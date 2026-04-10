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
    operationalizeTemplateCopy,
    pickTemplateCategory,
    sendWhatsAppTemplate,
} = require('../utils/msg91');
const {
    MSG91_WHATSAPP_WEBHOOK_DOC_URL,
    applyWhatsAppDeliveryWebhook,
    ensureWhatsAppDeliverySchema,
    getRecentWhatsAppDeliveryLogs,
    getWhatsAppDeliverySummary,
    normalizeWebhookToken,
    sendTrackedWhatsAppTemplate,
} = require('../utils/whatsappDelivery');
const {
    createProfileUploadMiddleware,
    cleanupUploadedFile,
    getStoredProfileValue,
    resolveStoredProfileImagePath,
} = require('../utils/profileUploads');
const { clearUserAuthCookie } = require('../utils/authCookies');
const { invalidateGymTimezoneCache } = require('../utils/gymTime');
const {
    computeEffectiveBillingLimits,
    ensureGymBillingAddonSchema,
    getBillingConfig,
    getBillingPlan,
    getBranchUsageSnapshot,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
    hasBillingCapability,
    serializeBillingConfig,
} = require('../utils/platformSettings');
const {
    ValidationError,
    ensureTrimmedString,
    ensureEmail,
    ensureInteger,
    ensureChoice,
    ensureObject,
    ensureUrl,
    isValidationError,
} = require('../utils/fieldValidation');
const {
    DEFAULT_BRANCH_ID,
    branchSchemaMiddleware,
    getGymBranchDirectory,
    getBranchName,
    getOutOfDirectoryBranchUsage,
} = require('../utils/branchAccess');

const isProduction = process.env.NODE_ENV === 'production';

const stripTrailingSlash = (value, fallback = '') => String(value || fallback || '').trim().replace(/\/+$/, '');

const getRequestBaseUrl = (req) => {
    const configured = stripTrailingSlash(process.env.APP_URL, '');
    if (configured) return configured;

    const forwardedProtocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http';
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    return forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : 'http://localhost:5000';
};

const buildWhatsAppDeliveryCallbackUrl = (req) => {
    const url = new URL('/api/settings/platform/whatsapp-delivery/webhook', `${getRequestBaseUrl(req)}/`);
    const token = normalizeWebhookToken();
    if (token) {
        url.searchParams.set('token', token);
    }
    return url.toString();
};

const buildScaledLimitHint = (effectiveLimits, totalLimitKey) => {
    const totalLimit = effectiveLimits?.[totalLimitKey];
    if (totalLimit === null || totalLimit === undefined) return '';

    const includedBranches = Number(effectiveLimits?.branches || 1);
    if (Boolean(effectiveLimits?.pooled_single_branch) && includedBranches > 1) {
        return ` (pooled from ${includedBranches} included branch${includedBranches === 1 ? '' : 'es'})`;
    }

    const scaledBranches = Number(effectiveLimits?.capacity_branches || 1);
    if (scaledBranches > 1) {
        const configuredBranches = Number(effectiveLimits?.configured_branches || 1);
        const scopeLabel = scaledBranches === configuredBranches
            ? 'configured branch'
            : 'active branch entitlement';
        return ` (${totalLimit} total across ${scaledBranches} ${scopeLabel}${scaledBranches === 1 ? '' : 's'})`;
    }

    return '';
};

const describeScaledLimitScope = (effectiveLimits) => {
    const includedBranches = Number(effectiveLimits?.branches || 1);
    if (Boolean(effectiveLimits?.pooled_single_branch) && includedBranches > 1) {
        return `after pooling ${includedBranches} included branch${includedBranches === 1 ? '' : 'es'} into your current branch`;
    }

    const scaledBranches = Number(effectiveLimits?.capacity_branches || 1);
    if (scaledBranches > 1) {
        const configuredBranches = Number(effectiveLimits?.configured_branches || 1);
        if (scaledBranches === configuredBranches) {
            return `across ${scaledBranches} configured branch${scaledBranches === 1 ? '' : 'es'}`;
        }
        return `across ${scaledBranches} branch entitlement${scaledBranches === 1 ? '' : 's'} available under your current plan`;
    }

    return 'in your current branch';
};

const renderWhatsAppTemplatePreviewText = (templateText, member = {}, gymName = '') => {
    const daysLeft = Number.isFinite(Number(member?.days_to_expiry)) ? Number(member.days_to_expiry) : 0;
    const values = {
        name: String(member?.full_name || 'Member').trim() || 'Member',
        plan: String(member?.plan_name || 'your plan').trim() || 'your plan',
        days_left: String(daysLeft),
        gym_name: String(gymName || 'GymVault').trim() || 'GymVault',
    };

    return String(templateText || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_token, placeholder) => {
        const key = String(placeholder || '').trim().toLowerCase();
        return values[key] || key.replace(/_/g, ' ');
    });
};

router.post('/platform/whatsapp-delivery/webhook', async (req, res) => {
    try {
        const expectedToken = normalizeWebhookToken();
        const suppliedToken = String(req.query.token || req.headers['x-gymvault-token'] || '').trim();

        if (expectedToken && suppliedToken !== expectedToken) {
            return res.status(401).json({ error: 'Invalid webhook token.' });
        }

        if (!expectedToken && !isProduction) {
            console.warn('WHATSAPP DELIVERY WEBHOOK WARNING: processing webhook without MSG91_WHATSAPP_WEBHOOK_TOKEN configured.');
        }

        const result = await applyWhatsAppDeliveryWebhook(req.body || {});
        return res.status(200).json({ ok: true, ...result });
    } catch (err) {
        console.error('WHATSAPP DELIVERY WEBHOOK ERROR:', err.message);
        return res.status(500).json({ error: 'Webhook processing failed.' });
    }
});

router.get('/branches', auth, branchSchemaMiddleware, async (req, res) => {
    try {
        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        return res.json({
            branch_directory: branchDirectory,
            default_branch_id: branchDirectory[0]?.id || 'branch-1',
            current_branch_id: String(req.user.branch_id || branchDirectory[0]?.id || 'branch-1'),
            can_select_all_branches: String(req.user.role || '').trim().toUpperCase() === 'OWNER' && branchDirectory.length > 1,
        });
    } catch (err) {
        console.error('BRANCH DIRECTORY FETCH ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load branch directory.' });
    }
});

router.use(auth, requireOwner);
router.use(branchSchemaMiddleware);

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

const MESSAGE_TEMPLATE_KEYS = MESSAGE_TEMPLATE_DEFAULTS.map((template) => template.template_key);
const MAX_MESSAGE_TEMPLATES = 50;
const MESSAGE_TEMPLATE_KEY_SET = new Set(MESSAGE_TEMPLATE_KEYS);
const CUSTOM_TEMPLATE_KEY_PREFIX = 'CUSTOM_';

const isBuiltInTemplateKey = (value) => MESSAGE_TEMPLATE_KEY_SET.has(String(value || '').trim().toUpperCase());

const normalizeTemplateKey = (value, field = 'template_key') => {
    const key = ensureTrimmedString(value, {
        field,
        required: true,
        max: 60,
        uppercase: true,
    });

    if (!/^[A-Z0-9_]+$/.test(key)) {
        throw new ValidationError(`${field} must contain only letters, numbers, and underscores.`);
    }

    return key;
};

const deriveTemplateTitleFromText = (value) => {
    const words = String(value || '')
        .replace(/{{\s*[a-zA-Z0-9_]+\s*}}/g, ' ')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5);

    if (words.length === 0) {
        return 'Custom Template';
    }

    return words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const buildCustomTemplateKey = (title, rawText) => {
    const stem = String(title || rawText || 'custom template')
        .replace(/{{\s*[a-zA-Z0-9_]+\s*}}/g, ' ')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_')
        .toUpperCase()
        .slice(0, 28) || 'MESSAGE';
    const signature = crypto.createHash('sha1').update(String(rawText || title || Date.now())).digest('hex').slice(0, 6).toUpperCase();
    return `${CUSTOM_TEMPLATE_KEY_PREFIX}${stem}_${signature}`.slice(0, 60);
};

const sortTemplatesForSettings = (templates = []) => [...templates].sort((left, right) => {
    const leftKey = String(left?.template_key || '').trim().toUpperCase();
    const rightKey = String(right?.template_key || '').trim().toUpperCase();
    const leftBuiltIn = isBuiltInTemplateKey(leftKey);
    const rightBuiltIn = isBuiltInTemplateKey(rightKey);

    if (leftBuiltIn && rightBuiltIn) {
        return MESSAGE_TEMPLATE_KEYS.indexOf(leftKey) - MESSAGE_TEMPLATE_KEYS.indexOf(rightKey);
    }

    if (leftBuiltIn !== rightBuiltIn) {
        return leftBuiltIn ? -1 : 1;
    }

    return String(left?.title || leftKey).localeCompare(String(right?.title || rightKey));
});

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

const normalizeBranchDirectoryInput = (value, branchesCount = 1) => normalizeBranchDirectory(value, branchesCount).map((item, index) => ({
    id: ensureTrimmedString(item?.id, { field: `branch_directory[${index}].id`, max: 60, defaultValue: `branch-${index + 1}` }) || `branch-${index + 1}`,
    name: ensureTrimmedString(item?.name, { field: `branch_directory[${index}].name`, max: 120, defaultValue: index === 0 ? 'Main Branch' : `Branch ${index + 1}` }) || (index === 0 ? 'Main Branch' : `Branch ${index + 1}`),
    address: ensureTrimmedString(item?.address, { field: `branch_directory[${index}].address`, max: 240 }),
    phone: ensureTrimmedString(item?.phone, { field: `branch_directory[${index}].phone`, max: 30 }),
}));

const normalizeWebhookSecret = (value) => ensureTrimmedString(value, { field: 'secret', max: 240 });

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

const INTEGRATION_SAVE_SCOPES = ['payments', 'messaging', 'campaigns', 'all'];
const MEMBER_PAYMENT_CONNECT_MODES = ['MANUAL', 'PARTNER'];

const normalizeCampaignChannelsInput = (value, fallback = { whatsapp: true, sms: false }) => {
    const source = ensureObject(value, { field: 'bulk_channels', defaultValue: {} });
    return {
        whatsapp: Boolean(source.whatsapp ?? fallback.whatsapp ?? true),
        sms: false,
    };
};

const normalizeIntegrationTemplatesInput = (value) => {
    if (value === undefined || value === null || value === '') {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('templates must be an array.');
    }

    if (value.length > MAX_MESSAGE_TEMPLATES) {
        throw new ValidationError(`templates must contain ${MAX_MESSAGE_TEMPLATES} items or fewer.`);
    }

    const seenKeys = new Set();
    return value.map((entry, index) => {
        const template = ensureObject(entry, { field: `templates[${index}]` });
        const key = normalizeTemplateKey(template.template_key, `templates[${index}].template_key`);

        if (seenKeys.has(key)) {
            throw new ValidationError(`templates contains a duplicate template_key: ${key}.`);
        }
        seenKeys.add(key);

        const fallback = MESSAGE_TEMPLATE_DEFAULTS.find((item) => item.template_key === key);
        const isCustomTemplate = !isBuiltInTemplateKey(key);
        const rawWhatsAppText = ensureTrimmedString(template.whatsapp_text || fallback?.whatsapp_text || '', {
            field: `templates[${index}].whatsapp_text`,
            required: true,
            min: 10,
            max: 4000,
        });
        const whatsappText = isCustomTemplate ? operationalizeTemplateCopy(rawWhatsAppText) : rawWhatsAppText;
        const rawSmsText = ensureTrimmedString(template.sms_text || fallback?.sms_text || whatsappText, {
            field: `templates[${index}].sms_text`,
            required: true,
            min: 10,
            max: 4000,
        });
        const smsText = isCustomTemplate ? operationalizeTemplateCopy(rawSmsText) : rawSmsText;
        const titleFallback = fallback?.title || deriveTemplateTitleFromText(rawWhatsAppText) || key;

        return {
            template_key: key,
            title: ensureTrimmedString(template.title || titleFallback, {
                field: `templates[${index}].title`,
                required: true,
                min: 2,
                max: 120,
            }),
            whatsapp_text: whatsappText,
            sms_text: smsText,
            whatsapp_template_category: pickTemplateCategory(key, whatsappText),
            is_active: template.is_active !== false,
        };
    });
};

const normalizeMemberPaymentSettingsInput = (value, currentConnectMode = 'PARTNER') => {
    const settings = ensureObject(value, { field: 'member_payments' });
    return {
        enabled: Boolean(settings.enabled),
        connectMode: ensureChoice(settings.connect_mode, {
            field: 'member_payments.connect_mode',
            choices: MEMBER_PAYMENT_CONNECT_MODES,
            defaultValue: String(currentConnectMode || 'MANUAL').toUpperCase(),
            uppercase: true,
        }),
        keyId: ensureTrimmedString(settings.razorpay_key_id, {
            field: 'member_payments.razorpay_key_id',
            max: 120,
        }),
        incomingSecret: ensureTrimmedString(settings.razorpay_key_secret, {
            field: 'member_payments.razorpay_key_secret',
            max: 240,
        }),
        upiId: ensureTrimmedString(settings.upi_id, {
            field: 'member_payments.upi_id',
            max: 120,
            lowercase: true,
        }),
    };
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

const seedMessageTemplates = async (gymId, db = pool) => {
    for (const template of MESSAGE_TEMPLATE_DEFAULTS) {
        const templateName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
        const templateCategory = pickTemplateCategory(template.template_key, template.whatsapp_text);

        await db.query(
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
                name,
                current_plan,
                COALESCE(branches_count, 1) AS branches_count,
                COALESCE(addon_extra_whatsapp, 0) AS addon_extra_whatsapp,
                COALESCE(addon_extra_branches, 0) AS addon_extra_branches,
                COALESCE(addon_extra_hello, 0) AS addon_extra_hello
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
        templates: sortTemplatesForSettings((templatesRes.rows || []).map((template) => ({
            ...template,
            is_custom: !isBuiltInTemplateKey(template.template_key),
        }))),
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
        let shouldRefreshProviderTemplates = false;
        const submittedTemplateNames = new Set();

        for (const template of initialState.templates) {
            const desiredName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
            const desiredCategory = pickTemplateCategory(template.template_key, template.whatsapp_text);
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
                    shouldRefreshProviderTemplates = true;
                    submittedTemplateNames.add(desiredName.toLowerCase());
                } catch (templateErr) {
                    if (looksLikeMsg91TemplateDuplicate(templateErr)) {
                        shouldRefreshProviderTemplates = true;
                        submittedTemplateNames.add(desiredName.toLowerCase());
                        continue;
                    }

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

        if (shouldRefreshProviderTemplates) {
            providerTemplates = await listWhatsAppTemplates(matchedNumber.integrated_number);
        }

        const refreshedProviderMap = new Map(providerTemplates.map((template) => [String(template.template_name || '').toLowerCase(), template]));
        const latestTemplatesState = await loadMessagingState(gymId);

        for (const template of latestTemplatesState.templates) {
            const desiredName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
            const desiredCategory = pickTemplateCategory(template.template_key, template.whatsapp_text);
            const providerTemplate = refreshedProviderMap.get(desiredName.toLowerCase());
            const currentStatus = normalizeTemplateStatus(template.whatsapp_template_status || 'NOT_SYNCED');
            const nextStatus = template.is_active === false
                ? 'DISABLED'
                : providerTemplate
                    ? normalizeTemplateStatus(providerTemplate.template_status)
                    : submittedTemplateNames.has(desiredName.toLowerCase())
                        ? 'PENDING'
                        : currentStatus;
            const nextError = template.is_active === false
                ? null
                : providerTemplate
                    ? null
                    : submittedTemplateNames.has(desiredName.toLowerCase())
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
                ADD COLUMN IF NOT EXISTS bulk_enabled BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS bulk_monthly_limit INTEGER DEFAULT 500,
                ADD COLUMN IF NOT EXISTS bulk_per_campaign_limit INTEGER DEFAULT 50,
                ADD COLUMN IF NOT EXISTS bulk_channels JSONB DEFAULT '{"whatsapp": true, "sms": false}'::jsonb;
            `);

            await pool.query(`
                ALTER TABLE gyms ALTER COLUMN bulk_enabled SET DEFAULT TRUE;
                UPDATE gyms SET bulk_enabled = TRUE WHERE COALESCE(bulk_enabled, FALSE) = FALSE;
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
        ensureMemberPaymentsSchemaPromise = (async () => {
            await pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS member_razorpay_key_id VARCHAR(120),
                ADD COLUMN IF NOT EXISTS member_razorpay_key_secret_enc TEXT,
                ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120),
                ADD COLUMN IF NOT EXISTS member_payments_updated_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS member_payments_connect_mode VARCHAR(20) DEFAULT 'PARTNER',
                ADD COLUMN IF NOT EXISTS member_payments_onboarding_status VARCHAR(30) DEFAULT 'NOT_CONNECTED',
                ADD COLUMN IF NOT EXISTS member_razorpay_connected_account_id VARCHAR(120),
                ADD COLUMN IF NOT EXISTS member_payments_connect_meta JSONB DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS member_payments_connect_nonce_hash TEXT,
                ADD COLUMN IF NOT EXISTS member_payments_connect_nonce_expires_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS member_payments_connected_at TIMESTAMP;
            `);

            await pool.query(`
                ALTER TABLE gyms ALTER COLUMN member_payments_enabled SET DEFAULT TRUE;
                ALTER TABLE gyms ALTER COLUMN member_payments_connect_mode SET DEFAULT 'PARTNER';
                UPDATE gyms SET member_payments_enabled = TRUE WHERE COALESCE(member_payments_enabled, FALSE) = FALSE;
                UPDATE gyms SET member_payments_connect_mode = 'PARTNER' WHERE COALESCE(member_payments_connect_mode, '') = '';
            `);
        })();
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

const ensureBillingAddonSchema = async () => {
    await ensureGymBillingAddonSchema();
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
        await Promise.all([ensureSupportProfileTable(), ensurePreferenceSchema(), ensureBillingAddonSchema()]);

        const [userRes, gymRes, billingConfig, usageSnapshot] = await Promise.all([
            pool.query(
                'SELECT full_name, email, phone, profile_pic FROM users WHERE id = $1 LIMIT 1',
                [req.user.id]
            ),
            pool.query(
                `SELECT
                    g.name,
                    g.phone,
                    g.address,
                    g.currency,
                    g.timezone,
                    g.tax_id,
                    g.website,
                    g.support_email,
                    g.saas_status,
                    g.saas_valid_until,
                    g.current_plan,
                    g.saas_billing_cycle,
                    g.grace_period_days,
                    COALESCE(g.branches_count, 1) AS branches_count,
                    COALESCE(g.branch_directory, '[]'::jsonb) AS branch_directory,
                    COALESCE(g.addon_extra_whatsapp, 0) AS addon_extra_whatsapp,
                    COALESCE(g.addon_extra_staff, 0)    AS addon_extra_staff,
                    COALESCE(g.addon_extra_members, 0)  AS addon_extra_members,
                    COALESCE(g.addon_extra_branches, 0) AS addon_extra_branches,
                    COALESCE(g.addon_extra_hello, 0)    AS addon_extra_hello,
                    COALESCE(g.interface_reduce_motion, FALSE) AS interface_reduce_motion,
                    COALESCE(g.interface_compact_mode, FALSE) AS interface_compact_mode,
                    COALESCE(g.interface_dark_mode, TRUE) AS interface_dark_mode,
                    sp.whatsapp,
                    sp.about_mission,
                    sp.support_window,
                    sp.sla,
                    COALESCE((
                        SELECT COUNT(*)::INTEGER
                        FROM members m
                        WHERE m.gym_id = g.id AND m.deleted_at IS NULL
                    ), 0) AS member_count,
                    COALESCE((
                        SELECT COUNT(*)::INTEGER
                        FROM users u
                        WHERE u.gym_id = g.id
                          AND COALESCE(UPPER(u.role), 'STAFF') <> 'OWNER'
                    ), 0) AS staff_count
                 FROM gyms g
                 LEFT JOIN gym_support_profiles sp ON sp.gym_id = g.id
                 WHERE g.id = $1
                 LIMIT 1`,
                [req.user.gym_id]
            ),
            getBillingConfig(),
            getGymUsageSnapshot(pool, req.user.gym_id),
        ]);

        const gym = gymRes.rows[0] || {};
        const branchesCount = Math.max(1, toPositiveInt(gym.branches_count, 1));
        const branchDirectory = normalizeBranchDirectory(gym.branch_directory, branchesCount);
        const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gym.current_plan, gym);

        res.json({
            account: userRes.rows[0] || {},
            gym: {
                name: gym.name,
                phone: gym.phone,
                address: gym.address,
                currency: gym.currency,
                timezone: gym.timezone,
                tax_id: gym.tax_id,
                website: gym.website,
                support_email: gym.support_email,
                saas_status: gym.saas_status,
                saas_valid_until: gym.saas_valid_until,
                current_plan: gym.current_plan,
                saas_billing_cycle: gym.saas_billing_cycle,
                grace_period_days: gym.grace_period_days,
                branches_count: branchesCount,
                branch_directory: branchDirectory,
                addon_extra_whatsapp: Number.parseInt(gym.addon_extra_whatsapp || 0, 10),
                addon_extra_staff: Number.parseInt(gym.addon_extra_staff || 0, 10),
                addon_extra_members: Number.parseInt(gym.addon_extra_members || 0, 10),
                addon_extra_branches: Number.parseInt(gym.addon_extra_branches || 0, 10),
                addon_extra_hello: Number.parseInt(gym.addon_extra_hello || 0, 10),
                interface_reduce_motion: false,
                interface_compact_mode: false,
                interface_dark_mode: gym.interface_dark_mode,
            },
            billing_catalog: serializeBillingConfig(billingConfig, { includeCurrentPlan: gym.current_plan }),
            effective_limits: effectiveLimits,
            support_profile: {
                whatsapp: gym.whatsapp,
                about_mission: gym.about_mission,
                support_window: gym.support_window,
                sla: gym.sla,
            },
            usage: {
                members: Number.parseInt(usageSnapshot.members || 0, 10),
                staff: Number.parseInt(usageSnapshot.staff || 0, 10),
                branches: Number.parseInt(usageSnapshot.branches || branchesCount || 1, 10),
                storage: 0.1,
            }
        });
    } catch (err) {
        console.error('SETTINGS ROOT ERROR:', err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

router.get('/preferences', auth, async (req, res) => {
    try {
        await ensurePreferenceSchema();

        const result = await pool.query(
            `SELECT currency, timezone,
                    FALSE AS interface_reduce_motion,
                    FALSE AS interface_compact_mode,
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
        const gymPlan = String(row.current_plan || 'basic').toLowerCase();
        const billingConfig = await getBillingConfig();
        const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymPlan, row);
        const planWhatsAppLimit = effectiveLimits.whatsapp ?? 500;
        // Always derive monthly limit from plan — plan-locked, not user-editable
        const monthlyLimit = planWhatsAppLimit || 500;
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
            bulk_enabled: row.bulk_enabled !== false,
            bulk_monthly_limit: monthlyLimit,
            bulk_per_campaign_limit: toPositiveInt(row.bulk_per_campaign_limit, 50),
            bulk_channels: row.bulk_channels || { whatsapp: true, sms: false },
            monthly_usage: monthlySent,
            monthly_remaining: Math.max(0, monthlyLimit - monthlySent),
            approved_template_count: templates.filter((template) => normalizeTemplateStatus(template.whatsapp_template_status) === 'APPROVED').length,
            templates,
            member_payments: {
                enabled: row.member_payments_enabled !== false,
                connect_mode: String(row.member_payments_connect_mode || 'PARTNER').toUpperCase(),
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

router.post('/integrations/templates/custom', auth, async (req, res) => {
    try {
        await ensureMessagingSchema();

        const gymId = req.user.gym_id;
        const [billingConfig, gymBillingSnapshot] = await Promise.all([
            getBillingConfig(),
            getGymBillingSnapshot(pool, gymId),
        ]);
        if (!hasBillingCapability(billingConfig, gymBillingSnapshot?.current_plan || 'basic', 'custom_templates')) {
            return res.status(403).json({
                error: 'Custom templates are not included in this gym plan. Upgrade the plan or enable the capability in Billing Catalog.',
            });
        }
        await seedMessageTemplates(gymId);

        const rawText = ensureTrimmedString(req.body?.raw_text, {
            field: 'raw_text',
            required: true,
            min: 5,
            max: 4000,
        });
        const requestedTitle = ensureTrimmedString(req.body?.title, {
            field: 'title',
            max: 120,
        });
        const whatsappText = operationalizeTemplateCopy(rawText);
        const title = ensureTrimmedString(requestedTitle || deriveTemplateTitleFromText(rawText), {
            field: 'title',
            required: true,
            min: 2,
            max: 120,
        });
        const templateKey = buildCustomTemplateKey(title, whatsappText);
        const templateCategory = pickTemplateCategory(templateKey, whatsappText);

        const templateCountRes = await pool.query(
            `SELECT COUNT(*)::INT AS template_count
             FROM gym_message_templates
             WHERE gym_id = $1`,
            [gymId]
        );

        if (Number(templateCountRes.rows[0]?.template_count || 0) >= MAX_MESSAGE_TEMPLATES) {
            return res.status(400).json({
                error: `You can store up to ${MAX_MESSAGE_TEMPLATES} templates per gym.`,
            });
        }

        const duplicateRes = await pool.query(
            `SELECT template_key, title
             FROM gym_message_templates
             WHERE gym_id = $1
               AND LOWER(whatsapp_text) = LOWER($2)
             LIMIT 1`,
            [gymId, whatsappText]
        );

        if (duplicateRes.rows.length > 0) {
            return res.status(409).json({
                error: `A similar template already exists as ${duplicateRes.rows[0].title || duplicateRes.rows[0].template_key}.`,
            });
        }

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
             VALUES ($1, $2, $3, $4, $5, $6, 'en_US', $7, 'NOT_SYNCED', NULL, TRUE, NOW())`,
            [
                gymId,
                templateKey,
                title,
                whatsappText,
                whatsappText,
                buildTemplateName(gymId, templateKey, whatsappText),
                templateCategory,
            ]
        );

        const syncedState = await syncGymWhatsAppState(gymId);
        const createdTemplate = (syncedState.templates || []).find((template) => template.template_key === templateKey) || null;
        const whatsappStatus = String(syncedState.gym?.messaging_whatsapp_status || 'NOT_CONFIGURED').toUpperCase();
        const templateStatus = normalizeTemplateStatus(createdTemplate?.whatsapp_template_status || 'NOT_SYNCED');

        let message = 'Custom template created.';
        if (whatsappStatus === 'CONNECTED') {
            if (templateStatus === 'APPROVED') {
                message = 'Custom template created and approved on MSG91.';
            } else if (templateStatus === 'PENDING') {
                message = 'Custom template created and submitted to MSG91 for approval.';
            } else if (templateStatus === 'FAILED' || templateStatus === 'REJECTED') {
                message = 'Custom template created, but MSG91 sync needs attention.';
            } else {
                message = 'Custom template created and queued for MSG91 sync.';
            }
        } else {
            message = 'Custom template created. Connect the business WhatsApp number to submit it to MSG91.';
        }

        return res.status(201).json({
            message,
            template: createdTemplate,
        });
    } catch (err) {
        console.error('CUSTOM TEMPLATE CREATE ERROR:', err.message);
        if (isValidationError(err)) {
            return res.status(err.statusCode || 400).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed to create template.' });
    }
});

router.put('/integrations', auth, async (req, res) => {
    let client;
    let transactionOpen = false;

    try {
        await ensureMessagingSchema();
        await ensureMemberPaymentsSchema();

        const gymId = req.user.gym_id;
        const saveScope = ensureChoice(req.body?.save_scope, {
            field: 'save_scope',
            choices: INTEGRATION_SAVE_SCOPES,
            defaultValue: 'all',
            lowercase: true,
        });
        const shouldSavePayments = saveScope === 'payments' || saveScope === 'all';
        const shouldSaveMessaging = saveScope === 'messaging' || saveScope === 'all';
        const shouldSaveCampaigns = saveScope === 'campaigns' || saveScope === 'all';

        client = await pool.connect();
        await client.query('BEGIN');
        transactionOpen = true;

        const currentGymRes = await client.query(
            `SELECT
                messaging_owner_mobile,
                messaging_whatsapp_number,
                current_plan,
                COALESCE(branches_count, 1) AS branches_count,
                bulk_enabled,
                bulk_monthly_limit,
                bulk_per_campaign_limit,
                bulk_channels,
                COALESCE(addon_extra_whatsapp, 0) AS addon_extra_whatsapp,
                COALESCE(addon_extra_branches, 0) AS addon_extra_branches,
                COALESCE(addon_extra_hello, 0) AS addon_extra_hello,
                member_razorpay_key_secret_enc,
                member_payments_connect_mode,
                member_payments_onboarding_status,
                member_razorpay_connected_account_id
             FROM gyms
             WHERE id = $1
             LIMIT 1
             FOR UPDATE`,
            [gymId]
        );

        if (currentGymRes.rows.length === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
            return res.status(404).json({ error: 'Gym not found.' });
        }

        const currentGym = currentGymRes.rows[0] || {};
        const currentWhatsAppNumber = normalizeWhatsAppNumber(currentGym.messaging_whatsapp_number);

        if (shouldSaveMessaging) {
            const ownerMobileInput = ensureTrimmedString(req.body?.owner_mobile, { field: 'owner_mobile', max: 30 });
            const normalizedOwnerMobile = ownerMobileInput ? normalizeMessagingPhone(ownerMobileInput) : '';
            const whatsappNumberInput = ensureTrimmedString(req.body?.whatsapp_number, {
                field: 'whatsapp_number',
                required: true,
                max: 30,
            });
            const normalizedWhatsAppNumber = normalizeWhatsAppNumber(whatsappNumberInput);

            if (ownerMobileInput && !normalizedOwnerMobile) {
                throw new ValidationError('Please enter a valid owner alert mobile number in +91XXXXXXXXXX format.');
            }

            if (!normalizedWhatsAppNumber) {
                throw new ValidationError('Please enter the gym business WhatsApp number in +91XXXXXXXXXX format.');
            }

            await client.query(
                `UPDATE gyms
                 SET messaging_owner_mobile = $1,
                     messaging_whatsapp_number = $2
                 WHERE id = $3`,
                [normalizedOwnerMobile || null, normalizedWhatsAppNumber, gymId]
            );

            if (normalizedWhatsAppNumber !== currentWhatsAppNumber) {
                await client.query(
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
                    ['PENDING_CONNECTION', gymId]
                );
            }
        }

        if (shouldSaveCampaigns) {
            const bulkEnabled = Boolean(req.body?.bulk_enabled ?? currentGym.bulk_enabled);
            const billingConfig = await getBillingConfig(client);
            const effectiveLimits = computeEffectiveBillingLimits(billingConfig, currentGym.current_plan || 'basic', currentGym);
            const monthlyLimit = effectiveLimits.whatsapp ?? 500;
            const perCampaign = ensureInteger(req.body?.bulk_per_campaign_limit, {
                field: 'bulk_per_campaign_limit',
                min: 1,
                max: 1000,
                defaultValue: toPositiveInt(currentGym.bulk_per_campaign_limit, 50),
            });
            const channels = normalizeCampaignChannelsInput(req.body?.bulk_channels, currentGym.bulk_channels || { whatsapp: true, sms: false });

            await client.query(
                `UPDATE gyms
                 SET bulk_enabled = $1,
                     bulk_monthly_limit = $2,
                     bulk_per_campaign_limit = $3,
                     bulk_channels = $4
                 WHERE id = $5`,
                [bulkEnabled, monthlyLimit, perCampaign, channels, gymId]
            );

            const templateEntries = normalizeIntegrationTemplatesInput(req.body?.templates);
            if (templateEntries.length > 0) {
                const hasCustomTemplatesInPayload = templateEntries.some((template) => String(template.template_key || '').trim().toUpperCase().startsWith(CUSTOM_TEMPLATE_KEY_PREFIX));
                if (hasCustomTemplatesInPayload) {
                    const billingConfig = await getBillingConfig(client);
                    if (!hasBillingCapability(billingConfig, currentGym.current_plan || 'basic', 'custom_templates')) {
                        throw new ValidationError('Custom templates are locked on this gym plan. Upgrade the plan or enable the capability in Billing Catalog before editing them.');
                    }
                }
                for (const template of templateEntries) {
                    const templateName = buildTemplateName(gymId, template.template_key, template.whatsapp_text);
                    const templateCategory = template.whatsapp_template_category || pickTemplateCategory(template.template_key, template.whatsapp_text);

                    await client.query(
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
                            template.template_key,
                            template.title,
                            template.whatsapp_text,
                            template.sms_text,
                            templateName,
                            templateCategory,
                            template.is_active ? 'NOT_SYNCED' : 'DISABLED',
                            template.is_active,
                        ]
                    );
                }
            } else {
                await seedMessageTemplates(gymId, client);
            }
        }

        if (shouldSavePayments) {
            const paymentSettings = normalizeMemberPaymentSettingsInput(
                req.body?.member_payments,
                currentGym.member_payments_connect_mode
            );
            const existingEncryptedSecret = String(currentGym.member_razorpay_key_secret_enc || '');
            const hasStoredSecret = Boolean(decryptSecret(existingEncryptedSecret));
            const connectedAccountId = String(currentGym.member_razorpay_connected_account_id || '').trim();
            const hasManualGateway = paymentSettings.connectMode === 'MANUAL' && Boolean(paymentSettings.keyId && (paymentSettings.incomingSecret || hasStoredSecret));
            const hasPartnerGateway = paymentSettings.connectMode === 'PARTNER' && Boolean(connectedAccountId);
            const hasCollectionChannel = Boolean(paymentSettings.upiId || hasManualGateway || hasPartnerGateway);

            if (paymentSettings.enabled && !hasCollectionChannel) {
                throw new ValidationError('Configure Razorpay collection or a direct UPI ID before enabling member online collection.');
            }

            const secretToPersist = paymentSettings.incomingSecret ? encryptSecret(paymentSettings.incomingSecret) : existingEncryptedSecret;
            const nextOnboardingStatus = !paymentSettings.enabled
                ? 'NOT_CONNECTED'
                : hasPartnerGateway
                    ? String(currentGym.member_payments_onboarding_status || 'NOT_CONNECTED').toUpperCase()
                    : hasManualGateway
                        ? 'MANUAL_CONFIGURED'
                        : paymentSettings.upiId
                            ? 'UPI_COLLECTION_READY'
                            : 'NOT_CONNECTED';

            await client.query(
                `UPDATE gyms
                 SET member_payments_enabled = $1,
                     member_payments_connect_mode = $2,
                     member_payments_onboarding_status = $3,
                     member_razorpay_key_id = $4,
                     member_razorpay_key_secret_enc = $5,
                     member_upi_id = $6,
                     member_payments_updated_at = NOW()
                 WHERE id = $7`,
                [
                    paymentSettings.enabled,
                    paymentSettings.connectMode,
                    nextOnboardingStatus,
                    paymentSettings.keyId || null,
                    secretToPersist || null,
                    paymentSettings.upiId || null,
                    gymId,
                ]
            );
        }

        await client.query('COMMIT');
        transactionOpen = false;

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
        if (transactionOpen && client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                console.error('INTEGRATIONS SAVE ROLLBACK ERROR:', rollbackErr.message);
            }
        }

        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }

        if (err.code === '23505' && String(err.constraint || '').trim() === 'idx_gyms_messaging_whatsapp_number_unique') {
            return res.status(400).json({ error: 'This business WhatsApp number is already linked to another gym.' });
        }

        console.error('INTEGRATIONS SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

router.post('/integrations/test-message', auth, async (req, res) => {
    try {
        await ensureMessagingSchema();
        await ensureWhatsAppDeliverySchema();

        const gymId = req.user.gym_id;
        const requesterId = req.user.user_id || req.user.id || null;
        const toInput = ensureTrimmedString(req.body?.to, { field: 'to', required: true, max: 40 });
        const requestedTemplateKey = ensureChoice(req.body?.template_key, {
            field: 'template_key',
            choices: MESSAGE_TEMPLATE_KEYS,
            defaultValue: '',
            uppercase: true,
        });

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

        if (requestedTemplateKey && !selectedTemplate) {
            return res.status(400).json({ error: 'Select an approved WhatsApp template before sending a test message.' });
        }

        if (!selectedTemplate) {
            return res.status(400).json({ error: 'Approve at least one WhatsApp template in Integrations before sending a test message.' });
        }

        await sendTrackedWhatsAppTemplate({
            gymId,
            initiatedBy: requesterId,
            sourceKind: 'TEST',
            sourceLabel: 'SETTINGS_TEST',
            integratedNumber: gym.messaging_whatsapp_number,
            recipientNumber: normalizedTo,
            recipientName: 'Test Member',
            templateKey: selectedTemplate.template_key,
            templateTitle: selectedTemplate.title,
            templateName: selectedTemplate.whatsapp_template_name,
            templateLanguage: selectedTemplate.whatsapp_template_language || 'en_US',
            messagePreview: renderWhatsAppTemplatePreviewText(
                selectedTemplate.whatsapp_text,
                { full_name: 'Test Member', plan_name: 'Elite Plan', days_to_expiry: 3 },
                gym.name || 'GymVault'
            ),
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
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('TEST MESSAGE ERROR:', err.message);
        return res.status(500).json({
            error: 'Failed to send test message.',
        });
    }
});

router.get('/platform', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        await ensureWhatsAppDeliverySchema();

        const gymId = req.user.gym_id;
        const [gymRes, apiKeyRes, webhookRes, deliverySummary, recentDeliveryLogs] = await Promise.all([
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
            getWhatsAppDeliverySummary(gymId),
            getRecentWhatsAppDeliveryLogs(gymId, 20),
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
            whatsapp_delivery: {
                callback_url: buildWhatsAppDeliveryCallbackUrl(req),
                docs_url: MSG91_WHATSAPP_WEBHOOK_DOC_URL,
                webhook_token_configured: Boolean(normalizeWebhookToken()),
                summary: deliverySummary,
                recent_logs: recentDeliveryLogs,
            },
        });
    } catch (err) {
        console.error('PLATFORM FETCH ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/platform/branches', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        await ensureBillingAddonSchema();

        const city = ensureTrimmedString(req.body?.city, { field: 'city', max: 100 });
        const branchesCount = Math.min(25, Math.max(1, toPositiveInt(req.body?.branches_count, 1)));
        const [billingConfig, gymBilling] = await Promise.all([
            getBillingConfig(),
            getGymBillingSnapshot(pool, req.user.gym_id),
        ]);
        if (!gymBilling) {
            return res.status(404).json({ error: 'Gym not found.' });
        }
        const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymBilling.current_plan, gymBilling);
        if (effectiveLimits.branches !== null && branchesCount > effectiveLimits.branches) {
            return res.status(409).json({
                error: `Your current plan allows up to ${effectiveLimits.branches} branch${effectiveLimits.branches === 1 ? '' : 'es'} including add-ons. Increase the branch limit in HQ pricing or buy more branch capacity before saving this change.`,
                allowed_branches: effectiveLimits.branches,
            });
        }
        const branchDirectory = normalizeBranchDirectoryInput(req.body?.branch_directory, branchesCount);
        const activeBranchIds = branchDirectory.map((branch) => branch.id);
        const outOfDirectoryBranchUsage = await getOutOfDirectoryBranchUsage(pool, req.user.gym_id, activeBranchIds);

        if (outOfDirectoryBranchUsage.length > 0) {
            return res.status(409).json({
                error: `Branch reduction blocked. Move records out of ${outOfDirectoryBranchUsage.map((branchId) => getBranchName(branchDirectory, branchId) || branchId).join(', ')} before removing those branches.`,
                branch_ids: outOfDirectoryBranchUsage,
            });
        }

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
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('BRANCH SAVE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/platform/api-keys', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const keyName = ensureTrimmedString(req.body?.key_name, { field: 'key_name', required: true, min: 2, max: 120 });
        const scopes = normalizeApiScopes(req.body?.scopes);
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
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('API KEY CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/platform/api-keys/:id', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        const apiKeyId = ensureInteger(req.params.id, { field: 'API key id', required: true, min: 1 });
        const result = await pool.query(
            `UPDATE api_keys
             SET is_active = FALSE
             WHERE id = $1 AND gym_id = $2
             RETURNING id`,
            [apiKeyId, req.user.gym_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'API key not found.' });
        }
        return res.json({ message: 'API key revoked.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('API KEY DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/platform/webhooks', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();

        const url = ensureUrl(req.body?.url, { field: 'url', required: true, max: 2048 });
        const events = normalizeWebhookEvents(req.body?.events);
        const secret = normalizeWebhookSecret(req.body?.secret);
        const isActive = req.body?.is_active !== false;

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
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('WEBHOOK CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/platform/webhooks/:id', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        const webhookId = ensureInteger(req.params.id, { field: 'webhook id', required: true, min: 1 });

        const webhookRes = await pool.query(
            'SELECT secret_hash FROM webhooks WHERE id = $1 AND gym_id = $2 LIMIT 1',
            [webhookId, req.user.gym_id]
        );
        if (webhookRes.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook not found.' });
        }

        const url = ensureUrl(req.body?.url, { field: 'url', required: true, max: 2048 });
        const events = normalizeWebhookEvents(req.body?.events);
        const secret = normalizeWebhookSecret(req.body?.secret);
        const isActive = req.body?.is_active !== false;
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
            [url, events, secretToPersist, isActive, webhookId, req.user.gym_id]
        );

        return res.json({
            message: 'Webhook updated successfully.',
            webhook: {
                ...result.rows[0],
                has_secret: Boolean(decryptSecret(result.rows[0].secret_hash || '')),
            },
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('WEBHOOK UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/platform/webhooks/:id', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        const webhookId = ensureInteger(req.params.id, { field: 'webhook id', required: true, min: 1 });
        const result = await pool.query(
            'DELETE FROM webhooks WHERE id = $1 AND gym_id = $2 RETURNING id',
            [webhookId, req.user.gym_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook not found.' });
        }
        return res.json({ message: 'Webhook deleted.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('WEBHOOK DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/platform/webhooks/:id/test', auth, async (req, res) => {
    try {
        await ensurePlatformSchema();
        const webhookId = ensureInteger(req.params.id, { field: 'webhook id', required: true, min: 1 });

        const webhookRes = await pool.query(
            'SELECT * FROM webhooks WHERE id = $1 AND gym_id = $2 LIMIT 1',
            [webhookId, req.user.gym_id]
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
            [webhookId, req.user.gym_id]
        );

        return res.json({ message: `Test webhook sent successfully (${response.status}).`, status: response.status });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('WEBHOOK TEST ERROR:', err.message);
        return res.status(502).json({ error: 'Failed to deliver webhook test event.' });
    }
});

router.post('/import/members', auth, async (req, res) => {
    let client;
    try {
        const csvText = ensureTrimmedString(req.body?.csv_text, { field: 'csv_text', required: true, max: 500000 });
        const dryRun = req.body?.dry_run === true;
        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const defaultBranchId = branchDirectory[0]?.id || DEFAULT_BRANCH_ID;

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

        if (validRows.length > 0) {
            const [billingConfig, gymBilling, usageSnapshot] = await Promise.all([
                getBillingConfig(),
                getGymBillingSnapshot(pool, req.user.gym_id),
                getGymUsageSnapshot(pool, req.user.gym_id),
            ]);
            if (!gymBilling) {
                return res.status(404).json({ error: 'Gym not found.' });
            }

            const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymBilling.current_plan, gymBilling);
            const branchUsage = await getBranchUsageSnapshot(pool, req.user.gym_id, defaultBranchId);
            const projectedBranchMembers = Number(branchUsage.members || 0) + validRows.length;
            const projectedMembers = Number(usageSnapshot.members || 0) + validRows.length;
            if (effectiveLimits.members_per_branch !== null && projectedBranchMembers > effectiveLimits.members_per_branch) {
                const totalCapacityHint = buildScaledLimitHint(effectiveLimits, 'members');
                return res.status(409).json({
                    error: `This import would exceed the ${effectiveLimits.members_per_branch}-member limit for ${getBranchName(branchDirectory, defaultBranchId) || 'the default branch'}${totalCapacityHint}. Delete expired or unpaid members there, or add more member capacity before importing more members.`,
                    allowed_members: effectiveLimits.members_per_branch,
                    current_members: Number(branchUsage.members || 0),
                    requested_import: validRows.length,
                    branch_id: defaultBranchId,
                });
            }
            if (effectiveLimits.members !== null && projectedMembers > effectiveLimits.members) {
                return res.status(409).json({
                    error: `This import would exceed your ${effectiveLimits.members}-member capacity ${describeScaledLimitScope(effectiveLimits)}. Delete expired or unpaid members, or add more member capacity before importing more members.`,
                    allowed_members: effectiveLimits.members,
                    current_members: Number(usageSnapshot.members || 0),
                    requested_import: validRows.length,
                });
            }
        }

        let importedCount = 0;
        if (!dryRun && validRows.length > 0) {
            client = await pool.connect();
            await client.query('BEGIN');
            for (const row of validRows) {
                await client.query(
                    `INSERT INTO members (full_name, email, phone, gym_id, joining_date, status, branch_id)
                     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'UNPAID', $5)`,
                    [row.full_name, row.email, row.phone, req.user.gym_id, defaultBranchId]
                );
                importedCount += 1;
            }
            await client.query('COMMIT');
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
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER IMPORT ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// --- 3. MASTER ACCOUNT UPDATE ---
router.put('/account', auth, uploadProfilePic, async (req, res) => {
    const removeProfilePic = String(req.body?.remove_profile_pic || '').trim().toLowerCase() === 'true';
    const uploadedProfileValue = getStoredProfileValue(req.file);
    let client;

    try {
        await ensurePreferenceSchema();
        const full_name = ensureTrimmedString(req.body?.full_name, { field: 'full_name', required: true, min: 2, max: 120 });
        const email = ensureEmail(req.body?.email, { field: 'email', required: true, max: 120 });
        const phone = ensureTrimmedString(req.body?.phone, { field: 'phone', max: 30 });
        const normalizedCurrentPassword = String(req.body?.current_password || '').trim();
        const normalizedNewPassword = String(req.body?.new_password || '');
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

        client = await pool.connect();
        await client.query('BEGIN');

        const nextProfileValue = uploadedProfileValue
            ? uploadedProfileValue
            : removeProfilePic
                ? null
                : currentUser.profile_pic || null;

        if (uploadedProfileValue || removeProfilePic) {
            await client.query(
                'UPDATE users SET full_name=$1, email=$2, phone=$3, profile_pic=$4 WHERE id=$5', 
                [full_name, email, phone || null, nextProfileValue, req.user.id]
            );
        } else {
            await client.query(
                'UPDATE users SET full_name=$1, email=$2, phone=$3 WHERE id=$4', 
                [full_name, email, phone || null, req.user.id]
            );
        }

        if (normalizedCurrentPassword && normalizedNewPassword) {
            const isMatch = await bcrypt.compare(normalizedCurrentPassword, currentUser.password_hash || '');
            
            if (!isMatch) {
                await client.query('ROLLBACK');
                await discardUploadedProfile(req);
                return res.status(400).json({ error: "Current password is incorrect." });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedNewPassword = await bcrypt.hash(normalizedNewPassword, salt);

            await client.query(
                'UPDATE users SET password_hash = $1 WHERE id = $2',
                [hashedNewPassword, req.user.id]
            );
        }

        await client.query('COMMIT');

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
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error("ACCOUNT UPDATE ERROR:", err.message);
        await discardUploadedProfile(req);
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
        if (err.code === '23505') return res.status(400).json({ error: "Email already in use." });
        res.status(500).json({ error: "Server Error" });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// --- 4. UPDATE GYM PROFILE ---
router.put('/gym', auth, async (req, res) => {
    try {
        await ensureSupportProfileTable();

        const name = ensureTrimmedString(req.body?.name, { field: 'name', required: true, min: 2, max: 120 });
        const phone = ensureTrimmedString(req.body?.phone, { field: 'phone', max: 30 });
        const email = ensureEmail(req.body?.email, { field: 'email', max: 120 });
        const address = ensureTrimmedString(req.body?.address, { field: 'address', max: 500 });
        const tax_id = ensureTrimmedString(req.body?.tax_id, { field: 'tax_id', max: 80 });
        const websiteInput = ensureTrimmedString(req.body?.website, { field: 'website', max: 2048 });
        const website = websiteInput
            ? ensureUrl(/^https?:\/\//i.test(websiteInput) ? websiteInput : `https://${websiteInput.replace(/^\/+/, '')}`, { field: 'website', max: 2048 })
            : '';
        const support_whatsapp = ensureTrimmedString(req.body?.support_whatsapp, { field: 'support_whatsapp', max: 30 });
        const support_window = ensureTrimmedString(req.body?.support_window, { field: 'support_window', max: 500 });
        const support_sla = ensureTrimmedString(req.body?.support_sla, { field: 'support_sla', max: 500 });
        const support_about_mission = ensureTrimmedString(req.body?.support_about_mission, { field: 'support_about_mission', max: 4000 });

        await pool.query(
            'UPDATE gyms SET name = $1, phone = $2, support_email = $3, address = $4, tax_id = $5, website = $6 WHERE id = $7',
            [name, phone || null, email || null, address || null, tax_id || null, website || null, req.user.gym_id]
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
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
        console.error("GYM UPDATE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 5. UPDATE SYSTEM PREFERENCES ---
router.put('/preferences', auth, async (req, res) => {
    try {
        await ensurePreferenceSchema();
        const currency = ensureTrimmedString(req.body?.currency, { field: 'currency', required: true, min: 1, max: 10, uppercase: true });
        const timezone = ensureTrimmedString(req.body?.timezone, { field: 'timezone', required: true, min: 3, max: 100 });
        const interface_reduce_motion = false;
        const interface_compact_mode = false;
        const interface_dark_mode = req.body?.interface_dark_mode === true;
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
        invalidateGymTimezoneCache(req.user.gym_id);
        res.json({ message: "Preferences updated successfully" });
    } catch (err) {
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
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

    const client = await pool.connect();
    try {
        const ownerResult = await client.query(
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

        const archivePayloadResult = await client.query(
            `SELECT row_to_json(g) AS payload
             FROM gyms g
             WHERE g.id = $1
             LIMIT 1`,
            [req.user.gym_id]
        );

        await client.query('BEGIN');
        await client.query(
            `INSERT INTO operational_archives (source_table, record_id, archived_from_at, payload, archived_at)
             VALUES ($1, $2, NOW(), $3::jsonb, NOW())
             ON CONFLICT (source_table, record_id)
             DO UPDATE SET archived_from_at = EXCLUDED.archived_from_at,
                           payload = EXCLUDED.payload,
                           archived_at = EXCLUDED.archived_at`,
            ['gyms', req.user.gym_id, JSON.stringify({
                gym: archivePayloadResult.rows[0]?.payload || null,
                archived_by: 'OWNER_SELF_SERVICE',
            })]
        );
        await client.query('UPDATE users SET is_active = FALSE WHERE gym_id = $1', [req.user.gym_id]);
        await client.query(
            `UPDATE gyms
             SET is_active = FALSE,
                 gym_access_status = 'SUSPENDED',
                 suspended_at = COALESCE(suspended_at, NOW()),
                 suspended_reason = COALESCE(NULLIF(suspended_reason, ''), 'Archived by owner request')
             WHERE id = $1`,
            [req.user.gym_id]
        );
        await client.query('COMMIT');
        clearUserAuthCookie(res);
        res.json({ message: "Gym archived and access revoked." });
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackError) {
            // Preserve the original failure.
        }
        console.error("NUKE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    } finally {
        client.release();
    }
});

module.exports = router;