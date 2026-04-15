const crypto = require('crypto');
const { pool } = require('../config/db');
const {
    normalizeCountryCodePhone,
    normalizeE164Phone,
    normalizeLocalIndianPhone,
    sendWhatsAppTemplate,
} = require('./msg91');

const MSG91_WHATSAPP_WEBHOOK_DOC_URL = 'https://msg91.com/help/whatsapp/how-to-get-reports-of-whatsapp-messages-on-webhook';
const META_HEALTHY_ECOSYSTEM_FAILURE_CODE = '131049';
const DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS = Math.max(1, Math.min(Number.parseInt(process.env.WHATSAPP_META_SUPPRESSION_COOLDOWN_HOURS || '24', 10) || 24, 168));
const STATUS_PRIORITY = {
    UNKNOWN: -1,
    QUEUED: 0,
    FAILED: 1,
    SUBMITTED: 2,
    SENT: 3,
    DELIVERED: 4,
    READ: 5,
};

let ensureWhatsAppDeliverySchemaPromise;

const toTrimmedString = (value) => String(value || '').trim();

const toPrimitiveString = (value) => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value).trim()
        : ''
);

const parseStructuredString = (value) => {
    const raw = toTrimmedString(value);
    if (!raw) return null;
    const firstChar = raw[0];
    if (firstChar !== '{' && firstChar !== '[') return null;

    try {
        return JSON.parse(raw);
    } catch (_err) {
        return null;
    }
};

const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

const truncateText = (value, max = 240) => {
    const normalized = toTrimmedString(value).replace(/\s+/g, ' ');
    if (!normalized) return '';
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
};

const extractMetaFailureCode = (...values) => {
    for (const candidate of values) {
        const match = String(candidate || '').match(/(131\d{3})/);
        if (match?.[1]) {
            return match[1];
        }
    }

    return '';
};

const looksLikeMetaFailure = ({ providerStatus = '', statusDetail = '', payloadText = '' } = {}) => {
    const combined = `${providerStatus} ${statusDetail} ${payloadText}`.toLowerCase();
    return combined.includes('meta')
        || combined.includes('failed by meta')
        || combined.includes('healthy ecosystem')
        || /131\d{3}/.test(combined);
};

const normalizeMetaFailureCode = (value) => {
    const code = String(value || '').trim();
    return code || 'UNKNOWN_META';
};

const looksLikeFailureStatusDetailText = (...values) => {
    const combined = values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

    if (!combined) {
        return false;
    }

    return combined.includes('failed by meta')
        || combined.includes('healthy ecosystem')
        || combined.includes('undeliver')
        || combined.includes('reject')
        || combined.includes('error')
        || combined.includes('failed')
        || /131\d{3}/.test(combined);
};

const repairStaleFailedDeliveryStatuses = async ({
    gymId,
    recipientNumbers = [],
    hours = 24 * 30,
} = {}) => {
    await ensureWhatsAppDeliverySchema();

    if (!gymId) {
        return 0;
    }

    const normalizedRecipients = Array.from(new Set(
        (Array.isArray(recipientNumbers) ? recipientNumbers : [recipientNumbers])
            .map((value) => normalizeE164Phone(value))
            .filter(Boolean)
    ));
    const safeHours = Math.max(1, Math.min(Number.parseInt(hours, 10) || (24 * 30), 24 * 30));
    const params = [gymId, safeHours];
    let recipientFilterSql = '';

    if (normalizedRecipients.length > 0) {
        recipientFilterSql = 'AND recipient_number = ANY($3::text[])';
        params.push(normalizedRecipients);
    }

    const candidates = await pool.query(
        `SELECT id, provider_status, current_status, status_detail, last_provider_payload
         FROM whatsapp_delivery_logs
         WHERE gym_id = $1
           AND current_status IN ('QUEUED', 'SUBMITTED', 'SENT')
           AND COALESCE(failed_at, updated_at, created_at) >= NOW() - ($2::int * INTERVAL '1 hour')
           ${recipientFilterSql}
           AND (
                COALESCE(provider_status, '') ILIKE '%fail%'
                OR COALESCE(provider_status, '') ILIKE '%meta%'
                OR COALESCE(provider_status, '') ILIKE '%reject%'
                OR COALESCE(provider_status, '') ILIKE '%error%'
                OR COALESCE(status_detail, '') ILIKE '%fail%'
                OR COALESCE(status_detail, '') ILIKE '%meta%'
                OR COALESCE(status_detail, '') ILIKE '%reject%'
                OR COALESCE(status_detail, '') ILIKE '%error%'
                OR COALESCE(status_detail, '') ILIKE '%healthy ecosystem%'
                OR COALESCE(status_detail, '') ~ '131[0-9]{3}'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%fail%'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%meta%'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%reject%'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%error%'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%healthy ecosystem%'
                OR COALESCE(last_provider_payload::text, '') ~ '131[0-9]{3}'
           )`,
        params
    );

    const staleFailedIds = (candidates.rows || [])
        .filter((row) => {
            const providerStatus = normalizeDeliveryStatus(row?.provider_status);
            return providerStatus === 'FAILED'
                || looksLikeFailureStatusDetailText(
                    row?.provider_status,
                    row?.status_detail,
                    JSON.stringify(row?.last_provider_payload || {})
                );
        })
        .map((row) => Number(row.id || 0))
        .filter((value) => value > 0);

    if (staleFailedIds.length === 0) {
        return 0;
    }

    const updateResult = await pool.query(
        `UPDATE whatsapp_delivery_logs
         SET provider_status = CASE
                 WHEN COALESCE(NULLIF(TRIM(provider_status), ''), '') = '' THEN 'FAILED'
                 ELSE provider_status
             END,
             current_status = 'FAILED',
             failed_at = COALESCE(failed_at, updated_at, created_at, NOW()),
             updated_at = NOW()
         WHERE id = ANY($1::int[])`,
        [staleFailedIds]
    );

    return Number(updateResult.rowCount || 0);
};

const mapMetaFailureRow = (row) => {
    const payloadText = toTrimmedString(JSON.stringify(row?.last_provider_payload || {}));
    const failureCode = extractMetaFailureCode(row?.status_detail, row?.provider_status, payloadText);

    return {
        id: Number(row?.id || 0) || null,
        gymId: Number(row?.gym_id || 0) || null,
        memberId: Number(row?.member_id || 0) || null,
        sourceKind: toTrimmedString(row?.source_kind).toUpperCase(),
        sourceLabel: toTrimmedString(row?.source_label),
        templateKey: toTrimmedString(row?.template_key).toUpperCase(),
        templateTitle: toTrimmedString(row?.template_title),
        recipientName: truncateText(row?.recipient_name, 120),
        recipientNumber: normalizeE164Phone(row?.recipient_number),
        providerStatus: toTrimmedString(row?.provider_status),
        statusDetail: toTrimmedString(row?.status_detail),
        failureCode: normalizeMetaFailureCode(failureCode),
        failedAt: row?.failed_at || row?.updated_at || row?.created_at || null,
        requestId: toTrimmedString(row?.msg91_request_id),
        messageUuid: toTrimmedString(row?.msg91_message_uuid),
        correlationId: toTrimmedString(row?.msg91_crqid),
    };
};

const normalizeDeliveryStatus = (value) => {
    const raw = toTrimmedString(value).toUpperCase();
    if (!raw) return 'UNKNOWN';
    if (raw.includes('READ')) return 'READ';
    if (raw.includes('DELIVER')) return 'DELIVERED';
    if (raw.includes('SENT')) return 'SENT';
    if (raw.includes('SUBMIT') || raw.includes('QUEUE') || raw.includes('ACCEPT')) return 'SUBMITTED';
    if (raw.includes('FAIL') || raw.includes('REJECT') || raw.includes('ERROR') || raw.includes('UNDELIVER')) return 'FAILED';
    return raw;
};

const normalizeWebhookDirection = (value) => {
    const raw = toTrimmedString(value).toLowerCase();
    if (!raw) return '';
    if (raw === '1') return 'outbound';
    if (raw === '0' || raw === '2') return 'inbound';
    if (raw.includes('inbound')) return 'inbound';
    if (raw.includes('outbound')) return 'outbound';
    return raw;
};

const normalizeWebhookToken = () => toTrimmedString(process.env.MSG91_WHATSAPP_WEBHOOK_TOKEN);

const createCorrelationId = () => `gvwa_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

const pickFirstPrimitiveByKeys = (value, keys, seen = new Set()) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        const parsed = parseStructuredString(value);
        if (parsed && typeof parsed === 'object') {
            return pickFirstPrimitiveByKeys(parsed, keys, seen);
        }
        return '';
    }
    if (typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);

    const desiredKeys = new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim().toLowerCase()).filter(Boolean));

    if (Array.isArray(value)) {
        for (const item of value) {
            const match = pickFirstPrimitiveByKeys(item, keys, seen);
            if (match !== '') return match;
        }
        return '';
    }

    for (const [key, child] of Object.entries(value)) {
        if (desiredKeys.has(String(key || '').trim().toLowerCase()) && (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')) {
            return child;
        }
    }

    for (const child of Object.values(value)) {
        const match = pickFirstPrimitiveByKeys(child, keys, seen);
        if (match !== '') return match;
    }

    return '';
};

const parseProviderTimestamp = (value) => {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number' || /^\d+$/.test(String(value || '').trim())) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        const timestamp = String(Math.trunc(numeric)).length <= 10 ? numeric * 1000 : numeric;
        const date = new Date(timestamp);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const mergeDeliveryStatus = (currentStatus, incomingStatus) => {
    const current = normalizeDeliveryStatus(currentStatus || 'UNKNOWN');
    const incoming = normalizeDeliveryStatus(incomingStatus || 'UNKNOWN');

    if (incoming === 'UNKNOWN') return current === 'UNKNOWN' ? 'QUEUED' : current;
    if (incoming === 'FAILED') return ['DELIVERED', 'READ'].includes(current) ? current : 'FAILED';

    return (STATUS_PRIORITY[incoming] ?? -1) >= (STATUS_PRIORITY[current] ?? -1)
        ? incoming
        : current;
};

const buildStatusDetail = (payload, fallback = '') => {
    const detail = toTrimmedString(
        pickFirstPrimitiveByKeys(payload, ['statusDescription', 'description', 'details', 'reason', 'error', 'message'])
    );
    return detail || fallback;
};

const extractSendAcceptanceMeta = (payload) => {
    const requestId = toTrimmedString(pickFirstPrimitiveByKeys(payload, ['request_id', 'requestId', 'requestid']));
    const messageUuid = toTrimmedString(pickFirstPrimitiveByKeys(payload, ['message_uuid', 'messageUuid', 'messageuuid']));
    const correlationId = toTrimmedString(pickFirstPrimitiveByKeys(payload, ['CRQID', 'crqid']));
    const providerStatus = toTrimmedString(pickFirstPrimitiveByKeys(payload, ['status', 'type']));
    const hasConfirmedReceipt = Boolean(requestId || messageUuid);
    const statusDetail = buildStatusDetail(payload);

    return {
        requestId,
        messageUuid,
        correlationId,
        providerStatus,
        normalizedStatus: providerStatus ? normalizeDeliveryStatus(providerStatus) : 'QUEUED',
        statusDetail: statusDetail || (hasConfirmedReceipt ? '' : 'MSG91 did not return a request_id or message_uuid for this recipient send.'),
        hasConfirmedReceipt,
    };
};

const getWebhookCandidates = (payload) => (
    Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.messages)
                ? payload.messages
                : Array.isArray(payload?.results)
                    ? payload.results
                    : [payload]
)
    .filter((item) => item && typeof item === 'object');

const extractInboundMessageText = (item) => truncateText(
    toPrimitiveString(item?.text)
    || toPrimitiveString(item?.body)
    || toPrimitiveString(item?.message_text)
    || toPrimitiveString(item?.messageText)
    || toPrimitiveString(item?.content)
    || toPrimitiveString(item?.reply)
    || toPrimitiveString(item?.replyText)
    || toTrimmedString(pickFirstPrimitiveByKeys(item, ['text', 'body', 'message_text', 'messageText', 'content', 'reply', 'replyText', 'message'])),
    1000
);

const extractInboundSenderName = (item) => truncateText(
    toPrimitiveString(item?.sender_name)
    || toPrimitiveString(item?.senderName)
    || toPrimitiveString(item?.customer_name)
    || toPrimitiveString(item?.customerName)
    || toPrimitiveString(item?.profile_name)
    || toPrimitiveString(item?.profileName)
    || toTrimmedString(pickFirstPrimitiveByKeys(item, ['sender_name', 'senderName', 'customer_name', 'customerName', 'profile_name', 'profileName', 'name'])),
    120
);

const isInboundWebhookCandidate = (item) => {
    const direction = normalizeWebhookDirection(item?.direction || item?.message_direction || item?.messageDirection || item?.event_type || item?.eventType);
    if (direction === 'inbound') return true;
    if (direction === 'outbound') return false;

    const senderNumber = normalizeE164Phone(
        item?.customer_number
        || item?.customerNumber
        || item?.from
        || item?.sender
        || item?.phone
        || pickFirstPrimitiveByKeys(item, ['customer_number', 'customerNumber', 'from', 'sender', 'phone', 'wa_id'])
    );
    const integratedNumber = normalizeE164Phone(
        item?.integrated_number
        || item?.integratedNumber
        || item?.number
        || item?.to
        || pickFirstPrimitiveByKeys(item, ['integrated_number', 'integratedNumber', 'number', 'to', 'destination', 'owner_number', 'business_number'])
    );
    const messageText = extractInboundMessageText(item);
    const hasExplicitReplyPayload = Boolean(
        toPrimitiveString(item?.reply)
        || toPrimitiveString(item?.replyText)
        || toPrimitiveString(item?.replyMsgId)
        || toPrimitiveString(item?.from)
        || toPrimitiveString(item?.sender)
        || toPrimitiveString(item?.sender_name)
        || toPrimitiveString(item?.profile_name)
        || toPrimitiveString(item?.customerName)
        || toPrimitiveString(item?.contentType)
        || toPrimitiveString(item?.messages)
        || toPrimitiveString(item?.contacts)
    );
    const hasDeliveryLifecycle = Boolean(
        toTrimmedString(item?.status || item?.delivery_status || item?.event_type || item?.eventType)
        || item?.submitted_at
        || item?.submittedAt
        || item?.sent_at
        || item?.sentAt
        || item?.delivered_at
        || item?.deliveredAt
        || item?.read_at
        || item?.readAt
        || item?.failed_at
        || item?.failedAt
        || toTrimmedString(item?.template_name || item?.templateName)
    );

    return Boolean(senderNumber && messageText && (hasExplicitReplyPayload || !hasDeliveryLifecycle || !integratedNumber));
};

const buildWebhookRecords = (payload) => {
    return getWebhookCandidates(payload)
        .filter((item) => !isInboundWebhookCandidate(item))
        .map((item) => {
            const providerStatus = toTrimmedString(item.status || item.delivery_status || item.eventName || item.event_name || item.event_type || item.eventType);
            return {
                requestId: toTrimmedString(item.request_id || item.requestId || item.requestid),
                messageUuid: toTrimmedString(item.message_uuid || item.messageUuid || item.messageuuid || item.uuid),
                correlationId: toTrimmedString(item.CRQID || item.crqid || item.correlation_id || item.correlationId),
                providerStatus,
                normalizedStatus: normalizeDeliveryStatus(providerStatus),
                integratedNumber: normalizeE164Phone(item.integrated_number || item.integratedNumber || item.number || pickFirstPrimitiveByKeys(item, ['integrated_number', 'integratedNumber', 'number'])),
                recipientNumber: normalizeE164Phone(item.customer_number || item.customerNumber || item.to || item.recipient || item.phone || pickFirstPrimitiveByKeys(item, ['customer_number', 'customerNumber', 'to', 'recipient', 'phone'])),
                templateName: toTrimmedString(item.template_name || item.templateName),
                templateLanguage: toTrimmedString(item.template_language || item.templateLanguage),
                direction: normalizeWebhookDirection(item.direction || item.message_direction || item.messageDirection),
                statusDetail: buildStatusDetail(item),
                submittedAt: parseProviderTimestamp(item.submitted_at || item.submittedAt),
                sentAt: parseProviderTimestamp(item.sent_at || item.sentAt),
                deliveredAt: parseProviderTimestamp(item.delivered_at || item.deliveredAt),
                readAt: parseProviderTimestamp(item.read_at || item.readAt),
                failedAt: parseProviderTimestamp(item.failed_at || item.failedAt),
                payload: item,
            };
        })
        .filter((item) => item.requestId || item.messageUuid || item.correlationId || item.recipientNumber || item.providerStatus);
};

const buildInboundWebhookRecords = (payload) => {
    return getWebhookCandidates(payload)
        .filter((item) => isInboundWebhookCandidate(item))
        .map((item) => {
            const messageText = extractInboundMessageText(item) || 'Customer replied on WhatsApp.';

            return {
                requestId: toTrimmedString(item.request_id || item.requestId || item.requestid),
                messageUuid: toTrimmedString(item.message_uuid || item.messageUuid || item.messageuuid || item.uuid),
                replyMessageId: toTrimmedString(item.reply_msg_id || item.replyMsgId || pickFirstPrimitiveByKeys(item, ['reply_msg_id', 'replyMsgId'])),
                correlationId: toTrimmedString(item.CRQID || item.crqid || item.correlation_id || item.correlationId),
                integratedNumber: normalizeE164Phone(item.integrated_number || item.integratedNumber || item.number || item.to || pickFirstPrimitiveByKeys(item, ['integrated_number', 'integratedNumber', 'number', 'to', 'destination', 'owner_number', 'business_number'])),
                senderNumber: normalizeE164Phone(item.customer_number || item.customerNumber || item.from || item.sender || item.phone || pickFirstPrimitiveByKeys(item, ['customer_number', 'customerNumber', 'from', 'sender', 'phone', 'wa_id'])),
                senderName: extractInboundSenderName(item),
                messageText,
                direction: normalizeWebhookDirection(item.direction || item.message_direction || item.messageDirection),
                receivedAt: parseProviderTimestamp(
                    item.received_at
                    || item.receivedAt
                    || item.created_at
                    || item.createdAt
                    || item.timestamp
                    || item.time
                    || item.sent_at
                    || item.sentAt
                ),
                payload: item,
            };
        })
        .filter((item) => item.integratedNumber || item.senderNumber || item.messageText);
};

const buildInboundProviderMessageKey = (record) => crypto.createHash('sha1')
    .update([
        record.requestId,
        record.messageUuid,
        record.correlationId,
        record.integratedNumber,
        record.senderNumber,
        record.messageText,
        record.receivedAt ? new Date(record.receivedAt).toISOString() : '',
    ].map((value) => toTrimmedString(value)).join('|'))
    .digest('hex');

const ensureWhatsAppDeliverySchema = async () => {
    if (!ensureWhatsAppDeliverySchemaPromise) {
        ensureWhatsAppDeliverySchemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS whatsapp_delivery_logs (
                    id SERIAL PRIMARY KEY,
                    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
                    broadcast_log_id INTEGER REFERENCES broadcast_logs(id) ON DELETE SET NULL,
                    initiated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    source_kind VARCHAR(30) NOT NULL DEFAULT 'REMINDER',
                    source_label VARCHAR(120) DEFAULT '',
                    template_key VARCHAR(60) DEFAULT '',
                    template_title VARCHAR(120) DEFAULT '',
                    template_name VARCHAR(120) DEFAULT '',
                    template_language VARCHAR(20) DEFAULT 'en_US',
                    integrated_number VARCHAR(30) DEFAULT '',
                    recipient_number VARCHAR(30) NOT NULL,
                    recipient_name VARCHAR(120) DEFAULT '',
                    message_preview TEXT DEFAULT '',
                    msg91_crqid VARCHAR(120) UNIQUE,
                    msg91_request_id VARCHAR(120),
                    msg91_message_uuid VARCHAR(120),
                    provider_status VARCHAR(40) DEFAULT '',
                    current_status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
                    status_detail TEXT DEFAULT '',
                    submitted_at TIMESTAMPTZ,
                    sent_at TIMESTAMPTZ,
                    delivered_at TIMESTAMPTZ,
                    read_at TIMESTAMPTZ,
                    failed_at TIMESTAMPTZ,
                    last_provider_payload JSONB DEFAULT '{}'::jsonb,
                    last_webhook_received_at TIMESTAMPTZ,
                    webhook_count INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_logs_gym_created_at
                    ON whatsapp_delivery_logs(gym_id, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_logs_request_id
                    ON whatsapp_delivery_logs(msg91_request_id)
                    WHERE msg91_request_id IS NOT NULL;

                CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_logs_message_uuid
                    ON whatsapp_delivery_logs(msg91_message_uuid)
                    WHERE msg91_message_uuid IS NOT NULL;

                CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_logs_crqid
                    ON whatsapp_delivery_logs(msg91_crqid)
                    WHERE msg91_crqid IS NOT NULL;

                CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_logs_broadcast_log_id
                    ON whatsapp_delivery_logs(broadcast_log_id)
                    WHERE broadcast_log_id IS NOT NULL;

                CREATE TABLE IF NOT EXISTS whatsapp_inbound_logs (
                    id SERIAL PRIMARY KEY,
                    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
                    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
                    integrated_number VARCHAR(30) DEFAULT '',
                    sender_number VARCHAR(30) NOT NULL,
                    sender_name VARCHAR(120) DEFAULT '',
                    message_text TEXT DEFAULT '',
                    provider_message_key VARCHAR(120) UNIQUE,
                    msg91_request_id VARCHAR(120),
                    msg91_message_uuid VARCHAR(120),
                    msg91_crqid VARCHAR(120),
                    received_at TIMESTAMPTZ,
                    reply_context JSONB DEFAULT '{}'::jsonb,
                    last_provider_payload JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_logs_gym_created_at
                    ON whatsapp_inbound_logs(gym_id, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_logs_sender_number
                    ON whatsapp_inbound_logs(sender_number);
            `);
        })();
    }

    await ensureWhatsAppDeliverySchemaPromise;
};

const createDeliveryLog = async ({
    gymId,
    memberId = null,
    broadcastLogId = null,
    initiatedBy = null,
    sourceKind = 'REMINDER',
    sourceLabel = '',
    templateKey = '',
    templateTitle = '',
    templateName = '',
    templateLanguage = 'en_US',
    integratedNumber,
    recipientNumber,
    recipientName = '',
    messagePreview = '',
}) => {
    await ensureWhatsAppDeliverySchema();

    const correlationId = createCorrelationId();
    const result = await pool.query(
        `INSERT INTO whatsapp_delivery_logs (
            gym_id,
            member_id,
            broadcast_log_id,
            initiated_by,
            source_kind,
            source_label,
            template_key,
            template_title,
            template_name,
            template_language,
            integrated_number,
            recipient_number,
            recipient_name,
            message_preview,
            msg91_crqid,
            provider_status,
            current_status,
            last_provider_payload,
            updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'QUEUED', 'QUEUED', '{}'::jsonb, NOW())
         RETURNING *`,
        [
            gymId,
            memberId,
            broadcastLogId,
            initiatedBy,
            toTrimmedString(sourceKind).toUpperCase() || 'REMINDER',
            sourceLabel,
            toTrimmedString(templateKey).toUpperCase(),
            templateTitle,
            templateName,
            templateLanguage || 'en_US',
            normalizeE164Phone(integratedNumber),
            normalizeE164Phone(recipientNumber),
            recipientName,
            messagePreview,
            correlationId,
        ]
    );

    return result.rows[0];
};

const updateDeliveryFromAcceptance = async ({ logId, providerPayload, acceptance }) => {
    const status = mergeDeliveryStatus('QUEUED', acceptance?.normalizedStatus || 'QUEUED');
    const statusTimestamp = new Date();
    const submittedAtFallback = ['SUBMITTED', 'SENT', 'DELIVERED', 'READ'].includes(status) ? statusTimestamp : null;
    const sentAtFallback = ['SENT', 'DELIVERED', 'READ'].includes(status) ? statusTimestamp : null;
    await pool.query(
        `UPDATE whatsapp_delivery_logs
         SET msg91_request_id = COALESCE($2, msg91_request_id),
             msg91_message_uuid = COALESCE($3, msg91_message_uuid),
             provider_status = COALESCE(NULLIF($4, ''), provider_status),
             current_status = $5,
             status_detail = COALESCE(NULLIF($6, ''), status_detail),
             submitted_at = COALESCE(submitted_at, $7::timestamptz),
             sent_at = COALESCE(sent_at, $8::timestamptz),
             last_provider_payload = $9::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
            logId,
            toTrimmedString(acceptance?.requestId) || null,
            toTrimmedString(acceptance?.messageUuid) || null,
            toTrimmedString(acceptance?.providerStatus) || null,
            status,
            toTrimmedString(acceptance?.statusDetail) || null,
            submittedAtFallback,
            sentAtFallback,
            JSON.stringify(providerPayload || {}),
        ]
    );
};

const markDeliverySendFailed = async ({ logId, errorMessage, providerPayload = null }) => {
    await pool.query(
        `UPDATE whatsapp_delivery_logs
         SET provider_status = 'FAILED',
             current_status = 'FAILED',
             status_detail = $2,
             failed_at = COALESCE(failed_at, NOW()),
             last_provider_payload = COALESCE($3::jsonb, last_provider_payload),
             updated_at = NOW()
         WHERE id = $1`,
        [logId, toTrimmedString(errorMessage) || 'Send failed.', providerPayload ? JSON.stringify(providerPayload) : null]
    );
};

const sendTrackedWhatsAppTemplate = async ({
    gymId,
    memberId = null,
    broadcastLogId = null,
    initiatedBy = null,
    sourceKind = 'REMINDER',
    sourceLabel = '',
    integratedNumber,
    recipientNumber,
    recipientName = '',
    templateKey = '',
    templateTitle = '',
    templateName,
    templateLanguage = 'en_US',
    messagePreview = '',
    variables = {},
}) => {
    const log = await createDeliveryLog({
        gymId,
        memberId,
        broadcastLogId,
        initiatedBy,
        sourceKind,
        sourceLabel,
        templateKey,
        templateTitle,
        templateName,
        templateLanguage,
        integratedNumber,
        recipientNumber,
        recipientName,
        messagePreview,
    });

    try {
        const providerPayload = await sendWhatsAppTemplate({
            integratedNumber,
            templateName,
            language: templateLanguage || 'en_US',
            recipientNumber,
            variables,
            correlationId: log.msg91_crqid,
        });

        const acceptance = extractSendAcceptanceMeta(providerPayload);
        if (!acceptance.hasConfirmedReceipt) {
            const error = new Error(acceptance.statusDetail || 'MSG91 did not confirm this recipient send.');
            error.payload = providerPayload;
            throw error;
        }
        await updateDeliveryFromAcceptance({ logId: log.id, providerPayload, acceptance });

        return {
            logId: log.id,
            correlationId: log.msg91_crqid,
            providerPayload,
            acceptance,
        };
    } catch (err) {
        await markDeliverySendFailed({
            logId: log.id,
            errorMessage: err?.message || 'Send failed.',
            providerPayload: err?.payload || null,
        });
        throw err;
    }
};

const findLogForWebhookRecord = async (record) => {
    const lookupPairs = [
        { column: 'msg91_request_id', value: record.requestId },
        { column: 'msg91_message_uuid', value: record.messageUuid },
        { column: 'msg91_crqid', value: record.correlationId },
    ].filter((item) => item.value);

    for (const lookup of lookupPairs) {
        const result = await pool.query(
            `SELECT id, current_status
             FROM whatsapp_delivery_logs
             WHERE ${lookup.column} = $1
             ORDER BY updated_at DESC
             LIMIT 1`,
            [lookup.value]
        );
        if (result.rows.length > 0) return result.rows[0];
    }

    if (!record.integratedNumber || !record.recipientNumber) {
        return null;
    }

    const result = await pool.query(
        `SELECT id, current_status
         FROM whatsapp_delivery_logs
         WHERE integrated_number = $1
           AND recipient_number = $2
           AND ($3::text = '' OR LOWER(template_name) = LOWER($3))
           AND created_at >= NOW() - INTERVAL '14 days'
         ORDER BY created_at DESC
         LIMIT 1`,
        [record.integratedNumber, record.recipientNumber, toTrimmedString(record.templateName)]
    );

    return result.rows[0] || null;
};

const applyWebhookRecordToLog = async (logRow, record) => {
    const nextStatus = mergeDeliveryStatus(logRow?.current_status, record.normalizedStatus);
    const statusTimestamp = new Date();
    const submittedAtFallback = ['SUBMITTED', 'SENT', 'DELIVERED', 'READ'].includes(nextStatus) ? statusTimestamp : null;
    const sentAtFallback = ['SENT', 'DELIVERED', 'READ'].includes(nextStatus) ? statusTimestamp : null;
    const deliveredAtFallback = ['DELIVERED', 'READ'].includes(nextStatus) ? statusTimestamp : null;
    const readAtFallback = nextStatus === 'READ' ? statusTimestamp : null;
    const failedAtFallback = nextStatus === 'FAILED' ? statusTimestamp : null;
    await pool.query(
        `UPDATE whatsapp_delivery_logs
         SET msg91_request_id = COALESCE($2, msg91_request_id),
             msg91_message_uuid = COALESCE($3, msg91_message_uuid),
             msg91_crqid = COALESCE($4, msg91_crqid),
             provider_status = COALESCE(NULLIF($5, ''), provider_status),
             current_status = $6,
             status_detail = COALESCE(NULLIF($7, ''), status_detail),
             submitted_at = COALESCE($8::timestamptz, submitted_at, $15::timestamptz),
             sent_at = COALESCE($9::timestamptz, sent_at, $16::timestamptz),
             delivered_at = COALESCE($10::timestamptz, delivered_at, $17::timestamptz),
             read_at = COALESCE($11::timestamptz, read_at, $18::timestamptz),
             failed_at = COALESCE($12::timestamptz, failed_at, $19::timestamptz),
             template_language = COALESCE(NULLIF($13, ''), template_language),
             last_provider_payload = $14::jsonb,
             last_webhook_received_at = NOW(),
             webhook_count = COALESCE(webhook_count, 0) + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [
            logRow.id,
            record.requestId || null,
            record.messageUuid || null,
            record.correlationId || null,
            record.providerStatus || null,
            nextStatus,
            record.statusDetail || null,
            record.submittedAt,
            record.sentAt,
            record.deliveredAt,
            record.readAt,
            record.failedAt,
            record.templateLanguage || null,
            JSON.stringify(record.payload || {}),
            submittedAtFallback,
            sentAtFallback,
            deliveredAtFallback,
            readAtFallback,
            failedAtFallback,
        ]
    );
};

const appendLeadNotes = (currentValue, nextValue) => {
    const current = toTrimmedString(currentValue);
    const next = toTrimmedString(nextValue);
    if (!current) return truncateText(next, 2000);
    if (!next) return truncateText(current, 2000);

    const combined = `${current}\n\n${next}`;
    if (combined.length <= 2000) return combined;
    return combined.slice(combined.length - 2000);
};

const AUTOMATED_LEAD_THREAD_NOTE_PATTERN = /^(\[WhatsApp reply\b|WhatsApp thread active\.)/i;

const stripAutomatedLeadThreadNotes = (value) => String(value || '')
    .split(/\n\s*\n/)
    .map((part) => toTrimmedString(part))
    .filter(Boolean)
    .filter((part) => !AUTOMATED_LEAD_THREAD_NOTE_PATTERN.test(part))
    .join('\n\n');

const buildInboundReplySummaryNote = (record) => truncateText(
    `WhatsApp thread active. Latest reply: ${record?.messageText || 'Customer replied on WhatsApp.'}`,
    320
);

const findRecentOutboundContextForInbound = async (record) => {
    const integratedLocal = normalizeLocalIndianPhone(record?.integratedNumber);
    const senderLocal = normalizeLocalIndianPhone(record?.senderNumber);
    const replyMessageId = toTrimmedString(record?.replyMessageId);

    const mapOutboundContextRow = (row) => {
        if (!row) return null;

        return {
            gymId: Number(row.gym_id || 0) || null,
            memberId: Number(row.member_id || 0) || null,
            broadcastLogId: Number(row.broadcast_log_id || 0) || null,
            sourceKind: toTrimmedString(row.source_kind).toUpperCase(),
            sourceLabel: toTrimmedString(row.source_label),
            templateKey: toTrimmedString(row.template_key).toUpperCase(),
            templateTitle: toTrimmedString(row.template_title),
            fullName: truncateText(row.full_name, 120),
            email: toTrimmedString(row.email),
        };
    };

    if (replyMessageId) {
        const result = await pool.query(
            `SELECT
                l.gym_id,
                l.member_id,
                l.broadcast_log_id,
                l.source_kind,
                l.source_label,
                l.template_key,
                l.template_title,
                COALESCE(m.full_name, l.recipient_name, '') AS full_name,
                COALESCE(m.email, '') AS email
             FROM whatsapp_delivery_logs l
             LEFT JOIN members m ON m.id = l.member_id
             WHERE l.msg91_message_uuid = $1
             ORDER BY l.created_at DESC
             LIMIT 1`,
            [replyMessageId]
        );

        const replyMatch = mapOutboundContextRow(result.rows[0] || null);
        if (replyMatch) {
            return replyMatch;
        }
    }

    if (!senderLocal) return null;

    if (integratedLocal) {
        const result = await pool.query(
            `SELECT
                l.gym_id,
                l.member_id,
                l.broadcast_log_id,
                l.source_kind,
                l.source_label,
                l.template_key,
                l.template_title,
                COALESCE(m.full_name, l.recipient_name, '') AS full_name,
                COALESCE(m.email, '') AS email
             FROM whatsapp_delivery_logs l
             LEFT JOIN members m ON m.id = l.member_id
             WHERE RIGHT(REGEXP_REPLACE(COALESCE(l.integrated_number, ''), '\\D', '', 'g'), 10) = $1
               AND RIGHT(REGEXP_REPLACE(COALESCE(l.recipient_number, ''), '\\D', '', 'g'), 10) = $2
             ORDER BY l.created_at DESC
             LIMIT 1`,
            [integratedLocal, senderLocal]
        );

        const strictMatch = mapOutboundContextRow(result.rows[0] || null);
        if (strictMatch) {
            return strictMatch;
        }
    }

    const fallbackResult = await pool.query(
        `SELECT
            l.gym_id,
            l.member_id,
            l.broadcast_log_id,
            l.source_kind,
            l.source_label,
            l.template_key,
            l.template_title,
            COALESCE(m.full_name, l.recipient_name, '') AS full_name,
            COALESCE(m.email, '') AS email
         FROM whatsapp_delivery_logs l
         LEFT JOIN members m ON m.id = l.member_id
                 WHERE RIGHT(REGEXP_REPLACE(COALESCE(l.recipient_number, ''), '\D', '', 'g'), 10) = $1
                     AND l.created_at >= NOW() - INTERVAL '14 days'
         ORDER BY l.created_at DESC
         LIMIT 1`,
                [senderLocal]
    );

        return mapOutboundContextRow(fallbackResult.rows[0] || null);
};

const findGymByIntegratedNumber = async (integratedNumber) => {
    const integratedLocal = normalizeLocalIndianPhone(integratedNumber);
    if (!integratedLocal) return null;

    const result = await pool.query(
        `SELECT id, name
         FROM gyms
         WHERE RIGHT(REGEXP_REPLACE(COALESCE(messaging_whatsapp_number, ''), '\\D', '', 'g'), 10) = $1
         LIMIT 1`,
        [integratedLocal]
    );

    return result.rows[0] || null;
};

const findMemberByPhone = async (gymId, phone) => {
    const localPhone = normalizeLocalIndianPhone(phone);
    if (!gymId || !localPhone) return null;

    const result = await pool.query(
        `SELECT id, full_name, email
         FROM members
         WHERE gym_id = $1
           AND deleted_at IS NULL
           AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
         ORDER BY id DESC
         LIMIT 1`,
        [gymId, localPhone]
    );

    return result.rows[0] || null;
};

const resolveInboundReplyContext = async (record) => {
    const outboundContext = await findRecentOutboundContextForInbound(record);
    if (outboundContext?.gymId) {
        return outboundContext;
    }

    const gym = await findGymByIntegratedNumber(record?.integratedNumber);
    if (!gym?.id) return null;

    const member = await findMemberByPhone(gym.id, record?.senderNumber);

    return {
        gymId: Number(gym.id || 0) || null,
        memberId: Number(member?.id || 0) || null,
        broadcastLogId: null,
        sourceKind: 'INBOUND_REPLY',
        sourceLabel: 'WHATSAPP_REPLY',
        templateKey: '',
        templateTitle: '',
        fullName: truncateText(member?.full_name || record?.senderName || `WhatsApp Reply ${normalizeLocalIndianPhone(record?.senderNumber) || ''}`, 120),
        email: toTrimmedString(member?.email),
    };
};

const upsertLeadForInboundReply = async ({ record, context }) => {
    const gymId = Number(context?.gymId || 0) || null;
    const phone = normalizeLocalIndianPhone(record?.senderNumber);
    if (!gymId || !phone) return null;

    const existingLeadResult = await pool.query(
        `SELECT id, source, status, priority, notes
         FROM leads
         WHERE gym_id = $1
           AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
           AND status NOT IN ('WON', 'LOST')
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1`,
        [gymId, phone]
    );

    const existingLead = existingLeadResult.rows[0] || null;
    if (existingLead?.id) {
        const currentStatus = toTrimmedString(existingLead.status).toUpperCase();
        const nextStatus = currentStatus === 'TRIAL_BOOKED' ? 'TRIAL_BOOKED' : 'FOLLOW_UP';
        const preservedNotes = stripAutomatedLeadThreadNotes(existingLead.notes);
        const updatedLead = await pool.query(
            `UPDATE leads
             SET status = $1,
                 priority = 'HIGH',
                 source = CASE WHEN COALESCE(NULLIF(TRIM(source), ''), '') = '' THEN 'WhatsApp Reply' ELSE source END,
                 notes = $2,
                 next_follow_up_at = NOW(),
                 updated_at = NOW()
             WHERE id = $3
             RETURNING id`,
            [
                nextStatus,
                appendLeadNotes(preservedNotes, buildInboundReplySummaryNote(record)),
                existingLead.id,
            ]
        );

        return updatedLead.rows[0] || { id: existingLead.id };
    }

    const createdLead = await pool.query(
        `INSERT INTO leads (
            gym_id,
            full_name,
            phone,
            email,
            source,
            status,
            priority,
            notes,
            next_follow_up_at
         )
         VALUES ($1, $2, $3, $4, 'WhatsApp Reply', 'FOLLOW_UP', 'HIGH', $5, NOW())
         RETURNING id`,
        [
            gymId,
            truncateText(context?.fullName || record?.senderName || `WhatsApp Reply ${phone}`, 120),
            phone,
            toTrimmedString(context?.email),
            buildInboundReplySummaryNote(record),
        ]
    );

    return createdLead.rows[0] || null;
};

const createInboundReplyNotification = async ({ gymId, fullName, messageText }) => {
    if (!gymId) return;
    const title = 'New WhatsApp reply';
    const person = truncateText(fullName || 'A contact', 80);
    const preview = truncateText(messageText || 'Replied on WhatsApp.', 140);

    await pool.query(
        `INSERT INTO notifications (gym_id, title, message)
         VALUES ($1, $2, $3)`,
        [gymId, title, `${person} replied on WhatsApp: ${preview} Open Leads to follow up.`]
    );
};

const registerInboundReply = async (record) => {
    const context = await resolveInboundReplyContext(record);
    if (!context?.gymId) {
        return { created: false, reason: 'unknown_gym' };
    }

    const providerMessageKey = buildInboundProviderMessageKey(record);
    const insertedLog = await pool.query(
        `INSERT INTO whatsapp_inbound_logs (
            gym_id,
            member_id,
            integrated_number,
            sender_number,
            sender_name,
            message_text,
            provider_message_key,
            msg91_request_id,
            msg91_message_uuid,
            msg91_crqid,
            received_at,
            reply_context,
            last_provider_payload,
            updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, NOW())
         ON CONFLICT (provider_message_key) DO NOTHING
         RETURNING id`,
        [
            context.gymId,
            context.memberId || null,
            normalizeE164Phone(record.integratedNumber),
            normalizeE164Phone(record.senderNumber),
            truncateText(context.fullName || record.senderName, 120),
            truncateText(record.messageText, 1000),
            providerMessageKey,
            record.requestId || null,
            record.messageUuid || null,
            record.correlationId || null,
            record.receivedAt || new Date(),
            JSON.stringify({
                source_kind: context.sourceKind || 'INBOUND_REPLY',
                source_label: context.sourceLabel || 'WHATSAPP_REPLY',
                template_key: context.templateKey || '',
                template_title: context.templateTitle || '',
                broadcast_log_id: context.broadcastLogId || null,
            }),
            JSON.stringify(record.payload || {}),
        ]
    );

    const inboundLogId = insertedLog.rows[0]?.id;
    if (!inboundLogId) {
        return { created: false, reason: 'duplicate' };
    }

    const lead = await upsertLeadForInboundReply({ record, context });

    await pool.query(
        `UPDATE whatsapp_inbound_logs
         SET lead_id = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [inboundLogId, lead?.id || null]
    );

    await createInboundReplyNotification({
        gymId: context.gymId,
        fullName: context.fullName || record.senderName,
        messageText: record.messageText,
    });

    return {
        created: true,
        leadId: lead?.id || null,
    };
};

const applyWhatsAppDeliveryWebhook = async (payload) => {
    await ensureWhatsAppDeliverySchema();

    const records = buildWebhookRecords(payload);
    const inboundRecords = buildInboundWebhookRecords(payload);
    let matched = 0;
    let updated = 0;
    let ignored = 0;
    let inboundCreated = 0;
    let inboundIgnored = 0;

    for (const record of records) {
        const logRow = await findLogForWebhookRecord(record);
        if (!logRow) {
            ignored += 1;
            continue;
        }

        matched += 1;
        await applyWebhookRecordToLog(logRow, record);
        updated += 1;
    }

    for (const record of inboundRecords) {
        const result = await registerInboundReply(record);
        if (result.created) {
            inboundCreated += 1;
        } else {
            inboundIgnored += 1;
        }
    }

    return {
        received: records.length + inboundRecords.length,
        matched,
        updated,
        ignored,
        inbound_received: inboundRecords.length,
        inbound_created: inboundCreated,
        inbound_ignored: inboundIgnored,
    };
};

const getWhatsAppDeliverySummary = async (gymId) => {
    await repairStaleFailedDeliveryStatuses({ gymId, hours: 24 * 30 });

    const result = await pool.query(
        `SELECT
            COUNT(*)::INT AS total_count,
            COALESCE(SUM(CASE WHEN current_status IN ('QUEUED', 'SUBMITTED', 'SENT') THEN 1 ELSE 0 END), 0)::INT AS in_flight_count,
            COALESCE(SUM(CASE WHEN current_status = 'DELIVERED' THEN 1 ELSE 0 END), 0)::INT AS delivered_count,
            COALESCE(SUM(CASE WHEN current_status = 'READ' THEN 1 ELSE 0 END), 0)::INT AS read_count,
            COALESCE(SUM(CASE WHEN current_status = 'FAILED' THEN 1 ELSE 0 END), 0)::INT AS failed_count
         FROM whatsapp_delivery_logs
         WHERE gym_id = $1
           AND created_at >= NOW() - INTERVAL '30 days'`,
        [gymId]
    );

    return result.rows[0] || {
        total_count: 0,
        in_flight_count: 0,
        delivered_count: 0,
        read_count: 0,
        failed_count: 0,
    };
};

const getRecentWhatsAppDeliveryLogs = async (gymId, limit = 20) => {
    await repairStaleFailedDeliveryStatuses({ gymId, hours: 24 * 30 });

    const result = await pool.query(
        `SELECT
            id,
            source_kind,
            source_label,
            template_key,
            template_title,
            recipient_name,
            recipient_number,
            provider_status,
            current_status,
            status_detail,
            submitted_at,
            sent_at,
            delivered_at,
            read_at,
            failed_at,
            created_at,
            updated_at,
            msg91_request_id,
            msg91_message_uuid,
            msg91_crqid
         FROM whatsapp_delivery_logs
         WHERE gym_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [gymId, Math.max(1, Math.min(Number(limit) || 20, 50))]
    );

    return result.rows;
};

const getRecentMetaFailureLogs = async (gymId, { recipientNumbers = [], hours = DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS, limit = 100 } = {}) => {
    await repairStaleFailedDeliveryStatuses({ gymId, recipientNumbers, hours });

    const normalizedRecipients = Array.from(new Set(
        (Array.isArray(recipientNumbers) ? recipientNumbers : [recipientNumbers])
            .map((value) => normalizeE164Phone(value))
            .filter(Boolean)
    ));
    const safeHours = Math.max(1, Math.min(Number.parseInt(hours, 10) || DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS, 24 * 30));
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const params = [gymId, safeHours];
    let recipientFilterSql = '';

    if (normalizedRecipients.length > 0) {
        recipientFilterSql = `AND recipient_number = ANY($3::text[])`;
        params.push(normalizedRecipients);
    }

    params.push(safeLimit);
    const limitParam = `$${params.length}`;

    const result = await pool.query(
        `SELECT
            id,
            gym_id,
            member_id,
            source_kind,
            source_label,
            template_key,
            template_title,
            recipient_name,
            recipient_number,
            provider_status,
            status_detail,
            failed_at,
            updated_at,
            created_at,
            msg91_request_id,
            msg91_message_uuid,
            msg91_crqid,
            last_provider_payload
         FROM whatsapp_delivery_logs
         WHERE gym_id = $1
           AND current_status = 'FAILED'
           AND COALESCE(failed_at, updated_at, created_at) >= NOW() - ($2::int * INTERVAL '1 hour')
           ${recipientFilterSql}
           AND (
                COALESCE(provider_status, '') ILIKE '%meta%'
                OR COALESCE(status_detail, '') ILIKE '%meta%'
                OR COALESCE(status_detail, '') ~ '131[0-9]{3}'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%meta%'
                OR COALESCE(last_provider_payload::text, '') ~ '131[0-9]{3}'
                OR COALESCE(last_provider_payload::text, '') ILIKE '%healthy ecosystem%'
           )
         ORDER BY COALESCE(failed_at, updated_at, created_at) DESC
         LIMIT ${limitParam}`,
        params
    );

    return (result.rows || [])
        .filter((row) => looksLikeMetaFailure({
            providerStatus: row?.provider_status,
            statusDetail: row?.status_detail,
            payloadText: toTrimmedString(JSON.stringify(row?.last_provider_payload || {})),
        }))
        .map(mapMetaFailureRow);
};

const getRecentFailedDeliveryForMember = async (gymId, memberId, { hours = DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS } = {}) => {
    await repairStaleFailedDeliveryStatuses({ gymId, hours });

    const normalizedGymId = Number.parseInt(gymId, 10);
    const normalizedMemberId = Number.parseInt(memberId, 10);
    if (!Number.isInteger(normalizedGymId) || !Number.isInteger(normalizedMemberId)) {
        return null;
    }

    const safeHours = Math.max(1, Math.min(Number.parseInt(hours, 10) || DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS, 24 * 30));
    const result = await pool.query(
        `SELECT
            id,
            gym_id,
            member_id,
            source_kind,
            source_label,
            template_key,
            template_title,
            recipient_name,
            recipient_number,
            provider_status,
            status_detail,
            failed_at,
            updated_at,
            created_at,
            msg91_request_id,
            msg91_message_uuid,
            msg91_crqid,
            last_provider_payload
         FROM whatsapp_delivery_logs
         WHERE gym_id = $1
           AND member_id = $2
           AND current_status = 'FAILED'
           AND COALESCE(failed_at, updated_at, created_at) >= NOW() - ($3::int * INTERVAL '1 hour')
         ORDER BY COALESCE(failed_at, updated_at, created_at) DESC
         LIMIT 10`,
        [normalizedGymId, normalizedMemberId, safeHours]
    );

    const failures = (result.rows || []).map((row) => {
        const mapped = mapMetaFailureRow(row);
        const payloadText = toTrimmedString(JSON.stringify(row?.last_provider_payload || {}));
        const isMetaFailure = looksLikeMetaFailure({
            providerStatus: row?.provider_status,
            statusDetail: row?.status_detail,
            payloadText,
        });

        return {
            ...mapped,
            isMetaFailure,
        };
    });

    return failures.find((failure) => failure.isMetaFailure) || failures[0] || null;
};

const getRecentFailedDeliveryForMembers = async (gymId, memberIds = [], { hours = DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS } = {}) => {
    await repairStaleFailedDeliveryStatuses({ gymId, hours });

    const normalizedGymId = Number.parseInt(gymId, 10);
    const normalizedMemberIds = Array.from(new Set(
        (Array.isArray(memberIds) ? memberIds : [memberIds])
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (!Number.isInteger(normalizedGymId) || normalizedMemberIds.length === 0) {
        return new Map();
    }

    const safeHours = Math.max(1, Math.min(Number.parseInt(hours, 10) || DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS, 24 * 30));
    const result = await pool.query(
        `SELECT
            id,
            gym_id,
            member_id,
            source_kind,
            source_label,
            template_key,
            template_title,
            recipient_name,
            recipient_number,
            provider_status,
            status_detail,
            failed_at,
            updated_at,
            created_at,
            msg91_request_id,
            msg91_message_uuid,
            msg91_crqid,
            last_provider_payload
         FROM whatsapp_delivery_logs
         WHERE gym_id = $1
           AND member_id = ANY($2::int[])
           AND current_status = 'FAILED'
           AND COALESCE(failed_at, updated_at, created_at) >= NOW() - ($3::int * INTERVAL '1 hour')
         ORDER BY member_id ASC, COALESCE(failed_at, updated_at, created_at) DESC, id DESC`,
        [normalizedGymId, normalizedMemberIds, safeHours]
    );

    const latestByMemberId = new Map();
    (result.rows || []).forEach((row) => {
        const normalizedMemberId = Number.parseInt(row?.member_id, 10);
        if (!Number.isInteger(normalizedMemberId) || latestByMemberId.has(normalizedMemberId)) {
            return;
        }

        const mapped = mapMetaFailureRow(row);
        const payloadText = toTrimmedString(JSON.stringify(row?.last_provider_payload || {}));
        latestByMemberId.set(normalizedMemberId, {
            ...mapped,
            isMetaFailure: looksLikeMetaFailure({
                providerStatus: row?.provider_status,
                statusDetail: row?.status_detail,
                payloadText,
            }),
        });
    });

    return latestByMemberId;
};

const getRecentMetaSuppressionRecipients = async (gymId, recipientNumbers = [], cooldownHours = DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS) => {
    const normalizedRecipients = Array.from(new Set(
        (Array.isArray(recipientNumbers) ? recipientNumbers : [recipientNumbers])
            .map((value) => normalizeE164Phone(value))
            .filter(Boolean)
    ));

    if (!gymId || normalizedRecipients.length === 0) {
        return new Map();
    }

    const safeCooldownHours = Math.max(1, Math.min(Number.parseInt(cooldownHours, 10) || DEFAULT_META_SUPPRESSION_COOLDOWN_HOURS, 168));
    const failures = await getRecentMetaFailureLogs(gymId, {
        recipientNumbers: normalizedRecipients,
        hours: safeCooldownHours,
        limit: Math.max(20, normalizedRecipients.length * 4),
    });

    const latestByRecipient = new Map();
    failures.forEach((failure) => {
        if (!failure.recipientNumber || latestByRecipient.has(failure.recipientNumber)) {
            return;
        }
        latestByRecipient.set(failure.recipientNumber, failure);
    });

    return new Map(
        Array.from(latestByRecipient.values()).map((failure) => {
            const normalizedRecipientNumber = normalizeE164Phone(failure.recipientNumber);
            return [
                normalizedRecipientNumber,
                {
                    recipientNumber: normalizedRecipientNumber,
                    failureCode: failure.failureCode || META_HEALTHY_ECOSYSTEM_FAILURE_CODE,
                    providerStatus: failure.providerStatus || '',
                    statusDetail: failure.statusDetail || '',
                    lastFailedAt: failure.failedAt || null,
                    cooldownHours: safeCooldownHours,
                },
            ];
        })
    );
};

module.exports = {
    MSG91_WHATSAPP_WEBHOOK_DOC_URL,
    ensureWhatsAppDeliverySchema,
    extractSendAcceptanceMeta,
    getRecentFailedDeliveryForMember,
    getRecentFailedDeliveryForMembers,
    getRecentMetaFailureLogs,
    getRecentMetaSuppressionRecipients,
    getRecentWhatsAppDeliveryLogs,
    getWhatsAppDeliverySummary,
    normalizeDeliveryStatus,
    normalizeWebhookToken,
    sendTrackedWhatsAppTemplate,
    applyWhatsAppDeliveryWebhook,
};