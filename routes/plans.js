const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');
const {
    ensureTrimmedString,
    ensureInteger,
    ensureNumber,
    ensureStringArray,
    ensureObject,
    ensureDateOnly,
    isValidationError,
} = require('../utils/fieldValidation');

const normalizePlanPayload = (body = {}) => ({
    name: ensureTrimmedString(body.name, { field: 'name', required: true, min: 1, max: 120 }),
    price: ensureNumber(body.price, { field: 'price', min: 0, max: 1000000, defaultValue: 0 }),
    duration_days: ensureInteger(body.duration_days, { field: 'duration_days', min: 1, max: 3650, defaultValue: 30 }),
    features: ensureStringArray(body.features, { field: 'features', maxItems: 50, itemMax: 120 }),
    color_theme: ensureTrimmedString(body.color_theme, { field: 'color_theme', max: 40, defaultValue: 'blue' }) || 'blue',
    is_popular: Boolean(body.is_popular),
    description: ensureTrimmedString(body.description, { field: 'description', max: 4000 }),
    discount_percent: ensureInteger(body.discount_percent, { field: 'discount_percent', min: 0, max: 100, defaultValue: 0 }),
    discount_valid_until: ensureDateOnly(body.discount_valid_until, { field: 'discount_valid_until' }),
    joining_fee: ensureNumber(body.joining_fee, { field: 'joining_fee', min: 0, max: 1000000, defaultValue: 0 }),
    freeze_allowance_days: ensureInteger(body.freeze_allowance_days, { field: 'freeze_allowance_days', min: 0, max: 3650, defaultValue: 0 }),
    transfer_fee: ensureNumber(body.transfer_fee, { field: 'transfer_fee', min: 0, max: 1000000, defaultValue: 0 }),
    access_hours: ensureTrimmedString(body.access_hours, { field: 'access_hours', max: 500 }),
    guest_passes: ensureInteger(body.guest_passes, { field: 'guest_passes', min: 0, max: 365, defaultValue: 0 }),
    renewal_policy: ensureTrimmedString(body.renewal_policy, { field: 'renewal_policy', max: 500 }),
    class_eligibility: ensureTrimmedString(body.class_eligibility, { field: 'class_eligibility', max: 500 }),
    advanced_rules: ensureObject(body.advanced_rules, { field: 'advanced_rules', defaultValue: {} }),
});

const normalizePlanFeatures = (value) => {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    if (typeof value !== 'string') {
        return [];
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            return normalizePlanFeatures(parsed);
        } catch (_err) {
            // Fall back to delimiter parsing below.
        }
    }

    const postgresArrayLiteral = trimmed.startsWith('{') && trimmed.endsWith('}')
        ? trimmed.slice(1, -1)
        : trimmed;

    return postgresArrayLiteral
        .split(/\r?\n|,/) 
        .map((item) => item.replace(/^"|"$/g, '').trim())
        .filter(Boolean);
};

const normalizePlanRow = (row = {}) => ({
    ...row,
    features: normalizePlanFeatures(row.features),
});

router.use(auth, saasMiddleware, requireOwner);

// GET ALL PLANS
router.get('/', async (req, res) => {
    try {
        const plans = await pool.query('SELECT * FROM plans WHERE gym_id = $1 AND deleted_at IS NULL ORDER BY price ASC', [req.user.gym_id]);
        res.json(plans.rows.map(normalizePlanRow));
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// CREATE A NEW PLAN
router.post('/add', async (req, res) => {
    try {
        const payload = normalizePlanPayload(req.body);
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

        res.status(200).json(normalizePlanRow(newPlan.rows[0]));
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("DATABASE ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
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
    try {
        const id = ensureInteger(req.params.id, { field: 'plan id', required: true, min: 1 });
        const payload = normalizePlanPayload(req.body);
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

        res.json(normalizePlanRow(updatePlan.rows[0]));
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
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

        const [stats, revenueByMonth, totalRevenueRes] = await Promise.all([
            pool.query(
                `SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired
                 FROM memberships 
                 WHERE plan_id = $1 AND gym_id = $2 AND deleted_at IS NULL`,
                [id, gym_id]
            ),
            pool.query(
                `WITH month_series AS (
                    SELECT generate_series(
                        date_trunc('month', NOW()) - INTERVAL '5 months',
                        date_trunc('month', NOW()),
                        INTERVAL '1 month'
                    ) AS month_start
                 )
                 SELECT
                    TO_CHAR(ms.month_start, 'Mon') AS month,
                    COALESCE(ROUND(SUM(p.amount_paid)), 0)::INTEGER AS revenue
                 FROM month_series ms
                 LEFT JOIN payments p
                    ON p.plan_id = $1
                    AND p.gym_id = $2
                    AND p.deleted_at IS NULL
                    AND date_trunc('month', p.payment_date) = ms.month_start
                 GROUP BY ms.month_start
                 ORDER BY ms.month_start ASC`,
                [id, gym_id]
            ),
            pool.query(
                `SELECT COALESCE(ROUND(SUM(amount_paid)), 0)::INTEGER AS total_revenue
                 FROM payments
                 WHERE plan_id = $1 AND gym_id = $2 AND deleted_at IS NULL`,
                [id, gym_id]
            ),
        ]);

        const total = parseInt(stats.rows[0].total) || 0;
        const active = parseInt(stats.rows[0].active) || 0;
        const expired = parseInt(stats.rows[0].expired) || 0;

        const totalRevenue = parseInt(totalRevenueRes.rows[0]?.total_revenue) || 0;
        const retentionRate = total > 0 ? ((active / total) * 100).toFixed(1) : 0;
        const churnRate = total > 0 ? ((expired / total) * 100).toFixed(1) : 0;

        res.json({
            name: plan.name,
            totalMembers: total,
            activeCount: active,
            expiredCount: expired,
            totalRevenue: totalRevenue,
            retentionRate: retentionRate,
            churnRate: churnRate,
            graphData: revenueByMonth.rows
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
        const planId = ensureInteger(req.params.id, { field: 'plan id', required: true, min: 1 });
        const { joining_fee, freeze_allowance_days, transfer_fee, access_hours, guest_passes, renewal_policy, class_eligibility, advanced_rules } = req.body || {};
        const updates = [];
        const vals = [];
        let idx = 3;
        if (joining_fee !== undefined)        { updates.push(`joining_fee=$${idx++}`);        vals.push(ensureNumber(joining_fee, { field: 'joining_fee', min: 0, max: 1000000 })); }
        if (freeze_allowance_days !== undefined) { updates.push(`freeze_allowance_days=$${idx++}`); vals.push(ensureInteger(freeze_allowance_days, { field: 'freeze_allowance_days', min: 0, max: 3650 })); }
        if (transfer_fee !== undefined)       { updates.push(`transfer_fee=$${idx++}`);       vals.push(ensureNumber(transfer_fee, { field: 'transfer_fee', min: 0, max: 1000000 })); }
        if (access_hours !== undefined)       { updates.push(`access_hours=$${idx++}`);       vals.push(ensureTrimmedString(access_hours, { field: 'access_hours', max: 500 })); }
        if (guest_passes !== undefined)       { updates.push(`guest_passes=$${idx++}`);       vals.push(ensureInteger(guest_passes, { field: 'guest_passes', min: 0, max: 365 })); }
        if (renewal_policy !== undefined)     { updates.push(`renewal_policy=$${idx++}`);     vals.push(ensureTrimmedString(renewal_policy, { field: 'renewal_policy', max: 500 })); }
        if (class_eligibility !== undefined)  { updates.push(`class_eligibility=$${idx++}`);  vals.push(ensureTrimmedString(class_eligibility, { field: 'class_eligibility', max: 500 })); }
        if (advanced_rules !== undefined)     { updates.push(`advanced_rules=$${idx++}`);     vals.push(JSON.stringify(ensureObject(advanced_rules, { field: 'advanced_rules', defaultValue: {} }))); }
        if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
        const result = await pool.query(
            `UPDATE plans SET ${updates.join(', ')} WHERE id=$1 AND gym_id=$2 RETURNING *`,
            [planId, gym_id, ...vals]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Plan not found' });
        res.json(normalizePlanRow(result.rows[0]));
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('PLAN RULES:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;