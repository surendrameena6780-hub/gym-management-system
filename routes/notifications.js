const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { hasPermission, requireOwner } = require('../middleware/rbac');
const { ok, fail } = require('../utils/apiResponse');
const {
    buildTemplateBodyVariables,
    normalizeLocalIndianPhone,
} = require('../utils/msg91');
const { sendTrackedWhatsAppTemplate } = require('../utils/whatsappDelivery');
const { writeAuditLog } = require('../utils/auditLog');

const AUDIENCE_MAP = {
    All: 'ALL',
    Active: 'ACTIVE',
    Expiring: 'EXPIRING_7_DAYS',
    Ghosts: 'GHOSTS',
    Expired: 'EXPIRED',
    HighChurn: 'HIGH_CHURN',
};

const WHATSAPP_SEND_CONCURRENCY = Math.max(1, Math.min(10, parseInt(process.env.MSG91_SEND_CONCURRENCY || '5', 10) || 5));
const BOT_MEMBER_EMAIL_DOMAIN = '@seed.gymvault.bot';
const REMINDER_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REMINDER_REQUEST_LIMIT = Math.max(1, parseInt(process.env.REMINDER_REQUEST_LIMIT || '6', 10) || 6);
const REMINDER_HOURLY_SEND_LIMIT = Math.max(1, parseInt(process.env.REMINDER_HOURLY_SEND_LIMIT || '250', 10) || 250);

const CHURN_SCORE_SQL = `
WITH latest_membership AS (
    SELECT DISTINCT ON (ms.member_id)
        ms.member_id,
        ms.status,
        ms.end_date,
        p.name AS plan_name
    FROM memberships ms
    LEFT JOIN plans p ON p.id = ms.plan_id
    WHERE ms.gym_id = $1 AND ms.deleted_at IS NULL
    ORDER BY ms.member_id, ms.end_date DESC, ms.created_at DESC
),
last_due AS (
    SELECT DISTINCT ON (pay.user_id)
        pay.user_id,
        COALESCE(pay.amount_due, 0) AS amount_due
    FROM payments pay
    WHERE pay.gym_id = $1 AND pay.deleted_at IS NULL
    ORDER BY pay.user_id, pay.payment_date DESC
),
base AS (
    SELECT
        m.id,
        m.full_name,
        m.email,
        m.phone,
        m.last_visit,
        COALESCE(lm.status, 'UNPAID') AS membership_status,
        lm.end_date,
        lm.plan_name,
        COALESCE(ld.amount_due, 0) AS amount_due,
        COALESCE(DATE_PART('day', NOW() - m.last_visit), 45)::INT AS days_inactive,
        CASE
            WHEN lm.end_date IS NULL THEN NULL
            ELSE (lm.end_date - CURRENT_DATE)
        END AS days_to_expiry
    FROM members m
    LEFT JOIN latest_membership lm ON lm.member_id = m.id
    LEFT JOIN last_due ld ON ld.user_id = m.id
    WHERE m.gym_id = $1
      AND m.deleted_at IS NULL
      AND COALESCE(m.phone, '') <> ''
),
scored AS (
    SELECT
        *,
        LEAST(
            100,
            (
                CASE WHEN membership_status = 'EXPIRED' THEN 45 ELSE 0 END +
                CASE
                    WHEN membership_status = 'ACTIVE' AND days_to_expiry BETWEEN 0 AND 3 THEN 35
                    WHEN membership_status = 'ACTIVE' AND days_to_expiry BETWEEN 4 AND 7 THEN 25
                    WHEN membership_status = 'ACTIVE' AND days_to_expiry BETWEEN 8 AND 14 THEN 10
                    ELSE 0
                END +
                CASE
                    WHEN days_inactive >= 30 THEN 30
                    WHEN days_inactive >= 14 THEN 20
                    WHEN days_inactive >= 7 THEN 10
                    ELSE 0
                END +
                CASE WHEN amount_due > 0 THEN 15 ELSE 0 END
            )
        )::INT AS churn_score
    FROM base
)
`;

let ensureMessagingSchemaPromise;

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

            await pool.query(`
                ALTER TABLE broadcast_logs
                ADD COLUMN IF NOT EXISTS dashboard_action_key VARCHAR(80),
                ADD COLUMN IF NOT EXISTS dashboard_audience_hash VARCHAR(120),
                ADD COLUMN IF NOT EXISTS dashboard_expected_count INTEGER DEFAULT 0;
            `);
        })();
    }
    await ensureMessagingSchemaPromise;
};

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

async function getSegmentMembers(gymId, segment, limit = 200) {
    const normalized = String(segment || 'ALL').toUpperCase();

    const whereClause = {
        ALL: `TRUE`,
        ACTIVE: `membership_status = 'ACTIVE'`,
        EXPIRING_7_DAYS: `membership_status = 'ACTIVE' AND days_to_expiry BETWEEN 0 AND 7`,
        EXPIRED: `membership_status = 'EXPIRED' OR (days_to_expiry IS NOT NULL AND days_to_expiry < 0)`,
        GHOSTS: `days_inactive >= 20`,
        HIGH_CHURN: `churn_score >= 70`,
    }[normalized] || `TRUE`;

    const sql = `${CHURN_SCORE_SQL}
SELECT
    id,
    full_name,
    email,
    phone,
    membership_status,
    plan_name,
    last_visit,
    end_date,
    days_inactive,
    days_to_expiry,
    amount_due,
    churn_score,
    CASE
        WHEN churn_score >= 70 THEN 'HIGH'
        WHEN churn_score >= 40 THEN 'MEDIUM'
        ELSE 'LOW'
    END AS churn_tier
FROM scored
WHERE ${whereClause}
ORDER BY churn_score DESC, days_inactive DESC, full_name ASC
LIMIT $2`;

    const result = await pool.query(sql, [gymId, Number(limit) || 200]);
    return result.rows;
}

async function getMembersByIds(gymId, memberIds = []) {
    const ids = Array.from(new Set(
        memberIds
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (ids.length === 0) {
        return [];
    }

    const result = await pool.query(
        `${CHURN_SCORE_SQL}
         SELECT
            id,
            full_name,
                email,
            phone,
            membership_status,
            plan_name,
            last_visit,
            end_date,
            days_inactive,
            days_to_expiry,
            amount_due,
            churn_score,
            CASE
                WHEN churn_score >= 70 THEN 'HIGH'
                WHEN churn_score >= 40 THEN 'MEDIUM'
                ELSE 'LOW'
            END AS churn_tier
         FROM scored
         WHERE id = ANY($2::int[])
         ORDER BY full_name ASC`,
        [gymId, ids]
    );

    return result.rows;
}

const canSendManualReminder = (user = {}) => {
    const role = String(user?.role || '').trim().toUpperCase();
    if (role === 'OWNER') return true;

    return hasPermission(user, 'members:write')
        || hasPermission(user, 'attendance:write')
        || hasPermission(user, 'payments:write');
};

const reminderRequestLimiter = rateLimit({
    windowMs: REMINDER_REQUEST_WINDOW_MS,
    max: REMINDER_REQUEST_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.user?.gym_id || 'nogym'}:${req.user?.id || req.user?.user_id || 'anon'}`,
    handler: (_req, res) => {
        return fail(res, 429, 'REMINDER_REQUEST_RATE_LIMIT', 'Too many reminder requests. Wait a few minutes and try again.');
    },
});

const pickReminderTemplateCandidates = (member = {}, requestedTemplateKey = '') => {
    const explicitKey = String(requestedTemplateKey || '').trim().toUpperCase();
    if (explicitKey) {
        return [explicitKey];
    }

    const membershipStatus = String(member.membership_status || '').trim().toUpperCase();
    const amountDue = Number(member.amount_due || 0);
    const daysToExpiry = Number(member.days_to_expiry);
    const daysInactive = Number(member.days_inactive || 0);

    if (amountDue > 0 || membershipStatus === 'UNPAID') {
        return ['PAYMENT_DUE', 'UNPAID', 'RENEWAL_REMINDER'];
    }

    if (membershipStatus === 'EXPIRED' || (Number.isFinite(daysToExpiry) && daysToExpiry < 0)) {
        return ['EXPIRED', 'RENEWAL_REMINDER'];
    }

    if (membershipStatus === 'ACTIVE' && Number.isFinite(daysToExpiry) && daysToExpiry <= 7) {
        return ['EXPIRING_SOON', 'RENEWAL_REMINDER'];
    }

    if (daysInactive >= 7) {
        return ['INACTIVE', 'SALES_OFFER', 'RENEWAL_REMINDER'];
    }

    return ['RENEWAL_REMINDER', 'EXPIRING_SOON', 'PAYMENT_DUE', 'INACTIVE', 'EXPIRED'];
};

const pickApprovedTemplate = (templateMap, candidateKeys = []) => {
    for (const candidate of candidateKeys) {
        const normalizedKey = String(candidate || '').trim().toUpperCase();
        if (normalizedKey && templateMap.has(normalizedKey)) {
            return templateMap.get(normalizedKey);
        }
    }
    return null;
};

const isDemoMember = (member = {}) => String(member.email || '').trim().toLowerCase().endsWith(BOT_MEMBER_EMAIL_DOMAIN);

const renderReminderPreviewText = (templateText, member = {}, gymName = '') => {
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

const buildReminderPreviewItems = ({ members = [], approvedTemplates = new Map(), requestedTemplateKey = '', gymName = '' }) => {
    return (Array.isArray(members) ? members : []).map((member) => {
        if (isDemoMember(member)) {
            return {
                member_id: member.id,
                full_name: member.full_name,
                phone: member.phone,
                email: member.email,
                eligible: false,
                reason: 'This is a demo/seed profile. Real reminders are blocked for demo members.',
            };
        }

        const recipientNumber = normalizeLocalIndianPhone(member.phone);
        if (!recipientNumber) {
            return {
                member_id: member.id,
                full_name: member.full_name,
                phone: member.phone,
                email: member.email,
                eligible: false,
                reason: 'Valid phone number not available for this member.',
            };
        }

        const selectedTemplate = pickApprovedTemplate(
            approvedTemplates,
            pickReminderTemplateCandidates(member, requestedTemplateKey)
        );

        if (!selectedTemplate) {
            return {
                member_id: member.id,
                full_name: member.full_name,
                phone: member.phone,
                email: member.email,
                eligible: false,
                reason: requestedTemplateKey
                    ? `Template ${requestedTemplateKey} is not approved for sending.`
                    : 'No approved reminder template is available for this member.',
            };
        }

        return {
            member_id: member.id,
            full_name: member.full_name,
            phone: member.phone,
            email: member.email,
            eligible: true,
            recipient_number: recipientNumber,
            template_key: String(selectedTemplate.template_key || '').trim().toUpperCase(),
            template_title: selectedTemplate.title,
            message: renderReminderPreviewText(selectedTemplate.whatsapp_text, member, gymName),
        };
    });
};

const runWithConcurrency = async (items, concurrency, worker) => {
    const queue = Array.isArray(items) ? items : [];
    if (queue.length === 0) return;

    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, queue.length));

    const runners = Array.from({ length: workerCount }, async () => {
        while (nextIndex < queue.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            await worker(queue[currentIndex], currentIndex);
        }
    });

    await Promise.all(runners);
};

// --- 1. GET ALL NOTIFICATIONS & UNREAD COUNT ---
router.get('/', auth, saasMiddleware, async (req, res) => {
    try {
        const gym_id = req.user.gym_id;

        const [result, unreadCount] = await Promise.all([
            pool.query(
                `SELECT *
                 FROM notifications
                 WHERE gym_id = $1
                 ORDER BY created_at DESC
                 LIMIT 50`,
                [gym_id]
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM notifications
                 WHERE gym_id = $1 AND is_read = FALSE`,
                [gym_id]
            ),
        ]);

        const payload = {
            notifications: result.rows,
            unread_count: parseInt(unreadCount.rows[0].count, 10)
        };

        return ok(res, payload, payload);
    } catch (err) {
        console.error("Fetch Notifications Error:", err.message);
        return fail(res, 500, 'NOTIFICATIONS_FETCH_FAILED', 'Server Error', null, { error: 'Server Error' });
    }
});

// --- 2. MARK A SINGLE NOTIFICATION AS READ ---
router.put('/:id/read', auth, saasMiddleware, async (req, res) => {
    try {
        await pool.query(
            `UPDATE notifications SET is_read = true WHERE id = $1 AND gym_id = $2`,
            [req.params.id, req.user.gym_id]
        );
        return ok(res, { updated: true }, { success: true });
    } catch (err) {
        console.error("Mark Read Error:", err.message);
        return fail(res, 500, 'NOTIFICATION_UPDATE_FAILED', 'Server Error', null, { error: 'Server Error' });
    }
});

// --- 3. MARK ALL AS READ (For a "Mark all as read" button) ---
router.put('/read-all', auth, saasMiddleware, async (req, res) => {
    try {
        await pool.query(
            `UPDATE notifications SET is_read = true WHERE gym_id = $1`,
            [req.user.gym_id]
        );
        return ok(res, { updated: true }, { success: true });
    } catch (err) {
        console.error("Mark All Read Error:", err.message);
        return fail(res, 500, 'NOTIFICATIONS_BULK_UPDATE_FAILED', 'Server Error', null, { error: 'Server Error' });
    }
});

// --- 4. PREVIEW DIRECT MEMBER REMINDERS ---
router.post('/reminders/preview', auth, saasMiddleware, async (req, res) => {
    try {
        await ensureMessagingSchema();

        if (!canSendManualReminder(req.user)) {
            return fail(res, 403, 'FORBIDDEN_REMINDER_SEND', 'You do not have permission to send WhatsApp reminders.');
        }

        const gymId = req.user.gym_id;
        const requesterId = req.user.user_id || req.user.id || null;
        const memberIds = Array.from(new Set(
            (Array.isArray(req.body.member_ids) ? req.body.member_ids : [req.body.member_id])
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => Number.isInteger(value) && value > 0)
        ));
        const requestedTemplateKey = String(req.body.template_key || '').trim().toUpperCase();

        if (memberIds.length === 0) {
            return fail(res, 400, 'REMINDER_MEMBERS_REQUIRED', 'Select at least one member before previewing a reminder.');
        }

        const gymConfigRes = await pool.query(
            `SELECT
                name,
                messaging_whatsapp_number,
                messaging_whatsapp_status,
                bulk_per_campaign_limit
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        );
        const gymConfig = gymConfigRes.rows[0] || {};

        if (String(gymConfig.messaging_whatsapp_status || '').toUpperCase() !== 'CONNECTED' || !gymConfig.messaging_whatsapp_number) {
            return fail(res, 400, 'WHATSAPP_NOT_CONNECTED', 'Connect and verify your gym WhatsApp number in Settings before sending reminders.');
        }

        const bulkLimit = Math.max(1, parseInt(gymConfig.bulk_per_campaign_limit || 50, 10));
        if (memberIds.length > bulkLimit) {
            return fail(res, 400, 'REMINDER_LIMIT_EXCEEDED', `Select up to ${bulkLimit} members at a time for WhatsApp reminders.`);
        }

        const templateRes = await pool.query(
            `SELECT
                template_key,
                title,
                whatsapp_text,
                whatsapp_template_name,
                whatsapp_template_language,
                whatsapp_template_status,
                is_active
             FROM gym_message_templates
             WHERE gym_id = $1 AND is_active = TRUE`,
            [gymId]
        );

        const approvedTemplates = new Map();
        for (const template of templateRes.rows) {
            const templateKey = String(template.template_key || '').trim().toUpperCase();
            if (!templateKey || !template.whatsapp_template_name) continue;
            if (normalizeTemplateStatus(template.whatsapp_template_status) !== 'APPROVED') continue;
            approvedTemplates.set(templateKey, template);
        }

        if (approvedTemplates.size === 0) {
            return fail(res, 400, 'NO_APPROVED_TEMPLATES', 'No approved WhatsApp templates are available. Approve a template in Settings first.');
        }

        if (requestedTemplateKey && !approvedTemplates.has(requestedTemplateKey)) {
            return fail(res, 400, 'TEMPLATE_NOT_APPROVED', 'The selected WhatsApp template is not approved yet. Approve it in Settings first.');
        }

        const members = await getMembersByIds(gymId, memberIds);
        if (members.length === 0) {
            return fail(res, 400, 'REMINDER_MEMBERS_NOT_FOUND', 'No valid members were found for this reminder request.');
        }

        const memberMap = new Map(members.map((member) => [Number(member.id), member]));

        const previewItems = buildReminderPreviewItems({
            members,
            approvedTemplates,
            requestedTemplateKey,
            gymName: gymConfig.name || 'GymVault',
        });

        return ok(res, {
            preview_items: previewItems,
            eligible_count: previewItems.filter((item) => item.eligible).length,
            blocked_count: previewItems.filter((item) => !item.eligible).length,
            template_keys_used: Array.from(new Set(previewItems.filter((item) => item.eligible).map((item) => item.template_key))),
        });
    } catch (err) {
        console.error('REMINDER PREVIEW ERROR:', err.message);
        return fail(res, 500, 'REMINDER_PREVIEW_FAILED', 'Failed to prepare the WhatsApp reminder preview.');
    }
});

// --- 5. SEND DIRECT MEMBER REMINDERS ---
router.post('/reminders/send', auth, saasMiddleware, reminderRequestLimiter, async (req, res) => {
    try {
        await ensureMessagingSchema();

        if (!canSendManualReminder(req.user)) {
            return fail(res, 403, 'FORBIDDEN_REMINDER_SEND', 'You do not have permission to send WhatsApp reminders.');
        }

        const gymId = req.user.gym_id;
        const requesterId = req.user.user_id || req.user.id || null;
        const memberIds = Array.from(new Set(
            (Array.isArray(req.body.member_ids) ? req.body.member_ids : [req.body.member_id])
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => Number.isInteger(value) && value > 0)
        ));
        const requestedTemplateKey = String(req.body.template_key || '').trim().toUpperCase();

        if (memberIds.length === 0) {
            return fail(res, 400, 'REMINDER_MEMBERS_REQUIRED', 'Select at least one member before sending a reminder.');
        }

        const gymConfigRes = await pool.query(
            `SELECT
                name,
                messaging_whatsapp_number,
                messaging_whatsapp_status,
                bulk_per_campaign_limit
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        );
        const gymConfig = gymConfigRes.rows[0] || {};

        if (String(gymConfig.messaging_whatsapp_status || '').toUpperCase() !== 'CONNECTED' || !gymConfig.messaging_whatsapp_number) {
            return fail(res, 400, 'WHATSAPP_NOT_CONNECTED', 'Connect and verify your gym WhatsApp number in Settings before sending reminders.');
        }

        const bulkLimit = Math.max(1, parseInt(gymConfig.bulk_per_campaign_limit || 50, 10));
        if (memberIds.length > bulkLimit) {
            return fail(res, 400, 'REMINDER_LIMIT_EXCEEDED', `Select up to ${bulkLimit} members at a time for WhatsApp reminders.`);
        }

        const templateRes = await pool.query(
            `SELECT
                template_key,
                title,
                whatsapp_text,
                whatsapp_template_name,
                whatsapp_template_language,
                whatsapp_template_status,
                is_active
             FROM gym_message_templates
             WHERE gym_id = $1 AND is_active = TRUE`,
            [gymId]
        );

        const approvedTemplates = new Map();
        for (const template of templateRes.rows) {
            const templateKey = String(template.template_key || '').trim().toUpperCase();
            if (!templateKey || !template.whatsapp_template_name) continue;
            if (normalizeTemplateStatus(template.whatsapp_template_status) !== 'APPROVED') continue;
            approvedTemplates.set(templateKey, template);
        }

        if (approvedTemplates.size === 0) {
            return fail(res, 400, 'NO_APPROVED_TEMPLATES', 'No approved WhatsApp templates are available. Approve a template in Settings first.');
        }

        if (requestedTemplateKey && !approvedTemplates.has(requestedTemplateKey)) {
            return fail(res, 400, 'TEMPLATE_NOT_APPROVED', 'The selected WhatsApp template is not approved yet. Approve it in Settings first.');
        }

        const members = await getMembersByIds(gymId, memberIds);
        if (members.length === 0) {
            return fail(res, 400, 'REMINDER_MEMBERS_NOT_FOUND', 'No valid members were found for this reminder request.');
        }

        const memberMap = new Map(members.map((member) => [Number(member.id), member]));

        const previewItems = buildReminderPreviewItems({
            members,
            approvedTemplates,
            requestedTemplateKey,
            gymName: gymConfig.name || 'GymVault',
        });

        const eligibleReminderCount = previewItems.filter((item) => item.eligible).length;
        const reminderUsageRes = await pool.query(
            `SELECT COUNT(*)::INT AS sent_last_hour
             FROM whatsapp_delivery_logs
             WHERE gym_id = $1
               AND source_kind = 'REMINDER'
               AND created_at >= NOW() - INTERVAL '1 hour'`,
            [gymId]
        );
        const sentLastHour = Number(reminderUsageRes.rows[0]?.sent_last_hour || 0);
        if (eligibleReminderCount > 0 && sentLastHour + eligibleReminderCount > REMINDER_HOURLY_SEND_LIMIT) {
            await writeAuditLog({
                actorType: 'GYM_USER',
                actorId: String(requesterId || req.user.id || ''),
                action: 'REMINDER_SEND_BLOCKED',
                targetType: 'WHATSAPP_REMINDER',
                targetId: requestedTemplateKey || 'AUTO',
                targetLabel: requestedTemplateKey || 'Auto template selection',
                details: {
                    gym_id: gymId,
                    attempted_count: memberIds.length,
                    eligible_count: eligibleReminderCount,
                    sent_last_hour: sentLastHour,
                    hourly_limit: REMINDER_HOURLY_SEND_LIMIT,
                },
            });
            return fail(
                res,
                429,
                'REMINDER_HOURLY_LIMIT_REACHED',
                `Reminder sending is capped at ${REMINDER_HOURLY_SEND_LIMIT} messages per hour. Try again later.`
            );
        }

        let successCount = 0;
        let failedCount = 0;
        const failures = [];
        const templateKeysUsed = new Set();

        await runWithConcurrency(previewItems, WHATSAPP_SEND_CONCURRENCY, async (previewItem) => {
            if (!previewItem.eligible) {
                failedCount += 1;
                failures.push({
                    member_id: previewItem.member_id,
                    full_name: previewItem.full_name,
                    phone: previewItem.phone,
                    reason: previewItem.reason || 'Member is not eligible for a reminder.',
                });
                return;
            }

            const selectedTemplate = approvedTemplates.get(String(previewItem.template_key || '').trim().toUpperCase());
            if (!selectedTemplate) {
                failedCount += 1;
                failures.push({
                    member_id: previewItem.member_id,
                    full_name: previewItem.full_name,
                    phone: previewItem.phone,
                    reason: requestedTemplateKey
                        ? `Template ${requestedTemplateKey} is not approved for sending.`
                        : 'No approved reminder template is available for this member.',
                });
                return;
            }

            try {
                const member = memberMap.get(Number(previewItem.member_id)) || {};
                await sendTrackedWhatsAppTemplate({
                    gymId,
                    memberId: previewItem.member_id,
                    initiatedBy: requesterId,
                    sourceKind: 'REMINDER',
                    sourceLabel: requestedTemplateKey || 'AUTO',
                    integratedNumber: gymConfig.messaging_whatsapp_number,
                    recipientNumber: previewItem.recipient_number,
                    recipientName: previewItem.full_name,
                    templateKey: selectedTemplate.template_key,
                    templateTitle: selectedTemplate.title,
                    templateName: selectedTemplate.whatsapp_template_name,
                    templateLanguage: selectedTemplate.whatsapp_template_language || 'en_US',
                    messagePreview: previewItem.message,
                    variables: buildTemplateBodyVariables(selectedTemplate.whatsapp_text, {
                        full_name: previewItem.full_name,
                        plan_name: member.plan_name,
                        days_to_expiry: member.days_to_expiry,
                    }, gymConfig.name || 'GymVault'),
                });
                successCount += 1;
                templateKeysUsed.add(String(selectedTemplate.template_key || '').trim().toUpperCase());
            } catch (sendErr) {
                failedCount += 1;
                failures.push({
                    member_id: previewItem.member_id,
                    full_name: previewItem.full_name,
                    phone: previewItem.phone,
                    reason: sendErr?.message || 'Send failed',
                });
            }
        });

        if (successCount > 0) {
            await pool.query(
                `INSERT INTO notifications (gym_id, title, message)
                 VALUES ($1, $2, $3)`,
                [
                    gymId,
                    successCount > 1 ? 'WhatsApp reminders queued' : 'WhatsApp reminder queued',
                    `${successCount} accepted for sending${failedCount > 0 ? `, ${failedCount} blocked or failed` : ''}`,
                ]
            );
        }

        await writeAuditLog({
            actorType: 'GYM_USER',
            actorId: String(requesterId || req.user.id || ''),
            action: 'REMINDER_SEND',
            targetType: 'WHATSAPP_REMINDER',
            targetId: requestedTemplateKey || 'AUTO',
            targetLabel: requestedTemplateKey || 'Auto template selection',
            details: {
                gym_id: gymId,
                attempted_count: members.length,
                sent_to_count: successCount,
                failed_count: failedCount,
                template_keys_used: Array.from(templateKeysUsed),
                requested_member_count: memberIds.length,
            },
        });

        return ok(res, {
            attempted_count: members.length,
            sent_to_count: successCount,
            failed_count: failedCount,
            template_keys_used: Array.from(templateKeysUsed),
            failures: failures.slice(0, 25),
        });
    } catch (err) {
        console.error('REMINDER SEND ERROR:', err.message);
        return fail(res, 500, 'REMINDER_SEND_FAILED', 'Failed to send WhatsApp reminders.');
    }
});

// --- 6. CAMPAIGN COMPOSER DATA (dashboard modal preload) ---
router.get('/campaign/composer', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMessagingSchema();

        const gymId = req.user.gym_id;
        const [gymResult, templatesResult] = await Promise.all([
            pool.query(
                `SELECT name
                 FROM gyms
                 WHERE id = $1
                 LIMIT 1`,
                [gymId]
            ),
            pool.query(
                `SELECT template_key, title, whatsapp_text, whatsapp_template_status, is_active
                 FROM gym_message_templates
                 WHERE gym_id = $1
                 ORDER BY updated_at DESC, title ASC`,
                [gymId]
            ),
        ]);

        const templates = templatesResult.rows
            .map((row) => ({
                ...row,
                template_key: String(row.template_key || '').trim().toUpperCase(),
            }))
            .filter((row) => row.template_key)
            .filter((row) => row.is_active !== false)
            .filter((row) => normalizeTemplateStatus(row.whatsapp_template_status) === 'APPROVED');

        return ok(res, {
            gym_name: String(gymResult.rows[0]?.name || '').trim(),
            templates,
        });
    } catch (err) {
        console.error('CAMPAIGN COMPOSER ERROR:', err.message);
        return fail(res, 500, 'CAMPAIGN_COMPOSER_FAILED', 'Failed to load campaign composer data.');
    }
});

// --- 7. SEGMENT PREVIEW (automation pipeline) ---
router.get('/campaign/segments', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const gymId = req.user.gym_id;
        const segment = String(req.query.segment || 'ALL').toUpperCase();
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10)));

        const members = await getSegmentMembers(gymId, segment, limit);

        return ok(res, {
            segment,
            total: members.length,
            members,
        });
    } catch (err) {
        console.error('CAMPAIGN SEGMENT ERROR:', err.message);
        return fail(res, 500, 'CAMPAIGN_SEGMENT_FAILED', 'Failed to prepare segment preview.');
    }
});

// --- 8. RUN CAMPAIGN (returns links + writes audit log) ---
router.post('/campaign/run', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMessagingSchema();

        const gymId = req.user.gym_id;
        const userId = req.user.user_id || req.user.id || null;
        const segmentInput = req.body.segment || 'ALL';
        const segment = AUDIENCE_MAP[segmentInput] || String(segmentInput).toUpperCase();
        const customMemberIds = Array.isArray(req.body.member_ids) ? req.body.member_ids : [];
        const templateKey = String(req.body.template_key || '').trim().toUpperCase();
        const channel = 'WHATSAPP';
        const dashboardActionKey = String(req.body.dashboard_action_key || '').trim().toUpperCase().slice(0, 80);
        const dashboardAudienceHash = String(req.body.dashboard_audience_hash || '').trim().slice(0, 120);
        const dashboardExpectedCountInput = Number.parseInt(req.body.dashboard_expected_count, 10);
        const dashboardExpectedCount = Number.isInteger(dashboardExpectedCountInput) && dashboardExpectedCountInput > 0
            ? dashboardExpectedCountInput
            : 0;

        if (!templateKey) {
            return fail(res, 400, 'WHATSAPP_TEMPLATE_REQUIRED', 'Select an approved WhatsApp template before launching the campaign.');
        }

        const gymConfigRes = await pool.query(
            `SELECT
                name,
                messaging_whatsapp_number,
                messaging_whatsapp_status,
                messaging_whatsapp_templates_status,
                bulk_enabled,
                bulk_monthly_limit,
                bulk_per_campaign_limit,
                bulk_channels
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        );
        const gymConfig = gymConfigRes.rows[0] || {};
        if (!gymConfig.bulk_enabled) {
            return fail(res, 403, 'BULK_DISABLED', 'Bulk messaging is disabled. Enable it in Settings → Integrations.');
        }

        const allowedChannels = gymConfig.bulk_channels || { whatsapp: true, sms: false };
        if (!allowedChannels.whatsapp) {
            return fail(res, 403, 'WHATSAPP_CHANNEL_DISABLED', 'WhatsApp channel is disabled in integrations settings.');
        }

        if (String(gymConfig.messaging_whatsapp_status || '').toUpperCase() !== 'CONNECTED' || !gymConfig.messaging_whatsapp_number) {
            return fail(res, 400, 'WHATSAPP_NOT_CONNECTED', 'Connect and verify your gym WhatsApp number in Settings before sending campaigns.');
        }

        const monthlyLimit = Math.max(10, parseInt(gymConfig.bulk_monthly_limit || 500, 10));
        const perCampaignLimit = Math.max(1, parseInt(gymConfig.bulk_per_campaign_limit || 50, 10));

        const monthUsageRes = await pool.query(
            `SELECT COALESCE(SUM(sent_to_count), 0)::INT AS monthly_used
             FROM broadcast_logs
             WHERE gym_id = $1
               AND created_at >= DATE_TRUNC('month', NOW())`,
            [gymId]
        );

        const monthlyUsed = Number(monthUsageRes.rows[0]?.monthly_used || 0);
        const remainingThisMonth = Math.max(0, monthlyLimit - monthlyUsed);
        if (remainingThisMonth <= 0) {
            return fail(res, 429, 'MONTHLY_BULK_LIMIT_REACHED', 'Monthly bulk message limit reached. Increase limit in Integrations or wait for next month.');
        }

        let selectedTemplate = null;
        {
            const templateRes = await pool.query(
                `SELECT
                    template_key,
                    title,
                    whatsapp_text,
                    whatsapp_template_name,
                    whatsapp_template_language,
                    whatsapp_template_status,
                    is_active
                 FROM gym_message_templates
                 WHERE gym_id = $1 AND template_key = $2
                 LIMIT 1`,
                [gymId, templateKey]
            );
            selectedTemplate = templateRes.rows[0] || null;
            if (!selectedTemplate) {
                return fail(res, 400, 'TEMPLATE_NOT_FOUND', 'Selected template does not exist.');
            }
            if (!selectedTemplate.is_active) {
                return fail(res, 400, 'TEMPLATE_DISABLED', 'Selected template is disabled.');
            }
            if (!selectedTemplate.whatsapp_template_name) {
                return fail(res, 400, 'TEMPLATE_NOT_SYNCED', 'This template is not synced to MSG91 yet. Refresh it in Settings and wait for approval.');
            }

            const templateStatus = normalizeTemplateStatus(selectedTemplate.whatsapp_template_status);
            if (templateStatus === 'PENDING') {
                return fail(res, 400, 'TEMPLATE_PENDING_APPROVAL', 'This WhatsApp template is still pending approval in MSG91.');
            }
            if (templateStatus !== 'APPROVED') {
                return fail(res, 400, 'TEMPLATE_NOT_APPROVED', 'This WhatsApp template is not approved yet.');
            }
        }

        const message = String(selectedTemplate.whatsapp_text || '').trim();

        const sendLimit = Math.min(remainingThisMonth, perCampaignLimit, 500);
        const members = customMemberIds.length > 0
            ? await getMembersByIds(gymId, customMemberIds)
            : await getSegmentMembers(gymId, segment, sendLimit * 2);
        if (members.length === 0) {
            return fail(res, 400, 'EMPTY_CAMPAIGN_SEGMENT', customMemberIds.length > 0 ? 'No members found in selected list.' : 'No members found in selected segment.');
        }

        const targetMembers = members
            .filter((member) => normalizeLocalIndianPhone(member.phone))
            .slice(0, sendLimit);

        if (targetMembers.length === 0) {
            return fail(res, 400, 'NO_VALID_PHONES', 'No valid member phone numbers found for selected segment.');
        }

        const insertLog = await pool.query(
            `INSERT INTO broadcast_logs (
                gym_id,
                segment,
                channel,
                message,
                sent_to_count,
                status,
                created_by,
                dashboard_action_key,
                dashboard_audience_hash,
                dashboard_expected_count
             )
             VALUES ($1, $2, $3, $4, 0, 'QUEUED', $5, $6, $7, $8)
             RETURNING id, created_at`,
            [
                gymId,
                customMemberIds.length > 0 ? 'CUSTOM' : segment,
                channel,
                message,
                userId,
                dashboardActionKey || null,
                dashboardAudienceHash || null,
                dashboardExpectedCount,
            ]
        );

        const broadcastLogId = insertLog.rows[0].id;
        let successCount = 0;
        let failedCount = 0;
        const failures = [];

        await runWithConcurrency(targetMembers, WHATSAPP_SEND_CONCURRENCY, async (member) => {
            const toPhone = normalizeLocalIndianPhone(member.phone);
            try {
                await sendTrackedWhatsAppTemplate({
                    gymId,
                    memberId: member.id,
                    broadcastLogId,
                    initiatedBy: userId,
                    sourceKind: 'CAMPAIGN',
                    sourceLabel: customMemberIds.length > 0 ? 'CUSTOM' : segment,
                    integratedNumber: gymConfig.messaging_whatsapp_number,
                    recipientNumber: toPhone,
                    recipientName: member.full_name,
                    templateKey: selectedTemplate.template_key,
                    templateTitle: selectedTemplate.title,
                    templateName: selectedTemplate.whatsapp_template_name,
                    templateLanguage: selectedTemplate.whatsapp_template_language || 'en_US',
                    messagePreview: renderReminderPreviewText(message, member, gymConfig.name || 'GymVault'),
                    variables: buildTemplateBodyVariables(message, member, gymConfig.name || 'GymVault'),
                });
                successCount += 1;
            } catch (sendErr) {
                failedCount += 1;
                failures.push({
                    member_id: member.id,
                    full_name: member.full_name,
                    phone: member.phone,
                    reason: sendErr?.message || 'Send failed',
                });
            }
        });

        const status = successCount === 0 ? 'FAILED' : failedCount > 0 ? 'PARTIAL' : 'SENT';

        const logSegment = customMemberIds.length > 0 ? 'CUSTOM' : segment;

        await pool.query(
            `UPDATE broadcast_logs
             SET sent_to_count = $2,
                 status = $3
             WHERE id = $1`,
            [broadcastLogId, successCount, status]
        );

        await pool.query(
            `INSERT INTO notifications (gym_id, title, message)
             VALUES ($1, $2, $3)`,
            [gymId, 'Campaign sent', `Broadcast ${status.toLowerCase()} · ${successCount} delivered, ${failedCount} failed [${logSegment}]`]
        );

        await writeAuditLog({
            actorType: 'GYM_USER',
            actorId: String(userId || req.user.id || ''),
            action: 'CAMPAIGN_RUN',
            targetType: 'WHATSAPP_CAMPAIGN',
            targetId: String(broadcastLogId),
            targetLabel: `${logSegment}:${selectedTemplate?.title || selectedTemplate?.template_key || 'template'}`,
            details: {
                gym_id: gymId,
                segment: logSegment,
                template_key: selectedTemplate?.template_key || null,
                template_title: selectedTemplate?.title || null,
                attempted_count: targetMembers.length,
                sent_to_count: successCount,
                failed_count: failedCount,
                monthly_limit: monthlyLimit,
                monthly_used_after_send: monthlyUsed + successCount,
            },
        });

        return ok(res, {
            campaign_id: broadcastLogId,
            created_at: insertLog.rows[0].created_at,
            segment: logSegment,
            channel,
            template_key: selectedTemplate?.template_key || null,
            template_title: selectedTemplate?.title || null,
            attempted_count: targetMembers.length,
            sent_to_count: successCount,
            failed_count: failedCount,
            monthly_limit: monthlyLimit,
            monthly_used: monthlyUsed + successCount,
            monthly_remaining: Math.max(0, monthlyLimit - (monthlyUsed + successCount)),
            failures: failures.slice(0, 25),
        });
    } catch (err) {
        console.error('CAMPAIGN RUN ERROR:', err.message);
        return fail(res, 500, 'CAMPAIGN_RUN_FAILED', 'Failed to run campaign automation.');
    }
});

// --- 8. CAMPAIGN HISTORY LOG ---
router.get('/campaign/logs', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMessagingSchema();
        const gymId = req.user.gym_id;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
        const logs = await pool.query(
            `SELECT
                id,
                segment,
                channel,
                message,
                sent_to_count,
                status,
                created_at,
                dashboard_action_key,
                dashboard_audience_hash,
                dashboard_expected_count
             FROM broadcast_logs
             WHERE gym_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [gymId, limit]
        );

        return ok(res, logs.rows);
    } catch (err) {
        console.error('CAMPAIGN LOGS ERROR:', err.message);
        return fail(res, 500, 'CAMPAIGN_LOGS_FETCH_FAILED', 'Failed to load campaign history.');
    }
});

// --- 9. DEEPER CHURN SCORES ---
router.get('/campaign/churn-scores', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const gymId = req.user.gym_id;
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));

        const result = await pool.query(
            `${CHURN_SCORE_SQL}
             SELECT
                id,
                full_name,
                phone,
                membership_status,
                plan_name,
                last_visit,
                end_date,
                days_inactive,
                days_to_expiry,
                amount_due,
                churn_score,
                CASE
                    WHEN churn_score >= 70 THEN 'HIGH'
                    WHEN churn_score >= 40 THEN 'MEDIUM'
                    ELSE 'LOW'
                END AS churn_tier
             FROM scored
             ORDER BY churn_score DESC, days_inactive DESC, full_name ASC
             LIMIT $2`,
            [gymId, limit]
        );

        const summary = result.rows.reduce((acc, row) => {
            const tier = row.churn_tier;
            if (tier === 'HIGH') acc.high += 1;
            else if (tier === 'MEDIUM') acc.medium += 1;
            else acc.low += 1;
            return acc;
        }, { high: 0, medium: 0, low: 0 });

        return ok(res, {
            summary,
            members: result.rows,
        });
    } catch (err) {
        console.error('CHURN SCORE ERROR:', err.message);
        return fail(res, 500, 'CHURN_SCORE_FETCH_FAILED', 'Failed to calculate churn scores.');
    }
});

module.exports = router;