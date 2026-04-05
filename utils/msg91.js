const crypto = require('crypto');

const MSG91_CONTROL_BASE = 'https://control.msg91.com';
const MSG91_API_BASE = 'https://api.msg91.com';
const DEFAULT_MSG91_PORTAL_SIGNIN_URL = 'https://control.msg91.com/signin/';
const DEFAULT_MSG91_WHATSAPP_GUIDE_URL = 'https://msg91.com/help/whatsapp/whatsapp-number-integration---onboarding';
const DEFAULT_META_BUSINESS_URL = 'https://business.facebook.com/';
const DEFAULT_MSG91_WHATSAPP_SUPPORT_URL = 'https://calendly.com/onbording-msg91/20-min-onbording';

const OTP_MODES = {
    PREVIEW: 'PREVIEW',
    MSG91: 'MSG91',
};

const TEMPLATE_CATEGORY_MAP = {
    EXPIRING_SOON: 'UTILITY',
    EXPIRED: 'UTILITY',
    UNPAID: 'UTILITY',
    PAYMENT_DUE: 'UTILITY',
    RENEWAL_REMINDER: 'UTILITY',
    INACTIVE: 'MARKETING',
    SALES_OFFER: 'MARKETING',
    HOLIDAY: 'MARKETING',
};

const TEMPLATE_PLACEHOLDER_DEFAULTS = {
    name: 'Member',
    plan: 'your plan',
    days_left: '3',
    gym_name: 'GymVault',
};

const toTrimmedString = (value) => String(value || '').trim();

const normalizeAbsoluteUrl = (value, fallback) => {
    const raw = toTrimmedString(value);
    if (!raw) return fallback;
    try {
        return new URL(raw).toString();
    } catch (_err) {
        return fallback;
    }
};

const normalizeLocalIndianPhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return digits;
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length > 12) return digits.slice(-10);
    return '';
};

const normalizeCountryCodePhone = (value) => {
    const local = normalizeLocalIndianPhone(value);
    return local ? `91${local}` : '';
};

const normalizeE164Phone = (value) => {
    const withCountryCode = normalizeCountryCodePhone(value);
    return withCountryCode ? `+${withCountryCode}` : '';
};

const maskPhone = (value) => {
    const normalized = normalizeLocalIndianPhone(value);
    if (!normalized) return '';
    return `+91 ${normalized.slice(0, 2)}***${normalized.slice(-3)}`;
};

const getMsg91OtpAuthKey = () => toTrimmedString(process.env.MSG91_OTP_AUTH_KEY || process.env.MSG91_AUTH_KEY);
const getMsg91OtpTemplateId = () => toTrimmedString(process.env.MSG91_OWNER_LOGIN_OTP_TEMPLATE_ID || process.env.MSG91_OTP_TEMPLATE_ID);
const getMsg91WhatsAppAuthKey = () => toTrimmedString(process.env.MSG91_WHATSAPP_AUTH_KEY || process.env.MSG91_AUTH_KEY);
const getMsg91PortalSignInUrl = () => normalizeAbsoluteUrl(process.env.MSG91_PORTAL_SIGNIN_URL, DEFAULT_MSG91_PORTAL_SIGNIN_URL);
const getMsg91WhatsAppOnboardingUrl = () => normalizeAbsoluteUrl(process.env.MSG91_WHATSAPP_ONBOARDING_URL, getMsg91PortalSignInUrl());
const getMsg91WhatsAppGuideUrl = () => normalizeAbsoluteUrl(process.env.MSG91_WHATSAPP_GUIDE_URL, DEFAULT_MSG91_WHATSAPP_GUIDE_URL);
const getMetaBusinessSuiteUrl = () => normalizeAbsoluteUrl(process.env.MSG91_META_BUSINESS_URL, DEFAULT_META_BUSINESS_URL);
const getMsg91WhatsAppSupportUrl = () => normalizeAbsoluteUrl(process.env.MSG91_WHATSAPP_SUPPORT_URL, DEFAULT_MSG91_WHATSAPP_SUPPORT_URL);

const isMsg91OtpConfigured = () => Boolean(getMsg91OtpAuthKey() && getMsg91OtpTemplateId());
const isMsg91WhatsAppConfigured = () => Boolean(getMsg91WhatsAppAuthKey());

const getMsg91OtpMode = () => {
    const explicitMode = toTrimmedString(process.env.MSG91_OWNER_LOGIN_OTP_MODE || process.env.MSG91_OTP_MODE).toUpperCase();
    if (explicitMode === OTP_MODES.MSG91 && isMsg91OtpConfigured()) {
        return OTP_MODES.MSG91;
    }
    return OTP_MODES.PREVIEW;
};

const getMsg91WhatsAppOnboardingConfig = () => ({
    login_url: getMsg91PortalSignInUrl(),
    launch_url: getMsg91WhatsAppOnboardingUrl(),
    guide_url: getMsg91WhatsAppGuideUrl(),
    meta_business_url: getMetaBusinessSuiteUrl(),
    support_url: getMsg91WhatsAppSupportUrl(),
    requires_msg91_login: true,
    requires_meta_verification: true,
    embed_mode: 'iframe',
});

const appendQueryParams = (url, query) => {
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });
};

const tryParseJson = (value) => {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch (_err) {
        return null;
    }
};

const collectPayloadMessages = (value, messages = [], seen = new Set()) => {
    if (value === null || value === undefined) return messages;
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) messages.push(normalized);
        return messages;
    }
    if (typeof value !== 'object') return messages;
    if (seen.has(value)) return messages;
    seen.add(value);

    if (Array.isArray(value)) {
        value.forEach((item) => collectPayloadMessages(item, messages, seen));
        return messages;
    }

    ['message', 'error', 'description', 'details', 'reason', 'statusDescription'].forEach((key) => {
        if (value[key]) {
            collectPayloadMessages(value[key], messages, seen);
        }
    });

    Object.values(value).forEach((child) => collectPayloadMessages(child, messages, seen));
    return messages;
};

const extractMsg91ErrorMessage = (payload, fallback = '') => {
    const messages = Array.from(new Set(collectPayloadMessages(payload)));
    return messages[0] || fallback || 'MSG91 request failed.';
};

const msg91Request = async ({
    path,
    method = 'GET',
    authKey,
    query,
    body,
    base = 'control',
    allowErrorPayload = false,
}) => {
    const origin = base === 'api' ? MSG91_API_BASE : MSG91_CONTROL_BASE;
    const url = new URL(path, origin);
    appendQueryParams(url, query);

    const headers = {
        accept: 'application/json',
    };
    if (authKey) {
        headers.authkey = authKey;
    }
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const rawText = await response.text();
    const payload = tryParseJson(rawText) || rawText;

    if (!response.ok) {
        const error = new Error(extractMsg91ErrorMessage(payload, `MSG91 request failed with status ${response.status}.`));
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    if (!allowErrorPayload && payload && typeof payload === 'object') {
        const type = toTrimmedString(payload.type || payload.status).toLowerCase();
        if (type === 'error' || payload.hasError === true) {
            const error = new Error(extractMsg91ErrorMessage(payload));
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
    }

    return payload;
};

const requestMsg91Otp = async (phone) => {
    const authKey = getMsg91OtpAuthKey();
    const templateId = getMsg91OtpTemplateId();
    if (!authKey || !templateId) {
        throw new Error('MSG91 owner OTP is not configured.');
    }

    return msg91Request({
        path: '/api/v5/otp',
        method: 'POST',
        authKey,
        query: {
            authkey: authKey,
            mobile: normalizeCountryCodePhone(phone),
            template_id: templateId,
        },
        body: {},
    });
};

const verifyMsg91Otp = async (phone, otp) => {
    const authKey = getMsg91OtpAuthKey();
    if (!authKey) {
        throw new Error('MSG91 owner OTP is not configured.');
    }

    const payload = await msg91Request({
        path: '/api/v5/otp/verify',
        method: 'GET',
        authKey,
        allowErrorPayload: true,
        query: {
            mobile: normalizeCountryCodePhone(phone),
            otp: String(otp || '').trim(),
        },
    });

    const message = toTrimmedString(payload?.message).toLowerCase();
    const type = toTrimmedString(payload?.type || payload?.status).toLowerCase();
    const verified = type === 'success' || message.includes('verified');

    return {
        verified,
        expired: message.includes('expired'),
        invalid: message.includes('not match') || message.includes('invalid'),
        message: extractMsg91ErrorMessage(payload, verified ? 'OTP verified.' : 'OTP verification failed.'),
        payload,
    };
};

const walkCollection = (value, visitor, seen = new Set()) => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    visitor(value);
    if (Array.isArray(value)) {
        value.forEach((item) => walkCollection(item, visitor, seen));
        return;
    }
    Object.values(value).forEach((child) => walkCollection(child, visitor, seen));
};

const listIntegratedWhatsAppNumbers = async () => {
    const authKey = getMsg91WhatsAppAuthKey();
    if (!authKey) {
        throw new Error('MSG91 WhatsApp is not configured.');
    }

    const payload = await msg91Request({
        path: '/api/v5/whatsapp/whatsapp-activation/',
        method: 'GET',
        authKey,
    });

    const numbers = [];
    const seen = new Set();
    walkCollection(payload, (node) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        const rawNumber = node.integrated_number || node.number || node.mobile || node.phone_number || node.whatsapp_number;
        const normalized = normalizeCountryCodePhone(rawNumber);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        numbers.push({
            integrated_number: normalized,
            display_name: toTrimmedString(node.display_name || node.business_name || node.name),
            category: toTrimmedString(node.category || node.business_category),
            status: toTrimmedString(node.status || node.whatsapp_status || node.state).toUpperCase(),
        });
    });

    return numbers;
};

const findIntegratedWhatsAppNumber = (numbers, candidate) => {
    const normalized = normalizeCountryCodePhone(candidate);
    if (!normalized) return null;
    return (Array.isArray(numbers) ? numbers : []).find((item) => normalizeCountryCodePhone(item?.integrated_number) === normalized) || null;
};

const listWhatsAppTemplates = async (integratedNumber) => {
    const authKey = getMsg91WhatsAppAuthKey();
    const normalizedNumber = normalizeCountryCodePhone(integratedNumber);
    if (!authKey || !normalizedNumber) {
        throw new Error('MSG91 WhatsApp is not configured for template sync.');
    }

    const payload = await msg91Request({
        path: `/api/v5/whatsapp/get-template-client/${normalizedNumber}`,
        method: 'GET',
        authKey,
    });

    const templates = [];
    const seen = new Set();
    walkCollection(payload, (node) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        const templateName = toTrimmedString(node.template_name || node.name || node.templateName || node.element_name);
        if (!templateName || seen.has(templateName.toLowerCase())) return;
        seen.add(templateName.toLowerCase());
        templates.push({
            template_name: templateName,
            template_status: toTrimmedString(node.template_status || node.status || node.templateStatus).toUpperCase(),
            template_language: toTrimmedString(node.template_language || node.language?.code || node.language || 'en_US'),
            template_category: toTrimmedString(node.category || node.template_category).toUpperCase(),
        });
    });

    return templates;
};

const extractTemplatePlaceholderKeys = (text) => {
    const matches = String(text || '').match(/{{\s*([a-zA-Z0-9_]+)\s*}}/g) || [];
    return matches.map((token) => token.replace(/[{}\s]/g, '').toLowerCase());
};

const resolveTemplatePlaceholderValue = (placeholder, member = {}, gymName = '') => {
    const daysLeft = Number.isFinite(Number(member?.days_to_expiry)) ? Number(member.days_to_expiry) : 0;
    const values = {
        name: toTrimmedString(member?.full_name) || TEMPLATE_PLACEHOLDER_DEFAULTS.name,
        plan: toTrimmedString(member?.plan_name) || TEMPLATE_PLACEHOLDER_DEFAULTS.plan,
        days_left: String(daysLeft),
        gym_name: toTrimmedString(gymName) || TEMPLATE_PLACEHOLDER_DEFAULTS.gym_name,
    };
    return values[placeholder] || TEMPLATE_PLACEHOLDER_DEFAULTS[placeholder] || placeholder.replace(/_/g, ' ');
};

const convertNamedPlaceholdersToPositional = (text) => {
    let index = 0;
    return String(text || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, () => {
        index += 1;
        return `{{${index}}}`;
    });
};

const buildTemplateName = (gymId, templateKey, whatsappText) => {
    const sanitizedKey = toTrimmedString(templateKey)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30) || 'template';
    const signature = crypto.createHash('sha1').update(String(whatsappText || '')).digest('hex').slice(0, 8);
    return `gv_${gymId}_${sanitizedKey}_${signature}`.slice(0, 60);
};

const pickTemplateCategory = (templateKey) => TEMPLATE_CATEGORY_MAP[String(templateKey || '').trim().toUpperCase()] || 'UTILITY';

const buildTemplateDefinition = ({ gymId, templateKey, title, whatsappText, integratedNumber }) => {
    const placeholderKeys = extractTemplatePlaceholderKeys(whatsappText);
    const exampleValues = placeholderKeys.map((key) => TEMPLATE_PLACEHOLDER_DEFAULTS[key] || key.replace(/_/g, ' '));
    const bodyComponent = {
        type: 'BODY',
        text: convertNamedPlaceholdersToPositional(whatsappText),
    };

    if (exampleValues.length > 0) {
        bodyComponent.example = { body_text: [exampleValues] };
    }

    return {
        integrated_number: normalizeCountryCodePhone(integratedNumber),
        template_name: buildTemplateName(gymId, templateKey, whatsappText),
        template_title: toTrimmedString(title),
        language: 'en_US',
        category: pickTemplateCategory(templateKey),
        components: [bodyComponent],
    };
};

const looksLikeMsg91TemplateDuplicate = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('already exist') || message.includes('duplicate');
};

const createWhatsAppTemplate = async ({ integratedNumber, templateName, language = 'en_US', category, whatsappText }) => {
    const authKey = getMsg91WhatsAppAuthKey();
    if (!authKey) {
        throw new Error('MSG91 WhatsApp is not configured.');
    }

    const placeholderKeys = extractTemplatePlaceholderKeys(whatsappText);
    const exampleValues = placeholderKeys.map((key) => TEMPLATE_PLACEHOLDER_DEFAULTS[key] || key.replace(/_/g, ' '));
    const bodyComponent = {
        type: 'BODY',
        text: convertNamedPlaceholdersToPositional(whatsappText),
    };
    if (exampleValues.length > 0) {
        bodyComponent.example = { body_text: [exampleValues] };
    }

    return msg91Request({
        path: '/api/v5/whatsapp/client-panel-template/',
        method: 'POST',
        authKey,
        base: 'api',
        body: {
            integrated_number: normalizeCountryCodePhone(integratedNumber),
            template_name: templateName,
            language,
            category: toTrimmedString(category || 'UTILITY').toUpperCase(),
            components: [bodyComponent],
        },
    });
};

const buildTemplateBodyVariables = (whatsappText, member = {}, gymName = '') => {
    const placeholderKeys = extractTemplatePlaceholderKeys(whatsappText);
    return placeholderKeys.reduce((accumulator, placeholder, index) => {
        accumulator[`body_${index + 1}`] = {
            type: 'text',
            value: resolveTemplatePlaceholderValue(placeholder, member, gymName),
        };
        return accumulator;
    }, {});
};

const sendWhatsAppTemplate = async ({ integratedNumber, templateName, language = 'en_US', recipientNumber, variables = {} }) => {
    const authKey = getMsg91WhatsAppAuthKey();
    if (!authKey) {
        throw new Error('MSG91 WhatsApp is not configured.');
    }

    return msg91Request({
        path: '/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
        method: 'POST',
        authKey,
        body: {
            integrated_number: normalizeCountryCodePhone(integratedNumber),
            content_type: 'template',
            payload: {
                type: 'template',
                template: {
                    name: templateName,
                    language: {
                        code: language || 'en_US',
                        policy: 'deterministic',
                    },
                    to_and_components: [
                        {
                            to: normalizeCountryCodePhone(recipientNumber),
                            components: variables,
                        },
                    ],
                },
            },
        },
    });
};

module.exports = {
    OTP_MODES,
    buildTemplateBodyVariables,
    buildTemplateDefinition,
    buildTemplateName,
    convertNamedPlaceholdersToPositional,
    createWhatsAppTemplate,
    extractTemplatePlaceholderKeys,
    findIntegratedWhatsAppNumber,
    getMsg91OtpMode,
    getMsg91WhatsAppOnboardingConfig,
    isMsg91OtpConfigured,
    isMsg91WhatsAppConfigured,
    listIntegratedWhatsAppNumbers,
    listWhatsAppTemplates,
    looksLikeMsg91TemplateDuplicate,
    maskPhone,
    normalizeCountryCodePhone,
    normalizeE164Phone,
    normalizeLocalIndianPhone,
    pickTemplateCategory,
    requestMsg91Otp,
    sendWhatsAppTemplate,
    verifyMsg91Otp,
};