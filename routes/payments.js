const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');

router.use(auth, saasMiddleware, requireOwner);

// --- 1. GET ALL PAYMENTS ---
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;
        const gym_id = req.user.gym_id;

        let query = `
            SELECT
                p.id,
                p.user_id,
                p.invoice_id,
                p.transaction_id,
                p.amount_paid,
                p.amount_due,
                p.total_amount,
                p.payment_date,
                p.status,
                p.payment_mode,
                p.notes,
                m.full_name  AS member_name,
                m.email      AS member_email,
                m.profile_pic,
                pl.name      AS plan_name,
                pl.duration_days
            FROM payments p
            JOIN    members m  ON p.user_id  = m.id AND m.gym_id = p.gym_id
            LEFT JOIN plans pl ON p.plan_id  = pl.id AND pl.gym_id = p.gym_id
            WHERE p.gym_id = $1
                            AND p.deleted_at IS NULL
                            AND m.deleted_at IS NULL
        `;
        const params = [gym_id];

        if (search) {
            query += ` AND (m.full_name ILIKE $2 OR p.invoice_id ILIKE $2 OR p.transaction_id ILIKE $2)`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY p.payment_date DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error("GET PAYMENTS ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 2. RECORD PAYMENT ---
router.post('/record', async (req, res) => {
    const { user_id, plan_id, amount_paid, total_amount, payment_mode, notes, transaction_id } = req.body;
    const gym_id = req.user.gym_id;

    // Input validation
    if (!user_id || !plan_id) {
        return res.status(400).json({ error: 'user_id and plan_id are required.' });
    }
    const parsedAmountPaid   = parseFloat(amount_paid);
    const parsedTotalAmount  = parseFloat(total_amount ?? amount_paid);
    if (isNaN(parsedAmountPaid) || parsedAmountPaid < 0) {
        return res.status(400).json({ error: 'amount_paid must be a valid non-negative number.' });
    }
    if (isNaN(parsedTotalAmount) || parsedTotalAmount < 0) {
        return res.status(400).json({ error: 'total_amount must be a valid non-negative number.' });
    }

    try {
        const amount_due   = parsedTotalAmount - parsedAmountPaid;
        const status       = amount_due > 0 ? 'Pending' : 'Completed';
        const auto_inv_id  = `INV-${Date.now().toString().slice(-6)}`;

        const final_txn_id     = (transaction_id && transaction_id.trim()) ? transaction_id : auto_inv_id;
        const final_invoice_id = (transaction_id && transaction_id.startsWith('pay_')) ? transaction_id : auto_inv_id;
        const final_mode       = (transaction_id && transaction_id.startsWith('pay_')) ? 'Online' : (payment_mode || 'Cash');

        const [memberResult, planResult] = await Promise.all([
            pool.query(
                'SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [user_id, gym_id]
            ),
            pool.query(
                'SELECT id, duration_days FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [plan_id, gym_id]
            ),
        ]);

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found.' });
        }

        await pool.query('BEGIN');

        const newPayment = await pool.query(
            `INSERT INTO payments
             (gym_id, user_id, plan_id, amount_paid, amount_due, total_amount,
              payment_mode, status, invoice_id, transaction_id, notes, payment_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
             RETURNING *`,
            [
                gym_id, user_id, plan_id,
                parsedAmountPaid, amount_due, parsedTotalAmount,
                final_mode, status, final_invoice_id, final_txn_id, notes || ''
            ]
        );

        await pool.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [user_id, gym_id]);

        const days = planResult.rows[0].duration_days || 30;
        await pool.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status)
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' day')::interval, 'ACTIVE')`,
            [gym_id, user_id, plan_id, days]
        );

        await pool.query(
            `UPDATE members
             SET status = 'ACTIVE',
                 joining_date = COALESCE(joining_date, CURRENT_DATE),
                 last_visit = NOW()
             WHERE id = $1 AND gym_id = $2`,
            [user_id, gym_id]
        );

        // Mirror the Members-page activation flow: payment activation counts as a same-day check-in.
        // This keeps today's attendance accurate and prevents a freshly-activated member from looking inactive.
        await pool.query(
            `INSERT INTO attendance (gym_id, member_id, check_in_time)
             VALUES ($1, $2, NOW())`,
            [gym_id, user_id]
        );

        await pool.query('COMMIT');
        res.json({ msg: "Payment Recorded!", payment: newPayment.rows[0] });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("RECORD PAYMENT ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 3. STATS ---
router.get('/stats', async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const [revenue, today, pending] = await Promise.all([
            pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS total   FROM payments WHERE gym_id = $1 AND deleted_at IS NULL`, [gym_id]),
            pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS today   FROM payments WHERE gym_id = $1 AND payment_date::date = CURRENT_DATE AND deleted_at IS NULL`, [gym_id]),
            pool.query(`SELECT COALESCE(SUM(amount_due),  0) AS pending FROM payments WHERE gym_id = $1 AND status = 'Pending' AND deleted_at IS NULL`, [gym_id])
        ]);

        res.json({
            total_revenue:  parseFloat(revenue.rows[0].total),
            today_revenue:  parseFloat(today.rows[0].today),
            pending_dues:   parseFloat(pending.rows[0].pending)
        });
    } catch (err) {
        console.error("PAYMENT STATS ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. REVENUE CHART ---
router.get('/chart', async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const days = req.query.days === '7' ? 7 : 30;

        const chartData = await pool.query(`
            SELECT
                TO_CHAR(payment_date, 'YYYY-MM-DD') AS date,
                SUM(amount_paid)::INTEGER            AS revenue
            FROM payments
            WHERE gym_id = $1
                            AND deleted_at IS NULL
              AND payment_date > NOW() - ($2::int * INTERVAL '1 day')
            GROUP BY TO_CHAR(payment_date, 'YYYY-MM-DD')
            ORDER BY date ASC
        `, [gym_id, days]);

        res.json(chartData.rows.map(r => ({ date: r.date, revenue: r.revenue || 0 })));
    } catch (err) {
        console.error("CHART ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 5. PAYMENT HISTORY FOR A MEMBER ---
router.get('/history/:member_id', async (req, res) => {
    try {
        const { member_id } = req.params;
        const gym_id = req.user.gym_id;
        if (!member_id || member_id === 'undefined' || member_id === 'null') {
            return res.json([]);
        }

        const history = await pool.query(`
            SELECT
                p.payment_date,
                p.amount_paid,
                p.status,
                p.invoice_id,
                p.transaction_id,
                p.payment_mode,
                pl.name AS plan_name
            FROM payments p
            LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
            WHERE p.user_id = $1 AND p.gym_id = $2
                            AND p.deleted_at IS NULL
            ORDER BY p.payment_date DESC
            LIMIT 10
        `, [member_id, gym_id]);

        res.json(history.rows);
    } catch (err) {
        console.error("HISTORY ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 6. DELETE PAYMENT ---
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const gym_id = req.user.gym_id;

        await pool.query('BEGIN');

        const payInfo = await pool.query(
            'SELECT user_id FROM payments WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL',
            [id, gym_id]
        );

        if (payInfo.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ msg: "Record not found" });
        }
        const member_id = payInfo.rows[0].user_id;

        await pool.query('UPDATE payments     SET deleted_at = NOW() WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL', [id, gym_id]);
        await pool.query('UPDATE memberships  SET deleted_at = NOW(), status = \'EXPIRED\' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [member_id, gym_id]);
        await pool.query("UPDATE members SET status = 'UNPAID' WHERE id = $1 AND gym_id = $2", [member_id, gym_id]);

        await pool.query('COMMIT');
        res.json({ msg: "Record archived and membership reset to Unpaid" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("DELETE PAYMENT ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;