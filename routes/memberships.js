const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const OAuthTokenClient = require('razorpay/dist/oAuthTokenClient');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner, requirePermission } = require('../middleware/rbac');
const { decryptSecret } = require('../utils/secretCrypto');
const {
    ensureInteger,
    ensureNumber,
    ensureTrimmedString,
    ensurePhone10,
    ensureEmail,
    ensureChoice,
    ensureDateOnly,
    isValidationError,
} = require('../utils/fieldValidation');

let ensureMemberPaymentsSchemaPromise;
const MEMBER_CONNECT_STATE_TTL_MS = Math.max(60, parseInt(process.env.RAZORPAY_PARTNER_STATE_TTL_SECONDS || '600', 10)) * 1000;
const COLLECTION_LINK_TTL_SECONDS = Math.max(1800, parseInt(process.env.RAZORPAY_COLLECTION_LINK_TTL_SECONDS || '86400', 10));
const ACTIVATION_DEDUPE_WINDOW_SECONDS = Math.max(10, parseInt(process.env.PAYMENT_DEDUPE_WINDOW_SECONDS || '45', 10));

const ensureMemberPaymentsSchema = async () => {
    if (!ensureMemberPaymentsSchemaPromise) {
        ensureMemberPaymentsSchemaPromise = pool.query(`
            ALTER TABLE gyms
            ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS member_razorpay_key_id VARCHAR(120),
            ADD COLUMN IF NOT EXISTS member_razorpay_key_secret_enc TEXT,
            ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120),
            ADD COLUMN IF NOT EXISTS member_payments_updated_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS member_payments_connect_mode VARCHAR(20) DEFAULT 'MANUAL',
            ADD COLUMN IF NOT EXISTS member_payments_onboarding_status VARCHAR(30) DEFAULT 'NOT_CONNECTED',
            ADD COLUMN IF NOT EXISTS member_razorpay_connected_account_id VARCHAR(120),
            ADD COLUMN IF NOT EXISTS member_payments_connect_meta JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS member_payments_connect_nonce_hash TEXT,
            ADD COLUMN IF NOT EXISTS member_payments_connect_nonce_expires_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS member_payments_connected_at TIMESTAMP;
        `);
    }
    await ensureMemberPaymentsSchemaPromise;
};

const buildDeskCollectionReference = (prefix, entityId) => {
    const safePrefix = String(prefix || 'COL').trim().toUpperCase() || 'COL';
    const safeEntityId = String(entityId || '').trim();
    const timeStamp = Date.now().toString(36).toUpperCase();
    const entropy = crypto.randomBytes(2).toString('hex').toUpperCase();
    return safeEntityId ? `${safePrefix}-${safeEntityId}-${timeStamp}-${entropy}` : `${safePrefix}-${timeStamp}-${entropy}`;
};

const normalizeMembershipPaymentMode = (value, { defaultValue = 'Cash' } = {}) => {
    const normalized = ensureChoice(value, {
        field: 'payment_mode',
        choices: ['CASH', 'ONLINE'],
        defaultValue: String(defaultValue || 'Cash').trim().toUpperCase() || 'CASH',
        uppercase: true,
    }) || 'CASH';

    return normalized === 'ONLINE' ? 'Online' : 'Cash';
};

const normalizePaymentReference = (value, field = 'payment_id') => ensureTrimmedString(value, { field, max: 120 });

const normalizeMembershipReason = (value, field = 'reason') => ensureTrimmedString(value, { field, max: 500 });

const findRecentActivationPayment = async (db, { gymId, memberId, planId, amount, paymentMode, transactionId }) => {
    const result = await db.query(
        `SELECT id, transaction_id, payment_date
         FROM payments
         WHERE gym_id = $1
           AND user_id = $2
           AND plan_id = $3
           AND deleted_at IS NULL
           AND amount_paid = $4
           AND total_amount = $4
           AND LOWER(COALESCE(payment_mode, '')) = LOWER($5)
           AND ($6 = '' OR COALESCE(transaction_id, '') = $6)
           AND payment_date > NOW() - ($7 || ' seconds')::interval
         ORDER BY payment_date DESC
         LIMIT 1`,
        [
            gymId,
            memberId,
            planId,
            amount,
            String(paymentMode || ''),
            String(transactionId || ''),
            ACTIVATION_DEDUPE_WINDOW_SECONDS,
        ]
    );

    return result.rows[0] || null;
};

const normalizeCollectionContact = (value) => {
    const digitsOnly = String(value || '').replace(/\D/g, '');
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return digitsOnly.slice(2);
    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) return digitsOnly.slice(1);
    if (digitsOnly.length < 10 || digitsOnly.length > 15) return '';
    return digitsOnly;
};

const buildPaymentLinkCustomer = (member = {}) => {
    const name = String(member.full_name || 'Gym member').trim() || 'Gym member';
    const email = String(member.email || '').trim();
    const contact = normalizeCollectionContact(member.phone);
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

const createCollectionRazorpayClient = (razorpayConfig) => {
    const headers = razorpayConfig.connectMode === 'PARTNER' && razorpayConfig.connectedAccount
        ? { 'X-Razorpay-Account': razorpayConfig.connectedAccount }
        : undefined;

    return new Razorpay({
        key_id: razorpayConfig.keyId,
        key_secret: razorpayConfig.keySecret,
        headers,
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

    const razorpayClient = createCollectionRazorpayClient(razorpayConfig);
    const paymentLink = await razorpayClient.paymentLink.create(payload);

    return {
        merchant_name: payeeName,
        payment_link: {
            id: paymentLink.id,
            short_url: paymentLink.short_url,
            status: paymentLink.status,
            amount: amountPaise / 100,
            currency: paymentLink.currency || 'INR',
            reference: paymentLink.reference_id || referenceId,
            customer_contact: contact,
            customer_email: email,
            notify,
        },
    };
};

const getGymCollectionSetup = async (gymId) => {
    await ensureMemberPaymentsSchema();

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

    const connectMode = String(gymConfig.member_payments_connect_mode || 'MANUAL').toUpperCase();
    const connectedAccount = String(gymConfig.member_razorpay_connected_account_id || '').trim();
    let razorpay = null;

    if (connectMode === 'PARTNER') {
        const platformKeyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
        const platformKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
        if (connectedAccount && platformKeyId && platformKeySecret) {
            razorpay = {
                connectMode,
                connectedAccount,
                keyId: platformKeyId,
                keySecret: platformKeySecret,
            };
        }
    } else {
        const keyId = String(gymConfig.member_razorpay_key_id || '').trim();
        const keySecret = decryptSecret(gymConfig.member_razorpay_key_secret_enc || '');
        if (keyId && keySecret) {
            razorpay = {
                connectMode,
                connectedAccount: '',
                keyId,
                keySecret,
            };
        }
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
        },
    };
};

const safeCompare = (left, right) => {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

const hashConnectNonce = (nonce) => crypto.createHash('sha256').update(String(nonce || ''), 'utf8').digest('hex');

const normalizeOrigin = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        return parsed.origin;
    } catch (_err) {
        return '';
    }
};

const extractConnectedAccountId = (tokenResponse = {}) => {
    const candidates = [
        tokenResponse.account_id,
        tokenResponse.connected_account_id,
        tokenResponse.razorpay_account_id,
        tokenResponse.merchant_id,
        tokenResponse.merchant?.id,
        tokenResponse.entity?.id,
    ];

    const accountId = candidates
        .map((value) => String(value || '').trim())
        .find((value) => value.startsWith('acc_'));

    return accountId || '';
};

const buildConnectMeta = ({ query = {}, tokenResponse = {} } = {}) => {
    return {
        callback: {
            error: String(query.error || '').trim() || null,
            error_description: String(query.error_description || '').trim() || null,
        },
        oauth: {
            scope: tokenResponse.scope || null,
            token_type: tokenResponse.token_type || null,
            expires_in: Number.isFinite(Number(tokenResponse.expires_in)) ? Number(tokenResponse.expires_in) : null,
            connected_account_id: extractConnectedAccountId(tokenResponse) || null,
        },
        updated_at: new Date().toISOString(),
    };
};

const renderConnectResultPage = ({ status, targetOrigin }) => {
    const message = status === 'CONNECTED'
        ? 'Razorpay connected successfully.'
        : status === 'FAILED'
            ? 'Razorpay onboarding failed.'
            : 'Razorpay onboarding updated.';
    const postMessageTarget = JSON.stringify(targetOrigin || '*');

    return `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;">
        <h3>${message}</h3>
        <p>You can close this window and return to GymVault Integrations.</p>
        <script>
            if (window.opener) {
                window.opener.postMessage({ type: 'GYMVAULT_RAZORPAY_CONNECT', status: '${status}' }, ${postMessageTarget});
            }
            setTimeout(function(){ window.close(); }, 1200);
        </script>
    </body></html>`;
};

const createSignedState = (payload) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET).update(encoded).digest('hex');
    return `${encoded}.${signature}`;
};

const verifySignedState = (stateValue) => {
    const raw = String(stateValue || '');
    const [encoded, signature] = raw.split('.');
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(encoded).digest('hex');
    if (!safeCompare(signature, expected)) return null;
    try {
        return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch (_err) {
        return null;
    }
};

const activateMembershipTransaction = async ({ gymId, memberId, planId, paymentMode, paymentId }) => {
    const client = await pool.connect();

    try {
        const normalizedGymId = ensureInteger(gymId, { field: 'gym id', required: true, min: 1 });
        const normalizedMemberId = ensureInteger(memberId, { field: 'member_id', required: true, min: 1 });
        const normalizedPlanId = ensureInteger(planId, { field: 'plan_id', required: true, min: 1 });
        const [planResult, memberResult] = await Promise.all([
            client.query(
                'SELECT * FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL',
                [normalizedPlanId, normalizedGymId]
            ),
            client.query(
                'SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [normalizedMemberId, normalizedGymId]
            ),
        ]);

        if (planResult.rows.length === 0) {
            return { ok: false, status: 404, error: 'Plan not found' };
        }

        if (memberResult.rows.length === 0) {
            return { ok: false, status: 404, error: 'Member not found' };
        }

        const plan = planResult.rows[0];
        const days = plan.duration_days || (plan.duration_months * 30) || 30;
        const price = parseFloat(plan.price) || 0;
        const normalizedPaymentId = normalizePaymentReference(paymentId);
        const finalMode = paymentMode
            ? normalizeMembershipPaymentMode(paymentMode)
            : (normalizedPaymentId.startsWith('pay_') ? 'Online' : 'Cash');
        const finalTxnId = normalizedPaymentId || buildDeskCollectionReference('INV', normalizedMemberId);

        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`membership-activate:${normalizedGymId}:${normalizedMemberId}:${normalizedPlanId}`]);

        const existingPayment = await findRecentActivationPayment(client, {
            gymId: normalizedGymId,
            memberId: normalizedMemberId,
            planId: normalizedPlanId,
            amount: price,
            paymentMode: finalMode,
            transactionId: normalizedPaymentId,
        });

        if (existingPayment) {
            await client.query('ROLLBACK');
            return {
                ok: true,
                data: {
                    message: 'Membership was already activated. Ignoring duplicate submit.',
                    payment_mode: finalMode,
                    transaction_id: existingPayment.transaction_id || finalTxnId,
                    amount: price,
                    plan_name: plan.name,
                    duplicate: true,
                },
            };
        }

        await client.query(
            "UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL",
            [normalizedMemberId, normalizedGymId]
        );
        await client.query(
            "UPDATE members SET status = 'ACTIVE', joining_date = COALESCE(joining_date, CURRENT_DATE) WHERE id = $1 AND gym_id = $2",
            [normalizedMemberId, normalizedGymId]
        );
        await client.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status)
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' day')::interval, 'ACTIVE')`,
            [normalizedGymId, normalizedMemberId, normalizedPlanId, days]
        );
        await client.query(
            `INSERT INTO payments
             (gym_id, user_id, plan_id, amount_paid, total_amount, payment_date, status, payment_mode, transaction_id, invoice_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), 'Completed', $6, $7, $8)`,
            [normalizedGymId, normalizedMemberId, normalizedPlanId, price, price, finalMode, finalTxnId, finalTxnId]
        );
        await client.query('COMMIT');

        return {
            ok: true,
            data: {
                message: 'Subscription Activated/Renewed Successfully!',
                payment_mode: finalMode,
                transaction_id: finalTxnId,
                amount: price,
                plan_name: plan.name,
            },
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
};

// --- 1. ACTIVATE / RENEW ---
router.post('/activate', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const planId = ensureInteger(req.body?.plan_id, { field: 'plan_id', required: true, min: 1 });
        const paymentId = normalizePaymentReference(req.body?.payment_id);
        const paymentMode = req.body?.payment_mode ? normalizeMembershipPaymentMode(req.body?.payment_mode) : undefined;

        const result = await activateMembershipTransaction({
            gymId: gym_id,
            memberId,
            planId,
            paymentMode,
            paymentId,
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.json(result.data);

    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("ACTIVATE ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/online/create-order', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const planId = ensureInteger(req.body?.plan_id, { field: 'plan_id', required: true, min: 1 });
        const collectionSetup = await getGymCollectionSetup(gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }

        const planResult = await pool.query(
            'SELECT id, name, price FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [planId, gym_id]
        );
        if (planResult.rows.length === 0) return res.status(404).json({ error: 'Plan not found.' });

        const memberResult = await pool.query(
            'SELECT id, full_name, email, phone FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [memberId, gym_id]
        );
        if (memberResult.rows.length === 0) return res.status(404).json({ error: 'Member not found.' });

        const plan = planResult.rows[0];
        const member = memberResult.rows[0];
        const amountPaise = Math.round(Number(plan.price || 0) * 100);
        if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
            return res.status(400).json({ error: 'Selected plan has invalid price.' });
        }

        let razorpay = null;
        if (collectionSetup.data.razorpay) {
            razorpay = await createCollectionPaymentLink({
                razorpayConfig: collectionSetup.data.razorpay,
                payeeName: collectionSetup.data.payeeName,
                amountPaise,
                referenceId: buildDeskCollectionReference('RZP', member.id),
                description: `${plan.name} membership for ${member.full_name}`,
                member,
                notes: {
                    purpose: 'MEMBER_PAYMENT',
                    gym_id: String(gym_id),
                    member_id: String(memberId),
                    plan_id: String(planId),
                },
            });
        }

        return res.json({
            mode: 'COLLECTION',
            merchant_name: collectionSetup.data.payeeName,
            collection: collectionSetup.data.upi ? {
                amount: Number(plan.price || 0),
                currency: 'INR',
                payee_name: collectionSetup.data.upi.payeeName,
                upi_id: collectionSetup.data.upi.upiId,
                note: `${plan.name} membership · ${member.full_name}`,
                reference: buildDeskCollectionReference('MEM', member.id),
            } : null,
            razorpay,
            channels: {
                upi: Boolean(collectionSetup.data.upi),
                razorpay: Boolean(razorpay),
            },
            member: {
                id: member.id,
                full_name: member.full_name,
                email: member.email,
                phone: member.phone,
            },
            plan: {
                id: plan.id,
                name: plan.name,
                price: Number(plan.price || 0),
            },
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER COLLECTION CONTEXT ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to prepare member collection details.' });
    }
});

router.post('/online/payment-link-status', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const planId = ensureInteger(req.body?.plan_id, { field: 'plan_id', required: true, min: 1 });
        const paymentLinkId = ensureTrimmedString(req.body?.payment_link_id, { field: 'payment_link_id', required: true, max: 120 });
        const collectionSetup = await getGymCollectionSetup(gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }
        if (!collectionSetup.data.razorpay) {
            return res.status(400).json({ error: 'Razorpay collection is not configured for this gym.' });
        }

        const razorpayClient = createCollectionRazorpayClient(collectionSetup.data.razorpay);
    const paymentLink = await razorpayClient.paymentLink.fetch(paymentLinkId);
        const settledPayment = await resolvePaidPaymentLinkResult(razorpayClient, paymentLink);

        if (!settledPayment) {
            return res.json({
                paid: false,
                status: String(paymentLink.status || 'created').toUpperCase(),
                payment_link: {
                    id: paymentLink.id,
                    short_url: paymentLink.short_url,
                    status: paymentLink.status,
                },
            });
        }

        const settledTransactionIds = Array.from(new Set([
            settledPayment.paymentId,
            settledPayment.linkId,
        ].map((value) => String(value || '').trim()).filter(Boolean)));

        const existingPayment = await pool.query(
            `SELECT id
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

        const result = await activateMembershipTransaction({
            gymId: gym_id,
            memberId,
            planId,
            paymentMode: 'Online',
            paymentId: settledPayment.paymentId || settledPayment.linkId,
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
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER PAYMENT LINK STATUS ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to verify Razorpay collection status.' });
    }
});

router.get('/online/connect-url', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();

        const gymId = req.user.gym_id;
        const clientId = String(process.env.RAZORPAY_PARTNER_CLIENT_ID || '').trim();
        const clientSecret = String(process.env.RAZORPAY_PARTNER_CLIENT_SECRET || '').trim();
        const redirectUri = String(process.env.RAZORPAY_PARTNER_REDIRECT_URI || '').trim();
        const connectBaseUrl = String(process.env.RAZORPAY_PARTNER_CONNECT_BASE_URL || '').trim();
        const requestOrigin = normalizeOrigin(req.headers.origin);

        if (!clientId || !clientSecret || !redirectUri) {
            return res.status(400).json({
                error: 'Partner connect is not configured on server. Set RAZORPAY_PARTNER_CLIENT_ID, RAZORPAY_PARTNER_CLIENT_SECRET, and RAZORPAY_PARTNER_REDIRECT_URI.',
            });
        }

        const nonce = crypto.randomBytes(24).toString('hex');
        const issuedAt = Date.now();
        const nonceExpiresAt = issuedAt + MEMBER_CONNECT_STATE_TTL_MS;

        const state = createSignedState({
            gym_id: gymId,
            user_id: req.user.id,
            origin: requestOrigin,
            nonce,
            issued_at: issuedAt,
        });

        await pool.query(
            `UPDATE gyms
             SET member_payments_connect_mode = 'PARTNER',
                 member_payments_onboarding_status = 'PENDING',
                 member_payments_connect_nonce_hash = $1,
                 member_payments_connect_nonce_expires_at = TO_TIMESTAMP($2 / 1000.0),
                 member_payments_updated_at = NOW()
             WHERE id = $3`,
            [hashConnectNonce(nonce), nonceExpiresAt, gymId]
        );

        let connectUrl;
        if (connectBaseUrl) {
            const url = new URL(connectBaseUrl);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('redirect_uri', redirectUri);
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('scope', 'read_write');
            url.searchParams.set('state', state);
            connectUrl = url.toString();
        } else {
            const oauthClient = new OAuthTokenClient();
            connectUrl = oauthClient.generateAuthUrl({
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: 'read_write',
                state,
            });
        }

        return res.json({ connect_url: connectUrl });
    } catch (err) {
        console.error('MEMBER PAY CONNECT URL ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to prepare Razorpay connect URL.' });
    }
});

router.get('/online/connect/callback', async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();

        const payload = verifySignedState(req.query.state);
        const gymId = Number(payload?.gym_id);
        const issuedAt = Number(payload?.issued_at || 0);
        const stateNonce = String(payload?.nonce || '').trim();
        const targetOrigin = normalizeOrigin(payload?.origin);

        if (!Number.isInteger(gymId) || !stateNonce || !issuedAt) {
            return res.status(400).send('<h3>Invalid onboarding state.</h3>');
        }

        if (Date.now() - issuedAt > MEMBER_CONNECT_STATE_TTL_MS) {
            return res.status(400).send('<h3>Onboarding state expired. Start the connection again.</h3>');
        }

        const nonceHash = hashConnectNonce(stateNonce);
        const stateCheck = await pool.query(
            `SELECT id
             FROM gyms
             WHERE id = $1
               AND member_payments_connect_nonce_hash = $2
               AND member_payments_connect_nonce_expires_at IS NOT NULL
               AND member_payments_connect_nonce_expires_at >= NOW()
             LIMIT 1`,
            [gymId, nonceHash]
        );

        if (stateCheck.rows.length === 0) {
            return res.status(400).send('<h3>Onboarding state is invalid or already used.</h3>');
        }

        const code = String(req.query.code || '').trim();
        const error = String(req.query.error || '').trim();

        if (error) {
            await pool.query(
                `UPDATE gyms
                 SET member_payments_connect_mode = 'PARTNER',
                     member_payments_onboarding_status = 'FAILED',
                     member_payments_connect_meta = $1::jsonb,
                     member_payments_connect_nonce_hash = NULL,
                     member_payments_connect_nonce_expires_at = NULL,
                     member_payments_updated_at = NOW()
                 WHERE id = $2 AND member_payments_connect_nonce_hash = $3`,
                [JSON.stringify(buildConnectMeta({ query: req.query })), gymId, nonceHash]
            );

            return res.send(renderConnectResultPage({ status: 'FAILED', targetOrigin }));
        }

        if (!code) {
            await pool.query(
                `UPDATE gyms
                 SET member_payments_connect_mode = 'PARTNER',
                     member_payments_onboarding_status = 'FAILED',
                     member_payments_connect_meta = $1::jsonb,
                     member_payments_connect_nonce_hash = NULL,
                     member_payments_connect_nonce_expires_at = NULL,
                     member_payments_updated_at = NOW()
                 WHERE id = $2 AND member_payments_connect_nonce_hash = $3`,
                [JSON.stringify(buildConnectMeta({ query: req.query })), gymId, nonceHash]
            );

            return res.status(400).send('<h3>Missing Razorpay authorization code.</h3>');
        }

        const clientId = String(process.env.RAZORPAY_PARTNER_CLIENT_ID || '').trim();
        const clientSecret = String(process.env.RAZORPAY_PARTNER_CLIENT_SECRET || '').trim();
        const redirectUri = String(process.env.RAZORPAY_PARTNER_REDIRECT_URI || '').trim();

        if (!clientId || !clientSecret || !redirectUri) {
            await pool.query(
                `UPDATE gyms
                 SET member_payments_onboarding_status = 'FAILED',
                     member_payments_connect_meta = $1::jsonb,
                     member_payments_connect_nonce_hash = NULL,
                     member_payments_connect_nonce_expires_at = NULL,
                     member_payments_updated_at = NOW()
                 WHERE id = $2 AND member_payments_connect_nonce_hash = $3`,
                [JSON.stringify(buildConnectMeta({ query: req.query })), gymId, nonceHash]
            );
            return res.status(500).send('<h3>Partner onboarding is not configured on server.</h3>');
        }

        const oauthClient = new OAuthTokenClient();

        try {
            const tokenResponse = await oauthClient.getAccessToken({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
                code,
            });
            const accountId = extractConnectedAccountId(tokenResponse);
            const onboardingStatus = accountId ? 'CONNECTED' : 'AUTHORIZED';

            await pool.query(
                `UPDATE gyms
                 SET member_payments_connect_mode = 'PARTNER',
                     member_payments_onboarding_status = $1,
                     member_razorpay_connected_account_id = CASE WHEN $2 <> '' THEN $2 ELSE member_razorpay_connected_account_id END,
                     member_payments_connect_meta = $3::jsonb,
                     member_payments_connected_at = CASE WHEN $1 = 'CONNECTED' THEN NOW() ELSE member_payments_connected_at END,
                     member_payments_connect_nonce_hash = NULL,
                     member_payments_connect_nonce_expires_at = NULL,
                     member_payments_updated_at = NOW()
                 WHERE id = $4 AND member_payments_connect_nonce_hash = $5`,
                [onboardingStatus, accountId, JSON.stringify(buildConnectMeta({ query: req.query, tokenResponse })), gymId, nonceHash]
            );

            return res.send(renderConnectResultPage({ status: onboardingStatus, targetOrigin }));
        } catch (exchangeErr) {
            console.error('MEMBER PAY CONNECT TOKEN EXCHANGE ERROR:', exchangeErr.message);
            await pool.query(
                `UPDATE gyms
                 SET member_payments_onboarding_status = 'FAILED',
                     member_payments_connect_meta = $1::jsonb,
                     member_payments_connect_nonce_hash = NULL,
                     member_payments_connect_nonce_expires_at = NULL,
                     member_payments_updated_at = NOW()
                 WHERE id = $2 AND member_payments_connect_nonce_hash = $3`,
                [JSON.stringify(buildConnectMeta({ query: req.query })), gymId, nonceHash]
            );

            return res.status(500).send(renderConnectResultPage({ status: 'FAILED', targetOrigin }));
        }
    } catch (err) {
        console.error('MEMBER PAY CONNECT CALLBACK ERROR:', err.message);
        return res.status(500).send('<h3>Failed to process onboarding callback.</h3>');
    }
});

router.post('/online/connect/disconnect', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();
        await pool.query(
            `UPDATE gyms
             SET member_payments_enabled = FALSE,
                 member_payments_connect_mode = 'MANUAL',
                 member_payments_onboarding_status = 'NOT_CONNECTED',
                 member_razorpay_connected_account_id = NULL,
                 member_payments_connect_meta = '{}'::jsonb,
                 member_payments_connect_nonce_hash = NULL,
                 member_payments_connect_nonce_expires_at = NULL,
                 member_payments_connected_at = NULL,
                 member_payments_updated_at = NOW()
             WHERE id = $1`,
            [req.user.gym_id]
        );
        return res.json({ message: 'Razorpay connection removed.' });
    } catch (err) {
        console.error('MEMBER PAY DISCONNECT ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to disconnect Razorpay account.' });
    }
});

// Create a Razorpay linked account for gym owners who do NOT have a Razorpay account.
// Razorpay will email them to complete KYC (PAN + bank) on their own platform.
// We get back acc_XXXXX immediately and can start routing payments to it.
router.post('/online/linked-account/create', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();
        const gym_id = req.user.gym_id;

        const legal_business_name = ensureTrimmedString(req.body?.legal_business_name, { field: 'legal_business_name', required: true, min: 2, max: 120 });
        const business_email = ensureEmail(req.body?.business_email, { field: 'business_email', required: true, max: 120 });
        const business_phone = req.body?.business_phone ? ensurePhone10(req.body?.business_phone, { field: 'business_phone' }) : '';
        const city = ensureTrimmedString(req.body?.city, { field: 'city', required: true, min: 2, max: 60 });
        const state = ensureTrimmedString(req.body?.state, { field: 'state', required: true, min: 2, max: 40, uppercase: true });
        const pincode = ensureTrimmedString(req.body?.pincode, { field: 'pincode', required: true, min: 6, max: 10 });

        if (!/^\d{6}$/.test(pincode)) {
            return res.status(400).json({ error: 'pincode must be exactly 6 digits.' });
        }

        const platformKeyId     = String(process.env.RAZORPAY_KEY_ID || '').trim();
        const platformKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
        if (!platformKeyId || !platformKeySecret) {
            return res.status(500).json({ error: 'Platform Razorpay gateway not configured. Contact support.' });
        }

        const platformRazorpay = new Razorpay({ key_id: platformKeyId, key_secret: platformKeySecret });

        // Step 1: Create the linked account under GymVault's Razorpay account.
        // Razorpay emails the gym owner to complete KYC (PAN + bank details).
        const account = await platformRazorpay.accounts.create({
            email: business_email,
            profile: {
                category: 'healthcare',
                subcategory: 'fitness_centres_gyms_sports_clubs',
                addresses: {
                    registered: {
                        street1: city,
                        city,
                        state,
                        postal_code: pincode,
                        country: 'IN',
                    },
                },
            },
            legal_business_name,
            business_type: 'individual',
            ...(business_phone ? { legal_info: {} } : {}),
        });

        if (!account || !account.id) {
            return res.status(502).json({ error: 'Razorpay did not return an account ID. Try again.' });
        }

        // Step 2: If phone provided, add a stakeholder so Razorpay has contact info for KYC.
        if (business_phone) {
            try {
                await platformRazorpay.accounts.addStakeholder(account.id, {
                    name: legal_business_name,
                    email: business_email,
                    relationship: { director: true },
                    phone: { primary: business_phone, secondary: business_phone },
                });
            } catch (_stakeholderErr) {
                // Non-fatal — KYC can still be completed by the gym owner via Razorpay email
            }
        }

        // Step 3: Save the linked account ID and mark as CONNECTED in PARTNER mode.
        await pool.query(
            `UPDATE gyms
             SET member_razorpay_connected_account_id = $1,
                 member_payments_connect_mode         = 'PARTNER',
                 member_payments_onboarding_status    = 'CONNECTED',
                 member_payments_connected_at         = NOW(),
                 member_payments_updated_at           = NOW()
             WHERE id = $2`,
            [account.id, gym_id]
        );

        return res.json({
            success: true,
            account_id: account.id,
            message: `Linked account created. ${business_email} will receive a Razorpay email to complete KYC (PAN + bank details).`,
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LINKED ACCOUNT CREATE ERROR:', err.message);
        const msg = err?.error?.description || err?.message || 'Failed to create linked account.';
        return res.status(500).json({ error: msg });
    }
});

// Save a Razorpay linked account ID that was created manually in the Razorpay Dashboard.
// Gym owner copies acc_XXXXX from Razorpay → Route → Accounts and pastes it here.
router.post('/online/linked-account/save', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();
        const gym_id = req.user.gym_id;
        const account_id = ensureTrimmedString(req.body?.account_id, { field: 'account_id', required: true, max: 120 });

        if (!/^acc_[A-Za-z0-9]+$/.test(account_id)) {
            return res.status(400).json({ error: 'Invalid account ID. Must start with acc_' });
        }

        await pool.query(
            `UPDATE gyms
             SET member_razorpay_connected_account_id = $1,
                 member_payments_connect_mode         = 'PARTNER',
                 member_payments_onboarding_status    = 'CONNECTED',
                 member_payments_connected_at         = NOW(),
                 member_payments_updated_at           = NOW()
             WHERE id = $2`,
            [account_id, gym_id]
        );

        return res.json({ success: true, message: 'Razorpay account connected successfully.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LINKED ACCOUNT SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to save account ID.' });
    }
});

router.post('/online/verify', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const planId = ensureInteger(req.body?.plan_id, { field: 'plan_id', required: true, min: 1 });
        const razorpay_order_id = ensureTrimmedString(req.body?.razorpay_order_id, { field: 'razorpay_order_id', required: true, max: 120 });
        const razorpay_payment_id = ensureTrimmedString(req.body?.razorpay_payment_id, { field: 'razorpay_payment_id', required: true, max: 120 });
        const razorpay_signature = ensureTrimmedString(req.body?.razorpay_signature, { field: 'razorpay_signature', required: true, max: 256 });
        await ensureMemberPaymentsSchema();
        const gymConfigRes = await pool.query(
            `SELECT member_razorpay_key_secret_enc, member_payments_connect_mode
             FROM gyms WHERE id = $1 LIMIT 1`,
            [gym_id]
        );
        const row = gymConfigRes.rows[0] || {};
        const verifyMode = String(row.member_payments_connect_mode || 'MANUAL').toUpperCase();
        if (verifyMode === 'PARTNER') {
            return res.status(410).json({ error: 'Partner-mode Razorpay checkout is disabled. Use the Razorpay payment link flow instead.' });
        }

        const keySecret = decryptSecret(row.member_razorpay_key_secret_enc || '');
        if (!keySecret) {
            return res.status(400).json({ error: 'Razorpay gateway secret missing. Update Integrations first.' });
        }

        const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSign = crypto.createHmac('sha256', keySecret).update(sign).digest('hex');
        if (expectedSign !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature.' });
        }

        const existingPayment = await pool.query(
            `SELECT id
             FROM payments
             WHERE gym_id = $1
               AND transaction_id = $2
               AND deleted_at IS NULL
             LIMIT 1`,
            [gym_id, razorpay_payment_id]
        );
        if (existingPayment.rows.length > 0) {
            return res.status(409).json({ error: 'This payment has already been processed.' });
        }

        const result = await activateMembershipTransaction({
            gymId: gym_id,
            memberId,
            planId,
            paymentMode: 'Online',
            paymentId: razorpay_payment_id,
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.json({ ...result.data, verified: true, razorpay_order_id });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER ONLINE VERIFY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to verify online member payment.' });
    }
});

// --- 2. GET ALL PLANS ---
router.get('/plans', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const plans = await pool.query(
            `SELECT id, name, duration_days, duration_months, price
             FROM plans WHERE gym_id = $1 AND deleted_at IS NULL ORDER BY price ASC`,
            [req.user.gym_id]
        );
        res.json(plans.rows);
    } catch (err) {
        console.error("FETCH PLANS ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 3. CREATE PLAN ---
router.post('/plans', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const plan_name = ensureTrimmedString(req.body?.plan_name, { field: 'plan_name', required: true, min: 2, max: 120 });
        const duration_days = ensureInteger(req.body?.duration_days, { field: 'duration_days', required: true, min: 1, max: 3650 });
        const price = ensureNumber(req.body?.price, { field: 'price', required: true, min: 0, max: 1000000 });
        const duration_months = Math.max(1, Math.floor(duration_days / 30));
        const newPlan = await pool.query(
            `INSERT INTO plans (gym_id, name, duration_days, duration_months, price)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [gym_id, plan_name, duration_days, duration_months, price]
        );
        res.json(newPlan.rows[0]);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("PLAN CREATION ERROR:", err.message);
        res.status(500).json({ error: "Error creating plan." });
    }
});

// --- 4. REMOVE PLAN ---
router.post('/remove-plan', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    let client;
    try {
        const member_id = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('UPDATE memberships SET deleted_at = NOW(), status = \'EXPIRED\' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [member_id, gym_id]);
        await client.query("UPDATE members SET status = 'UNPAID' WHERE id = $1 AND gym_id = $2", [member_id, gym_id]);
        await client.query('COMMIT');
        res.json({ message: "Plan removed and status reset to Unpaid" });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("REMOVE PLAN ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// --- 5. MEMBERSHIP STATUS LIST ---
router.get('/status', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const list = await pool.query(`
            SELECT
                ms.*,
                m.full_name,
                m.joining_date,
                p.name       AS plan_name,
                p.price      AS plan_price,
                pay.payment_date AS last_payment_date
            FROM memberships ms
            JOIN members m ON ms.member_id = m.id
            JOIN plans   p ON ms.plan_id   = p.id
            LEFT JOIN (
                SELECT user_id, MAX(payment_date) AS payment_date
                FROM payments
                WHERE status = 'Completed' AND gym_id = $1
                GROUP BY user_id
            ) pay ON m.id = pay.user_id
                        WHERE ms.gym_id = $1
                            AND ms.deleted_at IS NULL
                            AND m.deleted_at IS NULL
                            AND p.deleted_at IS NULL
            ORDER BY ms.end_date ASC
        `, [req.user.gym_id]);
        res.json(list.rows);
    } catch (err) {
        console.error("STATUS FETCH ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 6. RENEW ---
router.post('/renew', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    try {
        const membership_id = ensureInteger(req.body?.membership_id, { field: 'membership_id', required: true, min: 1 });
        const current = await pool.query(
            `SELECT ms.*, p.duration_days, p.duration_months
             FROM memberships ms
             JOIN plans p ON ms.plan_id = p.id
             WHERE ms.id = $1 AND ms.gym_id = $2 AND ms.deleted_at IS NULL AND p.deleted_at IS NULL`,
            [membership_id, req.user.gym_id]
        );

        if (current.rows.length === 0) return res.status(404).json({ message: "Membership not found" });
        const daysToAdd = current.rows[0].duration_days || (current.rows[0].duration_months * 30) || 30;

        await pool.query(
            `UPDATE memberships
             SET end_date = GREATEST(end_date, CURRENT_DATE) + ($1 || ' day')::interval,
                 status   = 'ACTIVE'
             WHERE id = $2 AND gym_id = $3 AND deleted_at IS NULL`,
            [daysToAdd, membership_id, req.user.gym_id]
        );
        res.json({ message: "Membership Renewed Successfully!" });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("RENEWAL ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/freeze', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const gym_id = req.user.gym_id;

    try {
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const freezeReason = normalizeMembershipReason(req.body?.freeze_reason, 'freeze_reason');
        const freezeEndDate = req.body?.freeze_end_date
            ? ensureDateOnly(req.body?.freeze_end_date, { field: 'freeze_end_date', allowPast: false })
            : '';
        const membershipRes = await pool.query(
            `SELECT id, status
             FROM memberships
             WHERE gym_id = $1 AND member_id = $2 AND deleted_at IS NULL
             ORDER BY end_date DESC, id DESC
             LIMIT 1`,
            [gym_id, memberId]
        );

        if (membershipRes.rows.length === 0) {
            return res.status(404).json({ error: 'Active membership not found.' });
        }

        const membership = membershipRes.rows[0];
        if (membership.status === 'FROZEN') {
            return res.status(400).json({ error: 'Membership is already frozen.' });
        }
        if (membership.status !== 'ACTIVE') {
            return res.status(400).json({ error: 'Only active memberships can be frozen.' });
        }

        const result = await pool.query(
            `UPDATE memberships
             SET status = 'FROZEN',
                 freeze_start_date = CURRENT_DATE,
                 freeze_end_date = CASE WHEN $1 <> '' THEN $1::date ELSE freeze_end_date END,
                 freeze_reason = $2,
                 frozen_at = NOW()
             WHERE id = $3 AND gym_id = $4
             RETURNING *`,
            [freezeEndDate, freezeReason, membership.id, gym_id]
        );

        return res.json({ message: 'Membership frozen successfully.', membership: result.rows[0] });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('FREEZE MEMBERSHIP ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to freeze membership.' });
    }
});

router.post('/unfreeze', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const gym_id = req.user.gym_id;

    try {
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const membershipRes = await pool.query(
            `SELECT id, end_date, freeze_start_date
             FROM memberships
             WHERE gym_id = $1 AND member_id = $2 AND deleted_at IS NULL AND status = 'FROZEN'
             ORDER BY end_date DESC, id DESC
             LIMIT 1`,
            [gym_id, memberId]
        );

        if (membershipRes.rows.length === 0) {
            return res.status(404).json({ error: 'Frozen membership not found.' });
        }

        const membership = membershipRes.rows[0];
        const freezeStartDate = membership.freeze_start_date ? new Date(membership.freeze_start_date) : new Date();
        const today = new Date();
        const extensionDays = Math.max(
            0,
            Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(freezeStartDate.getFullYear(), freezeStartDate.getMonth(), freezeStartDate.getDate())) / (1000 * 60 * 60 * 24))
        );

        const result = await pool.query(
            `UPDATE memberships
             SET status = 'ACTIVE',
                 end_date = end_date + ($1 || ' day')::interval,
                 freeze_end_date = CURRENT_DATE,
                 unfrozen_at = NOW()
             WHERE id = $2 AND gym_id = $3
             RETURNING *`,
            [extensionDays, membership.id, gym_id]
        );

        return res.json({
            message: 'Membership resumed successfully.',
            extended_by_days: extensionDays,
            membership: result.rows[0],
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('UNFREEZE MEMBERSHIP ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to resume membership.' });
    }
});

// --- 7. QUICK EXTEND ---
router.post('/extend', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    try {
        const member_id = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const days = ensureInteger(req.body?.days, { field: 'days', required: true, min: 1, max: 3650 });
        const result = await pool.query(
            `UPDATE memberships
             SET end_date = end_date + ($1 || ' day')::interval,
                 status   = 'ACTIVE'
             WHERE member_id = $2 AND gym_id = $3 AND deleted_at IS NULL
             RETURNING end_date`,
            [days, member_id, req.user.gym_id]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: "No active membership found for this member." });
        res.json({ message: `Membership extended by ${days} days`, new_end_date: result.rows[0].end_date });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("EXTEND ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 8. ACTIVATE GRACE PERIOD ---
router.post('/:id/grace', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const msId = ensureInteger(req.params.id, { field: 'membership id', required: true, min: 1 });
        const days = req.body?.grace_days === undefined || req.body?.grace_days === null || req.body?.grace_days === ''
            ? 7
            : ensureInteger(req.body?.grace_days, { field: 'grace_days', min: 1, max: 90 });
        const result = await pool.query(
            `UPDATE memberships SET status='GRACE', grace_end_date = end_date + ($3 || ' day')::interval
             WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL AND status IN ('ACTIVE','EXPIRED')
             RETURNING *`,
            [msId, gym_id, days]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Membership not found' });
        res.json({ message: 'Grace period activated', membership: result.rows[0] });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('GRACE ERROR:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 9. CANCEL MEMBERSHIP ---
router.post('/:id/cancel', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const msId = ensureInteger(req.params.id, { field: 'membership id', required: true, min: 1 });
        const cancellationReason = normalizeMembershipReason(req.body?.cancellation_reason, 'cancellation_reason') || null;
        const result = await pool.query(
            `UPDATE memberships SET status='CANCELLED', cancellation_reason=$3, cancelled_at=NOW()
             WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL AND status IN ('ACTIVE','FROZEN','GRACE')
             RETURNING *`,
            [msId, gym_id, cancellationReason]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Membership not found or already cancelled' });
        res.json({ message: 'Membership cancelled', membership: result.rows[0] });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('CANCEL MS ERROR:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
module.exports.ensureMemberPaymentsSchema = ensureMemberPaymentsSchema;
module.exports.buildDeskCollectionReference = buildDeskCollectionReference;