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

let ensureMemberPaymentsSchemaPromise;
const MEMBER_CONNECT_STATE_TTL_MS = Math.max(60, parseInt(process.env.RAZORPAY_PARTNER_STATE_TTL_SECONDS || '600', 10)) * 1000;

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
    const planResult = await pool.query(
        'SELECT * FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL',
        [planId, gymId]
    );
    if (planResult.rows.length === 0) {
        return { ok: false, status: 404, error: 'Plan not found' };
    }

    const memberResult = await pool.query(
        'SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
        [memberId, gymId]
    );
    if (memberResult.rows.length === 0) {
        return { ok: false, status: 404, error: 'Member not found' };
    }

    const plan = planResult.rows[0];
    const days = plan.duration_days || (plan.duration_months * 30) || 30;
    const price = parseFloat(plan.price) || 0;

    const finalMode = paymentMode || (paymentId && String(paymentId).startsWith('pay_') ? 'Online' : 'Cash');
    const finalTxnId = paymentId || `INV-${Date.now()}`;

    await pool.query('BEGIN');
    try {
        await pool.query(
            "UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL",
            [memberId, gymId]
        );
        await pool.query(
            "UPDATE members SET status = 'ACTIVE', joining_date = COALESCE(joining_date, CURRENT_DATE) WHERE id = $1 AND gym_id = $2",
            [memberId, gymId]
        );
        await pool.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status)
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' day')::interval, 'ACTIVE')`,
            [gymId, memberId, planId, days]
        );
        await pool.query(
            `INSERT INTO payments
             (gym_id, user_id, plan_id, amount_paid, total_amount, payment_date, status, payment_mode, transaction_id, invoice_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), 'Completed', $6, $7, $8)`,
            [gymId, memberId, planId, price, price, finalMode, finalTxnId, finalTxnId]
        );
        await pool.query('COMMIT');
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }

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
};

// --- 1. ACTIVATE / RENEW ---
router.post('/activate', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const { member_id, plan_id, payment_id, payment_mode } = req.body;
    const gym_id = req.user.gym_id;

    if (!member_id || !plan_id) return res.status(400).json({ error: "member_id and plan_id are required." });

    try {
        const result = await activateMembershipTransaction({
            gymId: gym_id,
            memberId: member_id,
            planId: plan_id,
            paymentMode: payment_mode,
            paymentId: payment_id,
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.json(result.data);

    } catch (err) {
        console.error("ACTIVATE ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/online/create-order', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const gym_id = req.user.gym_id;
    const { member_id, plan_id } = req.body || {};
    if (!member_id || !plan_id) return res.status(400).json({ error: 'member_id and plan_id are required.' });

    try {
        await ensureMemberPaymentsSchema();

        const gymConfigRes = await pool.query(
            `SELECT
                member_payments_enabled,
                member_razorpay_key_id,
                member_razorpay_key_secret_enc,
                member_payments_connect_mode,
                member_payments_onboarding_status,
                member_razorpay_connected_account_id
             FROM gyms WHERE id = $1 LIMIT 1`,
            [gym_id]
        );
        const gymConfig = gymConfigRes.rows[0] || {};
        const connectMode = String(gymConfig.member_payments_connect_mode || 'MANUAL').toUpperCase();
        const connectedAccount = String(gymConfig.member_razorpay_connected_account_id || '').trim();

        if (!gymConfig.member_payments_enabled) {
            return res.status(400).json({ error: 'Member online payments are disabled in Integrations.' });
        }

        if (connectMode === 'PARTNER') {
            // Route mode requires a linked account ID from the OAuth callback
            if (!connectedAccount) {
                return res.status(400).json({ error: 'Razorpay account is not connected yet. Complete Connect Razorpay onboarding first.' });
            }
            if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                return res.status(500).json({ error: 'Platform payment gateway not configured. Contact support.' });
            }
        } else {
            // Manual mode requires the gym to have saved their own Razorpay keys
            const keyId = String(gymConfig.member_razorpay_key_id || '').trim();
            const keySecret = decryptSecret(gymConfig.member_razorpay_key_secret_enc || '');
            if (!keyId || !keySecret) {
                return res.status(400).json({ error: 'Razorpay member payment gateway is not configured. Please update Integrations.' });
            }
        }

        const planResult = await pool.query(
            'SELECT id, name, price FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [plan_id, gym_id]
        );
        if (planResult.rows.length === 0) return res.status(404).json({ error: 'Plan not found.' });

        const memberResult = await pool.query(
            'SELECT id, full_name, email, phone FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [member_id, gym_id]
        );
        if (memberResult.rows.length === 0) return res.status(404).json({ error: 'Member not found.' });

        const plan = planResult.rows[0];
        const member = memberResult.rows[0];
        const amountPaise = Math.round(Number(plan.price || 0) * 100);
        if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
            return res.status(400).json({ error: 'Selected plan has invalid price.' });
        }

        let order, effectiveKeyId;

        if (connectMode === 'PARTNER') {
            // ── ROUTE MODE ──────────────────────────────────────────────────────────
            // Payment collected by GymVault's Razorpay account.
            // Razorpay Route automatically transfers (amount minus platform fee)
            // to the gym owner's linked account (acc_XXXXX) after capture.
            const platformKeyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
            const platformKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
            const feePercent = Math.max(0, Math.min(100, parseFloat(process.env.RAZORPAY_PLATFORM_FEE_PERCENT || '0')));
            const feeAmount = Math.round(amountPaise * feePercent / 100);
            const transferAmount = amountPaise - feeAmount;

            const platformRazorpay = new Razorpay({ key_id: platformKeyId, key_secret: platformKeySecret });
            order = await platformRazorpay.orders.create({
                amount: amountPaise,
                currency: 'INR',
                receipt: `gym_${gym_id}_m_${member_id}_${Date.now()}`,
                // Route: transfer funds to gym's linked account at capture
                transfers: [{
                    account: connectedAccount,
                    amount: transferAmount,
                    currency: 'INR',
                    on_hold: false,
                    notes: { gym_id: String(gym_id), member_id: String(member_id), plan_id: String(plan_id) },
                }],
                notes: {
                    purpose: 'MEMBER_PAYMENT',
                    gym_id: String(gym_id),
                    member_id: String(member_id),
                    plan_id: String(plan_id),
                },
            });
            effectiveKeyId = platformKeyId;
        } else {
            // ── MANUAL MODE ─────────────────────────────────────────────────────────
            // Gym owner's own Razorpay keys; money goes directly to their account.
            const keyId = String(gymConfig.member_razorpay_key_id || '').trim();
            const keySecret = decryptSecret(gymConfig.member_razorpay_key_secret_enc || '');
            const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
            order = await razorpay.orders.create({
                amount: amountPaise,
                currency: 'INR',
                receipt: `gym_${gym_id}_m_${member_id}_${Date.now()}`,
                notes: {
                    purpose: 'MEMBER_PAYMENT',
                    gym_id: String(gym_id),
                    member_id: String(member_id),
                    plan_id: String(plan_id),
                },
            });
            effectiveKeyId = keyId;
        }

        return res.json({
            key_id: effectiveKeyId,
            order,
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
        console.error('MEMBER ONLINE ORDER ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to initiate online member payment.' });
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

        const legal_business_name = String(req.body.legal_business_name || '').trim();
        const business_email      = String(req.body.business_email || '').trim();
        const business_phone      = String(req.body.business_phone || '').replace(/\D/g, '');
        const city                = String(req.body.city || '').trim();
        const state               = String(req.body.state || '').trim().toUpperCase();
        const pincode             = String(req.body.pincode || '').trim();

        if (!legal_business_name || !business_email || !city || !state || !pincode) {
            return res.status(400).json({ error: 'Business name, email, city, state and pincode are required.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business_email)) {
            return res.status(400).json({ error: 'Invalid email address.' });
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
        const account_id = String(req.body.account_id || '').trim();

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
        console.error('LINKED ACCOUNT SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to save account ID.' });
    }
});

router.post('/online/verify', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const gym_id = req.user.gym_id;
    const {
        member_id,
        plan_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
    } = req.body || {};

    if (!member_id || !plan_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing payment verification details.' });
    }

    try {
        await ensureMemberPaymentsSchema();
        const gymConfigRes = await pool.query(
            `SELECT member_razorpay_key_secret_enc, member_payments_connect_mode
             FROM gyms WHERE id = $1 LIMIT 1`,
            [gym_id]
        );
        const row = gymConfigRes.rows[0] || {};
        const verifyMode = String(row.member_payments_connect_mode || 'MANUAL').toUpperCase();
        // PARTNER: order was created with GymVault's key, so verify with GymVault's secret.
        // MANUAL: order was created with the gym's own key, so verify with their secret.
        const keySecret = verifyMode === 'PARTNER'
            ? String(process.env.RAZORPAY_KEY_SECRET || '').trim()
            : decryptSecret(row.member_razorpay_key_secret_enc || '');
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
            memberId: member_id,
            planId: plan_id,
            paymentMode: 'Online',
            paymentId: razorpay_payment_id,
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.json({ ...result.data, verified: true, razorpay_order_id });
    } catch (err) {
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
    const { plan_name, duration_days, price } = req.body;
    const gym_id = req.user.gym_id;
    const duration_months = Math.max(1, Math.floor(parseInt(duration_days) / 30));

    try {
        const newPlan = await pool.query(
            `INSERT INTO plans (gym_id, name, duration_days, duration_months, price)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [gym_id, plan_name, parseInt(duration_days), duration_months, parseFloat(price)]
        );
        res.json(newPlan.rows[0]);
    } catch (err) {
        console.error("PLAN CREATION ERROR:", err.message);
        res.status(500).json({ error: "Error creating plan." });
    }
});

// --- 4. REMOVE PLAN ---
router.post('/remove-plan', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const { member_id } = req.body;
    const gym_id = req.user.gym_id;
    try {
        await pool.query('BEGIN');
        await pool.query('UPDATE memberships SET deleted_at = NOW(), status = \'EXPIRED\' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [member_id, gym_id]);
        await pool.query("UPDATE members SET status = 'UNPAID' WHERE id = $1 AND gym_id = $2", [member_id, gym_id]);
        await pool.query('COMMIT');
        res.json({ message: "Plan removed and status reset to Unpaid" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("REMOVE PLAN ERROR:", err.message);
        res.status(500).json({ error: err.message });
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
    const { membership_id } = req.body;
    try {
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
        console.error("RENEWAL ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 7. QUICK EXTEND ---
router.post('/extend', auth, saasMiddleware, requirePermission('payments:write'), async (req, res) => {
    const { member_id, days } = req.body;
    if (!member_id || !days) return res.status(400).json({ error: "member_id and days required." });

    try {
        const result = await pool.query(
            `UPDATE memberships
             SET end_date = end_date + ($1 || ' day')::interval,
                 status   = 'ACTIVE'
             WHERE member_id = $2 AND gym_id = $3 AND deleted_at IS NULL
             RETURNING end_date`,
            [parseInt(days), member_id, req.user.gym_id]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: "No active membership found for this member." });
        res.json({ message: `Membership extended by ${days} days`, new_end_date: result.rows[0].end_date });
    } catch (err) {
        console.error("EXTEND ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;