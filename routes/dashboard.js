const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');
const { resolveBranchReadScope } = require('../utils/branchAccess');
const { cacheGet, cacheSet, buildCacheKey } = require('../utils/cache');

const DASHBOARD_STATS_TTL = 15; // seconds

router.use(auth, saasMiddleware, requireOwner);

let ensureDashboardSetupSchemaPromise;

const ensureDashboardSetupSchema = async () => {
    if (!ensureDashboardSetupSchemaPromise) {
        ensureDashboardSetupSchemaPromise = pool.query(`
            ALTER TABLE gyms
            ADD COLUMN IF NOT EXISTS messaging_whatsapp_status VARCHAR(30) DEFAULT 'NOT_CONFIGURED',
            ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120),
            ADD COLUMN IF NOT EXISTS member_payments_onboarding_status VARCHAR(30) DEFAULT 'NOT_CONNECTED';
        `).catch((error) => {
            ensureDashboardSetupSchemaPromise = null;
            throw error;
        });
    }

    await ensureDashboardSetupSchemaPromise;
};

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
    const gym_id = req.user.gym_id; 

    try {
        const scope = await resolveBranchReadScope(pool, req);
        const branchCondition = scope.branchId ? ` AND branch_id = '${scope.branchId.replace(/[^a-z0-9_-]/g, '')}'` : '';

        const cacheKey = buildCacheKey('dashboard', 'stats', gym_id, scope.branchId || 'all');
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const result = await pool.query(
            `WITH gym_base AS (
                SELECT id, COALESCE(is_active, TRUE) AS is_active
                FROM gyms
                WHERE id = $1
                LIMIT 1
            ),
            payments_summary AS (
                SELECT
                    COALESCE(SUM(amount_paid), 0) AS total_earnings,
                    COALESCE(
                        SUM(amount_paid) FILTER (
                            WHERE payment_date >= DATE_TRUNC('month', CURRENT_DATE)
                              AND payment_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
                        ),
                        0
                    ) AS monthly_revenue
                FROM payments
                WHERE gym_id = $1 AND deleted_at IS NULL${branchCondition}
            ),
            members_summary AS (
                SELECT
                    COUNT(*) FILTER (WHERE status = 'UNPAID')::INTEGER AS unpaid_members,
                    COUNT(*) FILTER (
                        WHERE COALESCE(last_visit, joining_date::timestamptz, NOW()) < NOW() - INTERVAL '14 days'
                    )::INTEGER AS inactive_members
                FROM members
                WHERE gym_id = $1 AND deleted_at IS NULL${branchCondition}
            ),
            memberships_summary AS (
                SELECT
                    COUNT(DISTINCT member_id) FILTER (WHERE status = 'ACTIVE')::INTEGER AS active_members,
                    COUNT(*) FILTER (
                        WHERE status = 'ACTIVE'
                          AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
                    )::INTEGER AS expiring_soon,
                    COUNT(DISTINCT member_id) FILTER (WHERE status = 'EXPIRED')::INTEGER AS expired_members
                FROM memberships
                WHERE gym_id = $1 AND deleted_at IS NULL${branchCondition}
            ),
            attendance_summary AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE check_in_time >= CURRENT_DATE
                          AND check_in_time < CURRENT_DATE + INTERVAL '1 day'
                    )::INTEGER AS today_checkins
                FROM attendance
                WHERE gym_id = $1 AND deleted_at IS NULL${branchCondition}
            )
            SELECT
                g.is_active,
                COALESCE(ms.active_members, 0) AS active_members,
                COALESCE(ps.total_earnings, 0) AS total_earnings,
                COALESCE(ps.monthly_revenue, 0) AS monthly_revenue,
                COALESCE(ms.expiring_soon, 0) AS expiring_soon,
                COALESCE(att.today_checkins, 0) AS today_checkins,
                COALESCE(mb.unpaid_members, 0) AS unpaid_members,
                COALESCE(ms.expired_members, 0) AS expired_members,
                COALESCE(mb.inactive_members, 0) AS inactive_members
            FROM gym_base g
            LEFT JOIN payments_summary ps ON TRUE
            LEFT JOIN members_summary mb ON TRUE
            LEFT JOIN memberships_summary ms ON TRUE
            LEFT JOIN attendance_summary att ON TRUE`,
            [gym_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Gym not found." });
        }

        if (result.rows[0].is_active === false) {
            return res.json({ is_active: false });
        }

        const statsResponse = {
            is_active: true,
            active_members: parseInt(result.rows[0].active_members || 0, 10),
            total_earnings: parseFloat(result.rows[0].total_earnings || 0),
            monthly_revenue: parseFloat(result.rows[0].monthly_revenue || 0),
            expiring_soon: parseInt(result.rows[0].expiring_soon || 0, 10),
            today_checkins: parseInt(result.rows[0].today_checkins || 0, 10),
            unpaid_members: parseInt(result.rows[0].unpaid_members || 0, 10),
            expired_members: parseInt(result.rows[0].expired_members || 0, 10),
            inactive_members: parseInt(result.rows[0].inactive_members || 0, 10)
        };

        await cacheSet(cacheKey, statsResponse, DASHBOARD_STATS_TTL);
        res.json(statsResponse);

    } catch (err) {
        console.error("DASHBOARD STATS ERROR:", err.message);
        res.status(500).json({ error: "Dashboard Stats Error" });
    }
});

// --- GET ONBOARDING SETUP STATUS ---
router.get('/setup-status', async (req, res) => {
    const gym_id = req.user.gym_id;

    try {
        await ensureDashboardSetupSchema();
        const result = await pool.query(
            `SELECT
                (
                    COALESCE(LENGTH(BTRIM(name)), 0) > 1
                    AND COALESCE(LENGTH(BTRIM(address)), 0) > 5
                    AND (
                        COALESCE(LENGTH(BTRIM(phone)), 0) > 0
                        OR COALESCE(LENGTH(BTRIM(support_email)), 0) > 0
                        OR COALESCE(LENGTH(BTRIM(website)), 0) > 0
                    )
                ) AS step1_profile,
                EXISTS (
                    SELECT 1
                    FROM plans p
                    WHERE p.gym_id = g.id AND p.deleted_at IS NULL
                    LIMIT 1
                ) AS step2_plans,
                EXISTS (
                    SELECT 1
                    FROM members m
                    WHERE m.gym_id = g.id AND m.deleted_at IS NULL
                    LIMIT 1
                ) AS step3_members,
                (COALESCE(UPPER(g.messaging_whatsapp_status), 'NOT_CONFIGURED') = 'CONNECTED') AS whatsapp_ready,
                (
                    COALESCE(LENGTH(BTRIM(g.member_upi_id)), 0) > 0
                    OR COALESCE(UPPER(g.member_payments_onboarding_status), 'NOT_CONNECTED') IN ('CONNECTED', 'ACTIVE')
                ) AS payments_ready
             FROM gyms g
             WHERE g.id = $1
             LIMIT 1`,
            [gym_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Gym not found.' });
        }

        const step1_profile = Boolean(result.rows[0].step1_profile);
        const step2_plans = Boolean(result.rows[0].step2_plans);
        const step3_members = Boolean(result.rows[0].step3_members);
        const whatsappReady = Boolean(result.rows[0].whatsapp_ready);
        const paymentsReady = Boolean(result.rows[0].payments_ready);

        // Core setup progress intentionally stays tied to the first-run essentials.
        let completedCount = 0;
        if (step1_profile) completedCount++;
        if (step2_plans) completedCount++;
        if (step3_members) completedCount++;

        const progress = Math.round((completedCount / 3) * 100);

        res.json({
            progress: progress,
            is_complete: progress === 100,
            steps: {
                profile: step1_profile,
                plans: step2_plans,
                members: step3_members
            },
            recommended: {
                whatsapp: whatsappReady,
                payments: paymentsReady,
            }
        });

    } catch (err) {
        console.error("SETUP STATUS ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;