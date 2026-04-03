const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');

const toMoney = (value, fallback = 0) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toInt = (value, fallback = 0) => {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
};

const normalizePlanPayload = (body = {}) => ({
    name: String(body.name || '').trim(),
    price: toMoney(body.price, 0),
    duration_days: toInt(body.duration_days, 30),
    features: Array.isArray(body.features) ? body.features : [],
    color_theme: String(body.color_theme || 'blue').trim() || 'blue',
    is_popular: Boolean(body.is_popular),
    description: String(body.description || '').trim(),
    discount_percent: toInt(body.discount_percent, 0),
    discount_valid_until: body.discount_valid_until || null,
    joining_fee: toMoney(body.joining_fee, 0),
    freeze_allowance_days: toInt(body.freeze_allowance_days, 0),
    transfer_fee: toMoney(body.transfer_fee, 0),
    access_hours: String(body.access_hours || '').trim(),
    guest_passes: toInt(body.guest_passes, 0),
    renewal_policy: String(body.renewal_policy || '').trim(),
    class_eligibility: String(body.class_eligibility || '').trim(),
    advanced_rules: body.advanced_rules && typeof body.advanced_rules === 'object' && !Array.isArray(body.advanced_rules)
        ? body.advanced_rules
        : {},
});

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
    const payload = normalizePlanPayload(req.body);
    try {
        const gym_id = req.user.gym_id; 

        const newPlan = await pool.query(
            `INSERT INTO plans 
            (gym_id, name, price, duration_days, features, color_theme, is_popular, description, discount_percent, discount_valid_until,
             joining_fee, freeze_allowance_days, transfer_fee, access_hours, guest_passes, renewal_policy, class_eligibility, advanced_rules) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) 
            RETURNING *`,
            [
                gym_id, 
                payload.name,
                payload.price,
                payload.duration_days,
                payload.features,
                payload.color_theme,
                payload.is_popular,
                payload.description,
                payload.discount_percent,
                payload.discount_valid_until,
                payload.joining_fee,
                payload.freeze_allowance_days,
                payload.transfer_fee,
                payload.access_hours,
                payload.guest_passes,
                payload.renewal_policy,
                payload.class_eligibility,
                JSON.stringify(payload.advanced_rules)
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
    const payload = normalizePlanPayload(req.body);

    try {
        const updatePlan = await pool.query(
            `UPDATE plans 
            SET name = $1,
                price = $2,
                duration_days = $3,
                features = $4,
                color_theme = $5,
                is_popular = $6,
                description = $7,
                discount_percent = $8,
                discount_valid_until = $9,
                joining_fee = $10,
                freeze_allowance_days = $11,
                transfer_fee = $12,
                access_hours = $13,
                guest_passes = $14,
                renewal_policy = $15,
                class_eligibility = $16,
                advanced_rules = $17
            WHERE id = $18 AND gym_id = $19 AND deleted_at IS NULL RETURNING *`,
            [
                payload.name,
                payload.price,
                payload.duration_days,
                payload.features,
                payload.color_theme,
                payload.is_popular,
                payload.description,
                payload.discount_percent,
                payload.discount_valid_until,
                payload.joining_fee,
                payload.freeze_allowance_days,
                payload.transfer_fee,
                payload.access_hours,
                payload.guest_passes,
                payload.renewal_policy,
                payload.class_eligibility,
                JSON.stringify(payload.advanced_rules),
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

// --- ADVANCED RULES ---
router.put('/:id/advanced-rules', async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const planId = req.params.id;
        const { joining_fee, freeze_allowance_days, transfer_fee, access_hours, guest_passes, renewal_policy, class_eligibility, advanced_rules } = req.body || {};
        const updates = [];
        const vals = [];
        let idx = 3;
        if (joining_fee !== undefined)        { updates.push(`joining_fee=$${idx++}`);        vals.push(joining_fee); }
        if (freeze_allowance_days !== undefined) { updates.push(`freeze_allowance_days=$${idx++}`); vals.push(freeze_allowance_days); }
        if (transfer_fee !== undefined)       { updates.push(`transfer_fee=$${idx++}`);       vals.push(transfer_fee); }
        if (access_hours !== undefined)       { updates.push(`access_hours=$${idx++}`);       vals.push(String(access_hours).trim()); }
        if (guest_passes !== undefined)       { updates.push(`guest_passes=$${idx++}`);       vals.push(guest_passes); }
        if (renewal_policy !== undefined)     { updates.push(`renewal_policy=$${idx++}`);     vals.push(String(renewal_policy).trim()); }
        if (class_eligibility !== undefined)  { updates.push(`class_eligibility=$${idx++}`);  vals.push(String(class_eligibility).trim()); }
        if (advanced_rules !== undefined)     { updates.push(`advanced_rules=$${idx++}`);     vals.push(JSON.stringify(advanced_rules)); }
        if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
        const result = await pool.query(
            `UPDATE plans SET ${updates.join(', ')} WHERE id=$1 AND gym_id=$2 RETURNING *`,
            [planId, gym_id, ...vals]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Plan not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PLAN RULES:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;