const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const { requireOwner } = require('../middleware/rbac');
const twilio = require('twilio');
const { encryptSecret, decryptSecret } = require('../utils/secretCrypto');
const {
    createProfileUploadMiddleware,
    cleanupUploadedFile,
    getStoredProfileValue,
    resolveStoredProfileImagePath,
} = require('../utils/profileUploads');

router.use(auth, requireOwner);

let ensureSupportProfileTablePromise;
let ensureMessagingSchemaPromise;
let ensureMemberPaymentsSchemaPromise;
let ensurePreferenceSchemaPromise;

const MESSAGE_TEMPLATE_DEFAULTS = [
    {
        template_key: 'EXPIRING_SOON',
        title: 'Membership Expiring Soon',
        whatsapp_text: 'Hi {{name}}, your GymVault membership ({{plan}}) expires in {{days_left}} day(s). Renew today to keep your progress going. Reply to this message for instant renewal support.',
        sms_text: 'Hi {{name}}, your membership expires in {{days_left}} day(s). Renew now to continue training. Reply for help.',
    },
    {
        template_key: 'EXPIRED',
        title: 'Membership Expired',
        whatsapp_text: 'Hi {{name}}, your membership has expired. We miss your energy at {{gym_name}}. Renew now and get back to your fitness routine.',
        sms_text: 'Hi {{name}}, your membership is expired. Renew now and restart your fitness journey at {{gym_name}}.',
    },
    {
        template_key: 'UNPAID',
        title: 'Pending Payment',
        whatsapp_text: 'Hi {{name}}, your payment is pending for your gym plan. Please clear dues to keep access active. Need help? Reply here and our team will assist.',
        sms_text: 'Hi {{name}}, your gym payment is pending. Please clear dues to avoid interruption.',
    },
    {
        template_key: 'INACTIVE',
        title: 'Inactive Member Winback',
        whatsapp_text: 'Hi {{name}}, we noticed you have not visited recently. Your goals are waiting. Come back this week and let us support your comeback.',
        sms_text: 'Hi {{name}}, we miss you at the gym. Come back this week and continue your progress.',
    },
    {
        template_key: 'SALES_OFFER',
        title: 'Sales / Promo Offer',
        whatsapp_text: 'Hi {{name}}, special offer from {{gym_name}}: renew or upgrade your plan this week and unlock exclusive benefits. Reply to claim now.',
        sms_text: 'Special offer from {{gym_name}} for you, {{name}}. Renew this week to unlock benefits.',
    },
    {
        template_key: 'HOLIDAY',
        title: 'Holiday Announcement',
        whatsapp_text: 'Hi {{name}}, holiday update from {{gym_name}}: schedule and timings may differ for upcoming holidays. Contact us for exact timings.',
        sms_text: 'Holiday update from {{gym_name}}: gym timings may change. Contact reception for details.',
    },
    {
        template_key: 'RENEWAL_REMINDER',
        title: 'Renewal Reminder',
        whatsapp_text: 'Friendly reminder, {{name}}: your current plan is due for renewal. Confirm today to continue uninterrupted access at {{gym_name}}.',
        sms_text: 'Reminder: {{name}}, your plan is due for renewal. Renew today for uninterrupted access.',
    },
    {
        template_key: 'PAYMENT_DUE',
        title: 'Payment Due Alert',
        whatsapp_text: 'Hi {{name}}, this is a payment due reminder from {{gym_name}}. Please clear your due amount to avoid service interruption.',
        sms_text: 'Payment due reminder from {{gym_name}}. Please clear your pending amount soon.',
    },
];

const toPositiveInt = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length >= 11 && String(value || '').trim().startsWith('+')) return `+${digits}`;
    if (digits.length >= 11) return `+${digits}`;
    return '';
};

const formatWhatsAppAddress = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('whatsapp:')) {
        const normalized = normalizePhone(raw.replace('whatsapp:', ''));
        return normalized ? `whatsapp:${normalized}` : '';
    }
    const normalized = normalizePhone(raw);
    return normalized ? `whatsapp:${normalized}` : '';
};

const maskKeyId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.length <= 8) return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
};

const isSandboxWhatsAppSender = (value) => {
    const sender = String(value || '').trim().toLowerCase();
    return sender === 'whatsapp:+14155238886';
};

const shouldFallbackToSms = (err) => {
    const code = Number(err?.code || 0);
    const message = String(err?.message || '').toLowerCase();
    return code === 63015 || code === 63016 || code === 21608 || message.includes('sandbox') || message.includes('join');
};

const seedMessageTemplates = async (gymId) => {
    for (const template of MESSAGE_TEMPLATE_DEFAULTS) {
        await pool.query(
            `INSERT INTO gym_message_templates (gym_id, template_key, title, whatsapp_text, sms_text, is_active, updated_at)
             VALUES ($1, $2, $3, $4, $5, true, NOW())
             ON CONFLICT (gym_id, template_key)
             DO NOTHING`,
            [gymId, template.template_key, template.title, template.whatsapp_text, template.sms_text]
        );
    }
};

const ensureSupportProfileTable = async () => {
    if (!ensureSupportProfileTablePromise) {
        ensureSupportProfileTablePromise = pool.query(`
            CREATE TABLE IF NOT EXISTS gym_support_profiles (
                gym_id INT PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
                whatsapp VARCHAR(30),
                about_mission TEXT,
                support_window VARCHAR(255),
                sla TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
    }
    await ensureSupportProfileTablePromise;
};

const ensureMessagingSchema = async () => {
    if (!ensureMessagingSchemaPromise) {
        ensureMessagingSchemaPromise = (async () => {
            await pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS messaging_owner_mobile VARCHAR(30),
                ADD COLUMN IF NOT EXISTS bulk_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS bulk_monthly_limit INTEGER DEFAULT 500,
                ADD COLUMN IF NOT EXISTS bulk_per_campaign_limit INTEGER DEFAULT 50,
                ADD COLUMN IF NOT EXISTS bulk_channels JSONB DEFAULT '{"whatsapp": true, "sms": false}'::jsonb;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS gym_message_templates (
                    id SERIAL PRIMARY KEY,
                    gym_id INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
                    template_key VARCHAR(60) NOT NULL,
                    title VARCHAR(120) NOT NULL,
                    whatsapp_text TEXT NOT NULL,
                    sms_text TEXT NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(gym_id, template_key)
                );
            `);
        })();
    }
    await ensureMessagingSchemaPromise;
};

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

const ensurePreferenceSchema = async () => {
    if (!ensurePreferenceSchemaPromise) {
        ensurePreferenceSchemaPromise = (async () => {
            await pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS interface_reduce_motion BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS interface_compact_mode BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS interface_dark_mode BOOLEAN DEFAULT FALSE;
            `);
            await pool.query(`
                ALTER TABLE users
                ALTER COLUMN profile_pic TYPE TEXT;
            `);
        })();
    }
    await ensurePreferenceSchemaPromise;
};

const uploadProfilePic = createProfileUploadMiddleware({
    prefix: 'profile',
    getActorId: (req) => req.user?.id || 'owner',
    storageMode: 'inline',
});

const discardUploadedProfile = async (req) => {
    await cleanupUploadedFile(req?.file);
};

router.get('/', auth, async (req, res) => {
    try {
        await ensureSupportProfileTable();
        await ensureMessagingSchema();
        await ensurePreferenceSchema();

        const userRes = await pool.query('SELECT full_name, email, phone, profile_pic FROM users WHERE id = $1', [req.user.id]);
        const gymRes = await pool.query(
            'SELECT name, phone, address, currency, timezone, tax_id, website, support_email, saas_status, saas_valid_until, current_plan, saas_billing_cycle, interface_reduce_motion, interface_compact_mode, interface_dark_mode FROM gyms WHERE id = $1', 
            [req.user.gym_id]
        );

        const supportProfileRes = await pool.query(
            `SELECT whatsapp, about_mission, support_window, sla
             FROM gym_support_profiles
             WHERE gym_id = $1`,
            [req.user.gym_id]
        );

        const memberCount = await pool.query('SELECT COUNT(*) FROM members WHERE gym_id = $1', [req.user.gym_id]).catch(() => ({ rows: [{ count: 0 }] }));
        const staffCount = await pool.query('SELECT COUNT(*) FROM users WHERE gym_id = $1', [req.user.gym_id]).catch(() => ({ rows: [{ count: 1 }] }));

        res.json({
            account: userRes.rows[0] || {},
            gym: gymRes.rows[0] || {},
            support_profile: supportProfileRes.rows[0] || {},
            usage: { members: parseInt(memberCount.rows[0].count), staff: parseInt(staffCount.rows[0].count), storage: 0.1 }
        });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

router.get('/preferences', auth, async (req, res) => {
    try {
        await ensurePreferenceSchema();

        const result = await pool.query(
            `SELECT currency, timezone, interface_reduce_motion, interface_compact_mode, interface_dark_mode
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [req.user.gym_id]
        );

        return res.json(result.rows[0] || {
            currency: '₹',
            timezone: 'Asia/Kolkata',
            interface_reduce_motion: false,
            interface_compact_mode: false,
            interface_dark_mode: false,
        });
    } catch (err) {
        console.error('PREFERENCES FETCH ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/integrations', auth, async (req, res) => {
    try {
        await ensureMessagingSchema();
        await ensureMemberPaymentsSchema();

        const gymId = req.user.gym_id;
        await seedMessageTemplates(gymId);

        const gymRes = await pool.query(
            `SELECT
                messaging_owner_mobile,
                bulk_enabled,
                bulk_monthly_limit,
                bulk_per_campaign_limit,
                bulk_channels,
                member_payments_enabled,
                member_razorpay_key_id,
                member_razorpay_key_secret_enc,
                member_upi_id,
                member_payments_connect_mode,
                member_payments_onboarding_status,
                member_razorpay_connected_account_id,
                member_payments_connected_at
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        );

        const templatesRes = await pool.query(
            `SELECT template_key, title, whatsapp_text, sms_text, is_active, updated_at
             FROM gym_message_templates
             WHERE gym_id = $1
             ORDER BY template_key ASC`,
            [gymId]
        );

        const usageRes = await pool.query(
            `SELECT COALESCE(SUM(sent_to_count), 0)::INT AS monthly_sent
             FROM broadcast_logs
             WHERE gym_id = $1
               AND created_at >= DATE_TRUNC('month', NOW())`,
            [gymId]
        );

        const row = gymRes.rows[0] || {};
        const monthlyLimit = toPositiveInt(row.bulk_monthly_limit, 500);
        const monthlySent = toPositiveInt(usageRes.rows[0]?.monthly_sent, 0);

        const whatsappFromEnv = String(process.env.TWILIO_WHATSAPP_FROM || '').trim();
        const smsFromEnv = String(process.env.TWILIO_SMS_FROM || '').trim();
        const twilioReady = Boolean(
            String(process.env.TWILIO_ACCOUNT_SID || '').trim() &&
            String(process.env.TWILIO_AUTH_TOKEN || '').trim() &&
            (whatsappFromEnv || normalizePhone(smsFromEnv))
        );
        const whatsappMode = !whatsappFromEnv
            ? 'UNAVAILABLE'
            : isSandboxWhatsAppSender(whatsappFromEnv)
                ? 'SANDBOX'
                : 'PRODUCTION';

        return res.json({
            owner_mobile: row.messaging_owner_mobile || '',
            gateway_connected: twilioReady,
            whatsapp_mode: whatsappMode,
            whatsapp_ready: Boolean(whatsappFromEnv),
            sms_ready: Boolean(normalizePhone(smsFromEnv)),
            bulk_enabled: Boolean(row.bulk_enabled),
            bulk_monthly_limit: monthlyLimit,
            bulk_per_campaign_limit: toPositiveInt(row.bulk_per_campaign_limit, 50),
            bulk_channels: row.bulk_channels || { whatsapp: true, sms: false },
            monthly_usage: monthlySent,
            monthly_remaining: Math.max(0, monthlyLimit - monthlySent),
            templates: templatesRes.rows,
            member_payments: {
                enabled: Boolean(row.member_payments_enabled),
                connect_mode: String(row.member_payments_connect_mode || 'MANUAL').toUpperCase(),
                onboarding_status: String(row.member_payments_onboarding_status || 'NOT_CONNECTED').toUpperCase(),
                connected_account_id: row.member_razorpay_connected_account_id || '',
                connected_at: row.member_payments_connected_at || null,
                razorpay_key_id: row.member_razorpay_key_id || '',
                razorpay_key_id_masked: maskKeyId(row.member_razorpay_key_id),
                has_razorpay_secret: Boolean(decryptSecret(row.member_razorpay_key_secret_enc || '')),
                upi_id: row.member_upi_id || '',
            },
        });
    } catch (err) {
        console.error('INTEGRATIONS FETCH ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/integrations', auth, async (req, res) => {
    try {
        await ensureMessagingSchema();
        await ensureMemberPaymentsSchema();

        const gymId = req.user.gym_id;
        const {
            owner_mobile,
            bulk_enabled,
            bulk_monthly_limit,
            bulk_per_campaign_limit,
            bulk_channels,
            templates,
            member_payments,
        } = req.body || {};

        const ownerMobile = normalizePhone(owner_mobile);

        const monthlyLimit = Math.min(100000, Math.max(10, toPositiveInt(bulk_monthly_limit, 500)));
        const perCampaign = Math.min(1000, Math.max(1, toPositiveInt(bulk_per_campaign_limit, 50)));
        const channels = {
            whatsapp: Boolean(bulk_channels?.whatsapp ?? true),
            sms: Boolean(bulk_channels?.sms ?? false),
        };

        if (!ownerMobile) {
            return res.status(400).json({ error: 'Please enter a valid owner mobile number in +91XXXXXXXXXX format.' });
        }

        await pool.query(
            `UPDATE gyms
             SET messaging_owner_mobile = $1,
                 bulk_enabled = $2,
                 bulk_monthly_limit = $3,
                 bulk_per_campaign_limit = $4,
                 bulk_channels = $5
             WHERE id = $6`,
            [ownerMobile, Boolean(bulk_enabled), monthlyLimit, perCampaign, channels, gymId]
        );

        if (member_payments && typeof member_payments === 'object') {
            const enabled = Boolean(member_payments.enabled);
            const keyId = String(member_payments.razorpay_key_id || '').trim();
            const upiId = String(member_payments.upi_id || '').trim().toLowerCase();
            const incomingSecret = String(member_payments.razorpay_key_secret || '').trim();
            const connectModeInput = String(member_payments.connect_mode || '').trim().toUpperCase();

            const currentRes = await pool.query(
                `SELECT
                    member_razorpay_key_secret_enc,
                    member_payments_connect_mode,
                    member_razorpay_connected_account_id,
                    member_payments_onboarding_status
                 FROM gyms WHERE id = $1 LIMIT 1`,
                [gymId]
            );
            const current = currentRes.rows[0] || {};
            const existingEncryptedSecret = current.member_razorpay_key_secret_enc || '';
            const connectMode = connectModeInput || String(current.member_payments_connect_mode || 'MANUAL').toUpperCase();
            const connectedAccountId = String(current.member_razorpay_connected_account_id || '').trim();

            if (enabled && connectMode === 'MANUAL' && (!keyId || (!incomingSecret && member_payments.has_razorpay_secret !== true))) {
                return res.status(400).json({ error: 'To enable member online payments in manual mode, enter Razorpay Key ID and Key Secret.' });
            }
            if (enabled && connectMode === 'PARTNER' && !connectedAccountId) {
                return res.status(400).json({ error: 'Razorpay account not connected yet. Use Connect Razorpay first.' });
            }

            const secretToPersist = incomingSecret ? encryptSecret(incomingSecret) : existingEncryptedSecret;
            const nextOnboardingStatus = connectMode === 'PARTNER'
                ? String(current.member_payments_onboarding_status || 'NOT_CONNECTED').toUpperCase()
                : enabled
                    ? 'MANUAL_CONFIGURED'
                    : 'NOT_CONNECTED';

            await pool.query(
                `UPDATE gyms
                 SET member_payments_enabled = $1,
                     member_payments_connect_mode = $2,
                     member_payments_onboarding_status = $3,
                     member_razorpay_key_id = $4,
                     member_razorpay_key_secret_enc = $5,
                     member_upi_id = $6,
                     member_payments_updated_at = NOW()
                 WHERE id = $7`,
                [enabled, connectMode, nextOnboardingStatus, keyId || null, secretToPersist || null, upiId || null, gymId]
            );
        }

        if (Array.isArray(templates) && templates.length > 0) {
            for (const template of templates) {
                const key = String(template.template_key || '').trim().toUpperCase();
                const fallback = MESSAGE_TEMPLATE_DEFAULTS.find((item) => item.template_key === key);
                const title = String(template.title || fallback?.title || key).trim().slice(0, 120);
                const whatsappText = String(template.whatsapp_text || fallback?.whatsapp_text || '').trim();
                const smsText = String(template.sms_text || fallback?.sms_text || '').trim();
                const isActive = template.is_active !== false;

                if (!key || !title || whatsappText.length < 10 || smsText.length < 10) continue;

                await pool.query(
                    `INSERT INTO gym_message_templates (gym_id, template_key, title, whatsapp_text, sms_text, is_active, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW())
                     ON CONFLICT (gym_id, template_key)
                     DO UPDATE SET
                        title = EXCLUDED.title,
                        whatsapp_text = EXCLUDED.whatsapp_text,
                        sms_text = EXCLUDED.sms_text,
                        is_active = EXCLUDED.is_active,
                        updated_at = NOW()`,
                    [gymId, key, title, whatsappText, smsText, isActive]
                );
            }
        } else {
            await seedMessageTemplates(gymId);
        }

        return res.json({ message: 'Messaging integrations saved successfully.' });
    } catch (err) {
        console.error('INTEGRATIONS SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/integrations/test-message', auth, async (req, res) => {
    try {
        await ensureMessagingSchema();

        const gymId = req.user.gym_id;
        const channel = String(req.body.channel || 'WHATSAPP').toUpperCase();
        const toInput = String(req.body.to || '').trim();
        const body = String(req.body.message || '').trim();

        if (!toInput || !body) {
            return res.status(400).json({ error: 'Recipient and message are required.' });
        }

        const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
        const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
        const whatsappFrom = String(process.env.TWILIO_WHATSAPP_FROM || '').trim();
        const smsFromEnv = String(process.env.TWILIO_SMS_FROM || '').trim();

        if (!accountSid || !authToken) {
            return res.status(400).json({ error: 'Platform messaging gateway is not configured. Ask HQ admin to set TWILIO_* env variables.' });
        }

        const client = twilio(accountSid, authToken);
        const normalizedTo = normalizePhone(toInput);
        if (!normalizedTo) {
            return res.status(400).json({ error: 'Please enter a valid recipient mobile number.' });
        }

        if (channel === 'SMS') {
            const from = normalizePhone(smsFromEnv);
            const to = normalizedTo;
            if (!from || !to) return res.status(400).json({ error: 'Valid SMS from/to numbers are required.' });

            const msg = await client.messages.create({ from, to, body });
            return res.json({ message: 'SMS test message sent.', sid: msg.sid, status: msg.status, channel: 'SMS' });
        }

        const from = formatWhatsAppAddress(whatsappFrom);
        const to = normalizedTo ? `whatsapp:${normalizedTo}` : '';
        if (!from || !to) return res.status(400).json({ error: 'Valid WhatsApp from/to numbers are required.' });

        try {
            const msg = await client.messages.create({ from, to, body });
            return res.json({ message: 'WhatsApp test message sent.', sid: msg.sid, status: msg.status, channel: 'WHATSAPP' });
        } catch (whatsErr) {
            const smsFrom = normalizePhone(smsFromEnv);
            if (isSandboxWhatsAppSender(whatsappFrom) && smsFrom && shouldFallbackToSms(whatsErr)) {
                const smsMsg = await client.messages.create({ from: smsFrom, to: normalizedTo, body });
                return res.json({
                    message: 'WhatsApp sandbox restriction detected. Sent via SMS fallback instead.',
                    sid: smsMsg.sid,
                    status: smsMsg.status,
                    channel: 'SMS',
                    fallback: true,
                });
            }
            throw whatsErr;
        }
    } catch (err) {
        console.error('TEST MESSAGE ERROR:', err.message);
        return res.status(500).json({
            error: 'Failed to send test message.',
        });
    }
});

// --- 3. MASTER ACCOUNT UPDATE ---
router.put('/account', auth, uploadProfilePic, async (req, res) => {
    const { full_name, email, phone, current_password, new_password } = req.body;
    const removeProfilePic = String(req.body?.remove_profile_pic || '').trim().toLowerCase() === 'true';
    const uploadedProfileValue = getStoredProfileValue(req.file);

    try {
        await ensurePreferenceSchema();
        const normalizedCurrentPassword = String(current_password || '').trim();
        const normalizedNewPassword = String(new_password || '');
        const currentUserRes = await pool.query('SELECT profile_pic, password_hash FROM users WHERE id = $1', [req.user.id]);
        const currentUser = currentUserRes.rows[0] || {};

        if ((normalizedCurrentPassword && !normalizedNewPassword) || (!normalizedCurrentPassword && normalizedNewPassword)) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'To change password, provide both current_password and new_password.' });
        }

        if (normalizedNewPassword && normalizedNewPassword.length < 8) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
        }

        if (normalizedCurrentPassword && normalizedNewPassword && normalizedCurrentPassword === normalizedNewPassword) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'New password must be different from current password.' });
        }

        await pool.query('BEGIN');

        const nextProfileValue = uploadedProfileValue
            ? uploadedProfileValue
            : removeProfilePic
                ? null
                : currentUser.profile_pic || null;

        if (uploadedProfileValue || removeProfilePic) {
            await pool.query(
                'UPDATE users SET full_name=$1, email=$2, phone=$3, profile_pic=$4 WHERE id=$5', 
                [full_name, email, phone, nextProfileValue, req.user.id]
            );
        } else {
            await pool.query(
                'UPDATE users SET full_name=$1, email=$2, phone=$3 WHERE id=$4', 
                [full_name, email, phone, req.user.id]
            );
        }

        if (normalizedCurrentPassword && normalizedNewPassword) {
            const isMatch = await bcrypt.compare(normalizedCurrentPassword, currentUser.password_hash || '');
            
            if (!isMatch) {
                await pool.query('ROLLBACK');
                await discardUploadedProfile(req);
                return res.status(400).json({ error: "Current password is incorrect." });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedNewPassword = await bcrypt.hash(normalizedNewPassword, salt);

            await pool.query(
                'UPDATE users SET password_hash = $1 WHERE id = $2',
                [hashedNewPassword, req.user.id]
            );
        }

        await pool.query('COMMIT');

        if (uploadedProfileValue || removeProfilePic) {
            const previousProfilePath = resolveStoredProfileImagePath(currentUser.profile_pic);
            if (previousProfilePath && previousProfilePath !== req.file?.path) {
                await cleanupUploadedFile(previousProfilePath);
            }
        }

        res.json({ 
            message: "Account updated successfully", 
            profile_pic: nextProfileValue
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("ACCOUNT UPDATE ERROR:", err.message);
        await discardUploadedProfile(req);
        if (err.code === '23505') return res.status(400).json({ error: "Email already in use." });
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. UPDATE GYM PROFILE ---
router.put('/gym', auth, async (req, res) => {
    const { name, phone, email, address, tax_id, website, support_whatsapp, support_window, support_sla, support_about_mission } = req.body;
    try {
        await ensureSupportProfileTable();

        await pool.query(
            'UPDATE gyms SET name = $1, phone = $2, support_email = $3, address = $4, tax_id = $5, website = $6 WHERE id = $7',
            [name, phone, email, address, tax_id, website, req.user.gym_id]
        );

        await pool.query(
            `INSERT INTO gym_support_profiles (gym_id, whatsapp, about_mission, support_window, sla, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (gym_id)
             DO UPDATE SET
               whatsapp = EXCLUDED.whatsapp,
               about_mission = EXCLUDED.about_mission,
               support_window = EXCLUDED.support_window,
               sla = EXCLUDED.sla,
               updated_at = NOW()`,
            [
                req.user.gym_id,
                support_whatsapp || phone || null,
                support_about_mission || null,
                support_window || null,
                support_sla || null,
            ]
        );

        res.json({ message: "Gym profile updated successfully" });
    } catch (err) {
        console.error("GYM UPDATE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 5. UPDATE SYSTEM PREFERENCES ---
router.put('/preferences', auth, async (req, res) => {
    const {
        currency,
        timezone,
        interface_reduce_motion,
        interface_compact_mode,
        interface_dark_mode,
    } = req.body || {};
    try {
        await ensurePreferenceSchema();
        await pool.query(
            `UPDATE gyms
             SET currency = $1,
                 timezone = $2,
                 interface_reduce_motion = $3,
                 interface_compact_mode = $4,
                 interface_dark_mode = $5
             WHERE id = $6`,
            [currency, timezone, Boolean(interface_reduce_motion), Boolean(interface_compact_mode), Boolean(interface_dark_mode), req.user.gym_id]
        );
        res.json({ message: "Preferences updated successfully" });
    } catch (err) {
        console.error("PREFERENCES UPDATE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 6. DANGER ZONE ---
router.delete('/nuke', auth, async (req, res) => {
    const currentPassword = String(req.body?.current_password || '');

    if (!currentPassword) {
        return res.status(400).json({ error: 'current_password is required to delete gym data.' });
    }

    try {
        const ownerResult = await pool.query(
            `SELECT password_hash
             FROM users
             WHERE id = $1 AND gym_id = $2 AND UPPER(role) = 'OWNER'
             LIMIT 1`,
            [req.user.id, req.user.gym_id]
        );

        if (ownerResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only gym owner can perform this action.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, ownerResult.rows[0].password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }

        await pool.query('BEGIN');
        await pool.query('DELETE FROM users WHERE gym_id = $1', [req.user.gym_id]);
        await pool.query('DELETE FROM gyms WHERE id = $1', [req.user.gym_id]);
        await pool.query('COMMIT');
        res.json({ message: "Gym data completely wiped." });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("NUKE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;