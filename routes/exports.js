const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');

const gymId = (req) => { const v = Number.parseInt(req?.user?.gym_id ?? req?.user?.gymId, 10); return Number.isInteger(v) ? v : null; };
const EXPORT_ROW_LIMIT = Math.max(100, Math.min(5000, parseInt(process.env.EXPORT_ROW_LIMIT || '5000', 10) || 5000));
const EXPORTS_PER_HOUR_LIMIT = Math.max(1, parseInt(process.env.EXPORTS_PER_HOUR_LIMIT || '10', 10) || 10);

router.use(auth, saasMiddleware);

const isLoadTest = process.env.LOAD_TEST_MODE === 'true';

const exportRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: isLoadTest ? 999999 : EXPORTS_PER_HOUR_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${gymId(req) || 'nogym'}:${req.user?.id || 'anon'}`,
    handler: (_req, res) => {
        return res.status(429).json({ error: 'Too many export requests. Try again later.' });
    },
});

const toCsv = (rows, columns) => {
    if (!rows.length) return columns.map(c => c.label).join(',') + '\n';
    const header = columns.map(c => c.label).join(',');
    const body = rows.map(row => columns.map(c => {
        let val = row[c.key] ?? '';
        val = String(val).replace(/"/g, '""');
        if (String(val).includes(',') || String(val).includes('\n') || String(val).includes('"')) val = `"${val}"`;
        return val;
    }).join(',')).join('\n');
    return header + '\n' + body + '\n';
};

const setCsvHeaders = (res, filename, rowCount) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Row-Limit', String(EXPORT_ROW_LIMIT));
    res.setHeader('X-Export-Truncated', rowCount >= EXPORT_ROW_LIMIT ? 'true' : 'false');
};

// ── Members CSV ──
router.get('/members', exportRateLimiter, requirePermission('members:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT m.full_name, m.phone, m.email, m.joining_date, m.status, m.last_visit,
                    m.onboarding_complete, m.waiver_signed_at, m.emergency_contact, m.gender, m.date_of_birth,
                    p.name AS plan_name, ms.start_date AS membership_start, ms.end_date AS membership_end, ms.status AS membership_status
             FROM members m
             LEFT JOIN LATERAL (
                SELECT ms2.start_date, ms2.end_date, ms2.status, ms2.plan_id FROM memberships ms2
                WHERE ms2.member_id = m.id AND ms2.gym_id = m.gym_id AND ms2.deleted_at IS NULL
                ORDER BY ms2.end_date DESC, ms2.id DESC LIMIT 1
             ) ms ON true
             LEFT JOIN plans p ON p.id = ms.plan_id
                 WHERE m.gym_id = $1 AND m.deleted_at IS NULL ORDER BY m.full_name LIMIT $2`, [gid, EXPORT_ROW_LIMIT]);

        const csv = toCsv(result.rows, [
            { key: 'full_name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
            { key: 'joining_date', label: 'Joining Date' }, { key: 'status', label: 'Status' },
            { key: 'plan_name', label: 'Plan' }, { key: 'membership_start', label: 'Membership Start' },
            { key: 'membership_end', label: 'Membership End' }, { key: 'membership_status', label: 'Membership Status' },
            { key: 'last_visit', label: 'Last Visit' }, { key: 'gender', label: 'Gender' },
            { key: 'date_of_birth', label: 'DOB' }, { key: 'emergency_contact', label: 'Emergency Contact' },
            { key: 'onboarding_complete', label: 'Onboarding Done' }, { key: 'waiver_signed_at', label: 'Waiver Signed' },
        ]);
        setCsvHeaders(res, 'members-export.csv', result.rows.length);
        return res.send(csv);
    } catch (err) { console.error('EXPORT MEMBERS:', err.message); return res.status(500).json({ error: 'Export failed.' }); }
});

// ── Payments CSV ──
router.get('/payments', exportRateLimiter, requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT m.full_name, p2.name AS plan_name, pay.amount_paid, pay.amount_due, pay.total_amount,
                    pay.payment_mode, pay.transaction_id, pay.invoice_id, pay.status, pay.payment_date, pay.notes
             FROM payments pay
             LEFT JOIN members m ON m.id = pay.user_id
             LEFT JOIN plans p2 ON p2.id = pay.plan_id
             WHERE pay.gym_id = $1 AND pay.deleted_at IS NULL ORDER BY pay.payment_date DESC LIMIT $2`, [gid, EXPORT_ROW_LIMIT]);

        const csv = toCsv(result.rows, [
            { key: 'full_name', label: 'Member' }, { key: 'plan_name', label: 'Plan' },
            { key: 'amount_paid', label: 'Paid' }, { key: 'amount_due', label: 'Due' },
            { key: 'total_amount', label: 'Total' }, { key: 'payment_mode', label: 'Mode' },
            { key: 'transaction_id', label: 'Txn ID' }, { key: 'invoice_id', label: 'Invoice' },
            { key: 'status', label: 'Status' }, { key: 'payment_date', label: 'Date' }, { key: 'notes', label: 'Notes' },
        ]);
        setCsvHeaders(res, 'payments-export.csv', result.rows.length);
        return res.send(csv);
    } catch (err) { console.error('EXPORT PAYMENTS:', err.message); return res.status(500).json({ error: 'Export failed.' }); }
});

// ── Attendance CSV ──
router.get('/attendance', exportRateLimiter, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT m.full_name, m.phone, a.check_in_time, a.checkin_method, a.checkin_status
             FROM attendance a
             LEFT JOIN members m ON m.id = a.member_id
             WHERE a.gym_id = $1 AND a.deleted_at IS NULL ORDER BY a.check_in_time DESC LIMIT $2`, [gid, EXPORT_ROW_LIMIT]);

        const csv = toCsv(result.rows, [
            { key: 'full_name', label: 'Member' }, { key: 'phone', label: 'Phone' },
            { key: 'check_in_time', label: 'Check-In Time' }, { key: 'checkin_method', label: 'Method' },
            { key: 'checkin_status', label: 'Status' },
        ]);
        setCsvHeaders(res, 'attendance-export.csv', result.rows.length);
        return res.send(csv);
    } catch (err) { console.error('EXPORT ATTENDANCE:', err.message); return res.status(500).json({ error: 'Export failed.' }); }
});

// ── Leads CSV ──
router.get('/leads', exportRateLimiter, requirePermission('members:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT full_name, phone, email, source, status, priority, notes, next_follow_up_at, trial_date, lost_reason, created_at
             FROM leads WHERE gym_id=$1 ORDER BY created_at DESC LIMIT $2`, [gid, EXPORT_ROW_LIMIT]);

        const csv = toCsv(result.rows, [
            { key: 'full_name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
            { key: 'source', label: 'Source' }, { key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' },
            { key: 'next_follow_up_at', label: 'Follow-Up' }, { key: 'trial_date', label: 'Trial Date' },
            { key: 'lost_reason', label: 'Lost Reason' }, { key: 'notes', label: 'Notes' }, { key: 'created_at', label: 'Created' },
        ]);
        setCsvHeaders(res, 'leads-export.csv', result.rows.length);
        return res.send(csv);
    } catch (err) { console.error('EXPORT LEADS:', err.message); return res.status(500).json({ error: 'Export failed.' }); }
});

// ── Expenses CSV ──
router.get('/expenses', exportRateLimiter, requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT category, vendor, description, amount, bill_date, payment_mode, is_recurring, created_at
             FROM expenses WHERE gym_id=$1 AND deleted_at IS NULL ORDER BY bill_date DESC LIMIT $2`, [gid, EXPORT_ROW_LIMIT]);

        const csv = toCsv(result.rows, [
            { key: 'category', label: 'Category' }, { key: 'vendor', label: 'Vendor' },
            { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount' },
            { key: 'bill_date', label: 'Bill Date' }, { key: 'payment_mode', label: 'Mode' },
            { key: 'is_recurring', label: 'Recurring' }, { key: 'created_at', label: 'Created' },
        ]);
        setCsvHeaders(res, 'expenses-export.csv', result.rows.length);
        return res.send(csv);
    } catch (err) { console.error('EXPORT EXPENSES:', err.message); return res.status(500).json({ error: 'Export failed.' }); }
});

// ── Saved Reports ──
router.get('/saved-reports', requirePermission('insights:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const result = await pool.query(
            `SELECT sr.*, u.full_name AS created_by_name FROM saved_reports sr
             LEFT JOIN users u ON u.id = sr.created_by WHERE sr.gym_id=$1 ORDER BY sr.created_at DESC`, [gid]);
        return res.json(result.rows);
    } catch (err) { console.error('SAVED REPORTS:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.post('/saved-reports', requirePermission('insights:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { name, report_type, filters, schedule } = req.body || {};
        if (!name) return res.status(400).json({ error: 'name is required.' });
        const result = await pool.query(
            `INSERT INTO saved_reports (gym_id, name, report_type, filters, schedule, created_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [gid, String(name).trim(), String(report_type||'members').trim(), filters || {}, String(schedule||'').trim(), req.user.id]);
        return res.status(201).json(result.rows[0]);
    } catch (err) { console.error('SAVED REPORT CREATE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

router.delete('/saved-reports/:id', requirePermission('insights:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
        await pool.query('DELETE FROM saved_reports WHERE id=$1 AND gym_id=$2', [id, gid]);
        return res.json({ message: 'Report deleted.' });
    } catch (err) { console.error('SAVED REPORT DELETE:', err.message); return res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
