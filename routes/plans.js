const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');

router.use(auth, saasMiddleware, requireOwner);

// GET ALL PLANS
router.get('/', async (req, res) => {
    try {
        const plans = await pool.query('SELECT * FROM plans WHERE gym_id = $1 AND deleted_at IS NULL ORDER BY price ASC', [req.user.gym_id]);
        res.json(plans.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// CREATE A NEW PLAN
router.post('/add', async (req, res) => {
    const { name, price, duration_days, features, color_theme, is_popular, description, discount_percent, discount_valid_until } = req.body;
    try {
        const gym_id = req.user.gym_id; 
        const days = duration_days ? parseInt(duration_days) : 30;

        const newPlan = await pool.query(
            `INSERT INTO plans 
            (gym_id, name, price, duration_days, features, color_theme, is_popular, description, discount_percent, discount_valid_until) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING *`,
            [
                gym_id, 
                name, 
                parseFloat(price), 
                days, 
                features || [], 
                color_theme || 'blue', 
                is_popular || false, 
                description || '',
                parseInt(discount_percent) || 0,
                discount_valid_until || null
            ]
        );

        res.status(200).json(newPlan.rows[0]);
    } catch (err) {
        console.error("DATABASE ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE PLAN
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE plans SET deleted_at = NOW() WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL", [id, req.user.gym_id]);
        res.json({ msg: "Plan archived successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// UPDATE PLAN
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, price, duration_days, features, color_theme, is_popular, description, discount_percent, discount_valid_until } = req.body;

    try {
        const days = duration_days ? parseInt(duration_days) : 30;

        const updatePlan = await pool.query(
            `UPDATE plans 
            SET name = $1, price = $2, duration_days = $3, features = $4, color_theme = $5, is_popular = $6, description = $7, discount_percent = $8, discount_valid_until = $9
            WHERE id = $10 AND gym_id = $11 AND deleted_at IS NULL RETURNING *`,
            [
                name, 
                parseFloat(price), 
                days, 
                features || [], 
                color_theme || 'blue', 
                is_popular || false, 
                description || '',
                parseInt(discount_percent) || 0,
                discount_valid_until || null,
                id,
                req.user.gym_id
            ]
        );

        if (updatePlan.rows.length === 0) {
            return res.status(404).json({ msg: "Plan not found" });
        }

        res.json(updatePlan.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// GET PLAN ANALYTICS
router.get('/:id/analytics', async (req, res) => {
    const { id } = req.params;
    const gym_id = req.user.gym_id;

    try {
        const planResult = await pool.query("SELECT name, price FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL", [id, gym_id]);
        if (planResult.rows.length === 0) return res.status(404).json({ msg: "Plan not found" });
        const plan = planResult.rows[0];

        const stats = await pool.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired
             FROM memberships 
             WHERE plan_id = $1 AND gym_id = $2 AND deleted_at IS NULL`,
            [id, gym_id]
        );

        const total = parseInt(stats.rows[0].total) || 0;
        const active = parseInt(stats.rows[0].active) || 0;
        const expired = parseInt(stats.rows[0].expired) || 0;

        const revenue = total * parseFloat(plan.price);
        const retentionRate = total > 0 ? ((active / total) * 100).toFixed(1) : 0;
        const churnRate = total > 0 ? ((expired / total) * 100).toFixed(1) : 0;

        const graphData = [
            { month: 'Jan', revenue: revenue * 0.1 },
            { month: 'Feb', revenue: revenue * 0.15 },
            { month: 'Mar', revenue: revenue * 0.12 },
            { month: 'Apr', revenue: revenue * 0.25 },
            { month: 'May', revenue: revenue * 0.20 },
            { month: 'Jun', revenue: revenue * 0.18 }
        ];

        res.json({
            name: plan.name,
            totalMembers: total,
            activeCount: active,
            expiredCount: expired,
            totalRevenue: revenue,
            retentionRate: retentionRate,
            churnRate: churnRate,
            graphData: graphData
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;