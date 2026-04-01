const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');
const twilio = require('twilio');
const { ok, fail } = require('../utils/apiResponse');

const AUDIENCE_MAP = {
    All: 'ALL',
    Active: 'ACTIVE',
    Expiring: 'EXPIRING_7_DAYS',
    Ghosts: 'GHOSTS',
    Expired: 'EXPIRED',
    HighChurn: 'HIGH_CHURN',
};

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
        ensureMessagingSchemaPromise = pool.query(`
            ALTER TABLE gyms
            ADD COLUMN IF NOT EXISTS messaging_owner_mobile VARCHAR(30),
            ADD COLUMN IF NOT EXISTS bulk_enabled BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS bulk_monthly_limit INTEGER DEFAULT 500,
            ADD COLUMN IF NOT EXISTS bulk_per_campaign_limit INTEGER DEFAULT 50,
            ADD COLUMN IF NOT EXISTS bulk_channels JSONB DEFAULT '{"whatsapp": true, "sms": false}'::jsonb;
        `);
    }
    await ensureMessagingSchemaPromise;
};

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
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

const isSandboxWhatsAppSender = (value) => {
    const sender = String(value || '').trim().toLowerCase();
    return sender === 'whatsapp:+14155238886';
};

const shouldFallbackToSms = (err) => {
    const code = Number(err?.code || 0);
    const message = String(err?.message || '').toLowerCase();
    return code === 63015 || code === 63016 || code === 21608 || message.includes('sandbox') || message.includes('join');
};

const fillTemplate = (text, member, gymName) => {
    const source = String(text || '');
    const daysLeft = Number.isFinite(Number(member.days_to_expiry)) ? Number(member.days_to_expiry) : 0;

    return source
        .replace(/{{\s*name\s*}}/gi, member.full_name || 'Member')
        .replace(/{{\s*plan\s*}}/gi, member.plan_name || 'your plan')
        .replace(/{{\s*days_left\s*}}/gi, `${daysLeft}`)
        .replace(/{{\s*gym_name\s*}}/gi, gymName || 'your gym');
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

// --- 1. GET ALL NOTIFICATIONS & UNREAD COUNT ---
router.get('/', auth, saasMiddleware, async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        
        // Fetch the latest 50 notifications
        const result = await pool.query(
            `SELECT * FROM notifications 
             WHERE gym_id = $1 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [gym_id]
        );
        
        // Get the count of unread messages for the red badge
        const unreadCount = await pool.query(
            `SELECT COUNT(*) FROM notifications WHERE gym_id = $1 AND is_read = false`,
            [gym_id]
        );

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

// --- 4. SEGMENT PREVIEW (automation pipeline) ---
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

// --- 5. RUN CAMPAIGN (returns links + writes audit log) ---
router.post('/campaign/run', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        await ensureMessagingSchema();

        const gymId = req.user.gym_id;
        const userId = req.user.user_id || req.user.id || null;
        const segmentInput = req.body.segment || 'ALL';
        const segment = AUDIENCE_MAP[segmentInput] || String(segmentInput).toUpperCase();
        const customMemberIds = Array.isArray(req.body.member_ids) ? req.body.member_ids : [];
        const templateKey = String(req.body.template_key || '').trim().toUpperCase();
        let message = String(req.body.message || '').trim();
        const channel = String(req.body.channel || 'WHATSAPP').toUpperCase();

        if (!['WHATSAPP', 'SMS'].includes(channel)) {
            return fail(res, 400, 'INVALID_CAMPAIGN_CHANNEL', 'Campaign channel must be WHATSAPP or SMS.');
        }

        const gymConfigRes = await pool.query(
            `SELECT
                name,
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
        if (channel === 'WHATSAPP' && !allowedChannels.whatsapp) {
            return fail(res, 403, 'WHATSAPP_CHANNEL_DISABLED', 'WhatsApp channel is disabled in integrations settings.');
        }
        if (channel === 'SMS' && !allowedChannels.sms) {
            return fail(res, 403, 'SMS_CHANNEL_DISABLED', 'SMS channel is disabled in integrations settings.');
        }

        const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
        const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
        const platformWhatsAppFrom = String(process.env.TWILIO_WHATSAPP_FROM || '').trim();
        const platformSmsFrom = String(process.env.TWILIO_SMS_FROM || '').trim();

        if (!accountSid || !authToken) {
            return fail(res, 400, 'TWILIO_NOT_CONFIGURED', 'Platform Twilio gateway is missing. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in backend env.');
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
        if (templateKey) {
            const templateRes = await pool.query(
                `SELECT template_key, title, whatsapp_text, sms_text, is_active
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
            if (!message) {
                message = channel === 'SMS' ? selectedTemplate.sms_text : selectedTemplate.whatsapp_text;
            }
        }

        if (!message || message.length < 5) {
            return fail(res, 400, 'INVALID_CAMPAIGN_MESSAGE', 'Campaign message must be at least 5 characters.');
        }

        const sendLimit = Math.min(remainingThisMonth, perCampaignLimit, 500);
        const members = customMemberIds.length > 0
            ? await getMembersByIds(gymId, customMemberIds)
            : await getSegmentMembers(gymId, segment, sendLimit * 2);
        if (members.length === 0) {
            return fail(res, 400, 'EMPTY_CAMPAIGN_SEGMENT', customMemberIds.length > 0 ? 'No members found in selected list.' : 'No members found in selected segment.');
        }

        const client = twilio(accountSid, authToken);
        const targetMembers = members
            .filter((member) => normalizePhone(member.phone))
            .slice(0, sendLimit);

        if (targetMembers.length === 0) {
            return fail(res, 400, 'NO_VALID_PHONES', 'No valid member phone numbers found for selected segment.');
        }

        const fromWhatsApp = formatWhatsAppAddress(platformWhatsAppFrom);
        const fromSms = normalizePhone(platformSmsFrom);
        const whatsappSandboxMode = isSandboxWhatsAppSender(platformWhatsAppFrom);
        const smsFallbackAllowed = whatsappSandboxMode && allowedChannels.sms && Boolean(fromSms);

        if (channel === 'WHATSAPP' && !fromWhatsApp) {
            return fail(res, 400, 'WHATSAPP_FROM_MISSING', 'TWILIO_WHATSAPP_FROM is missing in backend env.');
        }
        if (channel === 'SMS' && !fromSms) {
            return fail(res, 400, 'SMS_FROM_MISSING', 'TWILIO_SMS_FROM is missing in backend env.');
        }

        let successCount = 0;
        let failedCount = 0;
        let fallbackSmsCount = 0;
        const failures = [];

        for (const member of targetMembers) {
            const toPhone = normalizePhone(member.phone);
            const personalizedMessage = fillTemplate(message, member, gymConfig.name || 'GymVault');
            try {
                if (channel === 'SMS') {
                    await client.messages.create({
                        from: fromSms,
                        to: toPhone,
                        body: personalizedMessage,
                    });
                } else {
                    try {
                        await client.messages.create({
                            from: fromWhatsApp,
                            to: `whatsapp:${toPhone}`,
                            body: personalizedMessage,
                        });
                    } catch (whatsErr) {
                        if (smsFallbackAllowed && shouldFallbackToSms(whatsErr)) {
                            await client.messages.create({
                                from: fromSms,
                                to: toPhone,
                                body: personalizedMessage,
                            });
                            fallbackSmsCount += 1;
                        } else {
                            throw whatsErr;
                        }
                    }
                }
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
        }

        const status = successCount === 0 ? 'FAILED' : failedCount > 0 ? 'PARTIAL' : 'SENT';

        const logSegment = customMemberIds.length > 0 ? 'CUSTOM' : segment;

        const insertLog = await pool.query(
            `INSERT INTO broadcast_logs (gym_id, segment, channel, message, sent_to_count, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, created_at`,
            [gymId, logSegment, channel, message, successCount, status, userId]
        );

        await pool.query(
            `INSERT INTO notifications (gym_id, title, message)
             VALUES ($1, $2, $3)`,
            [gymId, 'Campaign sent', `Broadcast ${status.toLowerCase()} · ${successCount} delivered, ${failedCount} failed [${logSegment}]`]
        );

        return ok(res, {
            campaign_id: insertLog.rows[0].id,
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
            fallback_sms_count: fallbackSmsCount,
            failures: failures.slice(0, 25),
        });
    } catch (err) {
        console.error('CAMPAIGN RUN ERROR:', err.message);
        return fail(res, 500, 'CAMPAIGN_RUN_FAILED', 'Failed to run campaign automation.');
    }
});

// --- 6. CAMPAIGN HISTORY LOG ---
router.get('/campaign/logs', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const gymId = req.user.gym_id;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
        const logs = await pool.query(
            `SELECT id, segment, channel, message, sent_to_count, status, created_at
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

// --- 7. DEEPER CHURN SCORES ---
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