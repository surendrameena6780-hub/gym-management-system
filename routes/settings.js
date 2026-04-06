const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const { requireOwner } = require('../middleware/rbac');
const { encryptSecret, decryptSecret } = require('../utils/secretCrypto');
const {
    buildTemplateBodyVariables,
    buildTemplateName,
    createWhatsAppTemplate,
    findIntegratedWhatsAppNumber,
    getMsg91OtpMode,
    getMsg91WhatsAppOnboardingConfig,
    isMsg91WhatsAppConfigured,
    listIntegratedWhatsAppNumbers,
    listWhatsAppTemplates,
    looksLikeMsg91TemplateDuplicate,
    normalizeE164Phone,
    normalizeLocalIndianPhone,
    pickTemplateCategory,
    sendWhatsAppTemplate,
} = require('../utils/msg91');
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
let ensurePlatformSchemaPromise;

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

const normalizeMessagingPhone = (value) => normalizeE164Phone(value);

const normalizeWhatsAppNumber = (value) => {
    const normalized = normalizeLocalIndianPhone(value);
    return normalized ? `+91${normalized}` : '';
};

const maskKeyId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.length <= 8) return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
};

const hashValue = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

const generateApiToken = () => `gk_${crypto.randomBytes(24).toString('hex')}`;

const normalizeMemberImportPhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

const buildDefaultBranches = (count) => Array.from({ length: Math.max(1, count) }, (_, index) => ({
    id: `branch-${index + 1}`,
    name: index === 0 ? 'Main Branch' : `Branch ${index + 1}`,
    address: '',
    phone: '',
}));

const normalizeBranchDirectory = (value, branchesCount = 1) => {
    const requestedCount = Math.min(25, Math.max(1, toPositiveInt(branchesCount, 1)));
    const items = Array.isArray(value) ? value : [];
    const normalized = items
        .map((item, index) => ({
            id: String(item?.id || `branch-${index + 1}`).trim() || `branch-${index + 1}`,
            name: String(item?.name || '').trim() || (index === 0 ? 'Main Branch' : `Branch ${index + 1}`),
            address: String(item?.address || '').trim(),
            phone: String(item?.phone || '').trim(),
        }))
        .slice(0, requestedCount);

    if (normalized.length === 0) {
        return buildDefaultBranches(requestedCount);
    }

    while (normalized.length < requestedCount) {
        normalized.push({
            id: `branch-${normalized.length + 1}`,
            name: normalized.length === 0 ? 'Main Branch' : `Branch ${normalized.length + 1}`,
            address: '',
            phone: '',
        });
    }

    return normalized;
};

const ALLOWED_API_SCOPES = new Set([
    'members:read',
    'members:write',
    'payments:read',
    'payments:write',
    'attendance:read',
    'attendance:write',
    'dashboard:read',
]);

const normalizeApiScopes = (value) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter((entry) => ALLOWED_API_SCOPES.has(entry))
    ));
};

const ALLOWED_WEBHOOK_EVENTS = new Set([
    'member.created',
    'member.updated',
    'payment.recorded',
    'attendance.checked_in',
    'class.booking.created',
]);

const normalizeWebhookEvents = (value) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter((entry) => ALLOWED_WEBHOOK_EVENTS.has(entry))
    ));
};

const parseCsvLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    values.push(current.trim());
    return values;
};

const parseCsvText = (value) => String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);

const normalizeTemplateStatus = (value) => {
    const status = String(value || '').trim().toUpperCase();
    if (!status) return 'NOT_SYNCED';
    if (status.includes('APPROVED') || status === 'ACTIVE' || status.includes('ENABLE') || status === 'LIVE') return 'APPROVED';
    if (status.includes('PENDING') || status.includes('PROCESS') || status.includes('QUEUE') || status.includes('REVIEW') || status.includes('REQUESTED')) return 'PENDING';
    if (status.includes('REJECT')) return 'REJECTED';
    if (status.includes('DISABLE') || status.includes('INACTIVE')) return 'DISABLED';
    if (status.includes('FAIL') || status.includes('ERROR')) return 'FAILED';
    return status;
};

const summarizeTemplateSyncStatus = (templates) => {
    const activeTemplates = (Array.isArray(templates) ? templates : []).filter((template) => template.is_active !== false);
    if (activeTemplates.length === 0) return 'NOT_SYNCED';

    const statuses = activeTemplates.map((template) => normalizeTemplateStatus(template.whatsapp_template_status));
    if (statuses.every((status) => status === 'APPROVED')) return 'READY';
    if (statuses.some((status) => status === 'REJECTED' || status === 'FAILED')) {
        return statuses.some((status) => status === 'APPROVED' || status === 'PENDING') ? 'PARTIAL' : 'ERROR';
    }
    if (statuses.some((status) => status === 'PENDING')) return 'PENDING_APPROVAL';
    if (statuses.some((status) => status === 'APPROVED')) return 'PARTIAL';
    return 'NOT_SYNCED';
};

const seedMessageTemplates = async (gymId) => {
    for (const template of MESSAGE_TEMPLATE_DEFAULTS) {
        const templateName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
        const templateCategory = pickTemplateCategory(template.template_key);

        await pool.query(
            `INSERT INTO gym_message_templates (
                gym_id,
                template_key,
                title,
                whatsapp_text,
                sms_text,
                whatsapp_template_name,
                whatsapp_template_language,
                whatsapp_template_category,
                whatsapp_template_status,
                is_active,
                updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'en_US', $7, 'NOT_SYNCED', true, NOW())
             ON CONFLICT (gym_id, template_key)
             DO NOTHING`,
            [gymId, template.template_key, template.title, template.whatsapp_text, template.sms_text, templateName, templateCategory]
        );
    }
};

const loadMessagingState = async (gymId) => {
    const [gymRes, templatesRes] = await Promise.all([
        pool.query(
            `SELECT
                messaging_owner_mobile,
                messaging_whatsapp_number,
                messaging_whatsapp_display_name,
                messaging_whatsapp_category,
                messaging_whatsapp_status,
                messaging_whatsapp_connected_at,
                messaging_whatsapp_last_checked_at,
                messaging_whatsapp_last_error,
                messaging_whatsapp_templates_status,
                messaging_whatsapp_templates_last_synced_at,
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
                member_payments_connected_at,
                name
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        ),
        pool.query(
            `SELECT
                template_key,
                title,
                whatsapp_text,
                sms_text,
                whatsapp_template_name,
                whatsapp_template_language,
                whatsapp_template_category,
                whatsapp_template_status,
                whatsapp_template_error,
                is_active,
                updated_at
             FROM gym_message_templates
             WHERE gym_id = $1
             ORDER BY template_key ASC`,
            [gymId]
        ),
    ]);

    return {
        gym: gymRes.rows[0] || {},
        templates: templatesRes.rows || [],
    };
};

const syncGymWhatsAppState = async (gymId) => {
    await seedMessageTemplates(gymId);

    const initialState = await loadMessagingState(gymId);
    const storedNumber = normalizeWhatsAppNumber(initialState.gym.messaging_whatsapp_number);

    if (!storedNumber) {
        await pool.query(
            `UPDATE gyms
             SET messaging_whatsapp_status = 'NOT_CONFIGURED',
                 messaging_whatsapp_last_checked_at = NOW(),
                 messaging_whatsapp_last_error = NULL,
                 messaging_whatsapp_templates_status = 'NOT_SYNCED'
             WHERE id = $1`,
            [gymId]
        );
        return loadMessagingState(gymId);
    }

    if (!isMsg91WhatsAppConfigured()) {
        await pool.query(
            `UPDATE gyms
             SET messaging_whatsapp_status = 'PLATFORM_NOT_READY',
                 messaging_whatsapp_last_checked_at = NOW(),
                 messaging_whatsapp_last_error = 'MSG91 WhatsApp auth key is not configured on the server.'
             WHERE id = $1`,
            [gymId]
        );
        return loadMessagingState(gymId);
    }

    try {
        const integratedNumbers = await listIntegratedWhatsAppNumbers();
        const matchedNumber = findIntegratedWhatsAppNumber(integratedNumbers, storedNumber);

        if (!matchedNumber) {
            await pool.query(
                `UPDATE gyms
                 SET messaging_whatsapp_status = 'PENDING_CONNECTION',
                     messaging_whatsapp_display_name = NULL,
                     messaging_whatsapp_category = NULL,
                     messaging_whatsapp_last_checked_at = NOW(),
                     messaging_whatsapp_last_error = 'Connect and verify this number in MSG91 before using campaigns.'
                 WHERE id = $1`,
                [gymId]
            );
            return loadMessagingState(gymId);
        }

        await pool.query(
            `UPDATE gyms
             SET messaging_whatsapp_number = $1,
                 messaging_whatsapp_display_name = $2,
                 messaging_whatsapp_category = $3,
                 messaging_whatsapp_status = 'CONNECTED',
                 messaging_whatsapp_connected_at = COALESCE(messaging_whatsapp_connected_at, NOW()),
                 messaging_whatsapp_last_checked_at = NOW(),
                 messaging_whatsapp_last_error = NULL
             WHERE id = $4`,
            [
                normalizeWhatsAppNumber(matchedNumber.integrated_number),
                matchedNumber.display_name || null,
                matchedNumber.category || null,
                gymId,
            ]
        );

        let providerTemplates = await listWhatsAppTemplates(matchedNumber.integrated_number);
        const providerTemplateMap = new Map(providerTemplates.map((template) => [String(template.template_name || '').toLowerCase(), template]));
        let createdTemplate = false;

        for (const template of initialState.templates) {
            const desiredName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
            const desiredCategory = pickTemplateCategory(template.template_key);
            const isActive = template.is_active !== false;

            if (!isActive) {
                await pool.query(
                    `UPDATE gym_message_templates
                     SET whatsapp_template_name = $1,
                         whatsapp_template_language = 'en_US',
                         whatsapp_template_category = $2,
                         whatsapp_template_status = 'DISABLED',
                         whatsapp_template_error = NULL,
                         updated_at = NOW()
                     WHERE gym_id = $3 AND template_key = $4`,
                    [desiredName, desiredCategory, gymId, template.template_key]
                );
                continue;
            }

            if (!providerTemplateMap.has(desiredName.toLowerCase())) {
                try {
                    await createWhatsAppTemplate({
                        integratedNumber: matchedNumber.integrated_number,
                        templateName: desiredName,
                        language: 'en_US',
                        category: desiredCategory,
                        whatsappText: template.whatsapp_text,
                    });
                    createdTemplate = true;
                } catch (templateErr) {
                    if (!looksLikeMsg91TemplateDuplicate(templateErr)) {
                        await pool.query(
                            `UPDATE gym_message_templates
                             SET whatsapp_template_name = $1,
                                 whatsapp_template_language = 'en_US',
                                 whatsapp_template_category = $2,
                                 whatsapp_template_status = 'FAILED',
                                 whatsapp_template_error = $3,
                                 updated_at = NOW()
                             WHERE gym_id = $4 AND template_key = $5`,
                            [desiredName, desiredCategory, String(templateErr.message || 'Template sync failed.'), gymId, template.template_key]
                        );
                        continue;
                    }
                }
            }
        }

        if (createdTemplate) {
            providerTemplates = await listWhatsAppTemplates(matchedNumber.integrated_number);
        }

        const refreshedProviderMap = new Map(providerTemplates.map((template) => [String(template.template_name || '').toLowerCase(), template]));
        const latestTemplatesState = await loadMessagingState(gymId);

        for (const template of latestTemplatesState.templates) {
            const desiredName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
            const desiredCategory = pickTemplateCategory(template.template_key);
            const providerTemplate = refreshedProviderMap.get(desiredName.toLowerCase());
            const nextStatus = template.is_active === false
                ? 'DISABLED'
                : providerTemplate
                    ? normalizeTemplateStatus(providerTemplate.template_status)
                    : normalizeTemplateStatus(template.whatsapp_template_status || 'NOT_SYNCED');
            const nextError = template.is_active === false
                ? null
                : providerTemplate
                    ? null
                    : template.whatsapp_template_error || null;

            await pool.query(
                `UPDATE gym_message_templates
                 SET whatsapp_template_name = $1,
                     whatsapp_template_language = $2,
                     whatsapp_template_category = $3,
                     whatsapp_template_status = $4,
                     whatsapp_template_error = $5,
                     updated_at = NOW()
                 WHERE gym_id = $6 AND template_key = $7`,
                [
                    desiredName,
                    providerTemplate?.template_language || 'en_US',
                    providerTemplate?.template_category || desiredCategory,
                    nextStatus,
                    nextError,
                    gymId,
                    template.template_key,
                ]
            );
        }

        const finalState = await loadMessagingState(gymId);
        const templatesStatus = summarizeTemplateSyncStatus(finalState.templates);

        await pool.query(
            `UPDATE gyms
             SET messaging_whatsapp_templates_status = $1,
                 messaging_whatsapp_templates_last_synced_at = NOW(),
                 messaging_whatsapp_last_checked_at = NOW(),
                 messaging_whatsapp_last_error = NULL
             WHERE id = $2`,
            [templatesStatus, gymId]
        );

        return loadMessagingState(gymId);
    } catch (err) {
        await pool.query(
            `UPDATE gyms
             SET messaging_whatsapp_status = 'ERROR',
                 messaging_whatsapp_last_checked_at = NOW(),
                 messaging_whatsapp_last_error = $1
             WHERE id = $2`,
            [String(err.message || 'Failed to refresh WhatsApp state.'), gymId]
        );
        return loadMessagingState(gymId);
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
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_number VARCHAR(30),
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_display_name VARCHAR(120),
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_category VARCHAR(60),
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_status VARCHAR(30) DEFAULT 'NOT_CONFIGURED',
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_connected_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_last_checked_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_last_error TEXT,
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_templates_status VARCHAR(30) DEFAULT 'NOT_SYNCED',
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_templates_last_synced_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS bulk_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS bulk_monthly_limit INTEGER DEFAULT 500,
                ADD COLUMN IF NOT EXISTS bulk_per_campaign_limit INTEGER DEFAULT 50,
                ADD COLUMN IF NOT EXISTS bulk_channels JSONB DEFAULT '{"whatsapp": true, "sms": false}'::jsonb;
            `);

            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_gyms_messaging_whatsapp_number_unique
                    ON gyms (messaging_whatsapp_number)
                    WHERE messaging_whatsapp_number IS NOT NULL;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS gym_message_templates (
                    id SERIAL PRIMARY KEY,
                    gym_id INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
                    template_key VARCHAR(60) NOT NULL,
                    title VARCHAR(120) NOT NULL,
                    whatsapp_text TEXT NOT NULL,
                    sms_text TEXT NOT NULL,
                    whatsapp_template_name VARCHAR(120),
                    whatsapp_template_language VARCHAR(20) DEFAULT 'en_US',
                    whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY',
                    whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_SYNCED',
                    whatsapp_template_error TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(gym_id, template_key)
                );
            `);

            await pool.query(`
                ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_name VARCHAR(120);
                ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(20) DEFAULT 'en_US';
                ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY';
                ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_SYNCED';
                ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_error TEXT;
            `);
        })();
    }
    await ensureMessagingSchemaPromise;
};

const ensureMemberPaymentsSchema = async () => {
    if (!ensureMemberPaymentsSchemaPromise) {
        ensureMemberPaymentsSchemaPromise = pool.query(`
            ALTER TABLE gyms
            ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT TRUE,
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
                ADD COLUMN IF NOT EXISTS interface_dark_mode BOOLEAN DEFAULT TRUE;
            `);
            await pool.query(`ALTER TABLE gyms ALTER COLUMN interface_dark_mode SET DEFAULT TRUE;`);
            await pool.query(`UPDATE gyms SET interface_dark_mode = TRUE WHERE interface_dark_mode IS NULL;`);
            await pool.query(`
                ALTER TABLE users
                ALTER COLUMN profile_pic TYPE TEXT;
            `);
        })();
    }
    await ensurePreferenceSchemaPromise;
};

const ensurePlatformSchema = async () => {
    if (!ensurePlatformSchemaPromise) {
        ensurePlatformSchemaPromise = (async () => {
            await pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS city VARCHAR(100),
                ADD COLUMN IF NOT EXISTS branches_count INTEGER DEFAULT 1,
                ADD COLUMN IF NOT EXISTS branch_directory JSONB DEFAULT '[]'::jsonb;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS api_keys (
                    id SERIAL PRIMARY KEY,
                    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                    key_name VARCHAR(120) NOT NULL DEFAULT '',
                    key_hash TEXT NOT NULL,
                    key_prefix VARCHAR(12) NOT NULL DEFAULT '',
                    scopes TEXT[] DEFAULT '{}',
                    is_active BOOLEAN DEFAULT TRUE,
                    last_used_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS webhooks (
                    id SERIAL PRIMARY KEY,
                    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                    url TEXT NOT NULL,
                    events TEXT[] DEFAULT '{}',
                    secret_hash TEXT DEFAULT '',
                    is_active BOOLEAN DEFAULT TRUE,
                    last_triggered_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
        })();
    }
    await ensurePlatformSchemaPromise;
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
            'SELECT name, phone, address, currency, timezone, tax_id, website, support_email, saas_status, saas_valid_until, current_plan, saas_billing_cycle, grace_period_days, COALESCE(interface_reduce_motion, FALSE) AS interface_reduce_motion, COALESCE(interface_compact_mode, FALSE) AS interface_compact_mode, COALESCE(interface_dark_mode, TRUE) AS interface_dark_mode FROM gyms WHERE id = $1', 
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
            `SELECT currency, timezone,
                    COALESCE(interface_reduce_motion, FALSE) AS interface_reduce_motion,
                    COALESCE(interface_compact_mode, FALSE) AS interface_compact_mode,
                    COALESCE(interface_dark_mode, TRUE) AS interface_dark_mode
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
            interface_dark_mode: true,
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
        const messagingState = await syncGymWhatsAppState(gymId);

        const usageRes = await pool.query(
            `SELECT COALESCE(SUM(sent_to_count), 0)::INT AS monthly_sent
             FROM broadcast_logs
             WHERE gym_id = $1
               AND created_at >= DATE_TRUNC('month', NOW())`,
            [gymId]
        );

        const row = messagingState.gym || {};
        const templates = messagingState.templates || [];
        const monthlyLimit = toPositiveInt(row.bulk_monthly_limit, 500);
        const monthlySent = toPositiveInt(usageRes.rows[0]?.monthly_sent, 0);
        const templateSummary = summarizeTemplateSyncStatus(templates);
        const platformOtpMode = getMsg91OtpMode().toLowerCase();

        return res.json({
            owner_mobile: row.messaging_owner_mobile || '',
            whatsapp_number: row.messaging_whatsapp_number || '',
            whatsapp_display_name: row.messaging_whatsapp_display_name || '',
            whatsapp_category: row.messaging_whatsapp_category || '',
            whatsapp_onboarding: getMsg91WhatsAppOnboardingConfig(),
            gateway_connected: isMsg91WhatsAppConfigured(),
            whatsapp_mode: String(row.messaging_whatsapp_status || 'NOT_CONFIGURED').toUpperCase(),
            whatsapp_status: String(row.messaging_whatsapp_status || 'NOT_CONFIGURED').toUpperCase(),
            whatsapp_ready: String(row.messaging_whatsapp_status || '').toUpperCase() === 'CONNECTED',
            whatsapp_connected_at: row.messaging_whatsapp_connected_at || null,
            whatsapp_last_checked_at: row.messaging_whatsapp_last_checked_at || null,
            whatsapp_last_error: row.messaging_whatsapp_last_error || '',
            whatsapp_templates_status: String(row.messaging_whatsapp_templates_status || templateSummary).toUpperCase(),
            whatsapp_templates_last_synced_at: row.messaging_whatsapp_templates_last_synced_at || null,
            platform_otp_mode: platformOtpMode,
            platform_otp_ready: true,
            sms_ready: platformOtpMode === 'msg91',
            bulk_enabled: Boolean(row.bulk_enabled),
            bulk_monthly_limit: monthlyLimit,
            bulk_per_campaign_limit: toPositiveInt(row.bulk_per_campaign_limit, 50),
            bulk_channels: row.bulk_channels || { whatsapp: true, sms: false },
            monthly_usage: monthlySent,
            monthly_remaining: Math.max(0, monthlyLimit - monthlySent),
            approved_template_count: templates.filter((template) => normalizeTemplateStatus(template.whatsapp_template_status) === 'APPROVED').length,
            templates,
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
            save_scope,
            owner_mobile,
            whatsapp_number,
            bulk_enabled,
            bulk_monthly_limit,
            bulk_per_campaign_limit,
            bulk_channels,
            templates,
            member_payments,
        } = req.body || {};

        const saveScope = ['payments', 'messaging', 'campaigns', 'all'].includes(String(save_scope || '').trim().toLowerCase())
            ? String(save_scope || '').trim().toLowerCase()
            : 'all';
        const shouldSavePayments = saveScope === 'payments' || saveScope === 'all';
        const shouldSaveMessaging = saveScope === 'messaging' || saveScope === 'all';
        const shouldSaveCampaigns = saveScope === 'campaigns' || saveScope === 'all';

        const currentGymRes = await pool.query(
            `SELECT
                messaging_owner_mobile,
                messaging_whatsapp_number,
                bulk_enabled,
                bulk_monthly_limit,
                bulk_per_campaign_limit,
                bulk_channels
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        );
        const currentGym = currentGymRes.rows[0] || {};

        const ownerMobileInput = String(owner_mobile || '').trim();
        const normalizedOwnerMobile = ownerMobileInput
            ? normalizeMessagingPhone(owner_mobile)
            : String(currentGym.messaging_owner_mobile || '').trim();
        const whatsappNumberInput = String(whatsapp_number || '').trim();
        const currentWhatsAppNumber = normalizeWhatsAppNumber(currentGym.messaging_whatsapp_number);
        const normalizedWhatsAppNumber = whatsappNumberInput
            ? normalizeWhatsAppNumber(whatsapp_number)
            : currentWhatsAppNumber;

        const monthlyLimit = Math.min(100000, Math.max(10, toPositiveInt(bulk_monthly_limit, 500)));
        const perCampaign = Math.min(1000, Math.max(1, toPositiveInt(bulk_per_campaign_limit, 50)));
        const channels = {
            whatsapp: Boolean(bulk_channels?.whatsapp ?? true),
            sms: false,
        };

        if (ownerMobileInput && !normalizedOwnerMobile) {
            return res.status(400).json({ error: 'Please enter a valid owner alert mobile number in +91XXXXXXXXXX format.' });
        }

        if (shouldSaveMessaging && !normalizedWhatsAppNumber) {
            return res.status(400).json({ error: 'Please enter the gym business WhatsApp number in +91XXXXXXXXXX format.' });
        }

        if (shouldSaveMessaging || shouldSaveCampaigns) {
            await pool.query(
                `UPDATE gyms
                 SET messaging_owner_mobile = $1,
                     messaging_whatsapp_number = $2,
                     bulk_enabled = $3,
                     bulk_monthly_limit = $4,
                     bulk_per_campaign_limit = $5,
                     bulk_channels = $6
                 WHERE id = $7`,
                [
                    normalizedOwnerMobile || String(currentGym.messaging_owner_mobile || '').trim() || null,
                    shouldSaveMessaging ? (normalizedWhatsAppNumber || null) : (currentWhatsAppNumber || null),
                    shouldSaveCampaigns ? Boolean(bulk_enabled) : Boolean(currentGym.bulk_enabled),
                    shouldSaveCampaigns ? monthlyLimit : toPositiveInt(currentGym.bulk_monthly_limit, 500),
                    shouldSaveCampaigns ? perCampaign : toPositiveInt(currentGym.bulk_per_campaign_limit, 50),
                    shouldSaveCampaigns ? channels : (currentGym.bulk_channels || { whatsapp: true, sms: false }),
                    gymId,
                ]
            );

            if (shouldSaveMessaging && normalizedWhatsAppNumber !== currentWhatsAppNumber) {
                await pool.query(
                    `UPDATE gyms
                     SET messaging_whatsapp_display_name = NULL,
                         messaging_whatsapp_category = NULL,
                         messaging_whatsapp_status = $1,
                         messaging_whatsapp_connected_at = NULL,
                         messaging_whatsapp_last_checked_at = NULL,
                         messaging_whatsapp_last_error = NULL,
                         messaging_whatsapp_templates_status = 'NOT_SYNCED',
                         messaging_whatsapp_templates_last_synced_at = NULL
                     WHERE id = $2`,
                    [normalizedWhatsAppNumber ? 'PENDING_CONNECTION' : 'NOT_CONFIGURED', gymId]
                );
            }
        }

        if (shouldSavePayments && member_payments && typeof member_payments === 'object') {
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
            const hasManualGateway = connectMode === 'MANUAL' && Boolean(keyId && (incomingSecret || member_payments.has_razorpay_secret === true));
            const hasPartnerGateway = connectMode === 'PARTNER' && Boolean(connectedAccountId);
            const hasCollectionChannel = Boolean(upiId || hasManualGateway || hasPartnerGateway);

            if (enabled && !hasCollectionChannel) {
                return res.status(400).json({ error: 'Configure Razorpay collection or a direct UPI ID before enabling member online collection.' });
            }

            const secretToPersist = incomingSecret ? encryptSecret(incomingSecret) : existingEncryptedSecret;
            const nextOnboardingStatus = !enabled
                ? 'NOT_CONNECTED'
                : hasPartnerGateway
                    ? String(current.member_payments_onboarding_status || 'NOT_CONNECTED').toUpperCase()
                    : hasManualGateway
                        ? 'MANUAL_CONFIGURED'
                        : upiId
                            ? 'UPI_COLLECTION_READY'
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

        if (shouldSaveCampaigns && Array.isArray(templates) && templates.length > 0) {
            for (const template of templates) {
                const key = String(template.template_key || '').trim().toUpperCase();
                const fallback = MESSAGE_TEMPLATE_DEFAULTS.find((item) => item.template_key === key);
                const title = String(template.title || fallback?.title || key).trim().slice(0, 120);
                const whatsappText = String(template.whatsapp_text || fallback?.whatsapp_text || '').trim();
                const smsText = String(template.sms_text || fallback?.sms_text || whatsappText).trim();
                const isActive = template.is_active !== false;
                const templateName = buildTemplateName(gymId, key, whatsappText);
                const templateCategory = pickTemplateCategory(key);

                if (!key || !title || whatsappText.length < 10 || smsText.length < 10) continue;

                await pool.query(
                    `INSERT INTO gym_message_templates (
                        gym_id,
                        template_key,
                        title,
                        whatsapp_text,
                        sms_text,
                        whatsapp_template_name,
                        whatsapp_template_language,
                        whatsapp_template_category,
                        whatsapp_template_status,
                        whatsapp_template_error,
                        is_active,
                        updated_at
                     )
                     VALUES ($1, $2, $3, $4, $5, $6, 'en_US', $7, $8, NULL, $9, NOW())
                     ON CONFLICT (gym_id, template_key)
                     DO UPDATE SET
                        title = EXCLUDED.title,
                        whatsapp_text = EXCLUDED.whatsapp_text,
                        sms_text = EXCLUDED.sms_text,
                        whatsapp_template_name = EXCLUDED.whatsapp_template_name,
                        whatsapp_template_language = EXCLUDED.whatsapp_template_language,
                        whatsapp_template_category = EXCLUDED.whatsapp_template_category,
                        whatsapp_template_status = CASE
                            WHEN EXCLUDED.is_active = FALSE THEN 'DISABLED'
                            WHEN COALESCE(gym_message_templates.whatsapp_template_name, '') = COALESCE(EXCLUDED.whatsapp_template_name, '')
                                THEN COALESCE(gym_message_templates.whatsapp_template_status, 'NOT_SYNCED')
                            ELSE 'NOT_SYNCED'
                        END,
                        whatsapp_template_error = CASE
                            WHEN EXCLUDED.is_active = FALSE THEN NULL
                            WHEN COALESCE(gym_message_templates.whatsapp_template_name, '') = COALESCE(EXCLUDED.whatsapp_template_name, '')
                                THEN gym_message_templates.whatsapp_template_error
                            ELSE NULL
                        END,
                        is_active = EXCLUDED.is_active,
                        updated_at = NOW()`,
                    [
                        gymId,
                        key,
                        title,
                        whatsappText,
                        smsText,
                        templateName,
                        templateCategory,
                        isActive ? 'NOT_SYNCED' : 'DISABLED',
                        isActive,
                    ]
                );
            }
        } else if (shouldSaveCampaigns) {
            await seedMessageTemplates(gymId);
        }

        if (shouldSaveMessaging || shouldSaveCampaigns) {
            await syncGymWhatsAppState(gymId);
        }

        const message = shouldSavePayments && !shouldSaveMessaging && !shouldSaveCampaigns
            ? 'Payment integrations saved successfully.'
            : shouldSaveCampaigns && !shouldSavePayments && !shouldSaveMessaging
                ? 'WhatsApp campaign settings saved successfully.'
                : shouldSaveMessaging && !shouldSavePayments && !shouldSaveCampaigns
                    ? 'WhatsApp setup saved successfully.'
                    : 'Integration settings saved successfully.';

        return res.json({ message });
    } catch (err) {
        console.error('INTEGRATIONS SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/integrations/test-message', auth, async (req, res) => {
    try {
        await ensureMessagingSchema();

        const gymId = req.user.gym_id;
        const toInput = String(req.body.to || '').trim();
        const requestedTemplateKey = String(req.body.template_key || '').trim().toUpperCase();

        if (!toInput) {
            return res.status(400).json({ error: 'Recipient mobile number is required.' });
        }

        const normalizedTo = normalizeLocalIndianPhone(toInput);
        if (!normalizedTo) {
            return res.status(400).json({ error: 'Please enter a valid recipient mobile number.' });
        }

        const messagingState = await syncGymWhatsAppState(gymId);
        const gym = messagingState.gym || {};

        if (String(gym.messaging_whatsapp_status || '').toUpperCase() !== 'CONNECTED') {
            return res.status(400).json({ error: 'Connect and verify your gym WhatsApp number before sending a test template.' });
        }

        const approvedTemplates = (messagingState.templates || []).filter(
            (template) => template.is_active !== false && normalizeTemplateStatus(template.whatsapp_template_status) === 'APPROVED'
        );

        const selectedTemplate = requestedTemplateKey
            ? approvedTemplates.find((template) => template.template_key === requestedTemplateKey)
            : approvedTemplates[0];

        if (!selectedTemplate) {
            return res.status(400).json({ error: 'Approve at least one WhatsApp template in Integrations before sending a test message.' });
        }

        await sendWhatsAppTemplate({
            integratedNumber: gym.messaging_whatsapp_number,
            templateName: selectedTemplate.whatsapp_template_name,
            language: selectedTemplate.whatsapp_template_language || 'en_US',
            recipientNumber: normalizedTo,
            variables: buildTemplateBodyVariables(
                selectedTemplate.whatsapp_text,
                { full_name: 'Test Member', plan_name: 'Elite Plan', days_to_expiry: 3 },
                gym.name || 'GymVault'
            ),
        });

        return res.json({
            message: `WhatsApp test template sent using ${selectedTemplate.title}.`,
            channel: 'WHATSAPP',
            template_key: selectedTemplate.template_key,
        });
    } catch (err) {
        console.error('TEST MESSAGE ERROR:', err.message);
        return res.status(500).json({
            error: 'Failed to send test message.',
        });
    }
});

router.get('/platform', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const gymId = req.user.gym_id;
        const [gymRes, apiKeyRes, webhookRes] = await Promise.all([
            pool.query(
                `SELECT city, branches_count, branch_directory
                 FROM gyms
                 WHERE id = $1
                 LIMIT 1`,
                [gymId]
            ),
            pool.query(
                `SELECT id, key_name, key_prefix, scopes, is_active, last_used_at, created_at
                 FROM api_keys
                 WHERE gym_id = $1
                 ORDER BY created_at DESC`,
                [gymId]
            ),
            pool.query(
                `SELECT id, url, events, is_active, last_triggered_at, created_at,
                        (COALESCE(secret_hash, '') <> '') AS has_secret
                 FROM webhooks
                 WHERE gym_id = $1
                 ORDER BY created_at DESC`,
                [gymId]
            ),
        ]);

        const gym = gymRes.rows[0] || {};
        const branchesCount = Math.min(25, Math.max(1, toPositiveInt(gym.branches_count, 1)));

        return res.json({
            city: String(gym.city || ''),
            branches_count: branchesCount,
            branch_directory: normalizeBranchDirectory(gym.branch_directory, branchesCount),
            api_keys: apiKeyRes.rows,
            webhooks: webhookRes.rows.map((item) => ({
                ...item,
                has_secret: Boolean(item.has_secret),
            })),
        });
    } catch (err) {
        console.error('PLATFORM FETCH ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/platform/branches', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const city = String(req.body?.city || '').trim();
        const branchesCount = Math.min(25, Math.max(1, toPositiveInt(req.body?.branches_count, 1)));
        const branchDirectory = normalizeBranchDirectory(req.body?.branch_directory, branchesCount);

        await pool.query(
            `UPDATE gyms
             SET city = $1,
                 branches_count = $2,
                 branch_directory = $3
             WHERE id = $4`,
            [city || null, branchesCount, JSON.stringify(branchDirectory), req.user.gym_id]
        );

        return res.json({
            message: 'Branch controls saved successfully.',
            city,
            branches_count: branchesCount,
            branch_directory: branchDirectory,
        });
    } catch (err) {
        console.error('BRANCH SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/platform/api-keys', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const keyName = String(req.body?.key_name || '').trim();
        const scopes = normalizeApiScopes(req.body?.scopes);
        if (!keyName) {
            return res.status(400).json({ error: 'key_name is required.' });
        }
        if (scopes.length === 0) {
            return res.status(400).json({ error: 'Select at least one scope.' });
        }

        const plainTextKey = generateApiToken();
        const keyPrefix = plainTextKey.slice(0, 8);
        const result = await pool.query(
            `INSERT INTO api_keys (gym_id, key_name, key_hash, key_prefix, scopes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, key_name, key_prefix, scopes, is_active, last_used_at, created_at`,
            [req.user.gym_id, keyName, hashValue(plainTextKey), keyPrefix, scopes]
        );

        return res.status(201).json({
            message: 'API key created. Copy it now because it will not be shown again.',
            api_key: result.rows[0],
            plain_text_key: plainTextKey,
        });
    } catch (err) {
        console.error('API KEY CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/platform/api-keys/:id', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        const result = await pool.query(
            `UPDATE api_keys
             SET is_active = FALSE
             WHERE id = $1 AND gym_id = $2
             RETURNING id`,
            [req.params.id, req.user.gym_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'API key not found.' });
        }
        return res.json({ message: 'API key revoked.' });
    } catch (err) {
        console.error('API KEY DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/platform/webhooks', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const url = String(req.body?.url || '').trim();
        const events = normalizeWebhookEvents(req.body?.events);
        const secret = String(req.body?.secret || '').trim();
        const isActive = req.body?.is_active !== false;

        if (!/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: 'A valid webhook URL is required.' });
        }
        if (events.length === 0) {
            return res.status(400).json({ error: 'Select at least one webhook event.' });
        }

        const result = await pool.query(
            `INSERT INTO webhooks (gym_id, url, events, secret_hash, is_active)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, url, events, is_active, last_triggered_at, created_at`,
            [req.user.gym_id, url, events, secret ? encryptSecret(secret) : '', isActive]
        );

        return res.status(201).json({
            message: 'Webhook created successfully.',
            webhook: {
                ...result.rows[0],
                has_secret: Boolean(secret),
            },
        });
    } catch (err) {
        console.error('WEBHOOK CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/platform/webhooks/:id', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const webhookRes = await pool.query(
            'SELECT secret_hash FROM webhooks WHERE id = $1 AND gym_id = $2 LIMIT 1',
            [req.params.id, req.user.gym_id]
        );
        if (webhookRes.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook not found.' });
        }

        const url = String(req.body?.url || '').trim();
        const events = normalizeWebhookEvents(req.body?.events);
        const secret = String(req.body?.secret || '').trim();
        const isActive = req.body?.is_active !== false;
        if (!/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: 'A valid webhook URL is required.' });
        }
        if (events.length === 0) {
            return res.status(400).json({ error: 'Select at least one webhook event.' });
        }

        const secretToPersist = secret ? encryptSecret(secret) : String(webhookRes.rows[0].secret_hash || '');
        const result = await pool.query(
            `UPDATE webhooks
             SET url = $1,
                 events = $2,
                 secret_hash = $3,
                 is_active = $4
             WHERE id = $5 AND gym_id = $6
             RETURNING id, url, events, is_active, last_triggered_at, created_at, secret_hash`,
            [url, events, secretToPersist, isActive, req.params.id, req.user.gym_id]
        );

        return res.json({
            message: 'Webhook updated successfully.',
            webhook: {
                ...result.rows[0],
                has_secret: Boolean(decryptSecret(result.rows[0].secret_hash || '')),
            },
        });
    } catch (err) {
        console.error('WEBHOOK UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/platform/webhooks/:id', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        const result = await pool.query(
            'DELETE FROM webhooks WHERE id = $1 AND gym_id = $2 RETURNING id',
            [req.params.id, req.user.gym_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook not found.' });
        }
        return res.json({ message: 'Webhook deleted.' });
    } catch (err) {
        console.error('WEBHOOK DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/platform/webhooks/:id/test', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const webhookRes = await pool.query(
            'SELECT * FROM webhooks WHERE id = $1 AND gym_id = $2 LIMIT 1',
            [req.params.id, req.user.gym_id]
        );
        if (webhookRes.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook not found.' });
        }

        const webhook = webhookRes.rows[0];
        const payload = {
            event: 'gymvault.test',
            gym_id: req.user.gym_id,
            generated_at: new Date().toISOString(),
            data: {
                source: 'settings',
                message: 'This is a GymVault webhook test event.',
            },
        };
        const body = JSON.stringify(payload);
        const secret = decryptSecret(webhook.secret_hash || '');
        const signature = secret ? crypto.createHmac('sha256', secret).update(body).digest('hex') : '';
        const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-gymvault-event': payload.event,
                ...(signature ? { 'x-gymvault-signature': signature } : {}),
            },
            body,
        });

        await pool.query(
            'UPDATE webhooks SET last_triggered_at = NOW() WHERE id = $1 AND gym_id = $2',
            [req.params.id, req.user.gym_id]
        );

        return res.json({ message: `Test webhook sent successfully (${response.status}).`, status: response.status });
    } catch (err) {
        console.error('WEBHOOK TEST ERROR:', err.message);
        return res.status(502).json({ error: 'Failed to deliver webhook test event.' });
    }
});

router.post('/import/members', auth, async (req, res) => {
    try {
        const csvText = String(req.body?.csv_text || '').trim();
        const dryRun = req.body?.dry_run === true;
        if (!csvText) {
            return res.status(400).json({ error: 'csv_text is required.' });
        }

        const rows = parseCsvText(csvText);
        if (rows.length === 0) {
            return res.status(400).json({ error: 'No rows found in the import payload.' });
        }

        const headerRow = rows[0].map((cell) => String(cell || '').trim().toLowerCase());
        const hasHeader = headerRow.includes('full_name') || headerRow.includes('email') || headerRow.includes('phone');
        const dataRows = hasHeader ? rows.slice(1) : rows;

        const fullNameIndex = hasHeader ? headerRow.indexOf('full_name') : 0;
        const emailIndex = hasHeader ? headerRow.indexOf('email') : 1;
        const phoneIndex = hasHeader ? headerRow.indexOf('phone') : 2;

        if (fullNameIndex === -1 || emailIndex === -1 || phoneIndex === -1) {
            return res.status(400).json({ error: 'CSV must include full_name, email, and phone columns.' });
        }

        const existingMembersRes = await pool.query(
            `SELECT LOWER(email) AS email, phone
             FROM members
             WHERE gym_id = $1 AND deleted_at IS NULL`,
            [req.user.gym_id]
        );
        const existingEmails = new Set(existingMembersRes.rows.map((row) => String(row.email || '').trim().toLowerCase()).filter(Boolean));
        const existingPhones = new Set(existingMembersRes.rows.map((row) => normalizeMemberImportPhone(row.phone)).filter(Boolean));
        const batchEmails = new Set();
        const batchPhones = new Set();
        const validRows = [];
        const errors = [];

        dataRows.forEach((row, index) => {
            const full_name = String(row[fullNameIndex] || '').trim();
            const email = String(row[emailIndex] || '').trim().toLowerCase();
            const phone = normalizeMemberImportPhone(row[phoneIndex]);
            const rowNumber = hasHeader ? index + 2 : index + 1;

            if (!full_name || !email || !phone) {
                errors.push({ row: rowNumber, error: 'full_name, email, and phone are required.' });
                return;
            }
            if (!/^\d{10}$/.test(phone)) {
                errors.push({ row: rowNumber, error: 'Phone must contain exactly 10 digits.' });
                return;
            }
            if (!/^\S+@\S+\.\S+$/.test(email)) {
                errors.push({ row: rowNumber, error: 'Email format is invalid.' });
                return;
            }
            if (existingEmails.has(email) || batchEmails.has(email)) {
                errors.push({ row: rowNumber, error: 'Email already exists in this gym.' });
                return;
            }
            if (existingPhones.has(phone) || batchPhones.has(phone)) {
                errors.push({ row: rowNumber, error: 'Phone already exists in this gym.' });
                return;
            }

            batchEmails.add(email);
            batchPhones.add(phone);
            validRows.push({ full_name, email, phone });
        });

        let importedCount = 0;
        if (!dryRun && validRows.length > 0) {
            await pool.query('BEGIN');
            for (const row of validRows) {
                await pool.query(
                    `INSERT INTO members (full_name, email, phone, gym_id, joining_date, status)
                     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'UNPAID')`,
                    [row.full_name, row.email, row.phone, req.user.gym_id]
                );
                importedCount += 1;
            }
            await pool.query('COMMIT');
        }

        return res.json({
            message: dryRun ? 'Import preview generated.' : `Imported ${importedCount} member${importedCount === 1 ? '' : 's'}.`,
            total_rows: dataRows.length,
            valid_rows: validRows.length,
            imported_count: importedCount,
            error_count: errors.length,
            errors: errors.slice(0, 20),
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('MEMBER IMPORT ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
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