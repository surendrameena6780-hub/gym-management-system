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
    resolveBranchReadScope,
    resolveBranchWriteScope,
} = require('../utils/branchAccess');
const {
    ValidationError,
    ensureChoice,
    ensureInteger,
    ensureTimestamp,
    ensureTrimmedString,
    isValidationError,
} = require('../utils/fieldValidation');
const {
    computeEffectiveBillingLimits,
    getBillingConfig,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
} = require('../utils/platformSettings');

const saasMiddleware = require('../middleware/saasMiddleware');
const DEFAULT_BRANCH_SQL = `'${DEFAULT_BRANCH_ID}'`;
const STAFF_TASK_CATEGORIES = ['CLEANING', 'COUNT', 'MAINTENANCE', 'INVENTORY', 'FOLLOW_UP', 'FRONT_DESK', 'TRAINING', 'OTHER'];
const STAFF_TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const OWNER_TASK_STATUSES = ['OPEN', 'CANCELLED'];
const STAFF_TASK_PROGRESS_STATUSES = ['OPEN', 'IN_PROGRESS'];
let ensureStaffTaskSchemaPromise = null;

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

const isOwnerUser = (user) => String(user?.role || '').trim().toUpperCase() === 'OWNER';

const ensureStaffTaskSchema = async () => {
    if (!ensureStaffTaskSchemaPromise) {
        ensureStaffTaskSchemaPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS staff_tasks (
                id                SERIAL PRIMARY KEY,
                gym_id            INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                branch_id         VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}',
                assigned_to       INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title             VARCHAR(160) NOT NULL,
                description       TEXT DEFAULT '',
                category          VARCHAR(40) DEFAULT 'OTHER',
                priority          VARCHAR(20) DEFAULT 'MEDIUM',
                status            VARCHAR(20) DEFAULT 'OPEN',
                due_at            TIMESTAMPTZ,
                completion_notes  TEXT DEFAULT '',
                completion_photos JSONB DEFAULT '[]'::jsonb,
                completed_at      TIMESTAMPTZ,
                created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                updated_at        TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_staff_tasks_gym_id ON staff_tasks(gym_id);
            CREATE INDEX IF NOT EXISTS idx_staff_tasks_assigned_to ON staff_tasks(assigned_to);
            CREATE INDEX IF NOT EXISTS idx_staff_tasks_due_at ON staff_tasks(due_at);
        `).catch((error) => {
            ensureStaffTaskSchemaPromise = null;
            throw error;
        });
    }

    await ensureStaffTaskSchemaPromise;
};

const normalizeTaskPhotoUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
        return raw;
    }

    try {
        const parsed = new URL(raw);
        if (!/^https?:$/i.test(parsed.protocol)) return '';
        return parsed.toString();
    } catch (_err) {
        return '';
    }
};

const normalizeTaskPhotoList = (value, { required = false } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) {
            throw new ValidationError('completion_photos is required.');
        }
        return [];
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('completion_photos must be an array.');
    }

    if (value.length > 4) {
        throw new ValidationError('completion_photos can include at most 4 images.');
    }

    const normalized = value.map((item, index) => {
        const nextValue = normalizeTaskPhotoUrl(item);
        if (!nextValue) {
            throw new ValidationError(`completion_photos[${index}] must be a valid image.`);
        }
        if (nextValue.length > 2_800_000) {
            throw new ValidationError(`completion_photos[${index}] is too large.`);
        }
        return nextValue;
    });

    if (required && normalized.length === 0) {
        throw new ValidationError('At least one completion photo is required.');
    }

    return normalized;
};

const normalizeStaffTaskPayload = (payload = {}) => ({
    assigned_to: ensureInteger(payload.assigned_to, { field: 'assigned_to', required: true, min: 1 }),
    title: ensureTrimmedString(payload.title, { field: 'title', required: true, min: 3, max: 160 }),
    description: ensureTrimmedString(payload.description, { field: 'description', max: 2000 }),
    category: ensureChoice(payload.category, { field: 'category', choices: STAFF_TASK_CATEGORIES, required: true, defaultValue: 'OTHER', uppercase: true }),
    priority: ensureChoice(payload.priority, { field: 'priority', choices: STAFF_TASK_PRIORITIES, required: true, defaultValue: 'MEDIUM', uppercase: true }),
    due_at: ensureTimestamp(payload.due_at, { field: 'due_at', required: true }),
});

const normalizeOwnerTaskStatus = (value) => ensureChoice(value, {
    field: 'status',
    choices: OWNER_TASK_STATUSES,
    required: true,
    uppercase: true,
});

const normalizeStaffTaskProgressStatus = (value) => ensureChoice(value, {
    field: 'status',
    choices: STAFF_TASK_PROGRESS_STATUSES,
    required: true,
    uppercase: true,
});

const normalizeTaskCompletionPayload = (payload = {}) => ({
    completion_notes: ensureTrimmedString(payload.completion_notes, { field: 'completion_notes', max: 2000 }),
    completion_photos: normalizeTaskPhotoList(payload.completion_photos, { required: true }),
});

const buildTaskMeta = (task = {}) => {
    const rawStatus = String(task.status || 'OPEN').trim().toUpperCase() || 'OPEN';
    const dueAt = task.due_at ? new Date(task.due_at) : null;
    const isOverdue = Boolean(
        dueAt
        && !Number.isNaN(dueAt.getTime())
        && ['OPEN', 'IN_PROGRESS'].includes(rawStatus)
        && dueAt.getTime() < Date.now()
    );

    const statusLabel = rawStatus === 'IN_PROGRESS'
        ? 'In Progress'
        : rawStatus === 'COMPLETED'
            ? 'Completed'
            : rawStatus === 'CANCELLED'
                ? 'Cancelled'
                : isOverdue
                    ? 'Overdue'
                    : 'Open';

    return { rawStatus, isOverdue, statusLabel };
};

const mapTaskRow = (row, branchDirectory = []) => {
    const { rawStatus, isOverdue, statusLabel } = buildTaskMeta(row);
    return {
        id: Number(row.id),
        branch_id: row.branch_id || DEFAULT_BRANCH_ID,
        branch_name: getBranchName(branchDirectory, row.branch_id || DEFAULT_BRANCH_ID),
        assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
        assigned_staff_name: row.assigned_staff_name || '',
        assigned_staff_role: row.assigned_staff_role || 'STAFF',
        title: row.title || '',
        description: row.description || '',
        category: row.category || 'OTHER',
        priority: row.priority || 'MEDIUM',
        status: rawStatus,
        status_label: statusLabel,
        is_overdue: isOverdue,
        due_at: row.due_at || null,
        completion_notes: row.completion_notes || '',
        completion_photos: Array.isArray(row.completion_photos) ? row.completion_photos.filter(Boolean) : [],
        completed_at: row.completed_at || null,
        created_at: row.created_at || null,
        created_by: row.created_by ? Number(row.created_by) : null,
        created_by_name: row.created_by_name || '',
        updated_at: row.updated_at || null,
    };
};

const STAFF_TASK_SELECT = `
    SELECT
        st.*,
        assignee.full_name AS assigned_staff_name,
        COALESCE(assignee.staff_role, assignee.role, 'STAFF') AS assigned_staff_role,
        creator.full_name AS created_by_name
    FROM staff_tasks st
    LEFT JOIN users assignee ON assignee.id = st.assigned_to
    LEFT JOIN users creator ON creator.id = st.created_by
`;

const getStaffTaskRowById = async (taskId, gymId) => {
    const result = await pool.query(
        `${STAFF_TASK_SELECT}
         WHERE st.id = $1 AND st.gym_id = $2
         LIMIT 1`,
        [taskId, gymId]
    );
    return result.rows[0] || null;
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
        const scope = await resolveBranchReadScope(pool, req);
        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const params = [req.user.gym_id];
        const scopedBranchFilter = scope.branchId
            ? ` AND (UPPER(COALESCE(role, 'STAFF')) = 'OWNER' OR COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) = $2)`
            : '';

        if (scope.branchId) {
            params.push(scope.branchId);
        }

        const result = await pool.query(
            `SELECT id, full_name, email, role, staff_role, branch_id, is_active, permissions, created_at, last_login_at
             FROM users
             WHERE gym_id = $1${scopedBranchFilter}
             ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END, full_name ASC`,
            params
        );

        return res.json(result.rows.map((row) => ({
            ...row,
            branch_id: row.branch_id || DEFAULT_BRANCH_ID,
            branch_name: getBranchName(branchDirectory, row.branch_id || DEFAULT_BRANCH_ID),
        })));
    } catch (err) {
        console.error('STAFF LIST ERROR:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
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
                error: `Your current plan allows up to ${effectiveLimits.staff} staff user${effectiveLimits.staff === 1 ? '' : 's'} across your gym including add-ons. Delete a staff user or add more staff capacity before creating another staff login.`,
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
        const currentBranchId = existing.rows[0].branch_id || DEFAULT_BRANCH_ID;
        const nextBranchScope = req.body?.branch_id === undefined
            ? { branchId: currentBranchId }
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
router.delete('/staff/:id', auth, requireOwner, saasMiddleware, async (req, res) => {
    const staffId = parseInt(req.params.id, 10);

    if (!Number.isInteger(staffId)) {
        return res.status(400).json({ error: 'Invalid staff id.' });
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
            return res.status(400).json({ error: 'Owner account cannot be deleted here.' });
        }

        await pool.query(
            `DELETE FROM users
             WHERE id = $1 AND gym_id = $2`,
            [staffId, req.user.gym_id]
        );

        return res.json({ message: 'Staff member deleted successfully.' });
    } catch (err) {
        console.error('STAFF DELETE ERROR:', err.message);
        if (err.code === '23503') {
            return res.status(409).json({ error: 'This staff member is still linked to protected records and cannot be deleted yet.' });
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

router.get('/tasks', auth, async (req, res) => {
    try {
        await ensureStaffTaskSchema();
        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
        const includeCompleted = String(req.query.include_completed || '').trim() === '1';
        const includeCancelled = String(req.query.include_cancelled || '').trim() === '1';
        const whereClauses = ['st.gym_id = $1'];
        const params = [req.user.gym_id];

        if (isOwnerUser(req.user)) {
            const scope = await resolveBranchReadScope(pool, req);
            if (scope.branchId) {
                whereClauses.push(`COALESCE(st.branch_id, ${DEFAULT_BRANCH_SQL}) = $${params.length + 1}`);
                params.push(scope.branchId);
            }

            const assignedTo = ensureInteger(req.query.assigned_to, { field: 'assigned_to', min: 1, defaultValue: null });
            if (assignedTo) {
                whereClauses.push(`st.assigned_to = $${params.length + 1}`);
                params.push(assignedTo);
            }
        } else {
            whereClauses.push(`st.assigned_to = $${params.length + 1}`);
            params.push(req.user.id);
        }

        if (!includeCompleted) {
            whereClauses.push(`COALESCE(st.status, 'OPEN') <> 'COMPLETED'`);
        }
        if (!includeCancelled) {
            whereClauses.push(`COALESCE(st.status, 'OPEN') <> 'CANCELLED'`);
        }

        const result = await pool.query(
            `${STAFF_TASK_SELECT}
             WHERE ${whereClauses.join(' AND ')}
             ORDER BY
                CASE
                    WHEN COALESCE(st.status, 'OPEN') IN ('OPEN', 'IN_PROGRESS') THEN 0
                    WHEN COALESCE(st.status, 'OPEN') = 'COMPLETED' THEN 1
                    ELSE 2
                END,
                COALESCE(st.due_at, st.created_at) ASC,
                st.id DESC
             LIMIT $${params.length + 1}`,
            [...params, limit]
        );

        return res.json(result.rows.map((row) => mapTaskRow(row, branchDirectory)));
    } catch (err) {
        console.error('STAFF TASK LIST ERROR:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/tasks', auth, requireOwner, saasMiddleware, async (req, res) => {
    try {
        await ensureStaffTaskSchema();
        const payload = normalizeStaffTaskPayload(req.body || {});
        const assigneeResult = await pool.query(
            `SELECT id, role, staff_role, branch_id, is_active
             FROM users
             WHERE id = $1 AND gym_id = $2
             LIMIT 1`,
            [payload.assigned_to, req.user.gym_id]
        );

        if (assigneeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Assigned staff member not found.' });
        }

        const assignee = assigneeResult.rows[0];
        if (String(assignee.role || '').trim().toUpperCase() === 'OWNER') {
            return res.status(400).json({ error: 'Tasks can only be assigned to staff accounts.' });
        }
        if (!Boolean(assignee.is_active)) {
            return res.status(400).json({ error: 'This staff member is inactive. Activate them before assigning tasks.' });
        }

        const branchScope = await resolveBranchWriteScope(pool, req, assignee.branch_id || DEFAULT_BRANCH_ID);
        const insertResult = await pool.query(
            `INSERT INTO staff_tasks (
                gym_id,
                branch_id,
                assigned_to,
                title,
                description,
                category,
                priority,
                status,
                due_at,
                created_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9)
             RETURNING id`,
            [
                req.user.gym_id,
                branchScope.branchId,
                assignee.id,
                payload.title,
                payload.description,
                payload.category,
                payload.priority,
                payload.due_at,
                req.user.id,
            ]
        );

        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const taskRow = await getStaffTaskRowById(insertResult.rows[0].id, req.user.gym_id);
        return res.status(201).json(mapTaskRow(taskRow, branchDirectory));
    } catch (err) {
        console.error('STAFF TASK CREATE ERROR:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.patch('/tasks/:id/status', auth, saasMiddleware, async (req, res) => {
    try {
        await ensureStaffTaskSchema();
        const taskId = ensureInteger(req.params.id, { field: 'task id', required: true, min: 1 });
        const currentTask = await getStaffTaskRowById(taskId, req.user.gym_id);
        if (!currentTask) {
            return res.status(404).json({ error: 'Task not found.' });
        }

        const ownerUser = isOwnerUser(req.user);
        if (!ownerUser && Number(currentTask.assigned_to || 0) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'You can only update your own tasks.' });
        }

        const currentStatus = String(currentTask.status || 'OPEN').trim().toUpperCase();
        const nextStatus = ownerUser
            ? normalizeOwnerTaskStatus(req.body?.status)
            : normalizeStaffTaskProgressStatus(req.body?.status);

        if (!ownerUser && ['COMPLETED', 'CANCELLED'].includes(currentStatus)) {
            return res.status(400).json({ error: 'This task can no longer be updated.' });
        }

        const values = [nextStatus, taskId, req.user.gym_id];
        let completionResetSql = '';
        if (ownerUser && nextStatus === 'OPEN') {
            completionResetSql = ", completion_notes = '', completion_photos = '[]'::jsonb, completed_at = NULL";
        }

        await pool.query(
            `UPDATE staff_tasks
             SET status = $1,
                 updated_at = NOW()${completionResetSql}
             WHERE id = $2 AND gym_id = $3`,
            values
        );

        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const taskRow = await getStaffTaskRowById(taskId, req.user.gym_id);
        return res.json(mapTaskRow(taskRow, branchDirectory));
    } catch (err) {
        console.error('STAFF TASK STATUS ERROR:', err.message);
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/tasks/:id/complete', auth, saasMiddleware, async (req, res) => {
    try {
        await ensureStaffTaskSchema();
        const taskId = ensureInteger(req.params.id, { field: 'task id', required: true, min: 1 });
        const currentTask = await getStaffTaskRowById(taskId, req.user.gym_id);
        if (!currentTask) {
            return res.status(404).json({ error: 'Task not found.' });
        }

        const ownerUser = isOwnerUser(req.user);
        if (!ownerUser && Number(currentTask.assigned_to || 0) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'You can only complete your own tasks.' });
        }

        const currentStatus = String(currentTask.status || 'OPEN').trim().toUpperCase();
        if (currentStatus === 'CANCELLED') {
            return res.status(400).json({ error: 'Cancelled tasks cannot be completed.' });
        }

        const payload = normalizeTaskCompletionPayload(req.body || {});
        await pool.query(
            `UPDATE staff_tasks
             SET status = 'COMPLETED',
                 completion_notes = $1,
                 completion_photos = $2::jsonb,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $3 AND gym_id = $4`,
            [payload.completion_notes, JSON.stringify(payload.completion_photos), taskId, req.user.gym_id]
        );

        const branchDirectory = await getGymBranchDirectory(pool, req.user.gym_id);
        const taskRow = await getStaffTaskRowById(taskId, req.user.gym_id);
        return res.json(mapTaskRow(taskRow, branchDirectory));
    } catch (err) {
        console.error('STAFF TASK COMPLETE ERROR:', err.message);
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/tasks/:id', auth, requireOwner, saasMiddleware, async (req, res) => {
    try {
        await ensureStaffTaskSchema();
        const taskId = ensureInteger(req.params.id, { field: 'task id', required: true, min: 1 });
        const existingTask = await getStaffTaskRowById(taskId, req.user.gym_id);
        if (!existingTask) {
            return res.status(404).json({ error: 'Task not found.' });
        }

        await resolveBranchWriteScope(pool, req, existingTask.branch_id || DEFAULT_BRANCH_ID);
        await pool.query('DELETE FROM staff_tasks WHERE id = $1 AND gym_id = $2', [taskId, req.user.gym_id]);
        return res.json({ message: 'Task deleted successfully.' });
    } catch (err) {
        console.error('STAFF TASK DELETE ERROR:', err.message);
        if (err instanceof BranchAccessError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        return res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;