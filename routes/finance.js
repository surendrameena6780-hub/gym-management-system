const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');

const gymId = (req) => { const v = Number.parseInt(req?.user?.gym_id ?? req?.user?.gymId, 10); return Number.isInteger(v) ? v : null; };
const posInt = (v, f = null) => { const p = Number.parseInt(v, 10); return Number.isInteger(p) && p > 0 ? p : f; };
const parseDateBoundary = (value, endExclusive = false) => {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return null;
    }

    const date = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    if (endExclusive) {
        date.setDate(date.getDate() + 1);
    }

    return date;
};

const getFinancePeriodConfig = (value, fromValue, toValue) => {
    const period = String(value || '30d').trim().toLowerCase();
    const now = new Date();

    if (period === '30d') {
        return {
            key: '30d',
            label: 'Last 30 days',
            startAt: new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)),
            endAt: null,
        };
    }

    if (period === 'custom') {
        const startAt = parseDateBoundary(fromValue, false);
        const endAt = parseDateBoundary(toValue, true);

        if (startAt && endAt && startAt < endAt) {
            return {
                key: 'custom',
                label: 'Custom range',
                startAt,
                endAt,
            };
        }
    }

    return { key: 'all', label: 'All time', startAt: null, endAt: null };
};

router.use(auth, saasMiddleware);

// ═══════════════════════════════════════════════════════════
//   FINANCE OVERVIEW
// ═══════════════════════════════════════════════════════════
router.get('/overview', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const periodConfig = getFinancePeriodConfig(req.query.period, req.query.from, req.query.to);
        const periodStart = periodConfig.startAt ? periodConfig.startAt.toISOString() : null;
        const periodEnd = periodConfig.endAt ? periodConfig.endAt.toISOString() : null;
        const [revRes, expRes, payrollRes, posRes, pendingRes] = await Promise.all([
            pool.query(`WITH collection_totals AS (
                            SELECT
                                pc.payment_id,
                                COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                            FROM payment_collections pc
                            JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                            WHERE pc.gym_id = $1
                            GROUP BY pc.payment_id
                        ), initial_revenue AS (
                            SELECT COALESCE(SUM(GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0)), 0)::NUMERIC AS total
                            FROM payments p
                            LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                            WHERE p.gym_id = $1
                              AND p.deleted_at IS NULL
                              AND ($2::timestamptz IS NULL OR p.payment_date >= $2::timestamptz)
                                AND ($3::timestamptz IS NULL OR p.payment_date < $3::timestamptz)
                        ), due_revenue AS (
                            SELECT COALESCE(SUM(pc.collected_amount), 0)::NUMERIC AS total
                            FROM payment_collections pc
                            JOIN payments p ON p.id = pc.payment_id
                            WHERE pc.gym_id = $1
                              AND p.deleted_at IS NULL
                              AND ($2::timestamptz IS NULL OR pc.created_at >= $2::timestamptz)
                                AND ($3::timestamptz IS NULL OR pc.created_at < $3::timestamptz)
                        )
                        SELECT COALESCE(SUM(amount_paid),0)::NUMERIC AS total_revenue,
                               COALESCE(SUM(amount_paid) FILTER (WHERE payment_date::date = CURRENT_DATE),0)::NUMERIC AS today_revenue,
                               COALESCE(SUM(amount_due),0)::NUMERIC AS total_pending,
                               COALESCE((SELECT total FROM initial_revenue), 0) + COALESCE((SELECT total FROM due_revenue), 0) AS period_revenue
                        FROM payments
                            WHERE gym_id=$1 AND deleted_at IS NULL`, [gid, periodStart, periodEnd]),
            pool.query(`SELECT COALESCE(SUM(amount),0)::NUMERIC AS total_expenses,
                        COALESCE(SUM(amount) FILTER (WHERE bill_date >= DATE_TRUNC('month', CURRENT_DATE)),0)::NUMERIC AS month_expenses,
                            COALESCE(SUM(amount) FILTER (WHERE ($2::timestamptz IS NULL OR bill_date::timestamptz >= $2::timestamptz)
                                                 AND ($3::timestamptz IS NULL OR bill_date::timestamptz < $3::timestamptz)),0)::NUMERIC AS period_expenses,
                        COUNT(*)::INTEGER AS expense_count
                            FROM expenses WHERE gym_id=$1 AND deleted_at IS NULL`, [gid, periodStart, periodEnd]),
            pool.query(`SELECT COALESCE(SUM(net_pay),0)::NUMERIC AS total_payroll,
                        COALESCE(SUM(net_pay) FILTER (WHERE status='PENDING'),0)::NUMERIC AS pending_payroll,
                            COALESCE(SUM(net_pay) FILTER (WHERE ($2::timestamptz IS NULL OR COALESCE(paid_at, created_at) >= $2::timestamptz)
                                                  AND ($3::timestamptz IS NULL OR COALESCE(paid_at, created_at) < $3::timestamptz)),0)::NUMERIC AS period_payroll,
                        COUNT(*) FILTER (WHERE status='PENDING')::INTEGER AS pending_count
                            FROM payroll_entries WHERE gym_id=$1`, [gid, periodStart, periodEnd]),
            pool.query(`SELECT COALESCE(SUM(total_amount),0)::NUMERIC AS pos_revenue,
                        COALESCE(SUM(total_amount) FILTER (WHERE created_at::date = CURRENT_DATE),0)::NUMERIC AS pos_today,
                            COALESCE(SUM(total_amount) FILTER (WHERE ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
                                                     AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)),0)::NUMERIC AS period_revenue,
                        COUNT(*)::INTEGER AS pos_count
                            FROM pos_sales WHERE gym_id=$1`, [gid, periodStart, periodEnd]),
            pool.query(`SELECT COUNT(*)::INTEGER AS overdue_count,
                        COALESCE(SUM(amount_due),0)::NUMERIC AS overdue_amount
                        FROM payments WHERE gym_id=$1 AND deleted_at IS NULL AND amount_due > 0
                        AND payment_date < CURRENT_DATE - INTERVAL '7 days'`, [gid]),
        ]);

        const revenue = revRes.rows[0] || {};
        const expenses = expRes.rows[0] || {};
        const payroll = payrollRes.rows[0] || {};
        const pos = posRes.rows[0] || {};

        const periodIncome = Number(revenue.period_revenue || 0) + Number(pos.period_revenue || 0);
        const periodOutflows = Number(expenses.period_expenses || 0) + Number(payroll.period_payroll || 0);
        const periodProfit = periodIncome - periodOutflows;

        return res.json({
            revenue,
            expenses,
            payroll,
            pos,
            overdue: pendingRes.rows[0],
            summary: {
                period_key: periodConfig.key,
                period_label: periodConfig.label,
                period_income: periodIncome,
                period_outflows: periodOutflows,
                period_profit: periodProfit,
            },
        });
    } catch (err) { console.error('FINANCE OVERVIEW:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════
//   EXPENSES CRUD
// ═══════════════════════════════════════════════════════════
router.get('/expenses', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT e.*, u.full_name AS created_by_name FROM expenses e
             LEFT JOIN users u ON u.id = e.created_by
             WHERE e.gym_id=$1 AND e.deleted_at IS NULL ORDER BY e.bill_date DESC, e.id DESC`, [gid]);
        return res.json(result.rows);
    } catch (err) { console.error('EXPENSES LIST:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.post('/expenses', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { category, vendor, description, amount, bill_date, payment_mode, is_recurring, recurrence_rule } = req.body || {};
        if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount is required.' });
        const result = await pool.query(
            `INSERT INTO expenses (gym_id, category, vendor, description, amount, bill_date, payment_mode, is_recurring, recurrence_rule, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [gid, String(category||'General').trim(), String(vendor||'').trim(), String(description||'').trim(),
             Number(amount), bill_date||new Date().toISOString().slice(0,10), String(payment_mode||'Cash').trim(),
             Boolean(is_recurring), String(recurrence_rule||'').trim(), req.user.id]);
        return res.status(201).json(result.rows[0]);
    } catch (err) { console.error('EXPENSE CREATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.put('/expenses/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const { category, vendor, description, amount, bill_date, payment_mode, is_recurring, recurrence_rule } = req.body || {};
        const result = await pool.query(
            `UPDATE expenses SET category=$1, vendor=$2, description=$3, amount=$4, bill_date=$5,
             payment_mode=$6, is_recurring=$7, recurrence_rule=$8
             WHERE id=$9 AND gym_id=$10 AND deleted_at IS NULL RETURNING *`,
            [String(category||'General').trim(), String(vendor||'').trim(), String(description||'').trim(),
             Number(amount||0), bill_date||new Date().toISOString().slice(0,10), String(payment_mode||'Cash').trim(),
             Boolean(is_recurring), String(recurrence_rule||'').trim(), id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json(result.rows[0]);
    } catch (err) { console.error('EXPENSE UPDATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.delete('/expenses/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const result = await pool.query('UPDATE expenses SET deleted_at=NOW() WHERE id=$1 AND gym_id=$2 RETURNING id', [id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json({ message: 'Expense deleted.' });
    } catch (err) { console.error('EXPENSE DELETE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════
//   PAYROLL CRUD
// ═══════════════════════════════════════════════════════════
router.get('/payroll', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT pe.*, u.full_name AS staff_name, u.staff_role FROM payroll_entries pe
             LEFT JOIN users u ON u.id = pe.user_id
             WHERE pe.gym_id=$1 ORDER BY pe.created_at DESC`, [gid]);
        return res.json(result.rows);
    } catch (err) { console.error('PAYROLL LIST:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.post('/payroll', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { user_id, pay_period, base_pay, commission, deductions, notes } = req.body || {};
        const uid = posInt(user_id);
        if (!uid || !pay_period) return res.status(400).json({ error: 'user_id and pay_period are required.' });
        const net = Number(base_pay||0) + Number(commission||0) - Number(deductions||0);
        const result = await pool.query(
            `INSERT INTO payroll_entries (gym_id, user_id, pay_period, base_pay, commission, deductions, net_pay, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [gid, uid, String(pay_period).trim(), Number(base_pay||0), Number(commission||0), Number(deductions||0), net, String(notes||'').trim(), req.user.id]);
        return res.status(201).json(result.rows[0]);
    } catch (err) { console.error('PAYROLL CREATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.put('/payroll/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const { base_pay, commission, deductions, notes, status } = req.body || {};
        const net = Number(base_pay||0) + Number(commission||0) - Number(deductions||0);
        const paidAt = status === 'PAID' ? 'NOW()' : 'paid_at';
        const result = await pool.query(
            `UPDATE payroll_entries SET base_pay=$1, commission=$2, deductions=$3, net_pay=$4, notes=$5,
             status=$6, paid_at = CASE WHEN $6='PAID' THEN NOW() ELSE paid_at END
             WHERE id=$7 AND gym_id=$8 RETURNING *`,
            [Number(base_pay||0), Number(commission||0), Number(deductions||0), net, String(notes||'').trim(),
             String(status||'PENDING').trim().toUpperCase(), id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json(result.rows[0]);
    } catch (err) { console.error('PAYROLL UPDATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════
//   POS: Products
// ═══════════════════════════════════════════════════════════
router.get('/pos/products', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            'SELECT * FROM pos_products WHERE gym_id=$1 AND deleted_at IS NULL ORDER BY name ASC', [gid]);
        return res.json(result.rows);
    } catch (err) { console.error('POS PRODUCTS:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.post('/pos/products', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { name, category, price, cost_price, stock_qty, low_stock_threshold, sku } = req.body || {};
        if (!name || !price) return res.status(400).json({ error: 'name and price required.' });
        const result = await pool.query(
            `INSERT INTO pos_products (gym_id, name, category, price, cost_price, stock_qty, low_stock_threshold, sku)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [gid, String(name).trim(), String(category||'General').trim(), Number(price), Number(cost_price||0),
             Number(stock_qty||0), Number(low_stock_threshold||5), String(sku||'').trim()]);
        return res.status(201).json(result.rows[0]);
    } catch (err) { console.error('POS PRODUCT CREATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.put('/pos/products/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const { name, category, price, cost_price, stock_qty, low_stock_threshold, sku, is_active } = req.body || {};
        const result = await pool.query(
            `UPDATE pos_products SET name=$1, category=$2, price=$3, cost_price=$4, stock_qty=$5,
             low_stock_threshold=$6, sku=$7, is_active=$8 WHERE id=$9 AND gym_id=$10 AND deleted_at IS NULL RETURNING *`,
            [String(name||'').trim(), String(category||'General').trim(), Number(price||0), Number(cost_price||0),
             Number(stock_qty||0), Number(low_stock_threshold||5), String(sku||'').trim(),
             typeof is_active === 'boolean' ? is_active : true, id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json(result.rows[0]);
    } catch (err) { console.error('POS PRODUCT UPDATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.delete('/pos/products/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const result = await pool.query('UPDATE pos_products SET deleted_at=NOW() WHERE id=$1 AND gym_id=$2 RETURNING id', [id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json({ message: 'Product deleted.' });
    } catch (err) { console.error('POS PRODUCT DELETE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════
//   POS: Sales
// ═══════════════════════════════════════════════════════════
router.get('/pos/sales', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT ps.*, m.full_name AS member_name, u.full_name AS sold_by_name,
             COALESCE((SELECT json_agg(json_build_object('product_name',si.product_name,'quantity',si.quantity,'unit_price',si.unit_price,'total_price',si.total_price))
               FROM pos_sale_items si WHERE si.sale_id=ps.id), '[]') AS items
             FROM pos_sales ps
             LEFT JOIN members m ON m.id=ps.member_id LEFT JOIN users u ON u.id=ps.sold_by
             WHERE ps.gym_id=$1 ORDER BY ps.created_at DESC`, [gid]);
        return res.json(result.rows);
    } catch (err) { console.error('POS SALES:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.post('/pos/sales', requirePermission('payments:write'), async (req, res) => {
    const client = await pool.connect();
    try {
        const gid = gymId(req);
        const { member_id, items, payment_mode, notes } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required.' });

        await client.query('BEGIN');
        let totalAmount = 0;
        const validItems = [];
        for (const item of items) {
            const pid = posInt(item.product_id);
            const qty = posInt(item.quantity, 1);
            if (!pid) continue;
            const prodRes = await client.query(
                `UPDATE pos_products
                 SET stock_qty = stock_qty - $1
                 WHERE id = $2 AND gym_id = $3 AND deleted_at IS NULL AND stock_qty >= $1
                 RETURNING id, name, price, stock_qty`,
                [qty, pid, gid]
            );

            if (!prodRes.rows.length) {
                const productExists = await client.query(
                    'SELECT id, stock_qty FROM pos_products WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                    [pid, gid]
                );
                await client.query('ROLLBACK');
                if (!productExists.rows.length) {
                    return res.status(404).json({ error: `Product ${pid} not found.` });
                }
                return res.status(409).json({ error: `Insufficient stock for product ${pid}.` });
            }

            const prod = prodRes.rows[0];
            const lineTotal = Number(prod.price) * qty;
            totalAmount += lineTotal;
            validItems.push({ product_id: pid, product_name: prod.name, quantity: qty, unit_price: Number(prod.price), total_price: lineTotal });
        }

        const saleRes = await client.query(
            `INSERT INTO pos_sales (gym_id, member_id, total_amount, payment_mode, notes, sold_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [gid, posInt(member_id), totalAmount, String(payment_mode||'Cash').trim(), String(notes||'').trim(), req.user.id]);
        const saleId = saleRes.rows[0].id;

        for (const vi of validItems) {
            await client.query(
                `INSERT INTO pos_sale_items (sale_id, product_id, product_name, quantity, unit_price, total_price)
                 VALUES ($1,$2,$3,$4,$5,$6)`, [saleId, vi.product_id, vi.product_name, vi.quantity, vi.unit_price, vi.total_price]);
        }

        await client.query('COMMIT');
        return res.status(201).json({ ...saleRes.rows[0], items: validItems });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('POS SALE CREATE:', err.message);
        return res.status(500).json({ error: 'Failed' });
    } finally {
        client.release();
    }
});

// ═══════════════════════════════════════════════════════════
//   ACCESS POLICIES
// ═══════════════════════════════════════════════════════════
router.get('/access-policies', requirePermission('attendance:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT ap.*, p.name AS plan_name FROM access_policies ap
             LEFT JOIN plans p ON p.id = ap.plan_id WHERE ap.gym_id=$1 ORDER BY ap.created_at DESC`, [gid]);
        return res.json(result.rows);
    } catch (err) { console.error('ACCESS POLICIES:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.post('/access-policies', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { plan_id, name, allowed_days, allowed_from, allowed_to, is_offpeak_only, enforce_freeze, max_daily_visits } = req.body || {};
        const result = await pool.query(
            `INSERT INTO access_policies (gym_id, plan_id, name, allowed_days, allowed_from, allowed_to, is_offpeak_only, enforce_freeze, max_daily_visits)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [gid, posInt(plan_id), String(name||'').trim(), String(allowed_days||'').trim(),
             allowed_from||null, allowed_to||null, Boolean(is_offpeak_only), enforce_freeze !== false, posInt(max_daily_visits, 0)]);
        return res.status(201).json(result.rows[0]);
    } catch (err) { console.error('ACCESS POLICY CREATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.put('/access-policies/:id', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const { plan_id, name, allowed_days, allowed_from, allowed_to, is_offpeak_only, enforce_freeze, max_daily_visits, is_active } = req.body || {};
        const result = await pool.query(
            `UPDATE access_policies SET plan_id=$1, name=$2, allowed_days=$3, allowed_from=$4, allowed_to=$5,
             is_offpeak_only=$6, enforce_freeze=$7, max_daily_visits=$8, is_active=$9
             WHERE id=$10 AND gym_id=$11 RETURNING *`,
            [posInt(plan_id), String(name||'').trim(), String(allowed_days||'').trim(),
             allowed_from||null, allowed_to||null, Boolean(is_offpeak_only), enforce_freeze !== false,
             posInt(max_daily_visits, 0), is_active !== false, id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json(result.rows[0]);
    } catch (err) { console.error('ACCESS POLICY UPDATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.delete('/access-policies/:id', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        await pool.query('DELETE FROM access_policies WHERE id=$1 AND gym_id=$2', [id, gid]);
        return res.json({ message: 'Policy deleted.' });
    } catch (err) { console.error('ACCESS POLICY DELETE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
