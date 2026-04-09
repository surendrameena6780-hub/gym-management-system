const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');
const { decryptSecret } = require('../utils/secretCrypto');
const { recordRuntimeEvent } = require('../utils/runtimeTelemetry');
const {
    BranchAccessError,
    branchSchemaMiddleware,
    DEFAULT_BRANCH_ID,
    ensureBranchAccess,
    resolveBranchReadScope,
} = require('../utils/branchAccess');
const {
    ensureInteger,
    ensureNumber,
    ensureTrimmedString,
    ensureChoice,
    isValidationError,
} = require('../utils/fieldValidation');

const router = express.Router();

router.use(auth, saasMiddleware, requireOwner);
router.use(branchSchemaMiddleware);

const DUE_ZERO_THRESHOLD = 0.009;
const PLAN_CHANGE_DUE_GRACE_DAYS = 15;
const COLLECTION_LINK_TTL_SECONDS = Math.max(1800, parseInt(process.env.RAZORPAY_COLLECTION_LINK_TTL_SECONDS || '86400', 10));
const PAYMENT_DEDUPE_WINDOW_SECONDS = Math.max(10, parseInt(process.env.PAYMENT_DEDUPE_WINDOW_SECONDS || '45', 10));
const IS_PRODUCTION_RUNTIME = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
let ensurePaymentCollectionsSchemaPromise;

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

const logCollectionRazorpayError = ({ stage, error, gymId = null, metadata = {} }) => {
    const details = buildRazorpayErrorDetails(error);
    const summary = details.description || details.reason || error?.message || 'Unknown Razorpay error';

    console.error(`RAZORPAY COLLECTION ${String(stage || 'unknown').toUpperCase()} ERROR:`, summary, details);
    void recordRuntimeEvent({
        eventType: 'PAYMENT_GATEWAY_ERROR',
        severity: 'ERROR',
        source: 'razorpay',
        message: `Collection ${stage} failed: ${summary}`,
        gymId,
        metadata: {
            stage,
            ...metadata,
            ...details,
        },
    });
};

const ensurePaymentCollectionsSchema = async () => {
    if (!ensurePaymentCollectionsSchemaPromise) {
        ensurePaymentCollectionsSchemaPromise = pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120);

            CREATE TABLE IF NOT EXISTS payment_collections (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                payment_id       INTEGER REFERENCES payments(id) ON DELETE CASCADE,
                collected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
                payment_mode     VARCHAR(50) DEFAULT 'Cash',
                transaction_id   VARCHAR(120),
                notes            TEXT DEFAULT '',
                collected_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_payment_collections_payment_id ON payment_collections(payment_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_gym_id ON payment_collections(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_created_at ON payment_collections(created_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_collections_transaction_unique
            ON payment_collections(gym_id, transaction_id)
            WHERE transaction_id IS NOT NULL;
        `);
    }

    await ensurePaymentCollectionsSchemaPromise;
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseAmount = (value) => {
    if (value === undefined || value === null || value === '') return NaN;
    return roundMoney(Number.parseFloat(value));
};

const normalizeDateInput = (value) => {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const formatCurrency = (value) => roundMoney(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

const buildAutoPaymentReference = (prefix, gymId, userId) => {
    const safePrefix = String(prefix || 'INV').trim().toUpperCase() || 'INV';
    const stamp = Date.now().toString(36).toUpperCase();
    const entropy = crypto.randomBytes(2).toString('hex').toUpperCase();
    return [safePrefix, gymId, userId, stamp, entropy].filter(Boolean).join('-');
};

const findRecentMatchingPayment = async (db, {
    gymId,
    userId,
    planId,
    amountPaid,
    totalAmount,
    paymentMode,
    transactionId,
    notes,
    dedupeSeconds = PAYMENT_DEDUPE_WINDOW_SECONDS,
}) => {
    const result = await db.query(
        `SELECT *
         FROM payments
         WHERE gym_id = $1
           AND user_id = $2
           AND plan_id = $3
           AND deleted_at IS NULL
           AND amount_paid = $4
           AND total_amount = $5
           AND LOWER(COALESCE(payment_mode, '')) = LOWER($6)
           AND ($7 = '' OR COALESCE(transaction_id, '') = $7)
           AND COALESCE(notes, '') = $8
           AND payment_date > NOW() - ($9 || ' seconds')::interval
         ORDER BY payment_date DESC
         LIMIT 1`,
        [
            gymId,
            userId,
            planId,
            amountPaid,
            totalAmount,
            String(paymentMode || ''),
            String(transactionId || ''),
            String(notes || ''),
            Math.max(10, dedupeSeconds),
        ]
    );

    return result.rows[0] || null;
};

const normalizeCollectionMode = (value, { defaultValue = 'Cash' } = {}) => {
    const normalized = ensureChoice(value, {
        field: 'payment_mode',
        choices: ['CASH', 'ONLINE'],
        defaultValue: String(defaultValue || 'Cash').trim().toUpperCase() || 'CASH',
        uppercase: true,
    }) || 'CASH';

    return normalized === 'ONLINE' ? 'Online' : 'Cash';
};

const normalizePaymentReference = (value, field = 'transaction_id') => ensureTrimmedString(value, { field, max: 120 });

const normalizePaymentNotes = (value, field = 'notes') => ensureTrimmedString(value, { field, max: 1000 });

const DEFAULT_BRANCH_SQL = `'${DEFAULT_BRANCH_ID}'`;

const getBranchFilterSql = (params, branchId, columnExpression = `COALESCE(p.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL})`) => {
    if (!branchId) {
        return '';
    }

    params.push(branchId);
    return ` AND ${columnExpression} = $${params.length}`;
};

const getMemberBranchId = async (db, gymId, memberId) => {
    const result = await db.query(
        `SELECT COALESCE(branch_id, $3) AS branch_id
         FROM members
         WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [memberId, gymId, DEFAULT_BRANCH_ID]
    );

    return result.rows[0]?.branch_id || null;
};

const getScopedPaymentRecord = async (db, gymId, paymentId) => {
    const result = await db.query(
        `SELECT p.id, COALESCE(p.branch_id, m.branch_id, $3) AS branch_id
         FROM payments p
         LEFT JOIN members m ON m.id = p.user_id AND m.gym_id = p.gym_id
         WHERE p.id = $1 AND p.gym_id = $2 AND p.deleted_at IS NULL
         LIMIT 1`,
        [paymentId, gymId, DEFAULT_BRANCH_ID]
    );

    return result.rows[0] || null;
};

const sendPaymentRouteError = (res, err, logLabel, fallback = 'Server Error') => {
    if (err instanceof BranchAccessError) {
        return res.status(err.statusCode).json({ error: err.message });
    }

    if (isValidationError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
    }

    console.error(logLabel, err.message);
    return res.status(500).json({ error: fallback });
};

const appendNote = (existingNotes, newNote) => {
    const current = String(existingNotes || '').trim();
    const incoming = String(newNote || '').trim();
    if (!incoming) return current;
    return current ? `${current}\n${incoming}` : incoming;
};

const PLAN_CHANGE_AUTO_RESOLVE_NOTE = `Auto-cleared remaining due because the member switched plans within ${PLAN_CHANGE_DUE_GRACE_DAYS} days.`;

const buildPlanChangeDueSummary = (context = {}) => {
    const removable = Array.isArray(context.removable_pending_dues) ? context.removable_pending_dues : [];
    const retained = Array.isArray(context.retained_pending_dues) ? context.retained_pending_dues : [];

    return {
        grace_days: PLAN_CHANGE_DUE_GRACE_DAYS,
        removed_count: removable.length,
        removed_total_due: roundMoney(removable.reduce((sum, entry) => sum + Number(entry.amount_due || 0), 0)),
        retained_count: retained.length,
        retained_total_due: roundMoney(retained.reduce((sum, entry) => sum + Number(entry.amount_due || 0), 0)),
        removable_pending_dues: removable,
        retained_pending_dues: retained,
    };
};

const getPlanChangeDueContext = async (db, { gymId, userId, nextPlanId }) => {
    if (!gymId || !userId || !nextPlanId) {
        return buildPlanChangeDueSummary();
    }

    const pendingResult = await db.query(
        `SELECT
            p.id,
            p.plan_id,
            p.invoice_id,
            p.amount_paid,
            p.amount_due,
            p.total_amount,
            p.notes,
            p.payment_date,
            COALESCE(pl.name, 'Membership') AS plan_name
         FROM payments p
         LEFT JOIN plans pl ON pl.id = p.plan_id AND pl.gym_id = p.gym_id
         WHERE p.gym_id = $1
           AND p.user_id = $2
           AND p.deleted_at IS NULL
           AND LOWER(COALESCE(p.status, '')) = 'pending'
           AND COALESCE(p.amount_due, 0) > $4
           AND COALESCE(p.plan_id, 0) <> $3
         ORDER BY p.payment_date DESC, p.id DESC`,
        [gymId, userId, nextPlanId, DUE_ZERO_THRESHOLD]
    );

    const graceCutoffMs = Date.now() - (PLAN_CHANGE_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const removable = [];
    const retained = [];

    pendingResult.rows.forEach((entry) => {
        const paymentDate = new Date(entry.payment_date);
        const normalizedEntry = {
            id: entry.id,
            plan_id: entry.plan_id,
            plan_name: entry.plan_name,
            invoice_id: entry.invoice_id,
            amount_paid: roundMoney(entry.amount_paid || 0),
            amount_due: roundMoney(entry.amount_due || 0),
            total_amount: roundMoney(entry.total_amount || 0),
            notes: entry.notes || '',
            payment_date: entry.payment_date,
        };

        if (!Number.isNaN(paymentDate.getTime()) && paymentDate.getTime() >= graceCutoffMs) {
            removable.push(normalizedEntry);
            return;
        }

        retained.push(normalizedEntry);
    });

    return buildPlanChangeDueSummary({
        removable_pending_dues: removable,
        retained_pending_dues: retained,
    });
};

const resolveRecentPlanChangeDues = async (db, { gymId, userId, nextPlanId }) => {
    const dueContext = await getPlanChangeDueContext(db, { gymId, userId, nextPlanId });

    for (const entry of dueContext.removable_pending_dues) {
        if (roundMoney(entry.amount_paid || 0) <= DUE_ZERO_THRESHOLD) {
            await db.query(
                `UPDATE payments
                 SET deleted_at = NOW(),
                     notes = $1
                 WHERE id = $2 AND gym_id = $3 AND deleted_at IS NULL`,
                [appendNote(entry.notes, PLAN_CHANGE_AUTO_RESOLVE_NOTE), entry.id, gymId]
            );
            continue;
        }

        await db.query(
            `UPDATE payments
             SET amount_due = 0,
                 total_amount = amount_paid,
                 status = 'Completed',
                 notes = $1
             WHERE id = $2 AND gym_id = $3 AND deleted_at IS NULL`,
            [appendNote(entry.notes, PLAN_CHANGE_AUTO_RESOLVE_NOTE), entry.id, gymId]
        );
    }

    return dueContext;
};

const buildAutoCollectionReference = (paymentId) => `DUE-${paymentId}-${Date.now().toString().slice(-6)}`;

const normalizeCollectionContact = (value) => {
    const digitsOnly = String(value || '').replace(/\D/g, '');
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return digitsOnly.slice(2);
    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) return digitsOnly.slice(1);
    if (digitsOnly.length < 10 || digitsOnly.length > 15) return '';
    return digitsOnly;
};

const buildPaymentLinkCustomer = (member = {}) => {
    const name = String(member.member_name || member.full_name || 'Gym member').trim() || 'Gym member';
    const email = String(member.member_email || member.email || '').trim();
    const contact = normalizeCollectionContact(member.member_phone || member.phone);
    const customer = { name };

    if (email) customer.email = email;
    if (contact) customer.contact = contact;

    return {
        customer,
        contact,
        email,
    };
};

const normalizeSettledPaymentEntity = (payment, fallbackAmountPaise = 0) => {
    const paymentId = String(payment?.payment_id || payment?.id || '').trim();
    const paymentStatus = String(payment?.status || '').trim().toLowerCase();
    if (!paymentId || paymentStatus === 'failed') {
        return null;
    }

    const rawAmount = Number(payment?.amount || fallbackAmountPaise || 0);
    return {
        paymentId,
        amount: Number.isFinite(rawAmount) ? Math.round(rawAmount) / 100 : 0,
        method: String(payment?.method || '').trim(),
    };
};

const buildPaidPaymentLinkResult = (paymentLink) => {
    const status = String(paymentLink?.status || '').trim().toLowerCase();
    if (status !== 'paid') {
        return null;
    }

    const paidAmountPaise = Number(paymentLink?.amount_paid || paymentLink?.amount || 0);
    const paymentCandidates = [];

    if (paymentLink?.payment_id) {
        paymentCandidates.push({
            id: paymentLink.payment_id,
            amount: paidAmountPaise,
            method: paymentLink.method,
            status: paymentLink.payment_status || paymentLink.status,
        });
    }

    if (Array.isArray(paymentLink?.payments)) {
        paymentCandidates.push(...paymentLink.payments);
    } else if (paymentLink?.payments && typeof paymentLink.payments === 'object') {
        if (Array.isArray(paymentLink.payments.items)) {
            paymentCandidates.push(...paymentLink.payments.items);
        }
        paymentCandidates.push(paymentLink.payments);
    }

    const settledPayment = paymentCandidates
        .map((payment) => normalizeSettledPaymentEntity(payment, paidAmountPaise))
        .find(Boolean);

    return {
        paymentId: settledPayment?.paymentId || '',
        linkId: String(paymentLink?.id || '').trim(),
        amount: Number.isFinite(paidAmountPaise) ? Math.round(paidAmountPaise) / 100 : 0,
        method: settledPayment?.method || String(paymentLink?.method || '').trim(),
    };
};

const resolvePaidPaymentLinkResult = async (razorpayClient, paymentLink) => {
    const settledPayment = buildPaidPaymentLinkResult(paymentLink);
    if (!settledPayment) {
        return null;
    }
    if (settledPayment.paymentId) {
        return settledPayment;
    }

    const linkId = String(paymentLink?.id || '').trim();
    if (!linkId || !razorpayClient?.api?.get) {
        return settledPayment;
    }

    try {
        const paymentList = await razorpayClient.api.get({
            url: '/payments',
            data: {
                payment_link_id: linkId,
                count: 10,
            },
        });
        const paidAmountPaise = Number(paymentLink?.amount_paid || paymentLink?.amount || 0);
        const fetchedPayment = (Array.isArray(paymentList?.items) ? paymentList.items : [])
            .map((payment) => normalizeSettledPaymentEntity(payment, paidAmountPaise))
            .find(Boolean);

        if (!fetchedPayment) {
            return settledPayment;
        }

        return {
            ...settledPayment,
            paymentId: fetchedPayment.paymentId,
            method: fetchedPayment.method || settledPayment.method,
            amount: fetchedPayment.amount || settledPayment.amount,
        };
    } catch (_err) {
        return settledPayment;
    }
};

const getRazorpayKeyEnvironment = (keyId) => {
    const normalizedKeyId = String(keyId || '').trim().toLowerCase();
    if (!normalizedKeyId) return 'UNKNOWN';
    if (normalizedKeyId.startsWith('rzp_test_')) return 'TEST';
    if (normalizedKeyId.startsWith('rzp_live_')) return 'LIVE';
    return 'UNKNOWN';
};

const buildManualCollectionRazorpayConfig = (gymConfig = {}) => {
    const keyId = String(gymConfig.member_razorpay_key_id || '').trim();
    const keySecret = decryptSecret(gymConfig.member_razorpay_key_secret_enc || '');
    if (!keyId || !keySecret) {
        return null;
    }

    return {
        connectMode: 'MANUAL',
        connectedAccount: '',
        keyId,
        keySecret,
        environment: getRazorpayKeyEnvironment(keyId),
        source: 'MANUAL',
    };
};

const buildPartnerCollectionRazorpayConfig = (gymConfig = {}) => {
    const connectedAccount = String(gymConfig.member_razorpay_connected_account_id || '').trim();
    const platformKeyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
    const platformKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!connectedAccount || !platformKeyId || !platformKeySecret) {
        return null;
    }

    return {
        connectMode: 'PARTNER',
        connectedAccount,
        keyId: platformKeyId,
        keySecret: platformKeySecret,
        environment: getRazorpayKeyEnvironment(platformKeyId),
        source: 'PARTNER',
    };
};

const serializeCollectionPaymentLink = (paymentLink, {
    referenceId = '',
    contact = '',
    email = '',
    notify = {},
    environment = 'UNKNOWN',
    gatewaySource = 'UNKNOWN',
} = {}) => ({
    id: paymentLink?.id,
    short_url: paymentLink?.short_url || '',
    status: paymentLink?.status || 'created',
    amount: Number.isFinite(Number(paymentLink?.amount)) ? Math.round(Number(paymentLink.amount)) / 100 : 0,
    currency: paymentLink?.currency || 'INR',
    reference: paymentLink?.reference_id || referenceId || '',
    customer_contact: contact || normalizeCollectionContact(paymentLink?.customer?.contact),
    customer_email: email || String(paymentLink?.customer?.email || '').trim(),
    notify: {
        sms: paymentLink?.notify?.sms ?? Boolean(notify.sms),
        email: paymentLink?.notify?.email ?? Boolean(notify.email),
    },
    created_at: Number.isFinite(Number(paymentLink?.created_at)) ? Number(paymentLink.created_at) : null,
    expire_by: Number.isFinite(Number(paymentLink?.expire_by)) ? Number(paymentLink.expire_by) : null,
    expired_at: Number.isFinite(Number(paymentLink?.expired_at)) ? Number(paymentLink.expired_at) : null,
    environment,
    gateway_source: gatewaySource,
});

const resolveCollectionRazorpayConfig = (gymConfig = {}) => {
    const requestedMode = String(gymConfig.member_payments_connect_mode || 'MANUAL').trim().toUpperCase() || 'MANUAL';
    const manualConfig = buildManualCollectionRazorpayConfig(gymConfig);
    const partnerConfig = buildPartnerCollectionRazorpayConfig(gymConfig);

    if (requestedMode === 'PARTNER') {
        if (partnerConfig && (!IS_PRODUCTION_RUNTIME || partnerConfig.environment !== 'TEST')) {
            return { razorpay: partnerConfig, gatewayNotice: '' };
        }

        if (manualConfig && manualConfig.environment === 'LIVE') {
            return {
                razorpay: {
                    ...manualConfig,
                    source: 'MANUAL_FALLBACK',
                },
                gatewayNotice: 'Partner mode was unavailable, so GymVault switched this payment to your saved live Razorpay keys.',
            };
        }

        if (partnerConfig && IS_PRODUCTION_RUNTIME && partnerConfig.environment === 'TEST') {
            return {
                razorpay: null,
                gatewayNotice: '',
                error: 'Razorpay partner setup is still using test-mode server keys. Switch Member Payments to Manual with live Razorpay keys or update the server to live partner keys.',
            };
        }

        if (manualConfig) {
            return {
                razorpay: {
                    ...manualConfig,
                    source: 'MANUAL_FALLBACK',
                },
                gatewayNotice: 'Partner mode was unavailable, so GymVault used your saved manual Razorpay keys for this payment.',
            };
        }
    }

    if (manualConfig) {
        return { razorpay: manualConfig, gatewayNotice: '' };
    }

    return { razorpay: null, gatewayNotice: '' };
};

const isMissingRazorpayEntityError = (err) => {
    const statusCode = Number(
        err?.statusCode
        || err?.error?.statusCode
        || err?.response?.status
        || err?.error?.status_code
        || 0
    );
    const message = String(err?.error?.description || err?.error?.reason || err?.message || '').toLowerCase();
    return statusCode === 404 || message.includes('not found') || message.includes('does not exist');
};

const fetchCollectionPaymentLinkSafely = async (razorpayClient, paymentLinkId) => {
    try {
        return {
            ok: true,
            paymentLink: await razorpayClient.paymentLink.fetch(paymentLinkId),
        };
    } catch (err) {
        if (isMissingRazorpayEntityError(err)) {
            return {
                ok: false,
                missing: true,
            };
        }
        throw err;
    }
};

const createCollectionRazorpayClient = (razorpayConfig) => {
    return new Razorpay({
        key_id: razorpayConfig.keyId,
        key_secret: razorpayConfig.keySecret,
    });
};

const createCollectionPaymentLink = async ({
    razorpayConfig,
    payeeName,
    amountPaise,
    referenceId,
    description,
    member,
    notes,
}) => {
    const { customer, contact, email } = buildPaymentLinkCustomer(member);
    const notify = {
        sms: Boolean(contact),
        email: Boolean(email),
    };

    const payload = {
        amount: amountPaise,
        currency: 'INR',
        reference_id: referenceId,
        description,
        customer,
        notify,
        reminder_enable: notify.sms || notify.email,
        expire_by: Math.floor(Date.now() / 1000) + COLLECTION_LINK_TTL_SECONDS,
        notes,
    };

    // Keep Route member collection on the platform link + transfer flow.
    // Direct connected-account payment links regressed in production and stopped behaving like the working Apr 4 Route setup.
    if (razorpayConfig.connectMode === 'PARTNER') {
        const feePercent = Math.max(0, Math.min(100, parseFloat(process.env.RAZORPAY_PLATFORM_FEE_PERCENT || '0')));
        const feeAmount = Math.round(amountPaise * feePercent / 100);
        const transferAmount = amountPaise - feeAmount;
        if (transferAmount <= 0) {
            throw new Error('Collection amount is too small for the configured platform fee.');
        }

        payload.options = {
            order: {
                transfers: [{
                    account: razorpayConfig.connectedAccount,
                    amount: transferAmount,
                    currency: 'INR',
                    on_hold: false,
                    notes,
                }],
            },
        };
    }

    const razorpayClient = createCollectionRazorpayClient(razorpayConfig);
    let paymentLink;

    try {
        paymentLink = await razorpayClient.paymentLink.create(payload);
    } catch (err) {
        logCollectionRazorpayError({
            stage: 'create_link',
            error: err,
            gymId: Number.parseInt(notes?.gym_id, 10) || null,
            metadata: {
                connect_mode: razorpayConfig.connectMode,
                connected_account_id: razorpayConfig.connectedAccount || '',
                gateway_source: razorpayConfig.source,
                environment: razorpayConfig.environment,
                reference_id: referenceId,
                amount_paise: amountPaise,
            },
        });
        throw err;
    }

    return {
        merchant_name: payeeName,
        payment_link: serializeCollectionPaymentLink(paymentLink, {
            referenceId,
            contact,
            email,
            notify,
            environment: razorpayConfig.environment,
            gatewaySource: razorpayConfig.source,
        }),
    };
};

const getGymCollectionSetup = async (gymId) => {
    const gymConfigRes = await pool.query(
        `SELECT
            name,
            member_payments_enabled,
            member_upi_id,
            member_razorpay_key_id,
            member_razorpay_key_secret_enc,
            member_payments_connect_mode,
            member_razorpay_connected_account_id
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId]
    );

    const gymConfig = gymConfigRes.rows[0] || {};
    if (!gymConfig.member_payments_enabled) {
        return { ok: false, status: 400, error: 'Member online collection is disabled in Integrations.' };
    }

    const payeeName = String(gymConfig.name || 'GymVault Gym').trim() || 'GymVault Gym';
    const upiId = String(gymConfig.member_upi_id || '').trim().toLowerCase();
    const upi = upiId
        ? {
            payeeName,
            upiId,
        }
        : null;

    const { razorpay, gatewayNotice, error: gatewayError } = resolveCollectionRazorpayConfig(gymConfig);

    if (gatewayError) {
        return { ok: false, status: 400, error: gatewayError };
    }

    if (!upi && !razorpay) {
        return {
            ok: false,
            status: 400,
            error: 'Configure Razorpay collection or a direct UPI ID in Integrations before collecting member payments online.',
        };
    }

    return {
        ok: true,
        data: {
            payeeName,
            upi,
            razorpay,
            gatewayNotice,
        },
    };
};

const getPendingPaymentById = async (db, gymId, paymentId, { lock = false } = {}) => {
    const query = `
        SELECT
            p.id,
            p.gym_id,
            COALESCE(p.branch_id, m.branch_id, $3) AS branch_id,
            p.user_id,
            p.plan_id,
            p.invoice_id,
            p.transaction_id,
            p.amount_paid,
            p.amount_due,
            p.total_amount,
            p.payment_date,
            p.status,
            p.payment_mode,
            p.notes,
            m.full_name AS member_name,
            m.email AS member_email,
            m.phone AS member_phone,
            pl.name AS plan_name
        FROM payments p
        JOIN members m ON m.id = p.user_id AND m.gym_id = p.gym_id AND m.deleted_at IS NULL
        LEFT JOIN plans pl ON pl.id = p.plan_id AND pl.gym_id = p.gym_id
        WHERE p.id = $1
          AND p.gym_id = $2
          AND p.deleted_at IS NULL
        ${lock ? 'FOR UPDATE OF p' : ''}
    `;
        const result = await db.query(query, [paymentId, gymId, DEFAULT_BRANCH_ID]);
    return result.rows[0] || null;
};

const resolveDueAmount = (requestedAmount, remainingDue) => {
    if (requestedAmount === undefined || requestedAmount === null || requestedAmount === '') {
        return roundMoney(remainingDue);
    }
    return parseAmount(requestedAmount);
};

const getGymGatewayConfig = async (gymId) => {
    const gymConfigRes = await pool.query(
        `SELECT
            member_payments_enabled,
            member_razorpay_key_id,
            member_razorpay_key_secret_enc,
            member_payments_connect_mode,
            member_razorpay_connected_account_id
         FROM gyms WHERE id = $1 LIMIT 1`,
        [gymId]
    );

    const gymConfig = gymConfigRes.rows[0] || {};
    const connectMode = String(gymConfig.member_payments_connect_mode || 'MANUAL').toUpperCase();
    const connectedAccount = String(gymConfig.member_razorpay_connected_account_id || '').trim();

    if (!gymConfig.member_payments_enabled) {
        return { ok: false, status: 400, error: 'Member online payments are disabled in Integrations.' };
    }

    if (connectMode === 'PARTNER') {
        if (!connectedAccount) {
            return { ok: false, status: 400, error: 'Razorpay account is not connected yet. Complete Connect Razorpay onboarding first.' };
        }
        return { ok: false, status: 410, error: 'Partner-mode Razorpay checkout is disabled. Use the Razorpay payment link flow instead.' };
    }

    const keyId = String(gymConfig.member_razorpay_key_id || '').trim();
    const keySecret = decryptSecret(gymConfig.member_razorpay_key_secret_enc || '');
    if (!keyId || !keySecret) {
        return { ok: false, status: 400, error: 'Razorpay member payment gateway is not configured. Please update Integrations.' };
    }

    return {
        ok: true,
        data: {
            connectMode,
            connectedAccount: '',
            keyId,
            keySecret,
        },
    };
};

const applyDueCollection = async ({ gymId, paymentId, amount, paymentMode, transactionId, notes, collectedBy }) => {
    await ensurePaymentCollectionsSchema();

    const normalizedPaymentId = ensureInteger(paymentId, { field: 'payment id', required: true, min: 1 });
    const normalizedMode = normalizeCollectionMode(paymentMode);
    const normalizedTransactionId = normalizePaymentReference(transactionId);
    const normalizedNotes = normalizePaymentNotes(notes);
    const normalizedCollectedBy = collectedBy ? ensureInteger(collectedBy, { field: 'collectedBy', min: 1 }) : null;
    const requestedAmountInput = amount === undefined || amount === null || amount === ''
        ? amount
        : ensureNumber(amount, { field: 'amount', min: 0, max: 1000000 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const payment = await getPendingPaymentById(client, gymId, normalizedPaymentId, { lock: true });
        if (!payment) {
            await client.query('ROLLBACK');
            return { ok: false, status: 404, error: 'Payment record not found.' };
        }

        const remainingDue = roundMoney(payment.amount_due);
        if (remainingDue <= DUE_ZERO_THRESHOLD) {
            await client.query('ROLLBACK');
            return { ok: false, status: 400, error: 'This payment no longer has a pending due.' };
        }

        const requestedAmount = resolveDueAmount(requestedAmountInput, remainingDue);
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
            await client.query('ROLLBACK');
            return { ok: false, status: 400, error: 'Enter a valid collection amount.' };
        }
        if (requestedAmount - remainingDue > DUE_ZERO_THRESHOLD) {
            await client.query('ROLLBACK');
            return { ok: false, status: 400, error: 'Collection amount cannot exceed the remaining due.' };
        }

        const collectionTransactionId = normalizedTransactionId || buildAutoCollectionReference(normalizedPaymentId);
        const nextAmountPaid = roundMoney(Number(payment.amount_paid || 0) + requestedAmount);
        const nextAmountDue = Math.max(0, roundMoney(remainingDue - requestedAmount));
        const nextStatus = nextAmountDue <= DUE_ZERO_THRESHOLD ? 'Completed' : 'Pending';
        const nextNotes = appendNote(payment.notes, normalizedNotes);
        const nextPaymentMode = Number(payment.amount_paid || 0) <= DUE_ZERO_THRESHOLD ? normalizedMode : payment.payment_mode;

        const collectionResult = await client.query(
            `INSERT INTO payment_collections
             (gym_id, branch_id, payment_id, collected_amount, payment_mode, transaction_id, notes, collected_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             RETURNING *`,
            [
                gymId,
                payment.branch_id || DEFAULT_BRANCH_ID,
                normalizedPaymentId,
                requestedAmount,
                normalizedMode,
                collectionTransactionId || null,
                normalizedNotes,
                normalizedCollectedBy,
            ]
        );

        const updatedPayment = await client.query(
            `UPDATE payments
             SET amount_paid = $1,
                 amount_due = $2,
                 status = $3,
                 payment_mode = $4,
                 transaction_id = CASE WHEN $5 <> '' THEN $5 ELSE transaction_id END,
                 notes = $6
             WHERE id = $7 AND gym_id = $8
             RETURNING *`,
            [
                nextAmountPaid,
                nextAmountDue,
                nextStatus,
                nextPaymentMode,
                normalizedMode === 'Online' ? collectionTransactionId : '',
                nextNotes,
                normalizedPaymentId,
                gymId,
            ]
        );

        await client.query('COMMIT');

        const message = nextAmountDue <= DUE_ZERO_THRESHOLD
            ? `Pending due cleared for ${payment.member_name}.`
            : `Collected ₹${formatCurrency(requestedAmount)}. ₹${formatCurrency(nextAmountDue)} is still pending for ${payment.member_name}.`;

        return {
            ok: true,
            data: {
                message,
                payment: updatedPayment.rows[0],
                collection: collectionResult.rows[0],
                remaining_due: nextAmountDue,
                member: {
                    id: payment.user_id,
                    full_name: payment.member_name,
                    email: payment.member_email,
                    phone: payment.member_phone,
                },
            },
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

router.get('/', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const { branchId } = await resolveBranchReadScope(pool, req);
        const search = String(req.query.search || '').trim();
        const filter = String(req.query.filter || 'ALL').trim().toUpperCase();
        const fromDate = normalizeDateInput(req.query.from);
        const toDate = normalizeDateInput(req.query.to);
        const paginate = String(req.query.paginate || '').toLowerCase() === 'true' || req.query.page !== undefined || req.query.limit !== undefined;
        const compact = String(req.query.compact || '').toLowerCase() === 'true';
        const page = Math.max(Number.parseInt(req.query.page || '1', 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 200);
        const offset = (page - 1) * limit;
        const gym_id = req.user.gym_id;

        const paymentSelectClause = compact ? `
                p.id,
                p.user_id,
                p.invoice_id,
                p.transaction_id,
                p.amount_paid,
                p.amount_due,
                p.total_amount,
                p.payment_date,
                p.status,
                p.payment_mode,
                COALESCE(p.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(pc.collected_total, 0), 0) AS initial_amount_paid,
                COALESCE(pc.online_collected_total, 0) AS due_online_collected,
                COALESCE(pc.cash_collected_total, 0) AS due_cash_collected,
                m.full_name AS member_name,
                pl.name AS plan_name
        ` : `
                p.id,
                p.user_id,
                p.invoice_id,
                p.transaction_id,
                p.amount_paid,
                p.amount_due,
                p.total_amount,
                p.payment_date,
                p.status,
                p.payment_mode,
                p.notes,
                COALESCE(p.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(pc.collected_total, 0), 0) AS initial_amount_paid,
                COALESCE(pc.collection_count, 0) AS collection_count,
                COALESCE(pc.collected_total, 0) AS collected_later,
                COALESCE(pc.online_collected_total, 0) AS due_online_collected,
                COALESCE(pc.cash_collected_total, 0) AS due_cash_collected,
                pc.last_collection_at,
                CASE
                    WHEN (
                        (LOWER(COALESCE(p.payment_mode, '')) = 'online' AND COALESCE(pc.cash_collected_total, 0) > 0)
                        OR (LOWER(COALESCE(p.payment_mode, '')) = 'cash' AND COALESCE(pc.online_collected_total, 0) > 0)
                        OR (COALESCE(pc.online_collected_total, 0) > 0 AND COALESCE(pc.cash_collected_total, 0) > 0)
                    ) THEN 'Mixed'
                    ELSE p.payment_mode
                END AS effective_payment_mode,
                m.full_name AS member_name,
                m.email AS member_email,
                m.phone AS member_phone,
                m.profile_pic,
                pl.name AS plan_name,
                pl.duration_days
        `;

        let baseQuery = `
            SELECT
                ${paymentSelectClause}
            FROM payments p
            JOIN members m ON p.user_id = m.id AND m.gym_id = p.gym_id
            LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*)::INTEGER AS collection_count,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total,
                    COALESCE(SUM(CASE WHEN LOWER(COALESCE(pc.payment_mode, '')) = 'online' THEN pc.collected_amount ELSE 0 END), 0) AS online_collected_total,
                    COALESCE(SUM(CASE WHEN LOWER(COALESCE(pc.payment_mode, '')) = 'cash' THEN pc.collected_amount ELSE 0 END), 0) AS cash_collected_total,
                    MAX(pc.created_at) AS last_collection_at
                FROM payment_collections pc
                WHERE pc.payment_id = p.id
            ) pc ON true
            WHERE p.gym_id = $1
              AND p.deleted_at IS NULL
              AND m.deleted_at IS NULL
        `;
        const params = [gym_id];
        baseQuery += getBranchFilterSql(params, branchId);

        if (search) {
            params.push(`%${search}%`);
            baseQuery += ` AND (
                m.full_name ILIKE $${params.length}
                OR m.email ILIKE $${params.length}
                OR m.phone ILIKE $${params.length}
                OR p.invoice_id ILIKE $${params.length}
                OR p.transaction_id ILIKE $${params.length}
                OR COALESCE(pl.name, '') ILIKE $${params.length}
            )`;
        }

        if (fromDate) {
            params.push(fromDate);
            baseQuery += ` AND p.payment_date::date >= $${params.length}::date`;
        }

        if (toDate) {
            params.push(toDate);
            baseQuery += ` AND p.payment_date::date <= $${params.length}::date`;
        }

        if (filter === 'PENDING') {
            baseQuery += ` AND LOWER(COALESCE(p.status, '')) = 'pending' AND COALESCE(p.amount_due, 0) > 0`;
        } else if (filter === 'CASH') {
            baseQuery += ` AND (LOWER(COALESCE(p.payment_mode, '')) = 'cash' OR COALESCE(pc.cash_collected_total, 0) > 0)`;
        } else if (filter === 'ONLINE') {
            baseQuery += ` AND (LOWER(COALESCE(p.payment_mode, '')) = 'online' OR COALESCE(pc.online_collected_total, 0) > 0)`;
        }

        const orderedQuery = `${baseQuery} ORDER BY p.payment_date DESC, p.id DESC`;
        const listResult = await pool.query(
            paginate
                ? `${orderedQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
                : orderedQuery,
            paginate ? [...params, limit, offset] : params
        );

        if (!paginate) {
            return res.json(listResult.rows);
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total FROM (${baseQuery}) payments_list`,
            params
        );
        const total = Number(countResult.rows[0]?.total || 0);

        return res.json({
            items: listResult.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                hasNext: page * limit < total,
                hasPrev: page > 1,
            },
        });
    } catch (err) {
        return sendPaymentRouteError(res, err, 'GET PAYMENTS ERROR:');
    }
});

router.get('/renewal-context/:member_id', async (req, res) => {
    try {
        const memberId = ensureInteger(req.params?.member_id, { field: 'member_id', required: true, min: 1 });
        const planId = ensureInteger(req.query?.plan_id, { field: 'plan_id', required: true, min: 1 });
        const gym_id = req.user.gym_id;

        const memberBranchId = await getMemberBranchId(pool, gym_id, memberId);
        if (!memberBranchId) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        ensureBranchAccess(await resolveBranchReadScope(pool, req), memberBranchId);

        const context = await getPlanChangeDueContext(pool, {
            gymId: gym_id,
            userId: memberId,
            nextPlanId: planId,
        });

        return res.json(context);
    } catch (err) {
        return sendPaymentRouteError(res, err, 'RENEWAL CONTEXT ERROR:');
    }
});

router.post('/record', async (req, res) => {
    let client;

    try {
        const gym_id = req.user.gym_id;
        const userId = ensureInteger(req.body?.user_id, { field: 'user_id', required: true, min: 1 });
        const planId = ensureInteger(req.body?.plan_id, { field: 'plan_id', required: true, min: 1 });
        const parsedAmountPaid = ensureNumber(req.body?.amount_paid, { field: 'amount_paid', required: true, min: 0, max: 1000000 });
        const parsedTotalAmount = req.body?.total_amount === undefined || req.body?.total_amount === null || req.body?.total_amount === ''
            ? parsedAmountPaid
            : ensureNumber(req.body?.total_amount, { field: 'total_amount', min: 0, max: 1000000 });

        if (parsedAmountPaid - parsedTotalAmount > DUE_ZERO_THRESHOLD) {
            return res.status(400).json({ error: 'amount_paid cannot be greater than total_amount.' });
        }

        client = await pool.connect();
        const amount_due = roundMoney(parsedTotalAmount - parsedAmountPaid);
        const status = amount_due > DUE_ZERO_THRESHOLD ? 'Pending' : 'Completed';
        const normalizedTransactionId = normalizePaymentReference(req.body?.transaction_id);
        const normalizedNotes = normalizePaymentNotes(req.body?.notes);
        const auto_inv_id = buildAutoPaymentReference('INV', gym_id, userId);

        const final_txn_id = normalizedTransactionId || auto_inv_id;
        const final_invoice_id = normalizedTransactionId.startsWith('pay_') ? normalizedTransactionId : auto_inv_id;
        const final_mode = normalizedTransactionId.startsWith('pay_') ? 'Online' : normalizeCollectionMode(req.body?.payment_mode);

        const [memberResult, planResult] = await Promise.all([
            client.query(
                'SELECT id, COALESCE(branch_id, $3) AS branch_id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [userId, gym_id, DEFAULT_BRANCH_ID]
            ),
            client.query(
                'SELECT id, duration_days FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [planId, gym_id]
            ),
        ]);

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found.' });
        }

        const branchScope = await resolveBranchReadScope(pool, req);
        const memberBranchId = ensureBranchAccess(branchScope, memberResult.rows[0].branch_id || DEFAULT_BRANCH_ID);

        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payment-record:${gym_id}:${userId}:${planId}`]);

        const existingPayment = await findRecentMatchingPayment(client, {
            gymId: gym_id,
            userId,
            planId,
            amountPaid: parsedAmountPaid,
            totalAmount: parsedTotalAmount,
            paymentMode: final_mode,
            transactionId: normalizedTransactionId,
            notes: normalizedNotes,
        });

        if (existingPayment) {
            await client.query('ROLLBACK');
            return res.json({
                msg: 'Payment already recorded. Ignoring duplicate submit.',
                payment: existingPayment,
                duplicate: true,
            });
        }

        const newPayment = await client.query(
            `INSERT INTO payments
             (gym_id, user_id, plan_id, amount_paid, amount_due, total_amount,
              payment_mode, status, invoice_id, transaction_id, notes, payment_date, branch_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
             RETURNING *`,
            [
                gym_id, userId, planId,
                parsedAmountPaid, amount_due, parsedTotalAmount,
                final_mode, status, final_invoice_id, final_txn_id, normalizedNotes, memberBranchId,
            ]
        );

        const planChangeDueResolution = await resolveRecentPlanChangeDues(client, {
            gymId: gym_id,
            userId,
            nextPlanId: planId,
        });

        await client.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [userId, gym_id]);

        const days = planResult.rows[0].duration_days || 30;
        await client.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status, branch_id)
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' day')::interval, 'ACTIVE', $5)`,
            [gym_id, userId, planId, days, memberBranchId]
        );

        await client.query(
            `UPDATE members
             SET status = 'ACTIVE',
                 joining_date = COALESCE(joining_date, CURRENT_DATE),
                 last_visit = NOW()
             WHERE id = $1 AND gym_id = $2`,
            [userId, gym_id]
        );

        await client.query(
            `INSERT INTO attendance (gym_id, member_id, check_in_time, branch_id)
             VALUES ($1, $2, NOW(), $3)`,
            [gym_id, userId, memberBranchId]
        );

        await client.query('COMMIT');
        res.json({
            msg: 'Payment Recorded!',
            payment: newPayment.rows[0],
            plan_change_due_resolution: planChangeDueResolution,
        });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        return sendPaymentRouteError(res, err, 'RECORD PAYMENT ERROR:');
    } finally {
        if (client) {
            client.release();
        }
    }
});

router.get('/stats', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const { branchId } = await resolveBranchReadScope(pool, req);
        const gym_id = req.user.gym_id;
        const fromDate = normalizeDateInput(req.query.from);
        const toDate = normalizeDateInput(req.query.to);
        const params = [gym_id];
        let paymentDateClause = '';
        const paymentBranchClause = getBranchFilterSql(params, branchId, `COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})`);

        if (fromDate) {
            params.push(fromDate);
            paymentDateClause += ` AND payment_date::date >= $${params.length}::date`;
        }

        if (toDate) {
            params.push(toDate);
            paymentDateClause += ` AND payment_date::date <= $${params.length}::date`;
        }

        const [revenue, today, pending] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(amount_paid), 0) AS total
                 FROM payments
                 WHERE gym_id = $1 AND deleted_at IS NULL${paymentBranchClause}${paymentDateClause}`,
                params
            ),
            pool.query(
                `WITH collection_totals AS (
                    SELECT
                        pc.payment_id,
                        COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                    FROM payment_collections pc
                    JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                    WHERE pc.gym_id = $1
                                            ${branchId ? `AND COALESCE(p.branch_id, ${DEFAULT_BRANCH_SQL}) = $${params.indexOf(branchId) + 1}` : ''}
                    GROUP BY pc.payment_id
                ),
                initial_payments_today AS (
                    SELECT COALESCE(SUM(GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0)), 0) AS total
                    FROM payments p
                    LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                    WHERE p.gym_id = $1
                      AND p.deleted_at IS NULL
                                            ${branchId ? `AND COALESCE(p.branch_id, ${DEFAULT_BRANCH_SQL}) = $${params.indexOf(branchId) + 1}` : ''}
                      ${paymentDateClause}
                      AND p.payment_date::date = CURRENT_DATE
                ),
                due_collections_today AS (
                    SELECT 0::numeric AS total
                )
                SELECT (
                    COALESCE((SELECT total FROM initial_payments_today), 0)
                    + COALESCE((SELECT total FROM due_collections_today), 0)
                ) AS total`,
                params
            ),
            pool.query(
                `SELECT COALESCE(SUM(amount_due), 0) AS pending
                 FROM payments
                 WHERE gym_id = $1
                   AND status = 'Pending'
                   AND deleted_at IS NULL${paymentBranchClause}${paymentDateClause}`,
                params
            ),
        ]);

        res.json({
            total_revenue: parseFloat(revenue.rows[0].total),
            today_revenue: parseFloat(today.rows[0].total),
            pending_dues: parseFloat(pending.rows[0].pending),
        });
    } catch (err) {
        return sendPaymentRouteError(res, err, 'PAYMENT STATS ERROR:');
    }
});

router.get('/chart', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const { branchId } = await resolveBranchReadScope(pool, req);
        const gym_id = req.user.gym_id;
        const days = req.query.days === '7' ? 7 : 30;
        const params = [gym_id, days];
        let paymentBranchClause = '';
        let dueBranchClause = '';

        if (branchId) {
            params.push(branchId);
            paymentBranchClause = ` AND COALESCE(p.branch_id, ${DEFAULT_BRANCH_SQL}) = $3`;
            dueBranchClause = ` AND COALESCE(p.branch_id, ${DEFAULT_BRANCH_SQL}) = $3`;
        }

        const chartData = await pool.query(
            `WITH collection_totals AS (
                SELECT
                    pc.payment_id,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                WHERE pc.gym_id = $1
                  ${dueBranchClause}
                GROUP BY pc.payment_id
            ),
            payment_events AS (
                SELECT
                    p.payment_date::date AS event_date,
                    GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0) AS revenue
                FROM payments p
                LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                WHERE p.gym_id = $1
                  AND p.deleted_at IS NULL
                                    ${paymentBranchClause}
            ),
            due_events AS (
                SELECT
                    pc.created_at::date AS event_date,
                    pc.collected_amount AS revenue
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id
                WHERE pc.gym_id = $1
                  AND p.deleted_at IS NULL
                                    ${dueBranchClause}
            ),
            all_events AS (
                SELECT event_date, revenue FROM payment_events
                UNION ALL
                SELECT event_date, revenue FROM due_events
            )
            SELECT
                TO_CHAR(event_date, 'YYYY-MM-DD') AS date,
                ROUND(SUM(revenue))::INTEGER AS revenue
            FROM all_events
            WHERE event_date >= CURRENT_DATE - (($2::int - 1) * INTERVAL '1 day')
            GROUP BY event_date
            ORDER BY event_date ASC`,
            params
        );

        res.json(chartData.rows.map((row) => ({ date: row.date, revenue: row.revenue || 0 })));
    } catch (err) {
        return sendPaymentRouteError(res, err, 'CHART ERROR:');
    }
});

router.get('/history/:member_id', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const { member_id } = req.params;
        const gym_id = req.user.gym_id;
        if (!member_id || member_id === 'undefined' || member_id === 'null') {
            return res.json([]);
        }

        const memberBranchId = await getMemberBranchId(pool, gym_id, member_id);
        if (!memberBranchId) {
            return res.json([]);
        }
        ensureBranchAccess(await resolveBranchReadScope(pool, req), memberBranchId);

        const history = await pool.query(
            `WITH collection_totals AS (
                SELECT
                    pc.payment_id,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                WHERE pc.gym_id = $2
                GROUP BY pc.payment_id
            ),
            base_payments AS (
                SELECT
                    p.payment_date,
                    GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0) AS amount_paid,
                    p.status,
                    p.invoice_id,
                    p.transaction_id,
                    p.payment_mode,
                    pl.name AS plan_name,
                    'PAYMENT' AS entry_type
                FROM payments p
                LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
                LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                WHERE p.user_id = $1
                  AND p.gym_id = $2
                  AND p.deleted_at IS NULL
            ),
            due_entries AS (
                SELECT
                    pc.created_at AS payment_date,
                    pc.collected_amount AS amount_paid,
                    CASE WHEN COALESCE(p.amount_due, 0) <= 0 THEN 'Completed' ELSE 'Pending' END AS status,
                    p.invoice_id,
                    pc.transaction_id,
                    pc.payment_mode,
                    CONCAT(COALESCE(pl.name, 'Membership'), ' · Due Collection') AS plan_name,
                    'DUE_COLLECTION' AS entry_type
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
                WHERE p.user_id = $1
                  AND pc.gym_id = $2
            )
            SELECT *
            FROM (
                SELECT * FROM base_payments
                UNION ALL
                SELECT * FROM due_entries
            ) payment_history
            ORDER BY payment_date DESC
            LIMIT 12`,
            [member_id, gym_id]
        );

        res.json(history.rows);
    } catch (err) {
        return sendPaymentRouteError(res, err, 'HISTORY ERROR:');
    }
});

router.post('/:id/due/create-order', async (req, res) => {
    try {
        const paymentId = ensureInteger(req.params.id, { field: 'payment id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const amount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
            ? req.body?.amount
            : ensureNumber(req.body?.amount, { field: 'amount', min: 0, max: 1000000 });
        await ensurePaymentCollectionsSchema();

        const scopedPayment = await getScopedPaymentRecord(pool, gym_id, paymentId);
        if (!scopedPayment) {
            return res.status(404).json({ error: 'Payment record not found.' });
        }
        ensureBranchAccess(await resolveBranchReadScope(pool, req), scopedPayment.branch_id);

        const payment = await getPendingPaymentById(pool, gym_id, paymentId);
        if (!payment) {
            return res.status(404).json({ error: 'Payment record not found.' });
        }

        const remainingDue = roundMoney(payment.amount_due);
        if (remainingDue <= DUE_ZERO_THRESHOLD) {
            return res.status(400).json({ error: 'This payment no longer has a pending due.' });
        }

        const collectionAmount = resolveDueAmount(amount, remainingDue);
        if (!Number.isFinite(collectionAmount) || collectionAmount <= 0) {
            return res.status(400).json({ error: 'Enter a valid collection amount.' });
        }
        if (collectionAmount - remainingDue > DUE_ZERO_THRESHOLD) {
            return res.status(400).json({ error: 'Collection amount cannot exceed the remaining due.' });
        }

        const collectionSetup = await getGymCollectionSetup(gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }

        let razorpay = null;
        if (collectionSetup.data.razorpay) {
            const amountPaise = Math.round(collectionAmount * 100);
            if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
                return res.status(400).json({ error: 'Pending due amount is invalid.' });
            }

            razorpay = await createCollectionPaymentLink({
                razorpayConfig: collectionSetup.data.razorpay,
                payeeName: collectionSetup.data.payeeName,
                amountPaise,
                referenceId: buildAutoCollectionReference(payment.id),
                description: `Pending due for ${payment.member_name}`,
                member: payment,
                notes: {
                    purpose: 'DUE_COLLECTION',
                    gym_id: String(gym_id),
                    payment_id: String(paymentId),
                    member_id: String(payment.user_id),
                    invoice_id: String(payment.invoice_id || ''),
                },
            });
        }

        return res.json({
            mode: 'COLLECTION',
            merchant_name: collectionSetup.data.payeeName,
            collection: collectionSetup.data.upi ? {
                amount: collectionAmount,
                currency: 'INR',
                payee_name: collectionSetup.data.upi.payeeName,
                upi_id: collectionSetup.data.upi.upiId,
                note: `Pending due · ${payment.member_name} · Invoice ${payment.invoice_id || payment.id}`,
                reference: buildAutoCollectionReference(payment.id),
            } : null,
            razorpay,
            channels: {
                upi: Boolean(collectionSetup.data.upi),
                razorpay: Boolean(razorpay),
            },
            payment: {
                id: payment.id,
                invoice_id: payment.invoice_id,
                amount_due: remainingDue,
                total_amount: Number(payment.total_amount || 0),
                member_name: payment.member_name,
                member_email: payment.member_email,
                member_phone: payment.member_phone,
                plan_name: payment.plan_name,
            },
        });
    } catch (err) {
        return sendPaymentRouteError(res, err, 'DUE COLLECTION CONTEXT ERROR:', 'Failed to prepare due collection details.');
    }
});

router.post('/:id/due/payment-link-status', async (req, res) => {
    try {
        const paymentId = ensureInteger(req.params.id, { field: 'payment id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const paymentLinkId = ensureTrimmedString(req.body?.payment_link_id, { field: 'payment_link_id', required: true, max: 120 });
        const amount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
            ? req.body?.amount
            : ensureNumber(req.body?.amount, { field: 'amount', min: 0, max: 1000000 });
        const notes = normalizePaymentNotes(req.body?.notes);
        await ensurePaymentCollectionsSchema();

        const scopedPayment = await getScopedPaymentRecord(pool, gym_id, paymentId);
        if (!scopedPayment) {
            return res.status(404).json({ error: 'Payment record not found.' });
        }
        ensureBranchAccess(await resolveBranchReadScope(pool, req), scopedPayment.branch_id);

        const collectionSetup = await getGymCollectionSetup(gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }
        if (!collectionSetup.data.razorpay) {
            return res.status(400).json({ error: 'Razorpay collection is not configured for this gym.' });
        }

        const razorpayClient = createCollectionRazorpayClient(collectionSetup.data.razorpay);
        const paymentLinkFetch = await fetchCollectionPaymentLinkSafely(razorpayClient, paymentLinkId);
        if (!paymentLinkFetch.ok) {
            return res.json({
                paid: false,
                status: 'NOT_FOUND',
                payment_link: {
                    id: paymentLinkId,
                    short_url: '',
                    status: 'not_found',
                    environment: collectionSetup.data.razorpay.environment,
                    gateway_source: collectionSetup.data.razorpay.source,
                },
            });
        }

        const paymentLink = paymentLinkFetch.paymentLink;
        const settledPayment = await resolvePaidPaymentLinkResult(razorpayClient, paymentLink);

        if (!settledPayment) {
            return res.json({
                paid: false,
                status: String(paymentLink.status || 'created').toUpperCase(),
                payment_link: serializeCollectionPaymentLink(paymentLink, {
                    environment: collectionSetup.data.razorpay.environment,
                    gatewaySource: collectionSetup.data.razorpay.source,
                }),
            });
        }

        const settledTransactionIds = Array.from(new Set([
            settledPayment.paymentId,
            settledPayment.linkId,
        ].map((value) => String(value || '').trim()).filter(Boolean)));

        const existingCollection = await pool.query(
            `SELECT 1
             FROM payment_collections
             WHERE gym_id = $1
               AND transaction_id = ANY($2::text[])
             LIMIT 1`,
            [gym_id, settledTransactionIds]
        );
        if (existingCollection.rows.length > 0) {
            return res.json({
                paid: true,
                already_processed: true,
                status: 'PAID',
                payment_id: settledPayment.paymentId || settledPayment.linkId,
                payment_method: settledPayment.method || null,
            });
        }

        const existingPayment = await pool.query(
            `SELECT 1
             FROM payments
             WHERE gym_id = $1
               AND transaction_id = ANY($2::text[])
               AND deleted_at IS NULL
             LIMIT 1`,
            [gym_id, settledTransactionIds]
        );
        if (existingPayment.rows.length > 0) {
            return res.json({
                paid: true,
                already_processed: true,
                status: 'PAID',
                payment_id: settledPayment.paymentId || settledPayment.linkId,
                payment_method: settledPayment.method || null,
            });
        }

        const result = await applyDueCollection({
            gymId: gym_id,
            paymentId,
            amount: Number.isFinite(Number(amount)) ? amount : settledPayment.amount,
            paymentMode: 'Online',
            transactionId: settledPayment.paymentId || settledPayment.linkId,
            notes,
            collectedBy: req.user.id,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json({
            ...result.data,
            paid: true,
            status: 'PAID',
            payment_id: settledPayment.paymentId || settledPayment.linkId,
            payment_method: settledPayment.method || null,
        });
    } catch (err) {
        return sendPaymentRouteError(res, err, 'DUE PAYMENT LINK STATUS ERROR:', 'Failed to verify Razorpay due collection.');
    }
});

router.post('/:id/due/collect', async (req, res) => {
    try {
        const paymentId = ensureInteger(req.params.id, { field: 'payment id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const scopedPayment = await getScopedPaymentRecord(pool, gym_id, paymentId);
        if (!scopedPayment) {
            return res.status(404).json({ error: 'Payment record not found.' });
        }
        ensureBranchAccess(await resolveBranchReadScope(pool, req), scopedPayment.branch_id);
        const result = await applyDueCollection({
            gymId: gym_id,
            paymentId,
            amount: req.body?.amount,
            paymentMode: req.body?.payment_mode || 'Cash',
            transactionId: req.body?.transaction_id,
            notes: req.body?.notes,
            collectedBy: req.user.id,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json(result.data);
    } catch (err) {
        return sendPaymentRouteError(res, err, 'DUE COLLECTION ERROR:', 'Failed to collect pending due.');
    }
});

router.post('/:id/due/verify', async (req, res) => {
    try {
        const paymentId = ensureInteger(req.params.id, { field: 'payment id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const amount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
            ? req.body?.amount
            : ensureNumber(req.body?.amount, { field: 'amount', min: 0, max: 1000000 });
        const notes = normalizePaymentNotes(req.body?.notes);
        const razorpay_order_id = ensureTrimmedString(req.body?.razorpay_order_id, { field: 'razorpay_order_id', required: true, max: 120 });
        const razorpay_payment_id = ensureTrimmedString(req.body?.razorpay_payment_id, { field: 'razorpay_payment_id', required: true, max: 120 });
        const razorpay_signature = ensureTrimmedString(req.body?.razorpay_signature, { field: 'razorpay_signature', required: true, max: 256 });
        await ensurePaymentCollectionsSchema();

        const scopedPayment = await getScopedPaymentRecord(pool, gym_id, paymentId);
        if (!scopedPayment) {
            return res.status(404).json({ error: 'Payment record not found.' });
        }
        ensureBranchAccess(await resolveBranchReadScope(pool, req), scopedPayment.branch_id);

        const gatewayConfig = await getGymGatewayConfig(gym_id);
        if (!gatewayConfig.ok) {
            return res.status(gatewayConfig.status).json({ error: gatewayConfig.error });
        }

        const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSign = crypto.createHmac('sha256', gatewayConfig.data.keySecret).update(sign).digest('hex');
        if (expectedSign !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature.' });
        }

        const existingCollection = await pool.query(
            `SELECT 1
             FROM payment_collections
             WHERE gym_id = $1
               AND transaction_id = $2
             LIMIT 1`,
            [gym_id, razorpay_payment_id]
        );
        if (existingCollection.rows.length > 0) {
            return res.status(409).json({ error: 'This due payment has already been processed.' });
        }

        const existingPayment = await pool.query(
            `SELECT 1
             FROM payments
             WHERE gym_id = $1
               AND transaction_id = $2
               AND deleted_at IS NULL
             LIMIT 1`,
            [gym_id, razorpay_payment_id]
        );
        if (existingPayment.rows.length > 0) {
            return res.status(409).json({ error: 'This payment reference has already been used.' });
        }

        const result = await applyDueCollection({
            gymId: gym_id,
            paymentId,
            amount,
            paymentMode: 'Online',
            transactionId: razorpay_payment_id,
            notes,
            collectedBy: req.user.id,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json(result.data);
    } catch (err) {
        return sendPaymentRouteError(res, err, 'ONLINE DUE VERIFY ERROR:', 'Failed to verify due payment.');
    }
});

router.delete('/:id', async (req, res) => {
    let client;
    try {
        const id = ensureInteger(req.params.id, { field: 'payment id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const scopedPayment = await getScopedPaymentRecord(pool, gym_id, id);
        if (!scopedPayment) {
            return res.status(404).json({ msg: 'Record not found' });
        }
        ensureBranchAccess(await resolveBranchReadScope(pool, req), scopedPayment.branch_id);
        client = await pool.connect();

        await client.query('BEGIN');

        const payInfo = await client.query(
            'SELECT user_id FROM payments WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL',
            [id, gym_id]
        );

        if (payInfo.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ msg: 'Record not found' });
        }
        const member_id = payInfo.rows[0].user_id;

        await client.query('UPDATE payments SET deleted_at = NOW() WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL', [id, gym_id]);
        await client.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [member_id, gym_id]);
        await client.query("UPDATE members SET status = 'UNPAID' WHERE id = $1 AND gym_id = $2", [member_id, gym_id]);

        await client.query('COMMIT');
        res.json({ msg: 'Record archived and membership reset to Unpaid' });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        return sendPaymentRouteError(res, err, 'DELETE PAYMENT ERROR:');
    } finally {
        if (client) {
            client.release();
        }
    }
});

module.exports = router;
module.exports.ensurePaymentCollectionsSchema = ensurePaymentCollectionsSchema;
module.exports.roundMoney = roundMoney;
module.exports.DUE_ZERO_THRESHOLD = DUE_ZERO_THRESHOLD;
module.exports.getGymCollectionSetup = getGymCollectionSetup;
module.exports.getPendingPaymentById = getPendingPaymentById;
module.exports.createCollectionPaymentLink = createCollectionPaymentLink;
module.exports.createCollectionRazorpayClient = createCollectionRazorpayClient;
module.exports.resolvePaidPaymentLinkResult = resolvePaidPaymentLinkResult;
module.exports.serializeCollectionPaymentLink = serializeCollectionPaymentLink;
module.exports.fetchCollectionPaymentLinkSafely = fetchCollectionPaymentLinkSafely;
module.exports.applyDueCollection = applyDueCollection;