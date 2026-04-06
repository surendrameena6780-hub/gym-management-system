const DEFAULT_STRING_LIMIT = 2000;
const DEFAULT_ARRAY_LIMIT = 200;
const DEFAULT_OBJECT_KEY_LIMIT = 120;

const EXTERNAL_SKIP_PATHS = new Set([
    '/api/settings/platform/whatsapp-delivery/webhook',
]);

const STRING_RULES = [
    { pattern: /(^|\.)(full_name|owner_name)$/i, max: 100 },
    { pattern: /(^|\.)(gym_name|name|title|subject|reader_name|trainer_name|key_name)$/i, max: 120 },
    { pattern: /(^|\.)(email)$/i, max: 120 },
    { pattern: /(^|\.)(phone|owner_phone|mobile|whatsapp|messaging_whatsapp_number)$/i, max: 30 },
    { pattern: /(^|\.)(city|source|category|status|priority|payment_mode|color_theme|staff_role|role|channel|schedule)$/i, max: 60 },
    { pattern: /(^|\.)(sku|invoice_id|transaction_id|template_key|plan_name)$/i, max: 120 },
    { pattern: /(^|\.)(url|doc_url|receipt_url|avatar_url)$/i, max: 2048 },
    { pattern: /(^|\.)(description|message|about|mission|sla|waiver_text)$/i, max: 4000 },
    { pattern: /(^|\.)(notes|reason|cancellation_reason|lost_reason|address|gym_address|support_window|renewal_policy|class_eligibility|access_hours)$/i, max: 2000 },
    { pattern: /(^|\.)(csv|csv_data|csv_text|import_data)$/i, max: 500000 },
    { pattern: /(^|\.)(profile_pic|image|photo)$/i, max: 2500000 },
];

const ARRAY_RULES = [
    { pattern: /(^|\.)(member_ids|permissions|events|allowed_days|features|items)$/i, max: 200 },
    { pattern: /(^|\.)(branch_directory)$/i, max: 25 },
];

const getStringLimit = (path, value) => {
    if (/^data:image\//i.test(String(value || ''))) {
        return 2500000;
    }

    const match = STRING_RULES.find((rule) => rule.pattern.test(path));
    return match?.max || DEFAULT_STRING_LIMIT;
};

const getArrayLimit = (path) => {
    const match = ARRAY_RULES.find((rule) => rule.pattern.test(path));
    return match?.max || DEFAULT_ARRAY_LIMIT;
};

const inspectValue = (value, path) => {
    if (value === null || value === undefined) {
        return;
    }

    if (typeof value === 'string') {
        const limit = getStringLimit(path, value);
        if (value.length > limit) {
            throw new Error(`Field ${path.replace(/^body\./, '')} exceeds ${limit} characters.`);
        }
        return;
    }

    if (Array.isArray(value)) {
        const limit = getArrayLimit(path);
        if (value.length > limit) {
            throw new Error(`Field ${path.replace(/^body\./, '')} exceeds ${limit} items.`);
        }

        value.forEach((entry, index) => inspectValue(entry, `${path}[${index}]`));
        return;
    }

    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length > DEFAULT_OBJECT_KEY_LIMIT) {
            throw new Error(`Field ${path.replace(/^body\./, '')} contains too many nested keys.`);
        }

        keys.forEach((key) => inspectValue(value[key], `${path}.${key}`));
    }
};

const enforceRequestPayloadLimits = (req, res, next) => {
    if (EXTERNAL_SKIP_PATHS.has(req.path)) {
        return next();
    }

    if (!req.body || typeof req.body !== 'object') {
        return next();
    }

    try {
        inspectValue(req.body, 'body');
        return next();
    } catch (err) {
        return res.status(400).json({
            success: false,
            code: 'PAYLOAD_VALIDATION_FAILED',
            error: err.message || 'Request payload is too large or malformed.',
        });
    }
};

module.exports = {
    enforceRequestPayloadLimits,
};