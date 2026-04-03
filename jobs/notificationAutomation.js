const { pool } = require('../config/db');
const { getGymTimezone, DEFAULT_GYM_TIMEZONE } = require('../utils/gymTime');
const { sendPushToGym, sendPushToUsers } = require('../routes/push');

const AUTOMATION_SLOTS = [
    { key: 'MORNING', startHour: 9, endHour: 11 },
    { key: 'AFTERNOON', startHour: 13, endHour: 15 },
    { key: 'EVENING', startHour: 18, endHour: 20 },
];

const PUSH_ROLES = ['OWNER', 'STAFF'];
const MEMBER_ROLE = 'MEMBER';
const MEMBER_APP_URL = '/login';
const DEFAULT_AUTOMATION_SETTINGS = {
    owner_staff_enabled: true,
    member_push_enabled: true,
    owner_staff_slots: {
        MORNING: true,
        AFTERNOON: true,
        EVENING: true,
    },
    member_slots: {
        MORNING: true,
        AFTERNOON: false,
        EVENING: true,
    },
    member_max_per_slot: 25,
};

let ensureAutomationSchemaPromise;
let automationRunPromise;

const toInt = (value) => Number.parseInt(value, 10) || 0;
const toNumber = (value) => Number.parseFloat(value) || 0;
const pluralize = (count, singular, plural = `${singular}s`) => (count === 1 ? singular : plural);
const firstName = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || 'Champion';

const formatCurrency = (amount, currencyCode = 'INR') => {
    const value = Math.max(0, Math.round(toNumber(amount)));
    const code = String(currencyCode || 'INR').trim().toUpperCase() || 'INR';
    try {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: code,
            maximumFractionDigits: 0,
        }).format(value);
    } catch (_err) {
        return `${code} ${value}`;
    }
};

const normalizeAutomationSettings = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    return {
        owner_staff_enabled: raw.owner_staff_enabled !== false,
        member_push_enabled: raw.member_push_enabled !== false,
        owner_staff_slots: {
            ...DEFAULT_AUTOMATION_SETTINGS.owner_staff_slots,
            ...(raw.owner_staff_slots && typeof raw.owner_staff_slots === 'object' ? raw.owner_staff_slots : {}),
        },
        member_slots: {
            ...DEFAULT_AUTOMATION_SETTINGS.member_slots,
            ...(raw.member_slots && typeof raw.member_slots === 'object' ? raw.member_slots : {}),
        },
        member_max_per_slot: Math.min(100, Math.max(1, toInt(raw.member_max_per_slot) || DEFAULT_AUTOMATION_SETTINGS.member_max_per_slot)),
    };
};

const isSlotEnabled = (slotMap, slotKey) => slotMap?.[slotKey] !== false;

const getLocalTimeContext = (timezone) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || DEFAULT_GYM_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));

    return {
        localDate: `${parts.year}-${parts.month}-${parts.day}`,
        localHour: toInt(parts.hour),
        localMinute: toInt(parts.minute),
    };
};

const getActiveSlot = (localHour) => AUTOMATION_SLOTS.find((slot) => localHour >= slot.startHour && localHour < slot.endHour) || null;

const normalizeSlotKey = (value) => {
    const key = String(value || '').trim().toUpperCase();
    return AUTOMATION_SLOTS.find((slot) => slot.key === key) || null;
};

const ensureAutomationSchema = async () => {
    if (!ensureAutomationSchemaPromise) {
        ensureAutomationSchemaPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS platform_settings (
                id INTEGER PRIMARY KEY,
                maintenance_mode BOOLEAN DEFAULT FALSE,
                maintenance_message TEXT DEFAULT '',
                feature_flags JSONB DEFAULT '{"support": true, "attendance": true, "billing": true}'::jsonb,
                automation_settings JSONB DEFAULT '{"owner_staff_enabled": true, "member_push_enabled": true, "owner_staff_slots": {"MORNING": true, "AFTERNOON": true, "EVENING": true}, "member_slots": {"MORNING": true, "AFTERNOON": false, "EVENING": true}, "member_max_per_slot": 25}'::jsonb,
                support_profile JSONB DEFAULT '{"phone":"+91 00000 00000","email":"support@gymvault.com","whatsapp":"+91 00000 00000","about":"GymVault helps gym owners run operations with fast, reliable support.","address":"Head Office, India","timings":"Mon-Sat · 9:00 AM to 7:00 PM IST"}'::jsonb,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS notification_automation_log (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                local_date       DATE NOT NULL,
                slot_key         VARCHAR(30) NOT NULL,
                automation_key   VARCHAR(60) NOT NULL,
                notification_id  INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
                title            VARCHAR(200) NOT NULL,
                message          TEXT NOT NULL,
                context_snapshot JSONB DEFAULT '{}'::jsonb,
                push_sent_count  INTEGER DEFAULT 0,
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (gym_id, local_date, slot_key)
            );
            CREATE TABLE IF NOT EXISTS member_notification_automation_log (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id        INTEGER REFERENCES members(id) ON DELETE CASCADE,
                local_date       DATE NOT NULL,
                slot_key         VARCHAR(30) NOT NULL,
                automation_key   VARCHAR(60) NOT NULL,
                title            VARCHAR(200) NOT NULL,
                message          TEXT NOT NULL,
                push_sent_count  INTEGER DEFAULT 0,
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (gym_id, member_id, local_date)
            );
            CREATE INDEX IF NOT EXISTS idx_notification_automation_log_gym_date ON notification_automation_log(gym_id, local_date DESC);
            CREATE INDEX IF NOT EXISTS idx_notification_automation_log_created_at ON notification_automation_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_member_notification_automation_log_gym_date ON member_notification_automation_log(gym_id, local_date DESC);
            CREATE INDEX IF NOT EXISTS idx_member_notification_automation_log_member_date ON member_notification_automation_log(member_id, local_date DESC);
            ALTER TABLE platform_settings
            ADD COLUMN IF NOT EXISTS automation_settings JSONB
            DEFAULT '{"owner_staff_enabled": true, "member_push_enabled": true, "owner_staff_slots": {"MORNING": true, "AFTERNOON": true, "EVENING": true}, "member_slots": {"MORNING": true, "AFTERNOON": false, "EVENING": true}, "member_max_per_slot": 25}'::jsonb;
            INSERT INTO platform_settings (id)
            VALUES (1)
            ON CONFLICT (id) DO NOTHING;
        `);
    }

    await ensureAutomationSchemaPromise;
};

const getPlatformAutomationSettings = async () => {
    const result = await pool.query('SELECT automation_settings FROM platform_settings WHERE id = 1 LIMIT 1').catch(() => ({ rows: [] }));
    return normalizeAutomationSettings(result.rows[0]?.automation_settings);
};

const getGymMetrics = async (gymId, timezone) => {
    const result = await pool.query(
        `WITH latest_due AS (
            SELECT DISTINCT ON (p.user_id)
                p.user_id,
                COALESCE(p.amount_due, 0) AS amount_due
            FROM payments p
            WHERE p.gym_id = $1
              AND p.deleted_at IS NULL
            ORDER BY p.user_id, p.payment_date DESC NULLS LAST, p.id DESC
        )
        SELECT
            COALESCE((
                SELECT COUNT(DISTINCT ms.member_id)::INT
                FROM memberships ms
                WHERE ms.gym_id = $1
                  AND ms.deleted_at IS NULL
                  AND ms.status = 'ACTIVE'
                  AND ms.end_date BETWEEN timezone($2, NOW())::date AND (timezone($2, NOW())::date + 3)
            ), 0) AS expiring_3d_count,
            COALESCE((
                SELECT COUNT(DISTINCT ms.member_id)::INT
                FROM memberships ms
                WHERE ms.gym_id = $1
                  AND ms.deleted_at IS NULL
                  AND ms.status = 'ACTIVE'
                  AND ms.end_date BETWEEN timezone($2, NOW())::date AND (timezone($2, NOW())::date + 7)
            ), 0) AS expiring_7d_count,
            COALESCE((
                SELECT COUNT(*)::INT
                FROM latest_due ld
                WHERE ld.amount_due > 0
            ), 0) AS due_members_count,
            COALESCE((
                SELECT ROUND(SUM(ld.amount_due), 2)
                FROM latest_due ld
                WHERE ld.amount_due > 0
            ), 0) AS total_due_amount,
            COALESCE((
                SELECT COUNT(*)::INT
                FROM members m
                WHERE m.gym_id = $1
                  AND m.deleted_at IS NULL
                  AND timezone($2, COALESCE(m.last_visit, m.created_at))::date <= (timezone($2, NOW())::date - 10)
            ), 0) AS inactive_10d_count,
            COALESCE((
                SELECT COUNT(*)::INT
                FROM leads l
                WHERE l.gym_id = $1
                  AND COALESCE(UPPER(l.status), 'NEW') NOT IN ('LOST', 'CONVERTED')
                  AND l.next_follow_up_at IS NOT NULL
                  AND timezone($2, l.next_follow_up_at) <= timezone($2, NOW())
            ), 0) AS due_leads_count,
            COALESCE((
                SELECT COUNT(*)::INT
                FROM attendance a
                WHERE a.gym_id = $1
                  AND a.deleted_at IS NULL
                  AND timezone($2, a.check_in_time)::date = timezone($2, NOW())::date
            ), 0) AS today_checkins,
            COALESCE((
                SELECT ROUND(AVG(day_count)::numeric, 1)
                FROM (
                    SELECT timezone($2, a.check_in_time)::date AS local_day, COUNT(*)::INT AS day_count
                    FROM attendance a
                    WHERE a.gym_id = $1
                      AND a.deleted_at IS NULL
                      AND timezone($2, a.check_in_time)::date >= (timezone($2, NOW())::date - 7)
                      AND timezone($2, a.check_in_time)::date < timezone($2, NOW())::date
                    GROUP BY timezone($2, a.check_in_time)::date
                ) daily_counts
            ), 0) AS avg_daily_checkins_7d,
            COALESCE((
                SELECT COUNT(*)::INT
                FROM plans p
                WHERE p.gym_id = $1
                  AND p.deleted_at IS NULL
            ), 0) AS active_plans_count,
            COALESCE((
                SELECT COUNT(*)::INT
                FROM members m
                WHERE m.gym_id = $1
                  AND m.deleted_at IS NULL
            ), 0) AS members_count`,
        [gymId, timezone]
    );

    return result.rows[0] || {};
};

const buildSetupNudge = (metrics) => {
    const plansCount = toInt(metrics.active_plans_count);
    const membersCount = toInt(metrics.members_count);
    if (plansCount > 0 && membersCount > 0) return null;

    return {
        key: 'SETUP_FOCUS',
        title: 'Your next move is obvious',
        body: plansCount === 0
            ? 'No plans are live yet. Set up one sharp starter plan this morning so every walk-in has a clear yes-path.'
            : 'Your plan shelf is ready. Add the next few members today so the dashboard starts compounding with real data.',
        url: plansCount === 0 ? '/plans' : '/members',
    };
};

const buildLeadNudge = (metrics) => {
    const dueLeads = toInt(metrics.due_leads_count);
    if (dueLeads <= 0) return null;

    return {
        key: 'LEAD_SPRINT',
        title: 'Lead queue is warm',
        body: `${dueLeads} follow-up ${pluralize(dueLeads, 'lead')} ${dueLeads === 1 ? 'is' : 'are'} ready today. A quick callback sprint before the day gets noisy can turn curiosity into walk-ins.`,
        url: '/dashboard',
    };
};

const buildRenewalNudge = (count, variant = 'FINAL_3_DAYS') => {
    const total = toInt(count);
    if (total <= 0) return null;

    if (variant === 'FINAL_3_DAYS') {
        return {
            key: 'RENEWAL_RADAR',
            title: 'Renewals are within reach',
            body: `${total} ${pluralize(total, 'membership')} enter${total === 1 ? 's' : ''} the final 3-day window today. One crisp follow-up can lock revenue before the day slips away.`,
            url: '/members',
        };
    }

    return {
        key: 'RENEWAL_WEEK',
        title: 'Renewal week just opened',
        body: `${total} ${pluralize(total, 'member')} ${total === 1 ? 'is' : 'are'} now inside renewal week. Get ahead of the rush and make the rejoin decision feel easy.`,
        url: '/members',
    };
};

const buildAttendancePulse = (metrics) => {
    const todayCheckins = toInt(metrics.today_checkins);
    const avgDaily = Math.round(toNumber(metrics.avg_daily_checkins_7d));
    if (avgDaily < 8) return null;

    const softFloor = Math.max(4, Math.floor(avgDaily * 0.6));
    if (todayCheckins >= softFloor) return null;

    return {
        key: 'ATTENDANCE_PULSE',
        title: 'The floor could use a lift',
        body: `${todayCheckins} check-ins so far against a ${avgDaily}/day recent rhythm. One story, one class ping, or one comeback call can still lift the evening rush.`,
        url: '/attendance',
    };
};

const buildCollectionsNudge = (metrics, currency) => {
    const dueMembers = toInt(metrics.due_members_count);
    const totalDue = toNumber(metrics.total_due_amount);
    if (dueMembers <= 0 || totalDue <= 0) return null;

    return {
        key: 'COLLECTIONS_PUSH',
        title: 'Collections are still on the table',
        body: `${formatCurrency(totalDue, currency)} is still waiting across ${dueMembers} ${pluralize(dueMembers, 'account')}. Tonight is a clean window to recover dues while intent is still warm.`,
        url: '/payments',
    };
};

const buildWinbackNudge = (metrics) => {
    const inactiveCount = toInt(metrics.inactive_10d_count);
    if (inactiveCount < 3) return null;

    return {
        key: 'WINBACK_LIST',
        title: 'Your comeback list is ready',
        body: `${inactiveCount} ${pluralize(inactiveCount, 'member')} ${inactiveCount === 1 ? 'has' : 'have'} been quiet for 10+ days. A smart nudge tonight can wake up stalled routines before they go cold.`,
        url: '/members',
    };
};

const pickInternalNotificationCandidate = ({ slot, metrics, gym }) => {
    if (!slot) return null;

    if (slot.key === 'MORNING') {
        return (
            buildSetupNudge(metrics) ||
            buildLeadNudge(metrics) ||
            buildRenewalNudge(metrics.expiring_3d_count, 'FINAL_3_DAYS') ||
            buildCollectionsNudge(metrics, gym.currency) ||
            buildWinbackNudge(metrics)
        );
    }

    if (slot.key === 'AFTERNOON') {
        return (
            buildAttendancePulse(metrics) ||
            buildRenewalNudge(metrics.expiring_7d_count, 'WEEK') ||
            buildLeadNudge(metrics) ||
            buildWinbackNudge(metrics)
        );
    }

    return (
        buildCollectionsNudge(metrics, gym.currency) ||
        buildWinbackNudge(metrics) ||
        buildRenewalNudge(metrics.expiring_3d_count, 'FINAL_3_DAYS')
    );
};

const createNotificationAndLog = async ({ gymId, localDate, slotKey, candidate, metrics }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const logInsert = await client.query(
            `INSERT INTO notification_automation_log (gym_id, local_date, slot_key, automation_key, title, message, context_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             ON CONFLICT (gym_id, local_date, slot_key) DO NOTHING
             RETURNING id`,
            [
                gymId,
                localDate,
                slotKey,
                candidate.key,
                candidate.title,
                candidate.body,
                JSON.stringify({ url: candidate.url, metrics }),
            ]
        );

        if (logInsert.rows.length === 0) {
            await client.query('ROLLBACK');
            return { skipped: 'already-sent' };
        }

        const notificationInsert = await client.query(
            `INSERT INTO notifications (gym_id, title, message)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [gymId, candidate.title, candidate.body]
        );

        await client.query(
            `UPDATE notification_automation_log
             SET notification_id = $2
             WHERE id = $1`,
            [logInsert.rows[0].id, notificationInsert.rows[0].id]
        );

        await client.query('COMMIT');
        return { logId: logInsert.rows[0].id, notificationId: notificationInsert.rows[0].id };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
};

const getMemberPushRecipients = async ({ gymId, timezone, localDate, criteria, limit }) => {
    const result = await pool.query(
        `WITH subscribed_members AS (
            SELECT DISTINCT user_id AS member_id
            FROM push_subscriptions
            WHERE gym_id = $1
              AND role = $4
              AND user_id IS NOT NULL
        ),
        latest_membership AS (
            SELECT DISTINCT ON (ms.member_id)
                ms.member_id,
                ms.status,
                ms.end_date
            FROM memberships ms
            WHERE ms.gym_id = $1
              AND ms.deleted_at IS NULL
            ORDER BY ms.member_id, ms.end_date DESC NULLS LAST, ms.created_at DESC
        ),
        latest_due AS (
            SELECT DISTINCT ON (p.user_id)
                p.user_id,
                COALESCE(p.amount_due, 0) AS amount_due
            FROM payments p
            WHERE p.gym_id = $1
              AND p.deleted_at IS NULL
            ORDER BY p.user_id, p.payment_date DESC NULLS LAST, p.id DESC
        )
        SELECT
            m.id,
            m.full_name,
            COALESCE(lm.end_date - $2::date, 0)::INT AS days_to_expiry,
            COALESCE(ld.amount_due, 0)::NUMERIC(10, 2) AS amount_due,
            ($2::date - timezone($3, COALESCE(m.last_visit, m.created_at))::date)::INT AS days_inactive
        FROM members m
        JOIN subscribed_members sm ON sm.member_id = m.id
        LEFT JOIN latest_membership lm ON lm.member_id = m.id
        LEFT JOIN latest_due ld ON ld.user_id = m.id
        WHERE m.gym_id = $1
          AND m.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM member_notification_automation_log log
              WHERE log.gym_id = $1
                AND log.member_id = m.id
                AND log.local_date = $2::date
          )
          AND ${criteria}
        ORDER BY
          CASE
              WHEN COALESCE(lm.end_date - $2::date, 9999) < 0 THEN 9999
              ELSE COALESCE(lm.end_date - $2::date, 9999)
          END ASC,
          COALESCE(ld.amount_due, 0) DESC,
          ($2::date - timezone($3, COALESCE(m.last_visit, m.created_at))::date) DESC,
          m.full_name ASC
        LIMIT $5`,
        [gymId, localDate, timezone, MEMBER_ROLE, limit]
    );

    return result.rows;
};

const buildMemberRenewalCampaign = async ({ gym, timezone, localDate, limit }) => {
    const recipients = await getMemberPushRecipients({
        gymId: gym.id,
        timezone,
        localDate,
        limit,
        criteria: `lm.status = 'ACTIVE' AND lm.end_date BETWEEN $2::date AND ($2::date + 3)`,
    });

    if (recipients.length === 0) return null;

    return {
        key: 'MEMBER_RENEWAL',
        audience: 'MEMBER',
        slotTitle: 'Member renewal push',
        recipients,
        compose: (member) => {
            const daysLeft = Math.max(0, toInt(member.days_to_expiry));
            return {
                title: 'Your plan is almost out of reps',
                body: `${firstName(member.full_name)}, ${gym.name} access wraps in ${daysLeft} ${pluralize(daysLeft, 'day')}. Renew today and keep your streak moving, not paused.`,
                url: MEMBER_APP_URL,
                icon: '/vite.svg',
                badge: '/vite.svg',
                tag: `gymvault-member-renewal-${gym.id}`,
            };
        },
    };
};

const buildMemberDueCampaign = async ({ gym, timezone, localDate, limit }) => {
    const recipients = await getMemberPushRecipients({
        gymId: gym.id,
        timezone,
        localDate,
        limit,
        criteria: `COALESCE(ld.amount_due, 0) > 0`,
    });

    if (recipients.length === 0) return null;

    return {
        key: 'MEMBER_DUE',
        audience: 'MEMBER',
        slotTitle: 'Member due reminder',
        recipients,
        compose: (member) => ({
            title: 'A quick clear-up keeps you moving',
            body: `${firstName(member.full_name)}, ${formatCurrency(member.amount_due, gym.currency)} is still pending on your plan. Clear it today and keep your next entry smooth.`,
            url: MEMBER_APP_URL,
            icon: '/vite.svg',
            badge: '/vite.svg',
            tag: `gymvault-member-due-${gym.id}`,
        }),
    };
};

const buildMemberComebackCampaign = async ({ gym, timezone, localDate, limit }) => {
    const recipients = await getMemberPushRecipients({
        gymId: gym.id,
        timezone,
        localDate,
        limit,
        criteria: `($2::date - timezone($3, COALESCE(m.last_visit, m.created_at))::date) >= 7`,
    });

    if (recipients.length === 0) return null;

    return {
        key: 'MEMBER_COMEBACK',
        audience: 'MEMBER',
        slotTitle: 'Member comeback push',
        recipients,
        compose: (member) => ({
            title: 'Your spot is still warm',
            body: `${firstName(member.full_name)}, it has been ${toInt(member.days_inactive)} days since your last workout. One session today can flip the whole week back in your favour.`,
            url: MEMBER_APP_URL,
            icon: '/vite.svg',
            badge: '/vite.svg',
            tag: `gymvault-member-comeback-${gym.id}`,
        }),
    };
};

const pickMemberCampaign = async ({ gym, slot, timezone, localDate, settings }) => {
    if (!slot) return null;
    const limit = settings.member_max_per_slot || DEFAULT_AUTOMATION_SETTINGS.member_max_per_slot;

    if (slot.key === 'MORNING') {
        return (
            await buildMemberRenewalCampaign({ gym, timezone, localDate, limit }) ||
            await buildMemberDueCampaign({ gym, timezone, localDate, limit })
        );
    }

    if (slot.key === 'AFTERNOON') {
        return (
            await buildMemberDueCampaign({ gym, timezone, localDate, limit }) ||
            await buildMemberComebackCampaign({ gym, timezone, localDate, limit })
        );
    }

    return (
        await buildMemberComebackCampaign({ gym, timezone, localDate, limit }) ||
        await buildMemberRenewalCampaign({ gym, timezone, localDate, limit })
    );
};

const createMemberCampaignLogs = async ({ gymId, localDate, slotKey, campaign }) => {
    if (!campaign?.recipients?.length) return [];

    const prepared = campaign.recipients.map((member) => ({ member, payload: campaign.compose(member) }));
    const values = [];
    const placeholders = prepared.map(({ member, payload }, index) => {
        const offset = index * 7;
        values.push(gymId, member.id, localDate, slotKey, campaign.key, payload.title, payload.body);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });

    const inserted = await pool.query(
        `INSERT INTO member_notification_automation_log (gym_id, member_id, local_date, slot_key, automation_key, title, message)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (gym_id, member_id, local_date) DO NOTHING
         RETURNING id, member_id`,
        values
    );

    return prepared
        .filter(({ member }) => inserted.rows.some((row) => Number(row.member_id) === Number(member.id)))
        .map((entry) => ({
            ...entry,
            logId: inserted.rows.find((row) => Number(row.member_id) === Number(entry.member.id))?.id,
        }));
};

const runAutomatedNotificationNudges = async ({ dryRun = false, forceSlot = null } = {}) => {
    if (!dryRun && automationRunPromise) {
        return automationRunPromise;
    }

    const task = (async () => {
        await ensureAutomationSchema();
        const automationSettings = await getPlatformAutomationSettings();

        const gymsRes = await pool.query(
            `SELECT id, name, COALESCE(NULLIF(currency, ''), 'INR') AS currency, COALESCE(NULLIF(timezone, ''), $1) AS timezone
             FROM gyms`,
            [DEFAULT_GYM_TIMEZONE]
        );

        const summary = {
            processed: 0,
            sent: 0,
            internal_campaigns_sent: 0,
            member_campaigns_sent: 0,
            member_pushes_sent: 0,
            skipped: 0,
            candidates: [],
            errors: [],
        };

        for (const gym of gymsRes.rows) {
            summary.processed += 1;

            try {
                const timezone = await getGymTimezone(pool, gym.id).catch(() => gym.timezone || DEFAULT_GYM_TIMEZONE);
                const localContext = getLocalTimeContext(timezone);
                const slot = normalizeSlotKey(forceSlot) || getActiveSlot(localContext.localHour);

                if (!slot) {
                    summary.skipped += 1;
                    continue;
                }

                const metrics = await getGymMetrics(gym.id, timezone);
                let hasCandidate = false;
                let deliveredSomething = false;

                if (automationSettings.owner_staff_enabled && isSlotEnabled(automationSettings.owner_staff_slots, slot.key)) {
                    const internalCandidate = pickInternalNotificationCandidate({ slot, metrics, gym });
                    if (internalCandidate) {
                        hasCandidate = true;
                        if (dryRun) {
                            summary.candidates.push({
                                audience: 'OWNER_STAFF',
                                gym_id: gym.id,
                                gym_name: gym.name,
                                slot: slot.key,
                                candidate: internalCandidate,
                            });
                        } else {
                            const notificationRecord = await createNotificationAndLog({
                                gymId: gym.id,
                                localDate: localContext.localDate,
                                slotKey: slot.key,
                                candidate: internalCandidate,
                                metrics,
                            });

                            if (!notificationRecord.skipped) {
                                const pushSent = await sendPushToGym(
                                    gym.id,
                                    {
                                        title: internalCandidate.title,
                                        body: internalCandidate.body,
                                        icon: '/vite.svg',
                                        badge: '/vite.svg',
                                        url: internalCandidate.url || '/dashboard',
                                        tag: `gymvault-auto-${slot.key.toLowerCase()}-${internalCandidate.key.toLowerCase()}`,
                                    },
                                    PUSH_ROLES
                                );

                                await pool.query(
                                    `UPDATE notification_automation_log
                                     SET push_sent_count = $2
                                     WHERE id = $1`,
                                    [notificationRecord.logId, pushSent]
                                ).catch(() => {});

                                summary.sent += 1;
                                summary.internal_campaigns_sent += 1;
                                deliveredSomething = true;
                            }
                        }
                    }
                }

                if (automationSettings.member_push_enabled && isSlotEnabled(automationSettings.member_slots, slot.key)) {
                    const memberCampaign = await pickMemberCampaign({
                        gym,
                        slot,
                        timezone,
                        localDate: localContext.localDate,
                        settings: automationSettings,
                    });

                    if (memberCampaign) {
                        hasCandidate = true;
                        if (dryRun) {
                            summary.candidates.push({
                                audience: 'MEMBER',
                                gym_id: gym.id,
                                gym_name: gym.name,
                                slot: slot.key,
                                candidate: {
                                    key: memberCampaign.key,
                                    title: memberCampaign.slotTitle,
                                    recipients: memberCampaign.recipients.length,
                                    preview: memberCampaign.compose(memberCampaign.recipients[0]),
                                },
                            });
                        } else {
                            const insertedLogs = await createMemberCampaignLogs({
                                gymId: gym.id,
                                localDate: localContext.localDate,
                                slotKey: slot.key,
                                campaign: memberCampaign,
                            });

                            if (insertedLogs.length > 0) {
                                const pushResult = await sendPushToUsers(
                                    gym.id,
                                    insertedLogs.map((entry) => entry.member.id),
                                    (userId) => insertedLogs.find((entry) => Number(entry.member.id) === Number(userId))?.payload,
                                    MEMBER_ROLE
                                );

                                await Promise.all(insertedLogs.map((entry) => pool.query(
                                    `UPDATE member_notification_automation_log
                                     SET push_sent_count = $2
                                     WHERE id = $1`,
                                    [entry.logId, pushResult.deliveredByUser?.[entry.member.id] || 0]
                                ))).catch(() => {});

                                summary.sent += 1;
                                summary.member_campaigns_sent += 1;
                                summary.member_pushes_sent += pushResult.delivered;
                                deliveredSomething = true;
                            }
                        }
                    }
                }

                if ((dryRun && !hasCandidate) || (!dryRun && !deliveredSomething)) {
                    summary.skipped += 1;
                }
            } catch (err) {
                summary.errors.push({ gym_id: gym.id, message: err.message });
            }
        }

        if (summary.errors.length > 0) {
            console.error('AUTOMATED NOTIFICATION NUDGE ERRORS:', summary.errors);
        }

        return summary;
    })();

    if (dryRun) {
        return task;
    }

    automationRunPromise = task.finally(() => {
        automationRunPromise = null;
    });
    return automationRunPromise;
};

module.exports = {
    runAutomatedNotificationNudges,
};