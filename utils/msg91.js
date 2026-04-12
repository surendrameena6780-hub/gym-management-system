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

const TEMPLATE_PLACEHOLDER_ALIASES = {
    name: 'name',
    member: 'name',
    member_name: 'name',
    customer: 'name',
    customer_name: 'name',
    plan: 'plan',
    membership: 'plan',
    membership_plan: 'plan',
    days_left: 'days_left',
    daysleft: 'days_left',
    days: 'days_left',
    expiry_days: 'days_left',
    gym_name: 'gym_name',
    gymname: 'gym_name',
    gym: 'gym_name',
    studio_name: 'gym_name',
};

const toTrimmedString = (value) => String(value || '').trim();

const capitalizeSentenceStart = (value) => String(value || '').replace(/^\s*([a-z])/u, (match, character) => match.replace(character, character.toUpperCase()));

const normalizeTemplatePlaceholderKey = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    return TEMPLATE_PLACEHOLDER_ALIASES[normalized] || (TEMPLATE_PLACEHOLDER_DEFAULTS[normalized] ? normalized : '');
};

const normalizeLooseTemplatePlaceholders = (text) => String(text || '').replace(/(\{\{?|\[\[?)\s*([a-zA-Z][a-zA-Z0-9_\s-]{0,40})\s*(\}\}?|\]\]?)/g, (match, _open, rawPlaceholder) => {
    const normalizedKey = normalizeTemplatePlaceholderKey(rawPlaceholder);
    return normalizedKey ? `{{${normalizedKey}}}` : match;
});

const insertSuffixBeforeTerminalPunctuation = (text, suffix) => {
    const normalizedText = toTrimmedString(text);
    const normalizedSuffix = toTrimmedString(suffix);
    if (!normalizedText || !normalizedSuffix) {
        return normalizedText;
    }

    const punctuationMatch = normalizedText.match(/([.!?]+)$/);
    if (!punctuationMatch) {
        return `${normalizedText}${normalizedSuffix}`;
    }

    return `${normalizedText.slice(0, -punctuationMatch[1].length)}${normalizedSuffix}${punctuationMatch[1]}`;
};

const operationalizeTemplateCopy = (rawText) => {
    let text = toTrimmedString(rawText)
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.!?])/g, '$1');

    if (!text) {
        return '';
    }

    text = normalizeLooseTemplatePlaceholders(text)
        .replace(/\bgym\s*vault\b/gi, '{{gym_name}}')
        .replace(/\bgym\s*name\b/gi, '{{gym_name}}');

    let placeholderKeys = extractTemplatePlaceholderKeys(text);

    if (!placeholderKeys.includes('name')) {
        if (/^(hi|hello|hey|namaste|good morning|good afternoon|good evening)\b/i.test(text)) {
            text = text.replace(/^(hi|hello|hey|namaste|good morning|good afternoon|good evening)\b[\s,!.-]*/i, (_match, greeting) => `${capitalizeSentenceStart(greeting)} {{name}}, `);
        } else {
            text = `Hi {{name}}, ${text}`;
        }
    }

    placeholderKeys = extractTemplatePlaceholderKeys(text);

    if (!placeholderKeys.includes('gym_name')) {
        if (/\bfrom\s+(?:the\s+)?(?:gym|studio|club)\b/i.test(text)) {
            text = text.replace(/\bfrom\s+(?:the\s+)?(?:gym|studio|club)\b/i, 'from {{gym_name}}');
        } else if (/\bat\s+(?:the\s+)?(?:gym|studio|club)\b/i.test(text)) {
            text = text.replace(/\bat\s+(?:the\s+)?(?:gym|studio|club)\b/i, 'at {{gym_name}}');
        } else {
            text = insertSuffixBeforeTerminalPunctuation(text, ' from {{gym_name}}');
        }
    }

    placeholderKeys = extractTemplatePlaceholderKeys(text);

    if (!placeholderKeys.includes('plan')) {
        if (/\byour current plan\b/i.test(text)) {
            text = text.replace(/\byour current plan\b/i, '{{plan}}');
        } else if (/\byour plan\b/i.test(text)) {
            text = text.replace(/\byour plan\b/i, '{{plan}}');
        } else if (/\byour membership\b/i.test(text)) {
            text = text.replace(/\byour membership\b/i, 'your {{plan}} membership');
        }
    }

    placeholderKeys = extractTemplatePlaceholderKeys(text);

    if (!placeholderKeys.includes('days_left')) {
        if (/\b(?:in|within)\s+\d+\s+day(?:s|\(s\))\b/i.test(text)) {
            text = text.replace(/\b((?:in|within))\s+\d+\s+(day(?:s|\(s\)))\b/i, '$1 {{days_left}} $2');
        } else if (/\b(expire|expires|expiring|expired|renewal reminder|renew soon|payment due|due soon)\b/i.test(text)) {
            text = insertSuffixBeforeTerminalPunctuation(text, ' in {{days_left}} day(s)');
        }
    }

    text = capitalizeSentenceStart(
        text
            .replace(/\s+/g, ' ')
            .replace(/\s+([,.!?])/g, '$1')
            .trim()
    );

    if (!/[.!?]$/.test(text)) {
        text = `${text}.`;
    }

    return text;
};

const inferTemplateCategoryFromText = (templateKey, whatsappText = '') => {
    const mappedCategory = TEMPLATE_CATEGORY_MAP[String(templateKey || '').trim().toUpperCase()];
    if (mappedCategory) {
        return mappedCategory;
    }

    const normalizedText = String(whatsappText || '').toLowerCase();
    const utilitySignals = ['renew', 'renewal', 'expire', 'expired', 'payment', 'due', 'invoice', 'receipt', 'membership', 'schedule', 'timing', 'session', 'support'];
    const marketingSignals = ['offer', 'promo', 'discount', 'sale', 'winback', 'comeback', 'invite', 'refer', 'join', 'special'];

    if (utilitySignals.some((signal) => normalizedText.includes(signal))) {
        return 'UTILITY';
    }

    if (marketingSignals.some((signal) => normalizedText.includes(signal))) {
        return 'MARKETING';
    }

    return 'MARKETING';
};

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
        const templateCategory = toTrimmedString(node.category || node.template_category).toUpperCase();

        if (templateName && Array.isArray(node.languages) && node.languages.length > 0) {
            node.languages.forEach((languageNode) => {
                const localizedName = toTrimmedString(languageNode?.template_name || languageNode?.name || templateName);
                if (!localizedName || seen.has(localizedName.toLowerCase())) return;
                seen.add(localizedName.toLowerCase());
                templates.push({
                    template_name: localizedName,
                    template_status: toTrimmedString(languageNode?.template_status || languageNode?.status || languageNode?.templateStatus).toUpperCase(),
                    template_language: toTrimmedString(languageNode?.template_language || languageNode?.language?.code || languageNode?.language || 'en_US'),
                    template_category: toTrimmedString(languageNode?.category || languageNode?.template_category || templateCategory).toUpperCase(),
                });
            });
            return;
        }

        const templateStatus = toTrimmedString(node.template_status || node.status || node.templateStatus).toUpperCase();
        const templateLanguage = toTrimmedString(node.template_language || node.language?.code || node.language || 'en_US');
        const hasUsefulTemplateState = templateStatus && !['SUCCESS', 'OK'].includes(templateStatus);
        if (!templateName || !hasUsefulTemplateState || seen.has(templateName.toLowerCase())) return;

        seen.add(templateName.toLowerCase());
        templates.push({
            template_name: templateName,
            template_status: templateStatus,
            template_language: templateLanguage,
            template_category: templateCategory,
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

const buildTemplateNameFragment = (templateKey, whatsappText) => {
    const sanitizedKey = toTrimmedString(templateKey)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30) || 'template';
    const signature = crypto.createHash('sha1').update(String(whatsappText || '')).digest('hex').slice(0, 8);
    return `${sanitizedKey}_${signature}`;
};

const buildTemplateName = (namespace, templateKey, whatsappText) => {
    const sanitizedNamespace = toTrimmedString(namespace)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 16) || 'default';
    return `gv_${sanitizedNamespace}_${buildTemplateNameFragment(templateKey, whatsappText)}`.slice(0, 60);
};

const pickTemplateCategory = (templateKey, whatsappText = '') => inferTemplateCategoryFromText(templateKey, whatsappText);

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
        category: pickTemplateCategory(templateKey, whatsappText),
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

const sendWhatsAppTemplate = async ({ integratedNumber, templateName, language = 'en_US', recipientNumber, variables = {}, correlationId = '' }) => {
    const authKey = getMsg91WhatsAppAuthKey();
    if (!authKey) {
        throw new Error('MSG91 WhatsApp is not configured.');
    }

    const normalizedCorrelationId = toTrimmedString(correlationId);

    return msg91Request({
        path: '/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
        method: 'POST',
        authKey,
        body: {
            integrated_number: normalizeCountryCodePhone(integratedNumber),
            content_type: 'template',
            ...(normalizedCorrelationId ? { CRQID: normalizedCorrelationId } : {}),
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
                            ...(normalizedCorrelationId ? { CRQID: normalizedCorrelationId } : {}),
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
    buildTemplateNameFragment,
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
    operationalizeTemplateCopy,
    pickTemplateCategory,
    requestMsg91Otp,
    sendWhatsAppTemplate,
    verifyMsg91Otp,
};