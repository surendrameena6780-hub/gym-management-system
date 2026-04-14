const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const {
    ensureTrimmedString,
    ensureEmail,
    ensurePhone10,
    ensureInteger,
    ensureTimestamp,
    isValidationError,
} = require('../utils/fieldValidation');
const {
    computeEffectiveBillingLimits,
    getBillingConfig,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
} = require('../utils/platformSettings');
const { DEFAULT_BRANCH_ID, resolveBranchReadScope, resolveBranchWriteScope } = require('../utils/branchAccess');
const { buildTemplateBodyVariables, normalizeLocalIndianPhone } = require('../utils/msg91');
const { ensureWhatsAppDeliverySchema, sendTrackedWhatsAppTemplate } = require('../utils/whatsappDelivery');

const LEAD_REPLY_TEMPLATE = {
    template_key: 'LEAD_REPLY',
    title: 'Lead Chat Reply',
    whatsapp_text: 'Hi {{name}}, {{message}} Reply here if you want the team at {{gym_name}} to continue helping you.',
    sms_text: 'Hi {{name}}, {{message}} Reply here if you need help from {{gym_name}}.',
    whatsapp_template_language: 'en_US',
    whatsapp_template_category: 'UTILITY',
};

let ensureLeadMessagingSchemaPromise;

const getGymIdFromRequest = (req) => {
    const rawGymId = req?.user?.gym_id ?? req?.user?.gymId;
    const gymId = Number.parseInt(rawGymId, 10);
    return Number.isInteger(gymId) ? gymId : null;
};

const normalizeLeadPhoneForLookup = (value) => {
    const normalized = normalizeLocalIndianPhone(value);
    if (normalized) return normalized;
    return String(value || '').replace(/\D/g, '').slice(-10);
};

const normalizeTemplateStatus = (value) => String(value || '').trim().toUpperCase();

const ensureLeadMessagingSchema = async () => {
    if (!ensureLeadMessagingSchemaPromise) {
        ensureLeadMessagingSchemaPromise = (async () => {
            await pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_number VARCHAR(30),
                ADD COLUMN IF NOT EXISTS messaging_whatsapp_status VARCHAR(30) DEFAULT 'NOT_CONFIGURED';
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS gym_message_templates (
                    id SERIAL PRIMARY KEY,
                    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                    template_key VARCHAR(60) NOT NULL,
                    title VARCHAR(120) NOT NULL,
                    whatsapp_text TEXT NOT NULL DEFAULT '',
                    sms_text TEXT NOT NULL DEFAULT '',
                    whatsapp_template_name VARCHAR(180),
                    whatsapp_template_language VARCHAR(20) DEFAULT 'en_US',
                    whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_CREATED',
                    whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY',
                    last_synced_at TIMESTAMPTZ,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (gym_id, template_key)
                );
            `);

            await pool.query(`
                ALTER TABLE gym_message_templates
                ADD COLUMN IF NOT EXISTS whatsapp_text TEXT NOT NULL DEFAULT '',
                ADD COLUMN IF NOT EXISTS sms_text TEXT NOT NULL DEFAULT '',
                ADD COLUMN IF NOT EXISTS whatsapp_template_name VARCHAR(180),
                ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(20) DEFAULT 'en_US',
                ADD COLUMN IF NOT EXISTS whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_CREATED',
                ADD COLUMN IF NOT EXISTS whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY',
                ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
            `);
        })();
    }

    await ensureLeadMessagingSchemaPromise;
};

const seedLeadReplyTemplate = async (gymId) => {
    if (!gymId) return;

    await pool.query(
        `INSERT INTO gym_message_templates (
            gym_id,
            template_key,
            title,
            whatsapp_text,
            sms_text,
            whatsapp_template_language,
            whatsapp_template_category,
            is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (gym_id, template_key) DO NOTHING`,
        [
            gymId,
            LEAD_REPLY_TEMPLATE.template_key,
            LEAD_REPLY_TEMPLATE.title,
            LEAD_REPLY_TEMPLATE.whatsapp_text,
            LEAD_REPLY_TEMPLATE.sms_text,
            LEAD_REPLY_TEMPLATE.whatsapp_template_language,
            LEAD_REPLY_TEMPLATE.whatsapp_template_category,
        ]
    );
};

const renderLeadTemplatePreview = (templateText, lead = {}, gymName = '', replyText = '') => {
    const firstName = String(lead?.full_name || '').trim().split(/\s+/).filter(Boolean)[0] || 'there';
    const values = {
        name: String(lead?.full_name || firstName || 'Member').trim() || 'Member',
        member_name: String(lead?.full_name || firstName || 'Member').trim() || 'Member',
        customer_name: String(lead?.full_name || firstName || 'Member').trim() || 'Member',
        gym_name: String(gymName || 'GymVault').trim() || 'GymVault',
        message: String(replyText || 'we would be happy to help you with the next step.').trim(),
        reply: String(replyText || 'we would be happy to help you with the next step.').trim(),
        reply_text: String(replyText || 'we would be happy to help you with the next step.').trim(),
    };

    return String(templateText || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_token, placeholder) => {
        const key = String(placeholder || '').trim().toLowerCase();
        return values[key] || key.replace(/_/g, ' ');
    });
};

const loadLeadById = async (gymId, leadId) => {
    const result = await pool.query(
        `SELECT *
         FROM leads
         WHERE id = $1 AND gym_id = $2
         LIMIT 1`,
        [leadId, gymId]
    );

    return result.rows[0] || null;
};

const loadLeadChatSetup = async (gymId) => {
    await Promise.all([ensureLeadMessagingSchema(), ensureWhatsAppDeliverySchema()]);
    await seedLeadReplyTemplate(gymId);

    const [gymResult, templateResult] = await Promise.all([
        pool.query(
            `SELECT id, name, messaging_whatsapp_number, messaging_whatsapp_status
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
                whatsapp_template_status,
                whatsapp_template_category,
                is_active
             FROM gym_message_templates
             WHERE gym_id = $1
               AND COALESCE(is_active, TRUE) = TRUE
             ORDER BY CASE WHEN template_key = $2 THEN 0 ELSE 1 END, title ASC`,
            [gymId, LEAD_REPLY_TEMPLATE.template_key]
        ),
    ]);

    const gym = gymResult.rows[0] || null;
    const templates = templateResult.rows.map((row) => ({
        template_key: String(row.template_key || '').trim().toUpperCase(),
        title: String(row.title || '').trim(),
        whatsapp_text: String(row.whatsapp_text || '').trim(),
        sms_text: String(row.sms_text || '').trim(),
        whatsapp_template_name: String(row.whatsapp_template_name || '').trim(),
        whatsapp_template_language: String(row.whatsapp_template_language || 'en_US').trim() || 'en_US',
        whatsapp_template_status: normalizeTemplateStatus(row.whatsapp_template_status),
        whatsapp_template_category: String(row.whatsapp_template_category || 'UTILITY').trim().toUpperCase() || 'UTILITY',
    }));
    const approvedTemplates = templates.filter((template) => template.whatsapp_template_status === 'APPROVED' && template.whatsapp_template_name);
    const leadReplyTemplate = templates.find((template) => template.template_key === LEAD_REPLY_TEMPLATE.template_key) || null;
    const preferredTemplate = approvedTemplates.find((template) => template.template_key === LEAD_REPLY_TEMPLATE.template_key) || approvedTemplates[0] || null;

    return {
        gym,
        templates,
        approvedTemplates,
        leadReplyTemplate,
        preferredTemplate,
        whatsappConnected: normalizeTemplateStatus(gym?.messaging_whatsapp_status) === 'CONNECTED' && Boolean(String(gym?.messaging_whatsapp_number || '').trim()),
    };
};

const loadLeadConversation = async ({ gymId, leadId, phone }) => {
    const normalizedPhone = normalizeLeadPhoneForLookup(phone);
    if (!gymId || !normalizedPhone) return [];

    const result = await pool.query(
        `SELECT *
         FROM (
            SELECT
                CONCAT('outbound-', id) AS id,
                'OUTBOUND' AS direction,
                COALESCE(message_preview, '') AS message_text,
                COALESCE(current_status, provider_status, 'SUBMITTED') AS delivery_status,
                COALESCE(read_at, delivered_at, sent_at, submitted_at, failed_at, created_at) AS occurred_at,
                COALESCE(template_title, template_key, 'WhatsApp message') AS template_title,
                COALESCE(source_kind, 'LEAD_CHAT') AS source_kind
            FROM whatsapp_delivery_logs
            WHERE gym_id = $1
                            AND source_kind = 'LEAD_CHAT'
              AND RIGHT(REGEXP_REPLACE(COALESCE(recipient_number, ''), '\\D', '', 'g'), 10) = $2

            UNION ALL

            SELECT
                CONCAT('inbound-', id) AS id,
                'INBOUND' AS direction,
                COALESCE(message_text, '') AS message_text,
                'RECEIVED' AS delivery_status,
                COALESCE(received_at, created_at) AS occurred_at,
                'Member reply' AS template_title,
                'INBOUND_REPLY' AS source_kind
            FROM whatsapp_inbound_logs
            WHERE gym_id = $1
              AND (
                    lead_id = $3
                    OR RIGHT(REGEXP_REPLACE(COALESCE(sender_number, ''), '\\D', '', 'g'), 10) = $2
                  )
         ) conversation
         ORDER BY occurred_at ASC NULLS LAST, id ASC`,
        [gymId, normalizedPhone, leadId]
    );

    return result.rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        message_text: String(row.message_text || '').trim(),
        delivery_status: normalizeTemplateStatus(row.delivery_status || 'SUBMITTED') || 'SUBMITTED',
        occurred_at: row.occurred_at,
        template_title: String(row.template_title || '').trim(),
        source_kind: String(row.source_kind || '').trim(),
    }));
};

const normalizeLeadPayload = (payload = {}) => {
    return {
        full_name: ensureTrimmedString(payload.full_name, { field: 'full_name', required: true, min: 2, max: 100 }),
        phone: ensurePhone10(payload.phone, { field: 'phone', required: true }),
        email: ensureEmail(payload.email, { field: 'email', max: 120 }),
        source: ensureTrimmedString(payload.source, { field: 'source', max: 60, defaultValue: 'Walk-in' }) || 'Walk-in',
        status: ensureTrimmedString(payload.status, { field: 'status', max: 40, defaultValue: 'NEW', uppercase: true }) || 'NEW',
        priority: ensureTrimmedString(payload.priority, { field: 'priority', max: 40, defaultValue: 'MEDIUM', uppercase: true }) || 'MEDIUM',
        notes: ensureTrimmedString(payload.notes, { field: 'notes', max: 2000 }),
        lost_reason: ensureTrimmedString(payload.lost_reason, { field: 'lost_reason', max: 500 }),
        next_follow_up_at: ensureTimestamp(payload.next_follow_up_at, { field: 'next_follow_up_at' }),
        trial_date: ensureTimestamp(payload.trial_date, { field: 'trial_date' }),
        mark_contacted: Boolean(payload.mark_contacted),
    };
};

router.use(auth, saasMiddleware);

router.get('/summary', requirePermission('members:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const scope = await resolveBranchReadScope(pool, req);
        const queryParams = [gymId];
        let branchFilter = '';
        if (scope.branchId) {
            queryParams.push(scope.branchId);
            branchFilter = ` AND branch_id = $${queryParams.length}`;
        }
        const result = await pool.query(
            `SELECT
                COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('WON', 'LOST'))::INTEGER AS open_leads,
                COUNT(*) FILTER (WHERE status = 'NEW')::INTEGER AS new_leads,
                COUNT(*) FILTER (
                    WHERE status IN ('NEW', 'CONTACTED', 'FOLLOW_UP', 'TRIAL_BOOKED')
                      AND next_follow_up_at IS NOT NULL
                      AND next_follow_up_at::date <= CURRENT_DATE
                )::INTEGER AS follow_ups_due,
                COUNT(*) FILTER (WHERE trial_date IS NOT NULL AND trial_date::date = CURRENT_DATE)::INTEGER AS trials_today,
                COUNT(*) FILTER (WHERE status = 'TRIAL_BOOKED')::INTEGER AS trial_booked,
                COUNT(*) FILTER (
                    WHERE status = 'WON'
                      AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', CURRENT_DATE)
                )::INTEGER AS converted_this_month,
                COUNT(*) FILTER (WHERE status = 'LOST')::INTEGER AS lost_leads
             FROM leads
             WHERE gym_id = $1${branchFilter}`,
            queryParams
        );

        return res.json(result.rows[0] || {});
    } catch (err) {
        console.error('LEADS SUMMARY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load leads summary.' });
    }
});

router.get('/', requirePermission('members:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const scope = await resolveBranchReadScope(pool, req);
        const search = String(req.query.search || '').trim();
        const status = String(req.query.status || '').trim().toUpperCase();
        const paginate = String(req.query.paginate || '').toLowerCase() === 'true' || req.query.page !== undefined || req.query.limit !== undefined;
        const page = Math.max(Number.parseInt(req.query.page || '1', 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 200);
        const offset = (page - 1) * limit;
        const queryParams = [gymId];
        let whereClause = 'WHERE l.gym_id = $1';

        if (scope.branchId) {
            queryParams.push(scope.branchId);
            whereClause += ` AND l.branch_id = $${queryParams.length}`;
        }

        if (search) {
            queryParams.push(`%${search}%`);
            whereClause += ` AND (l.full_name ILIKE $${queryParams.length} OR l.phone ILIKE $${queryParams.length} OR l.email ILIKE $${queryParams.length})`;
        }

        if (status && status !== 'ALL') {
            queryParams.push(status);
            whereClause += ` AND l.status = $${queryParams.length}`;
        }

        const result = await pool.query(
            `SELECT
                l.*,
                u.full_name AS assigned_to_name,
                m.full_name AS converted_member_name
             FROM leads l
             LEFT JOIN users u ON u.id = l.assigned_to
             LEFT JOIN members m ON m.id = l.converted_member_id
             ${whereClause}
             ORDER BY
                CASE WHEN l.status IN ('WON', 'LOST') THEN 1 ELSE 0 END ASC,
                CASE
                    WHEN l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at::date <= CURRENT_DATE THEN 0
                    ELSE 1
                END ASC,
                l.next_follow_up_at ASC NULLS LAST,
                l.created_at DESC
                ${paginate ? `LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}` : ''}`,
            paginate ? [...queryParams, limit, offset] : queryParams
        );

        if (!paginate) {
            return res.json(result.rows);
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM leads l
             ${whereClause}`,
            queryParams
        );

        const total = Number(countResult.rows[0]?.total || 0);

        return res.json({
            items: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                hasNext: page * limit < total,
                hasPrev: page > 1,
            },
        });
    } catch (err) {
        console.error('LEADS LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load leads.' });
    }
});

router.get('/:id/chat', requirePermission('members:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });
        const lead = await loadLeadById(gymId, leadId);

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found.' });
        }

        const chatSetup = await loadLeadChatSetup(gymId);
        const conversation = await loadLeadConversation({ gymId, leadId, phone: lead.phone });

        return res.json({
            lead,
            conversation,
            messaging: {
                whatsapp_connected: chatSetup.whatsappConnected,
                whatsapp_number: String(chatSetup.gym?.messaging_whatsapp_number || '').trim(),
                preferred_template_key: chatSetup.preferredTemplate?.template_key || '',
                lead_reply_ready: chatSetup.leadReplyTemplate?.whatsapp_template_status === 'APPROVED' && Boolean(chatSetup.leadReplyTemplate?.whatsapp_template_name),
                lead_reply_template: chatSetup.leadReplyTemplate ? {
                    template_key: chatSetup.leadReplyTemplate.template_key,
                    title: chatSetup.leadReplyTemplate.title,
                    whatsapp_template_name: chatSetup.leadReplyTemplate.whatsapp_template_name,
                    whatsapp_template_status: chatSetup.leadReplyTemplate.whatsapp_template_status,
                    preview_text: renderLeadTemplatePreview(chatSetup.leadReplyTemplate.whatsapp_text, lead, chatSetup.gym?.name || ''),
                } : null,
                approved_templates: chatSetup.approvedTemplates.map((template) => ({
                    template_key: template.template_key,
                    title: template.title,
                    whatsapp_template_name: template.whatsapp_template_name,
                    whatsapp_template_status: template.whatsapp_template_status,
                    preview_text: renderLeadTemplatePreview(template.whatsapp_text, lead, chatSetup.gym?.name || ''),
                })),
            },
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD CHAT LOAD ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load lead chat.' });
    }
});

router.post('/:id/chat/messages', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });
        const lead = await loadLeadById(gymId, leadId);

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found.' });
        }

        const requestedTemplateKey = ensureTrimmedString(req.body?.template_key, {
            field: 'template_key',
            max: 60,
            uppercase: true,
        });
        const replyText = ensureTrimmedString(req.body?.message, {
            field: 'message',
            max: 700,
        });
        const chatSetup = await loadLeadChatSetup(gymId);

        if (!chatSetup.whatsappConnected) {
            return res.status(409).json({ error: 'Connect your GymVault WhatsApp business number first to send replies from Leads.' });
        }

        const selectedTemplate = requestedTemplateKey
            ? chatSetup.approvedTemplates.find((template) => template.template_key === requestedTemplateKey)
            : (chatSetup.preferredTemplate || null);

        if (!selectedTemplate) {
            return res.status(409).json({ error: 'No approved WhatsApp template is ready for lead chat yet. Approve a template in Settings and try again.' });
        }

        if (selectedTemplate.template_key === LEAD_REPLY_TEMPLATE.template_key && !replyText) {
            return res.status(400).json({ error: 'Enter a reply message before sending.' });
        }

        const messagePreview = renderLeadTemplatePreview(selectedTemplate.whatsapp_text, lead, chatSetup.gym?.name || '', replyText);
        const variables = buildTemplateBodyVariables(
            selectedTemplate.whatsapp_text,
            {
                full_name: lead.full_name,
                plan_name: 'your plan',
                days_to_expiry: 0,
            },
            chatSetup.gym?.name || '',
            { message: replyText }
        );

        const delivery = await sendTrackedWhatsAppTemplate({
            gymId,
            memberId: lead.converted_member_id || null,
            initiatedBy: req.user?.id || null,
            sourceKind: 'LEAD_CHAT',
            sourceLabel: `Lead ${lead.id}`,
            integratedNumber: chatSetup.gym.messaging_whatsapp_number,
            recipientNumber: lead.phone,
            recipientName: lead.full_name,
            templateKey: selectedTemplate.template_key,
            templateTitle: selectedTemplate.title,
            templateName: selectedTemplate.whatsapp_template_name,
            templateLanguage: selectedTemplate.whatsapp_template_language,
            messagePreview,
            variables,
        });

        await pool.query(
            `UPDATE leads
             SET last_contacted_at = NOW(),
                 status = CASE WHEN status = 'NEW' THEN 'CONTACTED' ELSE status END,
                 updated_at = NOW()
             WHERE id = $1 AND gym_id = $2`,
            [leadId, gymId]
        );

        const conversation = await loadLeadConversation({ gymId, leadId, phone: lead.phone });

        return res.status(201).json({
            ok: true,
            delivery: {
                log_id: delivery.logId,
                correlation_id: delivery.correlationId,
                status: normalizeTemplateStatus(delivery.acceptance?.status || 'SUBMITTED') || 'SUBMITTED',
            },
            conversation,
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD CHAT SEND ERROR:', err.message);
        return res.status(500).json({ error: err.message || 'Failed to send WhatsApp reply.' });
    }
});

router.post('/', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const scope = await resolveBranchWriteScope(pool, req);
        const payload = normalizeLeadPayload(req.body || {});

        const result = await pool.query(
            `INSERT INTO leads (
                gym_id, full_name, phone, email, source, status, priority,
                notes, next_follow_up_at, trial_date, last_contacted_at, lost_reason, branch_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING *`,
            [
                gymId,
                payload.full_name,
                payload.phone,
                payload.email,
                payload.source,
                payload.status,
                payload.priority,
                payload.notes,
                payload.next_follow_up_at,
                payload.trial_date,
                payload.mark_contacted ? new Date().toISOString() : null,
                payload.lost_reason,
                scope.branchId || scope.defaultBranchId,
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to create lead.' });
    }
});

router.put('/:id', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });
        const payload = normalizeLeadPayload(req.body || {});

        const result = await pool.query(
            `UPDATE leads
             SET full_name = $1,
                 phone = $2,
                 email = $3,
                 source = $4,
                 status = $5,
                 priority = $6,
                 notes = $7,
                 next_follow_up_at = $8,
                 trial_date = $9,
                 last_contacted_at = CASE WHEN $10 THEN NOW() ELSE last_contacted_at END,
                 lost_reason = $11,
                 updated_at = NOW()
             WHERE id = $12 AND gym_id = $13
             RETURNING *`,
            [
                payload.full_name,
                payload.phone,
                payload.email,
                payload.source,
                payload.status,
                payload.priority,
                payload.notes,
                payload.next_follow_up_at,
                payload.trial_date,
                payload.mark_contacted,
                payload.lost_reason,
                leadId,
                gymId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found.' });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to update lead.' });
    }
});

router.post('/:id/convert', requirePermission('members:write'), async (req, res) => {
    const gymId = getGymIdFromRequest(req);
    let leadId;

    try {
        leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        throw err;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const leadResult = await client.query(
            `SELECT *
             FROM leads
             WHERE id = $1 AND gym_id = $2
             FOR UPDATE`,
            [leadId, gymId]
        );

        if (leadResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Lead not found.' });
        }

        const lead = leadResult.rows[0];
        const normalizedEmail = String(lead.email || '').trim().toLowerCase();
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead-convert:${gymId}:${lead.phone}:${normalizedEmail}`]);

        if (lead.converted_member_id) {
            const existingMember = await client.query(
                'SELECT * FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [lead.converted_member_id, gymId]
            );
            await client.query('COMMIT');
            return res.json({
                lead,
                member: existingMember.rows[0] || null,
                created_new_member: false,
            });
        }

        const memberLookup = await client.query(
            `SELECT *
             FROM members
             WHERE gym_id = $1
               AND deleted_at IS NULL
               AND (phone = $2 OR ($3 <> '' AND lower(email) = $3))
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [gymId, lead.phone, normalizedEmail]
        );

        let member = memberLookup.rows[0] || null;
        let createdNewMember = false;

        if (!member) {
            const targetBranchId = String(lead.branch_id || DEFAULT_BRANCH_ID);
            const [billingConfig, gymBilling, usageSnapshot] = await Promise.all([
                getBillingConfig(),
                getGymBillingSnapshot(client, gymId),
                getGymUsageSnapshot(client, gymId),
            ]);
            if (!gymBilling) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Gym not found.' });
            }

            const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymBilling.current_plan, gymBilling);
            if (effectiveLimits.members !== null && Number(usageSnapshot.members || 0) + 1 > effectiveLimits.members) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: `Your current plan allows up to ${effectiveLimits.members} members across your gym including add-ons. Delete an expired or unpaid member, or add more member capacity before converting this lead.`,
                    allowed_members: effectiveLimits.members,
                    current_members: Number(usageSnapshot.members || 0),
                });
            }

            const createdMember = await client.query(
                `INSERT INTO members (gym_id, full_name, phone, email, joining_date, status, branch_id)
                 VALUES ($1, $2, $3, $4, CURRENT_DATE, 'UNPAID', $5)
                 RETURNING *`,
                [gymId, lead.full_name, lead.phone, lead.email || null, targetBranchId]
            );
            member = createdMember.rows[0];
            createdNewMember = true;
        }

        const updatedLead = await client.query(
            `UPDATE leads
             SET status = 'WON',
                 converted_member_id = $1,
                 last_contacted_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2 AND gym_id = $3
             RETURNING *`,
            [member.id, leadId, gymId]
        );

        await client.query('COMMIT');
        return res.json({
            lead: updatedLead.rows[0],
            member,
            created_new_member: createdNewMember,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('LEAD CONVERT ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to convert lead.' });
    } finally {
        client.release();
    }
});

router.delete('/:id', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });

        const result = await pool.query(
            'DELETE FROM leads WHERE id = $1 AND gym_id = $2 RETURNING id',
            [leadId, gymId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found.' });
        }

        return res.json({ message: 'Lead deleted.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to delete lead.' });
    }
});

module.exports = router;