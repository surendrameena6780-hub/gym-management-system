const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const {
    ensureDateOnly,
    ensureNumber,
    ensureTrimmedString,
    isValidationError,
} = require('../utils/fieldValidation');
const {
    BranchAccessError,
    DEFAULT_BRANCH_ID,
    branchSchemaMiddleware,
    getBranchName,
    getGymBranchDirectory,
    resolveBranchReadScope,
    resolveBranchWriteScope,
} = require('../utils/branchAccess');

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

const normalizeExpenseInput = (value = {}) => ({
    category: ensureTrimmedString(value.category, { field: 'category', defaultValue: 'General', max: 60 }),
    vendor: ensureTrimmedString(value.vendor, { field: 'vendor', max: 120 }),
    description: ensureTrimmedString(value.description, { field: 'description', max: 500 }),
    amount: ensureNumber(value.amount, { field: 'amount', required: true, min: 0.01 }),
    billDate: ensureDateOnly(value.bill_date, { field: 'bill_date', defaultValue: new Date().toISOString().slice(0, 10) }),
    paymentMode: ensureTrimmedString(value.payment_mode, { field: 'payment_mode', defaultValue: 'Cash', max: 40 }),
    isRecurring: Boolean(value.is_recurring),
    recurrenceRule: ensureTrimmedString(value.recurrence_rule, { field: 'recurrence_rule', max: 120 }),
});

const normalizePayrollStatus = (value, fallback = 'PENDING_APPROVAL') => {
    const normalized = String(value || fallback).trim().toUpperCase();
    const allowed = new Set(['PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED']);
    return allowed.has(normalized) ? normalized : fallback;
};

const isOwnerUser = (req) => String(req?.user?.role || '').trim().toUpperCase() === 'OWNER';

const getBranchFilterSql = (params, branchId, columnName) => {
    if (!branchId) return '';
    params.push(branchId);
    return ` AND ${columnName} = $${params.length}`;
};

const mapBranchRows = (rows = [], branchDirectory = [], columnName = 'branch_id') => rows.map((row) => {
    const branchId = row?.[columnName] || DEFAULT_BRANCH_ID;
    return {
        ...row,
        [columnName]: branchId,
        branch_name: getBranchName(branchDirectory, branchId),
    };
});

const loadScopedRecordBranch = async (db, tableName, recordId, gymId) => {
    const result = await db.query(
        `SELECT branch_id
         FROM ${tableName}
         WHERE id = $1 AND gym_id = $2
         LIMIT 1`,
        [recordId, gymId]
    );
    if (!result.rows.length) {
        return null;
    }
    return result.rows[0].branch_id || DEFAULT_BRANCH_ID;
};

router.use(auth, saasMiddleware);
router.use(branchSchemaMiddleware);

// ═══════════════════════════════════════════════════════════
//   FINANCE OVERVIEW
// ═══════════════════════════════════════════════════════════
router.get('/overview', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const periodConfig = getFinancePeriodConfig(req.query.period, req.query.from, req.query.to);
        const periodStart = periodConfig.startAt ? periodConfig.startAt.toISOString() : null;
        const periodEnd = periodConfig.endAt ? periodConfig.endAt.toISOString() : null;
        const branchScope = await resolveBranchReadScope(pool, req);
        const overviewParams = branchScope.branchId ? [gid, periodStart, periodEnd, branchScope.branchId] : [gid, periodStart, periodEnd];
        const overdueParams = branchScope.branchId ? [gid, branchScope.branchId] : [gid];
        const rootBranchFilter = branchScope.branchId ? ' AND branch_id = $4' : '';
        const paymentsBranchFilter = branchScope.branchId ? ' AND p.branch_id = $4' : '';
        const collectionsBranchFilter = branchScope.branchId ? ' AND pc.branch_id = $4' : '';
        const overdueBranchFilter = branchScope.branchId ? ' AND branch_id = $2' : '';
        const [revRes, expRes, payrollRes, posRes, pendingRes] = await Promise.all([
            pool.query(`WITH collection_totals AS (
                            SELECT
                                pc.payment_id,
                                COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                            FROM payment_collections pc
                            JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                            WHERE pc.gym_id = $1
                              ${collectionsBranchFilter}
                            GROUP BY pc.payment_id
                        ), initial_revenue AS (
                            SELECT COALESCE(SUM(GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0)), 0)::NUMERIC AS total
                            FROM payments p
                            LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                            WHERE p.gym_id = $1
                              AND p.deleted_at IS NULL
                              ${paymentsBranchFilter}
                              AND ($2::timestamptz IS NULL OR p.payment_date >= $2::timestamptz)
                                AND ($3::timestamptz IS NULL OR p.payment_date < $3::timestamptz)
                        ), due_revenue AS (
                            SELECT COALESCE(SUM(pc.collected_amount), 0)::NUMERIC AS total
                            FROM payment_collections pc
                            JOIN payments p ON p.id = pc.payment_id
                            WHERE pc.gym_id = $1
                              AND p.deleted_at IS NULL
                              ${collectionsBranchFilter}
                              AND ($2::timestamptz IS NULL OR pc.created_at >= $2::timestamptz)
                                AND ($3::timestamptz IS NULL OR pc.created_at < $3::timestamptz)
                        )
                        SELECT COALESCE(SUM(amount_paid),0)::NUMERIC AS total_revenue,
                               COALESCE(SUM(amount_paid) FILTER (WHERE payment_date::date = CURRENT_DATE),0)::NUMERIC AS today_revenue,
                               COALESCE(SUM(amount_due),0)::NUMERIC AS total_pending,
                               COALESCE((SELECT total FROM initial_revenue), 0) + COALESCE((SELECT total FROM due_revenue), 0) AS period_revenue
                        FROM payments
                            WHERE gym_id=$1 AND deleted_at IS NULL${rootBranchFilter}`, overviewParams),
            pool.query(`SELECT COALESCE(SUM(amount),0)::NUMERIC AS total_expenses,
                        COALESCE(SUM(amount) FILTER (WHERE bill_date >= DATE_TRUNC('month', CURRENT_DATE)),0)::NUMERIC AS month_expenses,
                            COALESCE(SUM(amount) FILTER (WHERE ($2::timestamptz IS NULL OR bill_date::timestamptz >= $2::timestamptz)
                                                 AND ($3::timestamptz IS NULL OR bill_date::timestamptz < $3::timestamptz)),0)::NUMERIC AS period_expenses,
                        COUNT(*)::INTEGER AS expense_count
                            FROM expenses WHERE gym_id=$1 AND deleted_at IS NULL${rootBranchFilter}`, overviewParams),
            pool.query(`SELECT COALESCE(SUM(net_pay),0)::NUMERIC AS total_payroll,
                        COALESCE(SUM(net_pay) FILTER (WHERE status IN ('PENDING_APPROVAL', 'APPROVED')),0)::NUMERIC AS pending_payroll,
                            COALESCE(SUM(net_pay) FILTER (WHERE ($2::timestamptz IS NULL OR COALESCE(paid_at, created_at) >= $2::timestamptz)
                                                  AND ($3::timestamptz IS NULL OR COALESCE(paid_at, created_at) < $3::timestamptz)),0)::NUMERIC AS period_payroll,
                        COUNT(*) FILTER (WHERE status IN ('PENDING_APPROVAL', 'APPROVED'))::INTEGER AS pending_count
                            FROM payroll_entries WHERE gym_id=$1${rootBranchFilter}`, overviewParams),
            pool.query(`SELECT COALESCE(SUM(total_amount),0)::NUMERIC AS pos_revenue,
                        COALESCE(SUM(total_amount) FILTER (WHERE created_at::date = CURRENT_DATE),0)::NUMERIC AS pos_today,
                            COALESCE(SUM(total_amount) FILTER (WHERE ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
                                                     AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)),0)::NUMERIC AS period_revenue,
                        COUNT(*)::INTEGER AS pos_count
                            FROM pos_sales WHERE gym_id=$1${rootBranchFilter}`, overviewParams),
            pool.query(`SELECT COUNT(*)::INTEGER AS overdue_count,
                        COALESCE(SUM(amount_due),0)::NUMERIC AS overdue_amount
                        FROM payments WHERE gym_id=$1 AND deleted_at IS NULL AND amount_due > 0
                        AND payment_date < CURRENT_DATE - INTERVAL '7 days'${overdueBranchFilter}`, overdueParams),
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
    } catch (err) {
        console.error('FINANCE OVERVIEW:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════════════════════════
//   EXPENSES CRUD
// ═══════════════════════════════════════════════════════════
router.get('/expenses', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const branchScope = await resolveBranchReadScope(pool, req);
        const params = [gid];
        const branchFilter = getBranchFilterSql(params, branchScope.branchId, 'e.branch_id');
        const result = await pool.query(
            `SELECT e.*, u.full_name AS created_by_name FROM expenses e
             LEFT JOIN users u ON u.id = e.created_by
             WHERE e.gym_id=$1 AND e.deleted_at IS NULL${branchFilter}
             ORDER BY e.bill_date DESC, e.id DESC`, params);
        return res.json(mapBranchRows(result.rows, branchScope.branchDirectory));
    } catch (err) {
        console.error('EXPENSES LIST:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.post('/expenses', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const expense = normalizeExpenseInput(req.body || {});
        const branchScope = await resolveBranchWriteScope(pool, req, req.body?.branch_id);
        const result = await pool.query(
            `INSERT INTO expenses (gym_id, category, vendor, description, amount, bill_date, payment_mode, is_recurring, recurrence_rule, branch_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [gid, expense.category, expense.vendor, expense.description,
             expense.amount, expense.billDate, expense.paymentMode,
             expense.isRecurring, expense.recurrenceRule, branchScope.branchId, req.user.id]);
        return res.status(201).json({
            ...result.rows[0],
            branch_id: branchScope.branchId,
            branch_name: getBranchName(branchScope.branchDirectory, branchScope.branchId),
        });
    } catch (err) {
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
        console.error('EXPENSE CREATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.put('/expenses/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const expense = normalizeExpenseInput(req.body || {});
        const existingBranchId = await loadScopedRecordBranch(pool, 'expenses', id, gid);
        if (!existingBranchId) return res.status(404).json({ error: 'Not found.' });
        const branchScope = await resolveBranchWriteScope(pool, req, req.body?.branch_id === undefined ? existingBranchId : req.body?.branch_id);
        const result = await pool.query(
            `UPDATE expenses SET category=$1, vendor=$2, description=$3, amount=$4, bill_date=$5,
             payment_mode=$6, is_recurring=$7, recurrence_rule=$8, branch_id=$9
             WHERE id=$10 AND gym_id=$11 AND deleted_at IS NULL RETURNING *`,
            [expense.category, expense.vendor, expense.description,
             expense.amount, expense.billDate, expense.paymentMode,
             expense.isRecurring, expense.recurrenceRule, branchScope.branchId, id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json({
            ...result.rows[0],
            branch_id: branchScope.branchId,
            branch_name: getBranchName(branchScope.branchDirectory, branchScope.branchId),
        });
    } catch (err) {
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
        console.error('EXPENSE UPDATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.delete('/expenses/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const branchScope = await resolveBranchReadScope(pool, req, await loadScopedRecordBranch(pool, 'expenses', id, gid));
        const params = [id, gid];
        const branchFilter = getBranchFilterSql(params, branchScope.branchId, 'branch_id');
        const result = await pool.query(`UPDATE expenses SET deleted_at=NOW() WHERE id=$1 AND gym_id=$2${branchFilter} RETURNING id`, params);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json({ message: 'Expense deleted.' });
    } catch (err) {
        console.error('EXPENSE DELETE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════════════════════════
//   PAYROLL CRUD
// ═══════════════════════════════════════════════════════════
router.get('/payroll', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const branchScope = await resolveBranchReadScope(pool, req);
        const params = [gid];
        const branchFilter = getBranchFilterSql(params, branchScope.branchId, 'pe.branch_id');
        const result = await pool.query(
            `SELECT pe.*, u.full_name AS staff_name, u.staff_role,
                    COALESCE(u.branch_id, pe.branch_id, $${params.length + 1}) AS staff_branch_id,
                    created_by_user.full_name AS created_by_name,
                    approved_by_user.full_name AS approved_by_name,
                    paid_by_user.full_name AS paid_by_name
             FROM payroll_entries pe
             LEFT JOIN users u ON u.id = pe.user_id
             LEFT JOIN users created_by_user ON created_by_user.id = pe.created_by
             LEFT JOIN users approved_by_user ON approved_by_user.id = pe.approved_by
             LEFT JOIN users paid_by_user ON paid_by_user.id = pe.paid_by
             WHERE pe.gym_id=$1${branchFilter}
             ORDER BY CASE pe.status
                        WHEN 'PENDING_APPROVAL' THEN 0
                        WHEN 'APPROVED' THEN 1
                        WHEN 'PAID' THEN 2
                        WHEN 'REJECTED' THEN 3
                        ELSE 4
                      END,
                      pe.created_at DESC`,
            [...params, DEFAULT_BRANCH_ID]
        );
        return res.json(result.rows.map((row) => ({
            ...row,
            branch_id: row.branch_id || DEFAULT_BRANCH_ID,
            branch_name: getBranchName(branchScope.branchDirectory, row.branch_id || DEFAULT_BRANCH_ID),
            staff_branch_id: row.staff_branch_id || row.branch_id || DEFAULT_BRANCH_ID,
            staff_branch_name: getBranchName(branchScope.branchDirectory, row.staff_branch_id || row.branch_id || DEFAULT_BRANCH_ID),
        })));
    } catch (err) {
        console.error('PAYROLL LIST:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.post('/payroll', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { user_id, pay_period, base_pay, commission, deductions, notes } = req.body || {};
        const uid = posInt(user_id);
        if (!uid || !pay_period) return res.status(400).json({ error: 'user_id and pay_period are required.' });
        const staffResult = await pool.query(
            `SELECT id, role, COALESCE(branch_id, $3) AS branch_id
             FROM users
             WHERE id = $1 AND gym_id = $2
             LIMIT 1`,
            [uid, gid, DEFAULT_BRANCH_ID]
        );
        const staff = staffResult.rows[0];
        if (!staff) return res.status(404).json({ error: 'Staff member not found.' });
        if (String(staff.role || '').trim().toUpperCase() === 'OWNER') {
            return res.status(400).json({ error: 'Owner payroll entries should not be created here.' });
        }

        const branchScope = await resolveBranchWriteScope(pool, req, staff.branch_id);
        const net = Number(base_pay||0) + Number(commission||0) - Number(deductions||0);
        const result = await pool.query(
            `INSERT INTO payroll_entries (gym_id, user_id, pay_period, base_pay, commission, deductions, net_pay, notes, status, branch_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [gid, uid, String(pay_period).trim(), Number(base_pay||0), Number(commission||0), Number(deductions||0), net, String(notes||'').trim(), 'PENDING_APPROVAL', branchScope.branchId, req.user.id]);
        return res.status(201).json({
            ...result.rows[0],
            branch_id: branchScope.branchId,
            branch_name: getBranchName(branchScope.branchDirectory, branchScope.branchId),
        });
    } catch (err) {
        console.error('PAYROLL CREATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.put('/payroll/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const existingResult = await pool.query(
            `SELECT id, status, branch_id, base_pay, commission, deductions, notes
             FROM payroll_entries
             WHERE id = $1 AND gym_id = $2
             LIMIT 1`,
            [id, gid]
        );
        const existing = existingResult.rows[0];
        if (!existing) return res.status(404).json({ error: 'Not found.' });

        const branchScope = await resolveBranchReadScope(pool, req, existing.branch_id || DEFAULT_BRANCH_ID);
        const nextStatus = normalizePayrollStatus(req.body?.status, existing.status || 'PENDING_APPROVAL');
        if (!isOwnerUser(req) && nextStatus !== String(existing.status || '').trim().toUpperCase()) {
            return res.status(403).json({ error: 'Only owners can approve, reject, or settle payroll.' });
        }
        if (nextStatus === 'PAID' && !['APPROVED', 'PAID'].includes(String(existing.status || '').trim().toUpperCase())) {
            return res.status(400).json({ error: 'Approve payroll before marking it as paid.' });
        }

        const normalizedBasePay = Number(base_pay ?? existing.base_pay ?? 0);
        const normalizedCommission = Number(commission ?? existing.commission ?? 0);
        const normalizedDeductions = Number(deductions ?? existing.deductions ?? 0);
        const normalizedNotes = String(notes ?? existing.notes ?? '').trim();
        const rejectionReason = String(req.body?.rejection_reason || '').trim();
        const payoutMode = String(req.body?.payout_mode || '').trim();
        const payoutReference = String(req.body?.payout_reference || '').trim();
        const payoutNotes = String(req.body?.payout_notes || '').trim();
        const net = normalizedBasePay + normalizedCommission - normalizedDeductions;
        const result = await pool.query(
            `UPDATE payroll_entries
             SET base_pay = $1,
                 commission = $2,
                 deductions = $3,
                 net_pay = $4,
                 notes = $5,
                 status = $6,
                 approved_at = CASE
                    WHEN $6 IN ('APPROVED', 'PAID') THEN COALESCE(approved_at, NOW())
                    WHEN $6 = 'REJECTED' THEN NULL
                    ELSE approved_at
                 END,
                 approved_by = CASE
                    WHEN $6 IN ('APPROVED', 'PAID') THEN COALESCE(approved_by, $7)
                    WHEN $6 = 'REJECTED' THEN NULL
                    ELSE approved_by
                 END,
                 paid_at = CASE
                    WHEN $6 = 'PAID' THEN COALESCE(paid_at, NOW())
                    ELSE NULL
                 END,
                 paid_by = CASE
                    WHEN $6 = 'PAID' THEN $7
                    ELSE NULL
                 END,
                 payout_mode = CASE WHEN $6 = 'PAID' THEN $8 ELSE '' END,
                 payout_reference = CASE WHEN $6 = 'PAID' THEN $9 ELSE '' END,
                 payout_notes = CASE WHEN $6 = 'PAID' THEN $10 ELSE '' END,
                 rejection_reason = CASE WHEN $6 = 'REJECTED' THEN $11 ELSE '' END
             WHERE id = $12 AND gym_id = $13
             RETURNING *`,
            [normalizedBasePay, normalizedCommission, normalizedDeductions, net, normalizedNotes,
             nextStatus, req.user.id, payoutMode, payoutReference, payoutNotes, rejectionReason, id, gid]);
        return res.json({
            ...result.rows[0],
            branch_id: existing.branch_id || DEFAULT_BRANCH_ID,
            branch_name: getBranchName(branchScope.branchDirectory, existing.branch_id || DEFAULT_BRANCH_ID),
        });
    } catch (err) {
        console.error('PAYROLL UPDATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════════════════════════
//   POS: Products
// ═══════════════════════════════════════════════════════════
router.get('/pos/products', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const branchScope = await resolveBranchReadScope(pool, req);
        const params = [gid];
        const branchFilter = getBranchFilterSql(params, branchScope.branchId, 'branch_id');
        const result = await pool.query(
            `SELECT id, name, category, price, stock_qty, low_stock_threshold, branch_id
             FROM pos_products
             WHERE gym_id=$1 AND deleted_at IS NULL${branchFilter}
             ORDER BY name ASC`, params);
        return res.json(mapBranchRows(result.rows, branchScope.branchDirectory));
    } catch (err) {
        console.error('POS PRODUCTS:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.post('/pos/products', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req);
        const { name, category, price, cost_price, stock_qty, low_stock_threshold, sku } = req.body || {};
        if (!name || !price) return res.status(400).json({ error: 'name and price required.' });
        const branchScope = await resolveBranchWriteScope(pool, req, req.body?.branch_id);
        const result = await pool.query(
            `INSERT INTO pos_products (gym_id, name, category, price, cost_price, stock_qty, low_stock_threshold, sku, branch_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [gid, String(name).trim(), String(category||'General').trim(), Number(price), Number(cost_price||0),
             Number(stock_qty||0), Number(low_stock_threshold||5), String(sku||'').trim(), branchScope.branchId]);
        return res.status(201).json({
            ...result.rows[0],
            branch_id: branchScope.branchId,
            branch_name: getBranchName(branchScope.branchDirectory, branchScope.branchId),
        });
    } catch (err) {
        console.error('POS PRODUCT CREATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.put('/pos/products/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const { name, category, price, cost_price, stock_qty, low_stock_threshold, sku, is_active } = req.body || {};
        const existingBranchId = await loadScopedRecordBranch(pool, 'pos_products', id, gid);
        if (!existingBranchId) return res.status(404).json({ error: 'Not found.' });
        const branchScope = await resolveBranchWriteScope(pool, req, req.body?.branch_id === undefined ? existingBranchId : req.body?.branch_id);
        const result = await pool.query(
            `UPDATE pos_products SET name=$1, category=$2, price=$3, cost_price=$4, stock_qty=$5,
             low_stock_threshold=$6, sku=$7, is_active=$8, branch_id=$9 WHERE id=$10 AND gym_id=$11 AND deleted_at IS NULL RETURNING *`,
            [String(name||'').trim(), String(category||'General').trim(), Number(price||0), Number(cost_price||0),
             Number(stock_qty||0), Number(low_stock_threshold||5), String(sku||'').trim(),
             typeof is_active === 'boolean' ? is_active : true, branchScope.branchId, id, gid]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json({
            ...result.rows[0],
            branch_id: branchScope.branchId,
            branch_name: getBranchName(branchScope.branchDirectory, branchScope.branchId),
        });
    } catch (err) {
        console.error('POS PRODUCT UPDATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.delete('/pos/products/:id', requirePermission('payments:write'), async (req, res) => {
    try {
        const gid = gymId(req); const id = posInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid id.' });
        const branchScope = await resolveBranchReadScope(pool, req, await loadScopedRecordBranch(pool, 'pos_products', id, gid));
        const params = [id, gid];
        const branchFilter = getBranchFilterSql(params, branchScope.branchId, 'branch_id');
        const result = await pool.query(`UPDATE pos_products SET deleted_at=NOW() WHERE id=$1 AND gym_id=$2${branchFilter} RETURNING id`, params);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json({ message: 'Product deleted.' });
    } catch (err) {
        console.error('POS PRODUCT DELETE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

// ═══════════════════════════════════════════════════════════
//   POS: Sales
// ═══════════════════════════════════════════════════════════
router.get('/pos/sales', requirePermission('payments:read'), async (req, res) => {
    try {
        const gid = gymId(req);
        const branchScope = await resolveBranchReadScope(pool, req);
        const params = [gid];
        const branchFilter = getBranchFilterSql(params, branchScope.branchId, 'ps.branch_id');
        const result = await pool.query(
            `SELECT ps.*, m.full_name AS member_name, u.full_name AS sold_by_name,
             COALESCE((SELECT json_agg(json_build_object('product_name',si.product_name,'quantity',si.quantity,'unit_price',si.unit_price,'total_price',si.total_price))
               FROM pos_sale_items si WHERE si.sale_id=ps.id), '[]') AS items
             FROM pos_sales ps
             LEFT JOIN members m ON m.id=ps.member_id LEFT JOIN users u ON u.id=ps.sold_by
             WHERE ps.gym_id=$1${branchFilter} ORDER BY ps.created_at DESC`, params);
        return res.json(mapBranchRows(result.rows, branchScope.branchDirectory));
    } catch (err) {
        console.error('POS SALES:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Failed' });
    }
});

router.post('/pos/sales', requirePermission('payments:write'), async (req, res) => {
    const client = await pool.connect();
    try {
        const gid = gymId(req);
        const branchScope = await resolveBranchWriteScope(pool, req, req.body?.branch_id);
        const { member_id, items, payment_mode, notes } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required.' });

        const requestedItems = items.map((item) => ({
            product_id: posInt(item?.product_id),
            quantity: posInt(item?.quantity),
        }));
        if (requestedItems.some((item) => !item.product_id || !item.quantity)) {
            return res.status(400).json({ error: 'Each sale item needs a valid product_id and quantity.' });
        }

        const requestedQuantities = new Map();
        for (const item of requestedItems) {
            requestedQuantities.set(item.product_id, (requestedQuantities.get(item.product_id) || 0) + item.quantity);
        }

        const productIds = Array.from(requestedQuantities.keys());

        await client.query('BEGIN');
        const lockedProductsRes = await client.query(
            `SELECT id, name, price, stock_qty
             FROM pos_products
             WHERE id = ANY($1::int[])
               AND gym_id = $2
                             AND branch_id = $3
               AND deleted_at IS NULL
             FOR UPDATE`,
                        [productIds, gid, branchScope.branchId]
        );

        const lockedProducts = new Map(lockedProductsRes.rows.map((row) => [Number(row.id), row]));
        const missingProductId = productIds.find((productId) => !lockedProducts.has(productId));
        if (missingProductId) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `Product ${missingProductId} not found.` });
        }

        const insufficientProductId = productIds.find((productId) => {
            const product = lockedProducts.get(productId);
            return Number(product?.stock_qty || 0) < (requestedQuantities.get(productId) || 0);
        });
        if (insufficientProductId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `Insufficient stock for product ${insufficientProductId}.` });
        }

        for (const [productId, quantity] of requestedQuantities.entries()) {
            await client.query(
                `UPDATE pos_products
                 SET stock_qty = stock_qty - $1
                 WHERE id = $2 AND gym_id = $3 AND deleted_at IS NULL`,
                [quantity, productId, gid]
            );
        }

        let totalAmount = 0;
        const validItems = [];
        for (const item of requestedItems) {
            const product = lockedProducts.get(item.product_id);
            const unitPrice = Number(product.price);
            const lineTotal = unitPrice * item.quantity;
            totalAmount += lineTotal;
            validItems.push({
                product_id: item.product_id,
                product_name: product.name,
                quantity: item.quantity,
                unit_price: unitPrice,
                total_price: lineTotal,
            });
        }

        const saleRes = await client.query(
            `INSERT INTO pos_sales (gym_id, member_id, total_amount, payment_mode, notes, branch_id, sold_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [gid, posInt(member_id), totalAmount, String(payment_mode||'Cash').trim(), String(notes||'').trim(), branchScope.branchId, req.user.id]);
        const saleId = saleRes.rows[0].id;

        for (const vi of validItems) {
            await client.query(
                `INSERT INTO pos_sale_items (sale_id, product_id, product_name, quantity, unit_price, total_price)
                 VALUES ($1,$2,$3,$4,$5,$6)`, [saleId, vi.product_id, vi.product_name, vi.quantity, vi.unit_price, vi.total_price]);
        }

        await client.query('COMMIT');
        return res.status(201).json({
            ...saleRes.rows[0],
            branch_id: branchScope.branchId,
            branch_name: getBranchName(branchScope.branchDirectory, branchScope.branchId),
            items: validItems,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('POS SALE CREATE:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
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
