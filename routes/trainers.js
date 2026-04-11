const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbac');
const saasMiddleware = require('../middleware/saasMiddleware');
const { branchSchemaMiddleware } = require('../utils/branchAccess');
const { ensureInteger, ensureTrimmedString } = require('../utils/fieldValidation');
const { isValidationError } = require('../utils/fieldValidation');
const { ok, fail } = require('../utils/apiResponse');

router.use(branchSchemaMiddleware);

// --- LIST ASSIGNMENTS FOR GYM ---
router.get('/assignments', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const trainerFilter = req.query.trainer_id ? ensureInteger(req.query.trainer_id, { field: 'trainer_id', min: 1 }) : null;

        let query = `
            SELECT ta.*, u.full_name AS trainer_name, m.full_name AS member_name, m.phone AS member_phone, m.email AS member_email
            FROM trainer_assignments ta
            JOIN users u ON ta.trainer_user_id = u.id
            JOIN members m ON ta.member_id = m.id
            WHERE ta.gym_id = $1 AND ta.is_active = TRUE`;
        const params = [gym_id];

        if (trainerFilter) {
            query += ` AND ta.trainer_user_id = $${params.length + 1}`;
            params.push(trainerFilter);
        }

        query += ` ORDER BY ta.assigned_at DESC`;

        const result = await pool.query(query, params);
        return ok(res, { assignments: result.rows });
    } catch (err) {
        console.error('TRAINER ASSIGNMENTS LIST ERROR:', err.message);
        return fail(res, 500, 'TRAINER_ASSIGNMENTS_LIST_FAILED', 'Failed to load trainer assignments.');
    }
});

// --- ASSIGN MEMBER TO TRAINER ---
router.post('/assignments', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const trainerUserId = ensureInteger(req.body?.trainer_user_id, { field: 'trainer_user_id', required: true, min: 1 });
        const memberId = ensureInteger(req.body?.member_id, { field: 'member_id', required: true, min: 1 });
        const notes = String(req.body?.notes || '').trim().slice(0, 500);

        // Verify trainer belongs to gym and has TRAINER role
        const trainerCheck = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND gym_id = $2 AND staff_role = 'TRAINER' AND is_active = TRUE`,
            [trainerUserId, gym_id]
        );
        if (trainerCheck.rows.length === 0) {
            return fail(res, 404, 'TRAINER_NOT_FOUND', 'Trainer not found or not active.');
        }

        // Verify member belongs to gym
        const memberCheck = await pool.query(
            `SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL`,
            [memberId, gym_id]
        );
        if (memberCheck.rows.length === 0) {
            return fail(res, 404, 'MEMBER_NOT_FOUND', 'Member not found.');
        }

        const result = await pool.query(
            `INSERT INTO trainer_assignments (gym_id, trainer_user_id, member_id, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (gym_id, trainer_user_id, member_id)
             DO UPDATE SET is_active = TRUE, notes = EXCLUDED.notes, assigned_at = NOW()
             RETURNING *`,
            [gym_id, trainerUserId, memberId, notes]
        );

        return ok(res, { message: 'Member assigned to trainer.', assignment: result.rows[0] });
    } catch (err) {
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
        console.error('TRAINER ASSIGN ERROR:', err.message);
        return fail(res, 500, 'TRAINER_ASSIGN_FAILED', 'Failed to assign member to trainer.');
    }
});

// --- REMOVE ASSIGNMENT ---
router.delete('/assignments/:id', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const assignmentId = ensureInteger(req.params.id, { field: 'assignment_id', required: true, min: 1 });

        const result = await pool.query(
            `UPDATE trainer_assignments SET is_active = FALSE WHERE id = $1 AND gym_id = $2 RETURNING *`,
            [assignmentId, gym_id]
        );

        if (result.rows.length === 0) {
            return fail(res, 404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
        }

        return ok(res, { message: 'Assignment removed.', assignment: result.rows[0] });
    } catch (err) {
        console.error('TRAINER UNASSIGN ERROR:', err.message);
        return fail(res, 500, 'TRAINER_UNASSIGN_FAILED', 'Failed to remove assignment.');
    }
});

// --- MY MEMBERS (for trainer's own view) ---
router.get('/my-members', auth, saasMiddleware, async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const userId = req.user.id;

        const result = await pool.query(
            `SELECT ta.id AS assignment_id, ta.notes, ta.assigned_at,
                    m.id AS member_id, m.full_name, m.phone, m.email, m.status,
                    m.last_visit, m.profile_pic
             FROM trainer_assignments ta
             JOIN members m ON ta.member_id = m.id
             WHERE ta.gym_id = $1 AND ta.trainer_user_id = $2 AND ta.is_active = TRUE AND m.deleted_at IS NULL
             ORDER BY m.full_name ASC`,
            [gym_id, userId]
        );

        return ok(res, { members: result.rows });
    } catch (err) {
        console.error('TRAINER MY MEMBERS ERROR:', err.message);
        return fail(res, 500, 'TRAINER_MY_MEMBERS_FAILED', 'Failed to load assigned members.');
    }
});

// --- TRAINER TASKS ---
router.get('/tasks', auth, saasMiddleware, async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const userId = req.user.id;
        const statusFilter = String(req.query.status || '').toUpperCase();

        let query = `
            SELECT tt.*, m.full_name AS member_name
            FROM trainer_tasks tt
            LEFT JOIN members m ON tt.member_id = m.id
            WHERE tt.gym_id = $1 AND tt.trainer_user_id = $2`;
        const params = [gym_id, userId];

        if (statusFilter && ['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(statusFilter)) {
            query += ` AND tt.status = $${params.length + 1}`;
            params.push(statusFilter);
        }

        query += ` ORDER BY CASE WHEN tt.status = 'PENDING' THEN 0 WHEN tt.status = 'IN_PROGRESS' THEN 1 ELSE 2 END, tt.due_date ASC NULLS LAST, tt.created_at DESC`;

        const result = await pool.query(query, params);
        return ok(res, { tasks: result.rows });
    } catch (err) {
        console.error('TRAINER TASKS LIST ERROR:', err.message);
        return fail(res, 500, 'TRAINER_TASKS_FAILED', 'Failed to load tasks.');
    }
});

router.post('/tasks', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const trainerUserId = ensureInteger(req.body?.trainer_user_id, { field: 'trainer_user_id', required: true, min: 1 });
        const memberId = req.body?.member_id ? ensureInteger(req.body.member_id, { field: 'member_id', min: 1 }) : null;
        const title = ensureTrimmedString(req.body?.title, { field: 'title', required: true, max: 200 });
        const description = String(req.body?.description || '').trim().slice(0, 2000);
        const dueDate = req.body?.due_date || null;

        const result = await pool.query(
            `INSERT INTO trainer_tasks (gym_id, trainer_user_id, member_id, title, description, due_date)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [gym_id, trainerUserId, memberId, title, description, dueDate]
        );

        return ok(res, { message: 'Task created.', task: result.rows[0] });
    } catch (err) {
        if (isValidationError(err)) return res.status(err.statusCode).json({ error: err.message });
        console.error('TRAINER TASK CREATE ERROR:', err.message);
        return fail(res, 500, 'TRAINER_TASK_CREATE_FAILED', 'Failed to create task.');
    }
});

router.patch('/tasks/:id', auth, saasMiddleware, async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const taskId = ensureInteger(req.params.id, { field: 'task_id', required: true, min: 1 });
        const status = String(req.body?.status || '').toUpperCase();

        if (!['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
            return fail(res, 400, 'INVALID_STATUS', 'Status must be PENDING, IN_PROGRESS, or COMPLETED.');
        }

        const completedAt = status === 'COMPLETED' ? 'NOW()' : 'NULL';
        const result = await pool.query(
            `UPDATE trainer_tasks
             SET status = $1, completed_at = ${completedAt}
             WHERE id = $2 AND gym_id = $3 AND trainer_user_id = $4
             RETURNING *`,
            [status, taskId, gym_id, req.user.id]
        );

        if (result.rows.length === 0) {
            return fail(res, 404, 'TASK_NOT_FOUND', 'Task not found or not assigned to you.');
        }

        return ok(res, { message: 'Task updated.', task: result.rows[0] });
    } catch (err) {
        console.error('TRAINER TASK UPDATE ERROR:', err.message);
        return fail(res, 500, 'TRAINER_TASK_UPDATE_FAILED', 'Failed to update task.');
    }
});

router.delete('/tasks/:id', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const taskId = ensureInteger(req.params.id, { field: 'task_id', required: true, min: 1 });

        const result = await pool.query(
            `DELETE FROM trainer_tasks WHERE id = $1 AND gym_id = $2 RETURNING id`,
            [taskId, gym_id]
        );

        if (result.rows.length === 0) {
            return fail(res, 404, 'TASK_NOT_FOUND', 'Task not found.');
        }

        return ok(res, { message: 'Task deleted.' });
    } catch (err) {
        console.error('TRAINER TASK DELETE ERROR:', err.message);
        return fail(res, 500, 'TRAINER_TASK_DELETE_FAILED', 'Failed to delete task.');
    }
});

module.exports = router;
