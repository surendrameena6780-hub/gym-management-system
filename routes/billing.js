const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const { requireOwner } = require('../middleware/rbac');
const { getOutOfDirectoryBranchUsage, normalizeBranchDirectory } = require('../utils/branchAccess');
const {
    computeEffectiveBillingLimits,
    ensureGymBillingAddonSchema,
    getBillingAddon,
    getBillingConfig,
    getBillingPlanPrice,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
    isBillingPlanVisible,
    isAddonAllowedForPlan,
    normalizePlanId,
    serializeBillingConfig,
} = require('../utils/platformSettings');
const { recordRuntimeEvent } = require('../utils/runtimeTelemetry');

router.use(auth, requireOwner);

// Lazy Razorpay initializer — prevents crash when keys are not configured
let _razorpay = null;
const getRazorpay = () => {
    if (!_razorpay) {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables are required for billing.');
        }
        _razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }
    return _razorpay;
};

const buildRazorpayErrorDetails = (err) => ({
    status_code: Number(
        err?.statusCode
        || err?.error?.statusCode
        || err?.response?.status
        || err?.error?.status_code
        || 0
    ) || null,
    code: String(err?.error?.code || err?.code || '').trim() || null,
    field: String(err?.error?.field || '').trim() || null,
    source: String(err?.error?.source || '').trim() || null,
    reason: String(err?.error?.reason || '').trim() || null,
    description: String(err?.error?.description || err?.message || '').trim() || null,
});

const logBillingRazorpayError = (req, stage, error, metadata = {}) => {
    const details = buildRazorpayErrorDetails(error);
    const summary = details.description || details.reason || error?.message || 'Unknown Razorpay error';

    console.error(`RAZORPAY BILLING ${String(stage || 'unknown').toUpperCase()} ERROR:`, summary, details);
    void recordRuntimeEvent({
        eventType: 'PAYMENT_GATEWAY_ERROR',
        severity: 'ERROR',
        source: 'razorpay',
        message: `Billing ${stage} failed: ${summary}`,
        route: req?.originalUrl || '/api/billing',
        method: req?.method || 'POST',
        gymId: req?.user?.gym_id,
        userId: req?.user?.id,
        actorRole: req?.user?.role,
        metadata: {
            stage,
            ...metadata,
            ...details,
        },
    });
};

const ensureBillingAddonSchema = ensureGymBillingAddonSchema;

let ensureBillingCouponRedemptionSchemaPromise = null;
const ensureBillingCouponRedemptionSchema = async () => {
    if (!ensureBillingCouponRedemptionSchemaPromise) {
        ensureBillingCouponRedemptionSchemaPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
                id SERIAL PRIMARY KEY,
                coupon_code VARCHAR(32) NOT NULL,
                gym_id INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
                plan_tier VARCHAR(24) NOT NULL,
                billing_cycle VARCHAR(16) NOT NULL,
                razorpay_order_id VARCHAR(80),
                razorpay_payment_id VARCHAR(80) NOT NULL,
                discount_paise INTEGER NOT NULL DEFAULT 0,
                coupon_label VARCHAR(120),
                metadata JSONB DEFAULT '{}'::jsonb,
                redeemed_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (razorpay_payment_id)
            );

            CREATE INDEX IF NOT EXISTS idx_billing_coupon_redemptions_code
                ON billing_coupon_redemptions(coupon_code, redeemed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_billing_coupon_redemptions_gym
                ON billing_coupon_redemptions(gym_id, redeemed_at DESC);
        `).catch((error) => {
            ensureBillingCouponRedemptionSchemaPromise = null;
            throw error;
        });
    }

    await ensureBillingCouponRedemptionSchemaPromise;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = { monthly: 30, annual: 365 };
const ACTIVE_CREDIT_STATUSES = new Set(['ACTIVE']);
const MIN_RAZORPAY_AMOUNT_PAISE = 100;
const PLAN_SETUP_MODES = new Set(['balanced', 'flexible']);
const UNSUPPORTED_HELLO_ADDON_ERROR = 'Additional Hello numbers are not supported in the current release.';

const normalizeCycle = (value) => String(value || 'monthly').trim().toLowerCase();
const normalizePlanTier = (value) => normalizePlanId(value, 'pro');

const toPaise = (amountInr) => Math.max(0, Math.round((Number(amountInr) || 0) * 100));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const parseTimestampMs = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
};
const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const normalizeCouponCode = (value) => String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
const getCycleDays = (cycle, planTier) => {
    if (normalizePlanTier(planTier) === 'test') return 1;
    return CYCLE_DAYS[normalizeCycle(cycle)] || 30;
};
const normalizePayablePaise = (value) => {
    const normalized = Math.max(0, Math.round(Number(value) || 0));
    if (normalized > 0 && normalized < MIN_RAZORPAY_AMOUNT_PAISE) {
        return MIN_RAZORPAY_AMOUNT_PAISE;
    }
    return normalized;
};

const resolveSaasPrice = (billingConfig, planTier, cycle) => {
    const normalizedCycle = normalizeCycle(cycle);
    const normalizedPlan = normalizePlanTier(planTier);
    if (!['monthly', 'annual'].includes(normalizedCycle)) {
        return null;
    }
    return {
        planTier: normalizedPlan,
        cycle: normalizedCycle,
        amountInr: getBillingPlanPrice(billingConfig, normalizedPlan, normalizedCycle),
    };
};

const buildBillingQuote = ({
    billingConfig,
    currentPlan,
    currentCycle,
    currentStatus,
    currentValidUntil,
    targetPlan,
    targetCycle,
    now = Date.now(),
}) => {
    const resolvedTarget = resolveSaasPrice(billingConfig, targetPlan, targetCycle);
    if (!resolvedTarget) return null;

    const fullPricePaise = toPaise(resolvedTarget.amountInr);
    const renewalDays = getCycleDays(resolvedTarget.cycle, resolvedTarget.planTier);
    const baseQuote = {
        planTier: resolvedTarget.planTier,
        cycle: resolvedTarget.cycle,
        kind: 'fresh_purchase',
        fullPricePaise,
        payablePaise: fullPricePaise,
        creditPaise: 0,
        preserveCurrentExpiry: false,
        renewalDays,
        remainingRatio: 0,
        error: null,
    };

    const resolvedCurrent = resolveSaasPrice(billingConfig, currentPlan, currentCycle);
    const validUntilMs = parseTimestampMs(currentValidUntil);
    const currentStatusNormalized = String(currentStatus || '').trim().toUpperCase();
    const hasActiveCredit = Boolean(
        resolvedCurrent
        && ACTIVE_CREDIT_STATUSES.has(currentStatusNormalized)
        && validUntilMs
        && validUntilMs > now
    );

    if (!hasActiveCredit) {
        if (
            resolvedCurrent
            && resolvedCurrent.planTier === resolvedTarget.planTier
            && resolvedCurrent.cycle === resolvedTarget.cycle
        ) {
            return { ...baseQuote, kind: 'renewal' };
        }
        return baseQuote;
    }

    const currentPricePaise = toPaise(resolvedCurrent.amountInr);
    const currentCycleDays = getCycleDays(resolvedCurrent.cycle, resolvedCurrent.planTier);
    const remainingRatio = clamp((validUntilMs - now) / (currentCycleDays * DAY_MS), 0, 1);
    const currentRemainingCreditPaise = Math.floor(currentPricePaise * remainingRatio);

    if (
        resolvedCurrent.planTier === resolvedTarget.planTier
        && resolvedCurrent.cycle === resolvedTarget.cycle
    ) {
        return { ...baseQuote, kind: 'renewal', remainingRatio };
    }

    if (resolvedCurrent.cycle === resolvedTarget.cycle) {
        if (fullPricePaise <= currentPricePaise) {
            return {
                ...baseQuote,
                kind: 'downgrade_requires_renewal',
                payablePaise: 0,
                creditPaise: currentRemainingCreditPaise,
                remainingRatio,
                error: 'Switching to a lower-value plan should happen at renewal. Immediate proration is applied only for upgrades.',
            };
        }

        const targetRemainingPaise = Math.ceil(fullPricePaise * remainingRatio);
        return {
            ...baseQuote,
            kind: 'prorated_upgrade',
            payablePaise: normalizePayablePaise(targetRemainingPaise - currentRemainingCreditPaise),
            creditPaise: currentRemainingCreditPaise,
            preserveCurrentExpiry: true,
            remainingRatio,
        };
    }

    if (fullPricePaise <= currentRemainingCreditPaise) {
        return {
            ...baseQuote,
            kind: 'downgrade_requires_renewal',
            payablePaise: 0,
            creditPaise: currentRemainingCreditPaise,
            remainingRatio,
            error: 'Your current plan still has more remaining value than this switch. Schedule lower-value changes at renewal instead.',
        };
    }

    return {
        ...baseQuote,
        kind: 'cycle_switch_with_credit',
        payablePaise: normalizePayablePaise(fullPricePaise - currentRemainingCreditPaise),
        creditPaise: currentRemainingCreditPaise,
        remainingRatio,
    };
};

const buildBillingPreviewPayload = (quote, currentValidUntil = null) => ({
    kind: quote.kind,
    full_price_paise: quote.fullPricePaise,
    full_price_inr: quote.fullPricePaise / 100,
    payable_before_coupon_paise: quote.payableBeforeCouponPaise ?? quote.payablePaise,
    payable_before_coupon_inr: (quote.payableBeforeCouponPaise ?? quote.payablePaise) / 100,
    payable_paise: quote.payablePaise,
    payable_inr: quote.payablePaise / 100,
    credit_paise: quote.creditPaise,
    credit_inr: quote.creditPaise / 100,
    preserve_current_expiry: quote.preserveCurrentExpiry,
    current_valid_until: currentValidUntil || null,
    renewal_days: quote.renewalDays,
    remaining_ratio: quote.remainingRatio,
    error: quote.error,
    coupon_code: quote.couponCode || null,
    coupon_label: quote.couponLabel || null,
    coupon_discount_paise: Number(quote.couponDiscountPaise || 0),
    coupon_discount_inr: Number(quote.couponDiscountPaise || 0) / 100,
    coupon_status: quote.couponStatus || 'none',
    coupon_error: quote.couponError || null,
  });

const normalizePlanSetupInput = (value, gymBilling = {}, targetLimits = {}) => {
    const currentBranches = Math.max(1, toPositiveInt(gymBilling?.branches_count, 1));
    const rawRequestedBranches = Number.parseInt(value?.branches_count, 10);
    const requestedBranches = Number.isInteger(rawRequestedBranches) && rawRequestedBranches > 0
        ? rawRequestedBranches
        : currentBranches;
    const distributionMode = PLAN_SETUP_MODES.has(String(value?.distribution_mode || '').trim().toLowerCase())
        ? String(value.distribution_mode).trim().toLowerCase()
        : requestedBranches > 1
            ? 'balanced'
            : 'flexible';

    return {
        branchesCount: Math.max(1, Math.min(25, requestedBranches)),
        distributionMode,
        branchDirectory: normalizeBranchDirectory(gymBilling?.branch_directory, Math.max(1, Math.min(25, requestedBranches))),
        branchCap: targetLimits?.branches ?? null,
    };
};

const distributeEvenly = (total, count) => {
    if (total === null || total === undefined) {
        return Array.from({ length: count }, () => null);
    }

    const normalizedTotal = Math.max(0, Number(total) || 0);
    const normalizedCount = Math.max(1, Number(count) || 1);
    const baseShare = Math.floor(normalizedTotal / normalizedCount);
    const remainder = normalizedTotal % normalizedCount;

    return Array.from({ length: normalizedCount }, (_item, index) => baseShare + (index < remainder ? 1 : 0));
};

const buildPlanSetupPreview = ({ targetLimits, planSetup }) => {
    const branchesCount = Math.max(1, Number(planSetup?.branchesCount || 1));
    const branchDirectory = normalizeBranchDirectory(planSetup?.branchDirectory, branchesCount);
    const distributionMode = String(planSetup?.distributionMode || 'flexible').toLowerCase();
    const totals = {
        members: targetLimits?.members ?? null,
        staff: targetLimits?.staff ?? null,
        whatsapp: targetLimits?.whatsapp ?? null,
        hello: targetLimits?.hello ?? null,
        storage: targetLimits?.storage ?? null,
    };
    const equalSplit = distributionMode === 'balanced' && branchesCount > 1;
    const memberShares = equalSplit ? distributeEvenly(totals.members, branchesCount) : [];
    const staffShares = equalSplit ? distributeEvenly(totals.staff, branchesCount) : [];
    const whatsappShares = equalSplit ? distributeEvenly(totals.whatsapp, branchesCount) : [];
    const helloShares = equalSplit ? distributeEvenly(totals.hello, branchesCount) : [];

    return {
        branches_count: branchesCount,
        distribution_mode: distributionMode,
        mode_label: equalSplit ? 'Equal split' : 'Uneven / flexible pool',
        total_limits: totals,
        branch_preview: branchDirectory.map((branch, index) => ({
            id: branch.id,
            name: branch.name,
            members: branchesCount === 1
                ? totals.members
                : equalSplit
                    ? memberShares[index]
                    : null,
            staff: branchesCount === 1
                ? totals.staff
                : equalSplit
                    ? staffShares[index]
                    : null,
            whatsapp: branchesCount === 1
                ? totals.whatsapp
                : equalSplit
                    ? whatsappShares[index]
                    : null,
            hello: branchesCount === 1
                ? totals.hello
                : equalSplit
                    ? helloShares[index]
                    : null,
        })),
        notes: branchesCount === 1
            ? ['One active branch selected, so the live plan limits collapse to a single branch share.']
            : equalSplit
                ? ['Balanced mode shows an equal recommended split per branch while the total plan remains tied to the active branch count.']
                : ['Flexible mode keeps one shared gym-wide pool across the selected branches, so one branch can consume more than another.'],
    };
};

const BILLING_GUARD_LIMIT_KEYS = [
    'members',
    'staff',
    'branches',
];

const isLowerLimit = (currentValue, targetValue) => {
    if (currentValue === null || currentValue === undefined) {
        return targetValue !== null && targetValue !== undefined;
    }
    if (targetValue === null || targetValue === undefined) {
        return false;
    }
    return Number(targetValue) < Number(currentValue);
};

const isRestrictivePlanChange = (currentLimits, targetLimits) => (
    BILLING_GUARD_LIMIT_KEYS.some((limitKey) => isLowerLimit(currentLimits?.[limitKey], targetLimits?.[limitKey]))
);

const buildPlanChangeViolations = ({ configuredBranches, usageSnapshot, targetLimits, branchReductionViolations = [] }) => {
    const violations = [...branchReductionViolations];

    if (targetLimits.branches !== null && configuredBranches > targetLimits.branches) {
        violations.push(`This gym already has ${configuredBranches} configured branch${configuredBranches === 1 ? '' : 'es'}, but the target plan allows ${targetLimits.branches}. Reduce branches before switching plans.`);
    }

    if (targetLimits.members !== null && Number(usageSnapshot?.members || 0) > targetLimits.members) {
        violations.push(`This gym currently has ${Number(usageSnapshot.members || 0)} members, but the target plan allows ${targetLimits.members} across the gym.`);
    }

    if (targetLimits.staff !== null && Number(usageSnapshot?.staff || 0) > targetLimits.staff) {
        violations.push(`This gym currently has ${Number(usageSnapshot.staff || 0)} staff users, but the target plan allows ${targetLimits.staff} across the gym.`);
    }

    return violations;
};

const validatePlanChangeCompatibility = async ({ db, gymId, billingConfig, gymBilling, targetPlan, planSetup = null }) => {
    const currentLimits = computeEffectiveBillingLimits(billingConfig, gymBilling?.current_plan, gymBilling || {});
    const baseTargetLimits = computeEffectiveBillingLimits(billingConfig, targetPlan, gymBilling || {});
    const normalizedPlanSetup = normalizePlanSetupInput(planSetup, gymBilling || {}, baseTargetLimits);
    const projectedGymBilling = {
        ...(gymBilling || {}),
        branches_count: normalizedPlanSetup.branchesCount,
    };
    const targetLimits = computeEffectiveBillingLimits(billingConfig, targetPlan, projectedGymBilling);
    const branchReductionViolations = [];
    const currentConfiguredBranches = Number(gymBilling?.branches_count || 1);

    if (normalizedPlanSetup.branchesCount < currentConfiguredBranches) {
        const activeBranchIds = normalizedPlanSetup.branchDirectory.map((branch) => branch.id);
        const outOfDirectoryBranchUsage = await getOutOfDirectoryBranchUsage(db, gymId, activeBranchIds);

        if (outOfDirectoryBranchUsage.length > 0) {
            branchReductionViolations.push(`Branch reduction blocked. Move records out of ${outOfDirectoryBranchUsage.join(', ')} before switching to ${normalizedPlanSetup.branchesCount} branch${normalizedPlanSetup.branchesCount === 1 ? '' : 'es'}.`);
        }
    }

    if (!isRestrictivePlanChange(currentLimits, targetLimits) && branchReductionViolations.length === 0) {
        return { targetLimits, planSetup: normalizedPlanSetup, violations: [] };
    }

    const usageSnapshot = await getGymUsageSnapshot(db, gymId);

    return {
        targetLimits,
        planSetup: normalizedPlanSetup,
        violations: buildPlanChangeViolations({
            configuredBranches: normalizedPlanSetup.branchesCount,
            usageSnapshot,
            targetLimits,
            branchReductionViolations,
        }),
    };
};

const countCouponRedemptions = async (db, couponCode) => {
    await ensureBillingCouponRedemptionSchema();
    const result = await db.query(
        `SELECT COUNT(*)::INTEGER AS count
         FROM billing_coupon_redemptions
         WHERE coupon_code = $1`,
        [couponCode]
    );
    return Number(result.rows[0]?.count || 0);
};

const resolveBillingCoupon = async ({ db, billingConfig, couponCode, targetPlan, targetCycle, payablePaise }) => {
    const normalizedCode = normalizeCouponCode(couponCode);
    if (!normalizedCode) {
        return {
            normalizedCode: '',
            coupon: null,
            error: null,
            discountPaise: 0,
            payablePaise,
        };
    }

    const coupons = Array.isArray(billingConfig?.coupons) ? billingConfig.coupons : [];
    const coupon = coupons.find((item) => normalizeCouponCode(item?.code) === normalizedCode) || null;
    if (!coupon) {
        return {
            normalizedCode,
            coupon: null,
            error: 'Coupon code not found.',
            discountPaise: 0,
            payablePaise,
        };
    }

    if (coupon.active === false) {
        return {
            normalizedCode,
            coupon,
            error: 'This coupon is inactive.',
            discountPaise: 0,
            payablePaise,
        };
    }

    if (Array.isArray(coupon.applies_to_plans) && coupon.applies_to_plans.length > 0 && !coupon.applies_to_plans.includes(targetPlan)) {
        return {
            normalizedCode,
            coupon,
            error: 'This coupon does not apply to the selected plan.',
            discountPaise: 0,
            payablePaise,
        };
    }

    if (Array.isArray(coupon.applies_to_cycles) && coupon.applies_to_cycles.length > 0 && !coupon.applies_to_cycles.includes(targetCycle)) {
        return {
            normalizedCode,
            coupon,
            error: 'This coupon does not apply to the selected billing cycle.',
            discountPaise: 0,
            payablePaise,
        };
    }

    const now = Date.now();
    const validFromMs = parseTimestampMs(coupon.valid_from);
    const validUntilMs = parseTimestampMs(coupon.valid_until);
    if (validFromMs && now < validFromMs) {
        return {
            normalizedCode,
            coupon,
            error: 'This coupon is not active yet.',
            discountPaise: 0,
            payablePaise,
        };
    }

    if (validUntilMs && now > validUntilMs) {
        return {
            normalizedCode,
            coupon,
            error: 'This coupon has expired.',
            discountPaise: 0,
            payablePaise,
        };
    }

    const minimumAmountPaise = toPaise(coupon.minimum_amount || 0);
    if (minimumAmountPaise > 0 && payablePaise < minimumAmountPaise) {
        return {
            normalizedCode,
            coupon,
            error: `This coupon requires a minimum order of ₹${coupon.minimum_amount}.`,
            discountPaise: 0,
            payablePaise,
        };
    }

    if (coupon.max_redemptions !== null && coupon.max_redemptions !== undefined) {
        const redemptionCount = await countCouponRedemptions(db, normalizedCode);
        if (redemptionCount >= Number(coupon.max_redemptions || 0)) {
            return {
                normalizedCode,
                coupon,
                error: 'This coupon has reached its redemption limit.',
                discountPaise: 0,
                payablePaise,
            };
        }
    }

    const requestedDiscountPaise = String(coupon.discount_type || '').toUpperCase() === 'AMOUNT'
        ? toPaise(coupon.discount_value)
        : Math.floor(payablePaise * (Number(coupon.discount_value || 0) / 100));
    const nextPayablePaise = normalizePayablePaise(Math.max(0, payablePaise - requestedDiscountPaise));
    const discountPaise = Math.max(0, payablePaise - nextPayablePaise);

    if (discountPaise <= 0) {
        return {
            normalizedCode,
            coupon,
            error: 'This coupon does not reduce the current payable amount.',
            discountPaise: 0,
            payablePaise,
        };
    }

    return {
        normalizedCode,
        coupon,
        error: null,
        discountPaise,
        payablePaise: nextPayablePaise,
    };
};

const applyCouponToQuote = (quote, couponContext) => ({
    ...quote,
    payableBeforeCouponPaise: quote.payablePaise,
    payablePaise: couponContext?.error ? quote.payablePaise : Number(couponContext?.payablePaise ?? quote.payablePaise),
    couponCode: couponContext?.coupon?.code || couponContext?.normalizedCode || '',
    couponLabel: couponContext?.coupon?.label || '',
    couponDiscountPaise: couponContext?.error ? 0 : Number(couponContext?.discountPaise || 0),
    couponStatus: couponContext?.normalizedCode
        ? couponContext?.error
            ? 'invalid'
            : 'applied'
        : 'none',
    couponError: couponContext?.error || null,
});

const buildCheckoutContext = async ({ db, gymId, billingConfig, gymBilling, targetPlan, targetCycle, couponCode, planSetup }) => {
    const quote = buildBillingQuote({
        billingConfig,
        currentPlan: gymBilling?.current_plan,
        currentCycle: gymBilling?.saas_billing_cycle,
        currentStatus: gymBilling?.saas_status,
        currentValidUntil: gymBilling?.saas_valid_until,
        targetPlan,
        targetCycle,
    });

    if (!quote) {
        return { quote: null, compatibility: null, planSetupPreview: null };
    }

    const compatibility = await validatePlanChangeCompatibility({
        db,
        gymId,
        billingConfig,
        gymBilling,
        targetPlan,
        planSetup,
    });
    const couponContext = await resolveBillingCoupon({
        db,
        billingConfig,
        couponCode,
        targetPlan,
        targetCycle,
        payablePaise: quote.payablePaise,
    });
    const quoteWithCoupon = applyCouponToQuote(quote, couponContext);

    return {
        quote: quoteWithCoupon,
        compatibility,
        couponContext,
        planSetupPreview: buildPlanSetupPreview({
            targetLimits: compatibility?.targetLimits,
            planSetup: compatibility?.planSetup,
        }),
    };
};

// --- 0. PUBLIC CONFIG — returns the Razorpay key_id to authenticated frontend ---
router.get('/config', (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) return res.status(503).json({ error: 'Payment gateway not configured.' });
    res.json({ razorpay_key_id: keyId });
});

router.post('/preview', async (req, res) => {
    try {
        const billingConfig = await getBillingConfig();
        const resolved = resolveSaasPrice(billingConfig, req.body.plan_tier, req.body.cycle);
        if (!resolved) {
            return res.status(400).json({ error: 'Invalid plan_tier or cycle.' });
        }
        if (!isBillingPlanVisible(billingConfig, resolved.planTier)) {
            return res.status(400).json({ error: 'This plan is no longer available for new purchases.' });
        }

        const gym = await getGymBillingSnapshot(pool, req.user.gym_id) || {};
        const checkoutContext = await buildCheckoutContext({
            db: pool,
            gymId: req.user.gym_id,
            billingConfig,
            gymBilling: gym,
            targetPlan: resolved.planTier,
            targetCycle: resolved.cycle,
            couponCode: req.body?.coupon_code,
            planSetup: req.body?.plan_setup,
        });

        if (!checkoutContext.quote) {
            return res.status(400).json({ error: 'Unable to build billing quote.' });
        }

        if (checkoutContext.compatibility?.violations?.length > 0) {
            return res.status(409).json({
                error: checkoutContext.compatibility.violations[0],
                details: checkoutContext.compatibility.violations,
                effective_limits: checkoutContext.compatibility.targetLimits,
                billing_preview: buildBillingPreviewPayload(checkoutContext.quote, gym.saas_valid_until),
                plan_setup_preview: checkoutContext.planSetupPreview,
            });
        }

        if (checkoutContext.quote.error) {
            return res.status(400).json({
                error: checkoutContext.quote.error,
                billing_preview: buildBillingPreviewPayload(checkoutContext.quote, gym.saas_valid_until),
                plan_setup_preview: checkoutContext.planSetupPreview,
            });
        }

        return res.json({
            billing_preview: buildBillingPreviewPayload(checkoutContext.quote, gym.saas_valid_until),
            effective_limits: checkoutContext.compatibility?.targetLimits,
            plan_setup: {
                branches_count: checkoutContext.compatibility?.planSetup?.branchesCount,
                distribution_mode: checkoutContext.compatibility?.planSetup?.distributionMode,
            },
            plan_setup_preview: checkoutContext.planSetupPreview,
        });
    } catch (error) {
        console.error('BILLING PREVIEW ERROR:', error);
        return res.status(500).json({ error: 'Failed to load billing preview.' });
    }
});

// --- 1. CREATE DYNAMIC SAAS ORDER ---
router.post('/create-order', async (req, res) => {
    try {
        const billingConfig = await getBillingConfig();
        const resolved = resolveSaasPrice(billingConfig, req.body.plan_tier, req.body.cycle);
        if (!resolved) {
            return res.status(400).json({ error: 'Invalid plan_tier or cycle.' });
        }
        if (!isBillingPlanVisible(billingConfig, resolved.planTier)) {
            return res.status(400).json({ error: 'This plan is no longer available for new purchases.' });
        }

        const gym = await getGymBillingSnapshot(pool, req.user.gym_id) || {};
        const checkoutContext = await buildCheckoutContext({
            db: pool,
            gymId: req.user.gym_id,
            billingConfig,
            gymBilling: gym,
            targetPlan: resolved.planTier,
            targetCycle: resolved.cycle,
            couponCode: req.body?.coupon_code,
            planSetup: req.body?.plan_setup,
        });
        const quote = checkoutContext.quote;

        if (!quote) {
            return res.status(400).json({ error: 'Unable to build billing quote.' });
        }

        const compatibility = checkoutContext.compatibility;

        if (compatibility.violations.length > 0) {
            return res.status(409).json({
                error: compatibility.violations[0],
                details: compatibility.violations,
                effective_limits: compatibility.targetLimits,
                billing_preview: buildBillingPreviewPayload(quote, gym.saas_valid_until),
                plan_setup_preview: checkoutContext.planSetupPreview,
            });
        }

        if (quote.error) {
            return res.status(400).json({
                error: quote.error,
                billing_preview: buildBillingPreviewPayload(quote, gym.saas_valid_until),
                plan_setup_preview: checkoutContext.planSetupPreview,
            });
        }

        if (normalizeCouponCode(req.body?.coupon_code) && quote.couponError) {
            return res.status(400).json({
                error: quote.couponError,
                billing_preview: buildBillingPreviewPayload(quote, gym.saas_valid_until),
                plan_setup_preview: checkoutContext.planSetupPreview,
            });
        }

        if (quote.payablePaise <= 0) {
            return res.status(400).json({ error: 'No payable amount was generated for this change.' });
        }

        const options = {
            amount: quote.payablePaise,
            currency: "INR",
            // Razorpay receipt max 40 chars — keep short
            receipt: `saas_${req.user.gym_id}_${resolved.planTier}_${Date.now().toString().slice(-8)}`,
            notes: {
                gym_id: String(req.user.gym_id),
                plan_tier: resolved.planTier,
                cycle: resolved.cycle,
                quote_kind: quote.kind,
                payable_paise: String(quote.payablePaise),
                payable_before_coupon_paise: String(quote.payableBeforeCouponPaise ?? quote.payablePaise),
                credit_paise: String(quote.creditPaise),
                preserve_expiry: quote.preserveCurrentExpiry ? '1' : '0',
                renewal_days: String(quote.renewalDays),
                coupon_code: quote.couponCode || '',
                coupon_discount_paise: String(quote.couponDiscountPaise || 0),
                coupon_label: String(quote.couponLabel || '').slice(0, 120),
                setup_branches: String(compatibility?.planSetup?.branchesCount || gym.branches_count || 1),
                setup_mode: compatibility?.planSetup?.distributionMode || 'flexible',
            },
        };

        const order = await getRazorpay().orders.create(options);
        res.json({
            ...order,
            billing_preview: buildBillingPreviewPayload(quote, gym.saas_valid_until),
            effective_limits: compatibility.targetLimits,
            plan_setup_preview: checkoutContext.planSetupPreview,
        });
    } catch (error) {
        logBillingRazorpayError(req, 'create_order', error, {
            plan_tier: req.body?.plan_tier,
            cycle: req.body?.cycle,
        });
        console.error("RAZORPAY ORDER ERROR:", error);
        res.status(500).json({ error: "Failed to initiate payment" });
    }
});

// --- 2. VERIFY & SAVE PLAN ---
router.post('/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_tier, cycle } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign.toString()).digest("hex");

    if (razorpay_signature === expectedSign) {
        let order;
        let targetPlan;
        let targetCycle;
        let payablePaise;
        let preserveCurrentExpiry;
        let renewalDays;
        let plannedBranchesCount;
        let plannedDistributionMode;
        let couponCode;
        let couponDiscountPaise;
        let couponLabel;

        try {
            order = await getRazorpay().orders.fetch(razorpay_order_id);
            targetPlan = normalizePlanTier(order?.notes?.plan_tier || plan_tier);
            targetCycle = normalizeCycle(order?.notes?.cycle || cycle);
            payablePaise = Number.parseInt(order?.notes?.payable_paise, 10) || Number(order?.amount || 0);
            preserveCurrentExpiry = String(order?.notes?.preserve_expiry || '') === '1';
            renewalDays = Number.parseInt(order?.notes?.renewal_days, 10)
                || getCycleDays(targetCycle, targetPlan);
            plannedBranchesCount = Number.parseInt(order?.notes?.setup_branches, 10) || null;
            plannedDistributionMode = String(order?.notes?.setup_mode || '').trim().toLowerCase() || 'flexible';
            couponCode = normalizeCouponCode(order?.notes?.coupon_code || '');
            couponDiscountPaise = Number.parseInt(order?.notes?.coupon_discount_paise, 10) || 0;
            couponLabel = String(order?.notes?.coupon_label || '').trim() || null;
        } catch (err) {
            logBillingRazorpayError(req, 'fetch_order', err, {
                razorpay_order_id,
                plan_tier: plan_tier,
                cycle: cycle,
            });
            return res.status(502).json({ error: 'Failed to verify payment order with Razorpay.' });
        }

        const billingConfig = await getBillingConfig();
        const resolved = resolveSaasPrice(billingConfig, targetPlan, targetCycle);
        if (!resolved) {
            return res.status(400).json({ error: 'Invalid order metadata for subscription update.' });
        }

        try {
            if (!order || Number(order.amount) !== payablePaise || String(order.currency || '').toUpperCase() !== 'INR') {
                return res.status(400).json({ error: 'Order amount/currency mismatch.' });
            }

            if (couponCode && couponDiscountPaise > 0) {
                await ensureBillingCouponRedemptionSchema();
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const gymBilling = await getGymBillingSnapshot(client, req.user.gym_id);
                if (!gymBilling) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'Gym not found.' });
                }

                const compatibility = await validatePlanChangeCompatibility({
                    db: client,
                    gymId: req.user.gym_id,
                    billingConfig,
                    gymBilling,
                    targetPlan,
                    planSetup: {
                        branches_count: plannedBranchesCount,
                        distribution_mode: plannedDistributionMode,
                    },
                });
                if (compatibility.violations.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: compatibility.violations[0],
                        details: compatibility.violations,
                        effective_limits: compatibility.targetLimits,
                        plan_setup_preview: buildPlanSetupPreview({
                            targetLimits: compatibility.targetLimits,
                            planSetup: compatibility.planSetup,
                        }),
                    });
                }

                const nextBranchDirectory = normalizeBranchDirectory(
                    gymBilling.branch_directory,
                    compatibility.planSetup?.branchesCount || gymBilling.branches_count || 1
                );

                if (preserveCurrentExpiry) {
                    await client.query(
                        `UPDATE gyms
                         SET saas_status = 'ACTIVE',
                             current_plan = $1,
                             saas_billing_cycle = $2,
                             branches_count = $4,
                             branch_directory = $5,
                             saas_valid_until = CASE
                                 WHEN saas_valid_until IS NULL OR saas_valid_until <= CURRENT_TIMESTAMP
                                     THEN CURRENT_TIMESTAMP + ($3 || ' days')::interval
                                 ELSE saas_valid_until
                             END
                         WHERE id = $6`,
                        [
                            targetPlan,
                            targetCycle,
                            renewalDays,
                            compatibility.planSetup?.branchesCount || gymBilling.branches_count || 1,
                            JSON.stringify(nextBranchDirectory),
                            req.user.gym_id,
                        ]
                    );
                } else {
                    await client.query(
                        `UPDATE gyms
                         SET saas_status = 'ACTIVE',
                             current_plan = $1,
                             saas_billing_cycle = $2,
                             branches_count = $4,
                             branch_directory = $5,
                             saas_valid_until = CURRENT_TIMESTAMP + ($3 || ' days')::interval
                         WHERE id = $6`,
                        [
                            targetPlan,
                            targetCycle,
                            renewalDays,
                            compatibility.planSetup?.branchesCount || gymBilling.branches_count || 1,
                            JSON.stringify(nextBranchDirectory),
                            req.user.gym_id,
                        ]
                    );
                }

                if (couponCode && couponDiscountPaise > 0) {
                    await client.query(
                        `INSERT INTO billing_coupon_redemptions (
                            coupon_code,
                            gym_id,
                            plan_tier,
                            billing_cycle,
                            razorpay_order_id,
                            razorpay_payment_id,
                            discount_paise,
                            coupon_label,
                            metadata
                         )
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                         ON CONFLICT (razorpay_payment_id) DO NOTHING`,
                        [
                            couponCode,
                            req.user.gym_id,
                            targetPlan,
                            targetCycle,
                            razorpay_order_id,
                            razorpay_payment_id,
                            couponDiscountPaise,
                            couponLabel,
                            JSON.stringify({
                                distribution_mode: plannedDistributionMode,
                                branches_count: compatibility.planSetup?.branchesCount || gymBilling.branches_count || 1,
                            }),
                        ]
                    );
                }

                await client.query('COMMIT');
            } catch (err) {
                try {
                    await client.query('ROLLBACK');
                } catch (_rollbackError) {
                    // Preserve the original billing failure.
                }
                throw err;
            } finally {
                client.release();
            }
            const updatedGym = await getGymBillingSnapshot(pool, req.user.gym_id);
            const updatedLimits = updatedGym
                ? computeEffectiveBillingLimits(billingConfig, updatedGym.current_plan, updatedGym)
                : null;
            res.json({
                message: "Subscription activated!",
                effective_limits: updatedLimits,
                plan_setup_preview: buildPlanSetupPreview({
                    targetLimits: updatedLimits,
                    planSetup: {
                        branchesCount: updatedGym?.branches_count || plannedBranchesCount || 1,
                        distributionMode: plannedDistributionMode,
                        branchDirectory: normalizeBranchDirectory(updatedGym?.branch_directory, updatedGym?.branches_count || plannedBranchesCount || 1),
                    },
                }),
            });
        } catch (err) {
            res.status(500).json({ error: "DB Error" });
        }
    } else {
        res.status(400).json({ error: "Invalid signature!" });
    }
});

// --- 3. RESET TEST PLAN TIMER (dev only, only works if current_plan is 'test') ---
router.post('/reset-test', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found' });
    }
    try {
        const { rows } = await pool.query('SELECT current_plan FROM gyms WHERE id = $1', [req.user.gym_id]);
        if (!rows[0] || rows[0].current_plan !== 'test') {
            return res.status(400).json({ error: 'Reset is only available for the Test Drive plan.' });
        }
        const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await pool.query(
            `UPDATE gyms SET saas_valid_until = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE id = $1`,
            [req.user.gym_id]
        );
        res.json({ message: 'Test timer reset to 1 day.', saas_valid_until: newExpiry });
    } catch (err) {
        console.error('Reset test error:', err);
        res.status(500).json({ error: 'Failed to reset test timer.' });
    }
});

// --- 4. GET CURRENT ADD-ON COUNTS ---
router.get('/addons', async (req, res) => {
    try {
        await ensureBillingAddonSchema();
        const billingConfig = await getBillingConfig();
        const { rows } = await pool.query(
            `SELECT
                COALESCE(addon_extra_whatsapp, 0)  AS addon_extra_whatsapp,
                COALESCE(addon_extra_staff, 0)     AS addon_extra_staff,
                COALESCE(addon_extra_members, 0)   AS addon_extra_members,
                COALESCE(addon_extra_branches, 0)  AS addon_extra_branches,
                COALESCE(addon_extra_hello, 0)     AS addon_extra_hello
             FROM gyms WHERE id = $1`,
            [req.user.gym_id]
        );
        res.json({ addons: rows[0] || {}, pricing: serializeBillingConfig(billingConfig).addons });
    } catch (err) {
        console.error('Addon fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch add-ons.' });
    }
});

// --- 5. CREATE ADD-ON ORDER ---
router.post('/create-addon-order', async (req, res) => {
    try {
        const addonKey = String(req.body.addon_key || '').trim();
        if (addonKey === 'extra_hello_1') {
            return res.status(409).json({ error: UNSUPPORTED_HELLO_ADDON_ERROR });
        }

        const billingConfig = await getBillingConfig();
        const addon = getBillingAddon(billingConfig, addonKey);
        if (!addon) {
            return res.status(400).json({ error: 'Invalid add-on type.' });
        }

        const gym = await getGymBillingSnapshot(pool, req.user.gym_id);
        if (!gym) {
            return res.status(404).json({ error: 'Gym not found.' });
        }
        if (!isAddonAllowedForPlan(billingConfig, addonKey, gym.current_plan)) {
            return res.status(409).json({ error: 'This add-on is not available on your current plan.' });
        }

        const options = {
            amount: addon.price * 100,
            currency: 'INR',
            receipt: `addon_${req.user.gym_id}_${addonKey.slice(0, 12)}_${Date.now().toString().slice(-8)}`,
            notes: {
                gym_id: String(req.user.gym_id),
                addon_key: addonKey,
                type: 'addon',
            },
        };

        const order = await getRazorpay().orders.create(options);
        res.json(order);
    } catch (error) {
        logBillingRazorpayError(req, 'create_addon_order', error, { addon_key: req.body?.addon_key });
        res.status(500).json({ error: 'Failed to initiate add-on payment.' });
    }
});

// --- 6. VERIFY & APPLY ADD-ON ---
router.post('/verify-addon', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, addon_key } = req.body;
    const addonKey = String(addon_key || '').trim();
    if (addonKey === 'extra_hello_1') {
        return res.status(409).json({ error: UNSUPPORTED_HELLO_ADDON_ERROR });
    }

    const billingConfig = await getBillingConfig();
    const addon = getBillingAddon(billingConfig, addonKey);
    if (!addon) {
        return res.status(400).json({ error: 'Invalid add-on type.' });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(sign).digest('hex');

    if (razorpay_signature !== expectedSign) {
        return res.status(400).json({ error: 'Invalid signature!' });
    }

    let order;
    try {
        order = await getRazorpay().orders.fetch(razorpay_order_id);
    } catch (err) {
        logBillingRazorpayError(req, 'fetch_addon_order', err, { razorpay_order_id, addon_key: addonKey });
        return res.status(502).json({ error: 'Failed to verify add-on order with Razorpay.' });
    }

    if (!order || Number(order.amount) !== addon.price * 100 || String(order.currency || '').toUpperCase() !== 'INR') {
        return res.status(400).json({ error: 'Add-on order amount/currency mismatch.' });
    }

    try {
        await ensureBillingAddonSchema();
        const gym = await getGymBillingSnapshot(pool, req.user.gym_id);
        if (!gym) {
            return res.status(404).json({ error: 'Gym not found.' });
        }
        if (!isAddonAllowedForPlan(billingConfig, addonKey, gym.current_plan)) {
            return res.status(409).json({ error: 'This add-on is not available on your current plan.' });
        }
        const col = addon.column;
        const { rows } = await pool.query(
            `UPDATE gyms
             SET ${col} = COALESCE(${col}, 0) + $1
             WHERE id = $2
             RETURNING
                COALESCE(addon_extra_whatsapp, 0)  AS addon_extra_whatsapp,
                COALESCE(addon_extra_staff, 0)     AS addon_extra_staff,
                COALESCE(addon_extra_members, 0)   AS addon_extra_members,
                COALESCE(addon_extra_branches, 0)  AS addon_extra_branches,
                COALESCE(addon_extra_hello, 0)     AS addon_extra_hello`,
            [addon.increment, req.user.gym_id]
        );
        const updatedGym = await getGymBillingSnapshot(pool, req.user.gym_id);
        const effectiveLimits = updatedGym
            ? computeEffectiveBillingLimits(billingConfig, updatedGym.current_plan, updatedGym)
            : null;
        res.json({
            message: `${addon.label} added successfully!`,
            addons: rows[0],
            effective_limits: effectiveLimits,
        });
    } catch (err) {
        console.error('Addon apply error:', err);
        res.status(500).json({ error: 'Failed to apply add-on.' });
    }
});

module.exports = router;