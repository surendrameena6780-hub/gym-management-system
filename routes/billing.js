const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const { requireOwner } = require('../middleware/rbac');
const {
    ensureGymBillingAddonSchema,
    getBillingAddon,
    getBillingConfig,
    getBillingPlanPrice,
    getGymBillingSnapshot,
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

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = { monthly: 30, annual: 365 };
const ACTIVE_CREDIT_STATUSES = new Set(['ACTIVE']);
const MIN_RAZORPAY_AMOUNT_PAISE = 100;

const normalizeCycle = (value) => String(value || 'monthly').trim().toLowerCase();
const normalizePlanTier = (value) => normalizePlanId(value, 'pro');

const toPaise = (amountInr) => Math.max(0, Math.round((Number(amountInr) || 0) * 100));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const parseTimestampMs = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
};
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
    payable_paise: quote.payablePaise,
    payable_inr: quote.payablePaise / 100,
    credit_paise: quote.creditPaise,
    credit_inr: quote.creditPaise / 100,
    preserve_current_expiry: quote.preserveCurrentExpiry,
    current_valid_until: currentValidUntil || null,
    renewal_days: quote.renewalDays,
    remaining_ratio: quote.remainingRatio,
    error: quote.error,
  });

// --- 0. PUBLIC CONFIG — returns the Razorpay key_id to authenticated frontend ---
router.get('/config', (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) return res.status(503).json({ error: 'Payment gateway not configured.' });
    res.json({ razorpay_key_id: keyId });
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
        const quote = buildBillingQuote({
            billingConfig,
            currentPlan: gym.current_plan,
            currentCycle: gym.saas_billing_cycle,
            currentStatus: gym.saas_status,
            currentValidUntil: gym.saas_valid_until,
            targetPlan: resolved.planTier,
            targetCycle: resolved.cycle,
        });

        if (!quote) {
            return res.status(400).json({ error: 'Unable to build billing quote.' });
        }

        if (quote.error) {
            return res.status(400).json({
                error: quote.error,
                billing_preview: buildBillingPreviewPayload(quote, gym.saas_valid_until),
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
                credit_paise: String(quote.creditPaise),
                preserve_expiry: quote.preserveCurrentExpiry ? '1' : '0',
                renewal_days: String(quote.renewalDays),
            },
        };

        const order = await getRazorpay().orders.create(options);
        res.json({
            ...order,
            billing_preview: buildBillingPreviewPayload(quote, gym.saas_valid_until),
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

        try {
            order = await getRazorpay().orders.fetch(razorpay_order_id);
            targetPlan = normalizePlanTier(order?.notes?.plan_tier || plan_tier);
            targetCycle = normalizeCycle(order?.notes?.cycle || cycle);
            payablePaise = Number.parseInt(order?.notes?.payable_paise, 10) || Number(order?.amount || 0);
            preserveCurrentExpiry = String(order?.notes?.preserve_expiry || '') === '1';
            renewalDays = Number.parseInt(order?.notes?.renewal_days, 10)
                || getCycleDays(targetCycle, targetPlan);
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

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                if (preserveCurrentExpiry) {
                    await client.query(
                        `UPDATE gyms
                         SET saas_status = 'ACTIVE',
                             current_plan = $1,
                             saas_billing_cycle = $2,
                             saas_valid_until = CASE
                                 WHEN saas_valid_until IS NULL OR saas_valid_until <= CURRENT_TIMESTAMP
                                     THEN CURRENT_TIMESTAMP + ($3 || ' days')::interval
                                 ELSE saas_valid_until
                             END
                         WHERE id = $4`,
                        [targetPlan, targetCycle, renewalDays, req.user.gym_id]
                    );
                } else {
                    await client.query(
                        `UPDATE gyms
                         SET saas_status = 'ACTIVE',
                             current_plan = $1,
                             saas_billing_cycle = $2,
                             saas_valid_until = CURRENT_TIMESTAMP + ($3 || ' days')::interval
                         WHERE id = $4`,
                        [targetPlan, targetCycle, renewalDays, req.user.gym_id]
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
            res.json({ message: "Subscription activated!" });
        } catch (err) {
            res.status(500).json({ error: "DB Error" });
        }
    } else {
        res.status(400).json({ error: "Invalid signature!" });
    }
});

// --- 3. RESET TEST PLAN TIMER (dev only, only works if current_plan is 'test') ---
router.post('/reset-test', async (req, res) => {
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
        const billingConfig = await getBillingConfig();
        const addonKey = String(req.body.addon_key || '').trim();
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
        res.json({ message: `${addon.label} added successfully!`, addons: rows[0] });
    } catch (err) {
        console.error('Addon apply error:', err);
        res.status(500).json({ error: 'Failed to apply add-on.' });
    }
});

module.exports = router;