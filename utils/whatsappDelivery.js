const crypto = require('crypto');
const { pool } = require('../config/db');
const {
    normalizeCountryCodePhone,
    normalizeE164Phone,
    normalizeLocalIndianPhone,
    sendWhatsAppTemplate,
} = require('./msg91');

const MSG91_WHATSAPP_WEBHOOK_DOC_URL = 'https://msg91.com/help/whatsapp/how-to-get-reports-of-whatsapp-messages-on-webhook';
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

const normalizeWebhookToken = () => toTrimmedString(process.env.MSG91_WHATSAPP_WEBHOOK_TOKEN);

const createCorrelationId = () => `gvwa_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

const pickFirstPrimitiveByKeys = (value, keys, seen = new Set()) => {
    if (value === null || value === undefined) return '';
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
    if (incoming === 'FAILED' && ['DELIVERED', 'READ'].includes(current)) return current;

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

    return {
        requestId,
        messageUuid,
        correlationId,
        providerStatus,
        normalizedStatus: providerStatus ? normalizeDeliveryStatus(providerStatus) : 'QUEUED',
        statusDetail: buildStatusDetail(payload),
    };
};

const buildWebhookRecords = (payload) => {
    const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.messages)
                ? payload.messages
                : Array.isArray(payload?.results)
                    ? payload.results
                    : [payload];

    return candidates
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
            const providerStatus = toTrimmedString(item.status || item.delivery_status || item.event_type || item.eventType);
            return {
                requestId: toTrimmedString(item.request_id || item.requestId || item.requestid),
                messageUuid: toTrimmedString(item.message_uuid || item.messageUuid || item.messageuuid),
                correlationId: toTrimmedString(item.CRQID || item.crqid || item.correlation_id || item.correlationId),
                providerStatus,
                normalizedStatus: normalizeDeliveryStatus(providerStatus),
                integratedNumber: normalizeE164Phone(item.integrated_number || item.integratedNumber || item.number),
                recipientNumber: normalizeE164Phone(item.customer_number || item.customerNumber || item.to || item.recipient || item.phone),
                templateName: toTrimmedString(item.template_name || item.templateName),
                templateLanguage: toTrimmedString(item.template_language || item.templateLanguage),
                direction: toTrimmedString(item.direction || item.message_direction || item.messageDirection).toLowerCase(),
                statusDetail: buildStatusDetail(item),
                submittedAt: parseProviderTimestamp(item.submitted_at || item.submittedAt),
                sentAt: parseProviderTimestamp(item.sent_at || item.sentAt),
                deliveredAt: parseProviderTimestamp(item.delivered_at || item.deliveredAt),
                readAt: parseProviderTimestamp(item.read_at || item.readAt),
                failedAt: parseProviderTimestamp(item.failed_at || item.failedAt),
                payload: item,
            };
        })
        .filter((item) => item.direction !== 'inbound')
        .filter((item) => item.requestId || item.messageUuid || item.correlationId || item.recipientNumber || item.providerStatus);
};

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
    await pool.query(
        `UPDATE whatsapp_delivery_logs
         SET msg91_request_id = COALESCE($2, msg91_request_id),
             msg91_message_uuid = COALESCE($3, msg91_message_uuid),
             provider_status = COALESCE(NULLIF($4, ''), provider_status),
             current_status = $5,
             status_detail = COALESCE(NULLIF($6, ''), status_detail),
             submitted_at = COALESCE(submitted_at, CASE WHEN $5 IN ('SUBMITTED', 'SENT', 'DELIVERED', 'READ') THEN NOW() ELSE NULL END),
             sent_at = COALESCE(sent_at, CASE WHEN $5 IN ('SENT', 'DELIVERED', 'READ') THEN NOW() ELSE NULL END),
             last_provider_payload = $7::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
            logId,
            toTrimmedString(acceptance?.requestId) || null,
            toTrimmedString(acceptance?.messageUuid) || null,
            toTrimmedString(acceptance?.providerStatus) || null,
            status,
            toTrimmedString(acceptance?.statusDetail) || null,
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
    await pool.query(
        `UPDATE whatsapp_delivery_logs
         SET msg91_request_id = COALESCE($2, msg91_request_id),
             msg91_message_uuid = COALESCE($3, msg91_message_uuid),
             msg91_crqid = COALESCE($4, msg91_crqid),
             provider_status = COALESCE(NULLIF($5, ''), provider_status),
             current_status = $6,
             status_detail = COALESCE(NULLIF($7, ''), status_detail),
             submitted_at = COALESCE($8, submitted_at),
             sent_at = COALESCE($9, sent_at, CASE WHEN $6 IN ('SENT', 'DELIVERED', 'READ') THEN NOW() ELSE NULL END),
             delivered_at = COALESCE($10, delivered_at, CASE WHEN $6 IN ('DELIVERED', 'READ') THEN NOW() ELSE NULL END),
             read_at = COALESCE($11, read_at, CASE WHEN $6 = 'READ' THEN NOW() ELSE NULL END),
             failed_at = COALESCE($12, failed_at, CASE WHEN $6 = 'FAILED' THEN NOW() ELSE NULL END),
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
        ]
    );
};

const applyWhatsAppDeliveryWebhook = async (payload) => {
    await ensureWhatsAppDeliverySchema();

    const records = buildWebhookRecords(payload);
    let matched = 0;
    let updated = 0;
    let ignored = 0;

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

    return {
        received: records.length,
        matched,
        updated,
        ignored,
    };
};

const getWhatsAppDeliverySummary = async (gymId) => {
    await ensureWhatsAppDeliverySchema();

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
    await ensureWhatsAppDeliverySchema();

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

module.exports = {
    MSG91_WHATSAPP_WEBHOOK_DOC_URL,
    ensureWhatsAppDeliverySchema,
    extractSendAcceptanceMeta,
    getRecentWhatsAppDeliveryLogs,
    getWhatsAppDeliverySummary,
    normalizeDeliveryStatus,
    normalizeWebhookToken,
    sendTrackedWhatsAppTemplate,
    applyWhatsAppDeliveryWebhook,
};