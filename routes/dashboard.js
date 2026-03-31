const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');

router.use(auth, saasMiddleware, requireOwner);

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
    const gym_id = req.user.gym_id; 

    try {
        const gymCheck = await pool.query(
            'SELECT is_active FROM gyms WHERE id = $1', 
            [gym_id]
        );

        if (gymCheck.rows.length === 0) {
            return res.status(404).json({ message: "Gym not found." });
        }

        if (gymCheck.rows[0].is_active === false) {
            return res.json({ is_active: false });
        }

        const [
            activeMembers,
            totalEarnings,
            monthlyRevenue,
            expiringSoon,
            todayCheckins,
            unpaidMembers,
            expiredMembers
        ] = await Promise.all([

            pool.query(
                `SELECT COUNT(DISTINCT member_id) AS count
                 FROM memberships
                 WHERE status = 'ACTIVE' AND gym_id = $1 AND deleted_at IS NULL`,
                [gym_id]
            ),

            pool.query(
                `SELECT COALESCE(SUM(amount_paid), 0) AS total
                 FROM payments WHERE gym_id = $1 AND deleted_at IS NULL`,
                [gym_id]
            ),

            pool.query(
                `SELECT COALESCE(SUM(amount_paid), 0) AS total
                 FROM payments
                 WHERE gym_id = $1
                                     AND deleted_at IS NULL
                   AND EXTRACT(MONTH FROM payment_date) = EXTRACT(MONTH FROM CURRENT_DATE)
                   AND EXTRACT(YEAR  FROM payment_date) = EXTRACT(YEAR  FROM CURRENT_DATE)`,
                [gym_id]
            ),

            pool.query(
                `SELECT COUNT(*) AS count
                 FROM memberships
                 WHERE status = 'ACTIVE'
                   AND gym_id = $1
                                     AND deleted_at IS NULL
                   AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`,
                [gym_id]
            ),

            pool.query(
                `SELECT COUNT(*) AS count
                 FROM attendance
                 WHERE gym_id = $1
                                     AND deleted_at IS NULL
                   AND check_in_time::date = CURRENT_DATE`,
                [gym_id]
            ),

            pool.query(
                `SELECT COUNT(*) AS count
                 FROM members
                 WHERE gym_id = $1 AND status = 'UNPAID' AND deleted_at IS NULL`,
                [gym_id]
            ),

            pool.query(
                `SELECT COUNT(DISTINCT member_id) AS count
                 FROM memberships
                 WHERE status = 'EXPIRED' AND gym_id = $1 AND deleted_at IS NULL`,
                [gym_id]
            )
        ]);

        res.json({
            is_active: true,
            active_members:   parseInt(activeMembers.rows[0].count),
            total_earnings:   parseFloat(totalEarnings.rows[0].total),
            monthly_revenue:  parseFloat(monthlyRevenue.rows[0].total),
            expiring_soon:    parseInt(expiringSoon.rows[0].count),
            today_checkins:   parseInt(todayCheckins.rows[0].count),
            unpaid_members:   parseInt(unpaidMembers.rows[0].count),
            expired_members:  parseInt(expiredMembers.rows[0].count),
            inactive_members: parseInt(expiringSoon.rows[0].count)
        });

    } catch (err) {
        console.error("DASHBOARD STATS ERROR:", err.message);
        res.status(500).json({ error: "Dashboard Stats Error" });
    }
});

// --- GET ONBOARDING SETUP STATUS ---
router.get('/setup-status', async (req, res) => {
    const gym_id = req.user.gym_id;

    try {
        // 1. Check if gym profile is completed (has address and phone)
        const gymQuery = await pool.query('SELECT address, phone FROM gyms WHERE id = $1', [gym_id]);
        const gym = gymQuery.rows[0];
        const step1_profile = Boolean(gym && gym.address && gym.phone && gym.address.length > 5);

        // 2. Check if they have created at least one plan
        const plansQuery = await pool.query('SELECT COUNT(*) FROM plans WHERE gym_id = $1', [gym_id]);
        const step2_plans = parseInt(plansQuery.rows[0].count) > 0;

        // 3. Check if they have added at least one member
        const membersQuery = await pool.query('SELECT COUNT(*) FROM members WHERE gym_id = $1 AND deleted_at IS NULL', [gym_id]);
        const step3_members = parseInt(membersQuery.rows[0].count) > 0;

        // Calculate completion percentage
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
            }
        });

    } catch (err) {
        console.error("SETUP STATUS ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;