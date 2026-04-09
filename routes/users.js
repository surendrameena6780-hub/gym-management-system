const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware'); // Added Auth Check
const { requireOwner, getDefaultPermissionsByStaffRole } = require('../middleware/rbac');
const {
    BranchAccessError,
    DEFAULT_BRANCH_ID,
    branchSchemaMiddleware,
    getBranchName,
    getGymBranchDirectory,
    resolveBranchWriteScope,
} = require('../utils/branchAccess');
const {
    computeEffectiveBillingLimits,
    getBillingConfig,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
} = require('../utils/platformSettings');

const saasMiddleware = require('../middleware/saasMiddleware');

router.use(branchSchemaMiddleware);

const normalizeStaffRole = (role) => {
    const value = String(role || 'STAFF').trim().toUpperCase();
    const allowed = new Set(['MANAGER', 'RECEPTION', 'TRAINER', 'WORKER', 'CLEANER', 'ACCOUNTANT', 'STAFF']);
    return allowed.has(value) ? value : 'STAFF';
};

const normalizePermissions = (permissions, staffRole) => {
    if (Array.isArray(permissions) && permissions.length > 0) {
        return Array.from(new Set(permissions.map((value) => String(value || '').trim()).filter(Boolean)));
    }
    return getDefaultPermissionsByStaffRole(staffRole);
};

// GET /api/users — Returns gym users for admin dropdowns
router.get('/', auth, async (req, res) => {
    try {
        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const result = await pool.query(
            `SELECT id, full_name, email, role, staff_role, branch_id, is_active
             FROM users
             WHERE gym_id = $1
             ORDER BY full_name ASC`,
             [req.user.gym_id] // Securely locks queries to the logged-in owner's unique gym ID
        );
        res.json(result.rows.map((row) => ({
            ...row,
            branch_id: row.branch_id || DEFAULT_BRANCH_ID,
            branch_name: getBranchName(branchDirectory, row.branch_id || DEFAULT_BRANCH_ID),
        })));
    } catch (err) {
        console.error("USERS ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// GET /api/users/staff — Owner-only staff list
router.get('/staff', auth, requireOwner, async (req, res) => {
    try {
        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const result = await pool.query(
            `SELECT id, full_name, email, role, staff_role, branch_id, is_active, permissions, created_at, last_login_at
             FROM users
             WHERE gym_id = $1
             ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END, full_name ASC`,
            [req.user.gym_id]
        );

        return res.json(result.rows.map((row) => ({
            ...row,
            branch_id: row.branch_id || DEFAULT_BRANCH_ID,
            branch_name: getBranchName(branchDirectory, row.branch_id || DEFAULT_BRANCH_ID),
        })));
    } catch (err) {
        console.error('STAFF LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

// POST /api/users/staff — Owner adds staff with email + password
router.post('/staff', auth, requireOwner, saasMiddleware, async (req, res) => {
    const { full_name, email, password, staff_role, permissions } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'full_name, email and password are required.' });
    }

    if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    try {
        const normalizedRole = normalizeStaffRole(staff_role);
        const effectivePermissions = normalizePermissions(permissions, normalizedRole);
        const branchScope = await resolveBranchWriteScope(pool, req, req.body?.branch_id);
        const [billingConfig, gymBilling, usageSnapshot] = await Promise.all([
            getBillingConfig(),
            getGymBillingSnapshot(pool, req.user.gym_id),
            getGymUsageSnapshot(pool, req.user.gym_id),
        ]);

        if (!gymBilling) {
            return res.status(404).json({ error: 'Gym not found.' });
        }

        const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymBilling.current_plan, gymBilling);
        if (effectiveLimits.staff !== null && Number(usageSnapshot.staff || 0) + 1 > effectiveLimits.staff) {
            return res.status(409).json({
                error: `Your current plan allows up to ${effectiveLimits.staff} staff user${effectiveLimits.staff === 1 ? '' : 's'} including add-ons. Upgrade the plan or add staff capacity before creating another staff login.`,
                allowed_staff: effectiveLimits.staff,
                current_staff: Number(usageSnapshot.staff || 0),
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const insert = await pool.query(
            `INSERT INTO users (gym_id, full_name, email, password_hash, role, staff_role, branch_id, is_active, permissions, created_by)
             VALUES ($1, $2, $3, $4, 'STAFF', $5, $6, TRUE, $7::jsonb, $8)
             RETURNING id, full_name, email, role, staff_role, branch_id, is_active, permissions, created_at`,
            [
                req.user.gym_id,
                full_name,
                String(email).trim().toLowerCase(),
                hashedPassword,
                normalizedRole,
                branchScope.branchId,
                JSON.stringify(effectivePermissions),
                req.user.id,
            ]
        );

        return res.status(201).json(insert.rows[0]);
    } catch (err) {
        console.error('STAFF CREATE ERROR:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (err.code === '23505') {
            return res.status(400).json({ error: 'This email is already registered.' });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

// PUT /api/users/staff/:id — Owner updates staff role, permissions, profile, status
router.put('/staff/:id', auth, requireOwner, saasMiddleware, async (req, res) => {
    const staffId = parseInt(req.params.id, 10);
    const { full_name, staff_role, is_active, permissions } = req.body;

    if (!Number.isInteger(staffId)) {
        return res.status(400).json({ error: 'Invalid staff id.' });
    }

    try {
        const existing = await pool.query(
            `SELECT id, role, branch_id
             FROM users
             WHERE id = $1 AND gym_id = $2`,
            [staffId, req.user.gym_id]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Staff user not found.' });
        }

        if (existing.rows[0].role === 'OWNER') {
            return res.status(400).json({ error: 'Owner account cannot be edited here.' });
        }

        const normalizedRole = normalizeStaffRole(staff_role);
        const effectivePermissions = normalizePermissions(permissions, normalizedRole);
        const nextBranchScope = req.body?.branch_id === undefined
            ? { branchId: existing.rows[0].branch_id || DEFAULT_BRANCH_ID }
            : await resolveBranchWriteScope(pool, req, req.body?.branch_id);

        const updated = await pool.query(
            `UPDATE users
             SET full_name = COALESCE($1, full_name),
                 staff_role = $2,
                 branch_id = $3,
                 is_active = COALESCE($4, is_active),
                 permissions = $5::jsonb
             WHERE id = $6 AND gym_id = $7
             RETURNING id, full_name, email, role, staff_role, branch_id, is_active, permissions, created_at, last_login_at`,
            [
                full_name || null,
                normalizedRole,
                nextBranchScope.branchId,
                typeof is_active === 'boolean' ? is_active : null,
                JSON.stringify(effectivePermissions),
                staffId,
                req.user.gym_id,
            ]
        );

        return res.json(updated.rows[0]);
    } catch (err) {
        console.error('STAFF UPDATE ERROR:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

// POST /api/users/staff/:id/reset-password — Owner resets staff password
router.post('/staff/:id/reset-password', auth, requireOwner, saasMiddleware, async (req, res) => {
    const staffId = parseInt(req.params.id, 10);
    const { new_password } = req.body;

    if (!Number.isInteger(staffId)) {
        return res.status(400).json({ error: 'Invalid staff id.' });
    }

    if (!new_password || String(new_password).length < 8) {
        return res.status(400).json({ error: 'new_password must be at least 8 characters.' });
    }

    try {
        const existing = await pool.query(
            `SELECT id, role
             FROM users
             WHERE id = $1 AND gym_id = $2`,
            [staffId, req.user.gym_id]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Staff user not found.' });
        }

        if (existing.rows[0].role === 'OWNER') {
            return res.status(400).json({ error: 'Owner password cannot be reset from this action.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(new_password, salt);

        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2 AND gym_id = $3',
            [hashed, staffId, req.user.gym_id]
        );

        return res.json({ message: 'Staff password reset successfully.' });
    } catch (err) {
        console.error('STAFF PASSWORD RESET ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;