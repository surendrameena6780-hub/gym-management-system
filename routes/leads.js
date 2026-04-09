const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const {
    ensureTrimmedString,
    ensureEmail,
    ensurePhone10,
    ensureInteger,
    ensureTimestamp,
    isValidationError,
} = require('../utils/fieldValidation');
const {
    computeEffectiveBillingLimits,
    getBillingConfig,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
} = require('../utils/platformSettings');

const getGymIdFromRequest = (req) => {
    const rawGymId = req?.user?.gym_id ?? req?.user?.gymId;
    const gymId = Number.parseInt(rawGymId, 10);
    return Number.isInteger(gymId) ? gymId : null;
};

const normalizeLeadPayload = (payload = {}) => {
    return {
        full_name: ensureTrimmedString(payload.full_name, { field: 'full_name', required: true, min: 2, max: 100 }),
        phone: ensurePhone10(payload.phone, { field: 'phone', required: true }),
        email: ensureEmail(payload.email, { field: 'email', max: 120 }),
        source: ensureTrimmedString(payload.source, { field: 'source', max: 60, defaultValue: 'Walk-in' }) || 'Walk-in',
        status: ensureTrimmedString(payload.status, { field: 'status', max: 40, defaultValue: 'NEW', uppercase: true }) || 'NEW',
        priority: ensureTrimmedString(payload.priority, { field: 'priority', max: 40, defaultValue: 'MEDIUM', uppercase: true }) || 'MEDIUM',
        notes: ensureTrimmedString(payload.notes, { field: 'notes', max: 2000 }),
        lost_reason: ensureTrimmedString(payload.lost_reason, { field: 'lost_reason', max: 500 }),
        next_follow_up_at: ensureTimestamp(payload.next_follow_up_at, { field: 'next_follow_up_at' }),
        trial_date: ensureTimestamp(payload.trial_date, { field: 'trial_date' }),
        mark_contacted: Boolean(payload.mark_contacted),
    };
};

router.use(auth, saasMiddleware);

router.get('/summary', requirePermission('members:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const result = await pool.query(
            `SELECT
                COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('WON', 'LOST'))::INTEGER AS open_leads,
                COUNT(*) FILTER (WHERE status = 'NEW')::INTEGER AS new_leads,
                COUNT(*) FILTER (
                    WHERE status IN ('NEW', 'CONTACTED', 'FOLLOW_UP', 'TRIAL_BOOKED')
                      AND next_follow_up_at IS NOT NULL
                      AND next_follow_up_at::date <= CURRENT_DATE
                )::INTEGER AS follow_ups_due,
                COUNT(*) FILTER (WHERE trial_date IS NOT NULL AND trial_date::date = CURRENT_DATE)::INTEGER AS trials_today,
                COUNT(*) FILTER (WHERE status = 'TRIAL_BOOKED')::INTEGER AS trial_booked,
                COUNT(*) FILTER (
                    WHERE status = 'WON'
                      AND DATE_TRUNC('month', updated_at) = DATE_TRUNC('month', CURRENT_DATE)
                )::INTEGER AS converted_this_month,
                COUNT(*) FILTER (WHERE status = 'LOST')::INTEGER AS lost_leads
             FROM leads
             WHERE gym_id = $1`,
            [gymId]
        );

        return res.json(result.rows[0] || {});
    } catch (err) {
        console.error('LEADS SUMMARY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load leads summary.' });
    }
});

router.get('/', requirePermission('members:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const search = String(req.query.search || '').trim();
        const status = String(req.query.status || '').trim().toUpperCase();
        const paginate = String(req.query.paginate || '').toLowerCase() === 'true' || req.query.page !== undefined || req.query.limit !== undefined;
        const page = Math.max(Number.parseInt(req.query.page || '1', 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 200);
        const offset = (page - 1) * limit;
        const queryParams = [gymId];
        let whereClause = 'WHERE l.gym_id = $1';

        if (search) {
            queryParams.push(`%${search}%`);
            whereClause += ` AND (l.full_name ILIKE $${queryParams.length} OR l.phone ILIKE $${queryParams.length} OR l.email ILIKE $${queryParams.length})`;
        }

        if (status && status !== 'ALL') {
            queryParams.push(status);
            whereClause += ` AND l.status = $${queryParams.length}`;
        }

        const result = await pool.query(
            `SELECT
                l.*,
                u.full_name AS assigned_to_name,
                m.full_name AS converted_member_name
             FROM leads l
             LEFT JOIN users u ON u.id = l.assigned_to
             LEFT JOIN members m ON m.id = l.converted_member_id
             ${whereClause}
             ORDER BY
                CASE WHEN l.status IN ('WON', 'LOST') THEN 1 ELSE 0 END ASC,
                CASE
                    WHEN l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at::date <= CURRENT_DATE THEN 0
                    ELSE 1
                END ASC,
                l.next_follow_up_at ASC NULLS LAST,
                l.created_at DESC
                ${paginate ? `LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}` : ''}`,
            paginate ? [...queryParams, limit, offset] : queryParams
        );

        if (!paginate) {
            return res.json(result.rows);
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM leads l
             ${whereClause}`,
            queryParams
        );

        const total = Number(countResult.rows[0]?.total || 0);

        return res.json({
            items: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                hasNext: page * limit < total,
                hasPrev: page > 1,
            },
        });
    } catch (err) {
        console.error('LEADS LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load leads.' });
    }
});

router.post('/', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const payload = normalizeLeadPayload(req.body || {});

        const result = await pool.query(
            `INSERT INTO leads (
                gym_id, full_name, phone, email, source, status, priority,
                notes, next_follow_up_at, trial_date, last_contacted_at, lost_reason
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
                gymId,
                payload.full_name,
                payload.phone,
                payload.email,
                payload.source,
                payload.status,
                payload.priority,
                payload.notes,
                payload.next_follow_up_at,
                payload.trial_date,
                payload.mark_contacted ? new Date().toISOString() : null,
                payload.lost_reason,
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to create lead.' });
    }
});

router.put('/:id', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });
        const payload = normalizeLeadPayload(req.body || {});

        const result = await pool.query(
            `UPDATE leads
             SET full_name = $1,
                 phone = $2,
                 email = $3,
                 source = $4,
                 status = $5,
                 priority = $6,
                 notes = $7,
                 next_follow_up_at = $8,
                 trial_date = $9,
                 last_contacted_at = CASE WHEN $10 THEN NOW() ELSE last_contacted_at END,
                 lost_reason = $11,
                 updated_at = NOW()
             WHERE id = $12 AND gym_id = $13
             RETURNING *`,
            [
                payload.full_name,
                payload.phone,
                payload.email,
                payload.source,
                payload.status,
                payload.priority,
                payload.notes,
                payload.next_follow_up_at,
                payload.trial_date,
                payload.mark_contacted,
                payload.lost_reason,
                leadId,
                gymId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found.' });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to update lead.' });
    }
});

router.post('/:id/convert', requirePermission('members:write'), async (req, res) => {
    const gymId = getGymIdFromRequest(req);
    let leadId;

    try {
        leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        throw err;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const leadResult = await client.query(
            `SELECT *
             FROM leads
             WHERE id = $1 AND gym_id = $2
             FOR UPDATE`,
            [leadId, gymId]
        );

        if (leadResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Lead not found.' });
        }

        const lead = leadResult.rows[0];
        const normalizedEmail = String(lead.email || '').trim().toLowerCase();
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead-convert:${gymId}:${lead.phone}:${normalizedEmail}`]);

        if (lead.converted_member_id) {
            const existingMember = await client.query(
                'SELECT * FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [lead.converted_member_id, gymId]
            );
            await client.query('COMMIT');
            return res.json({
                lead,
                member: existingMember.rows[0] || null,
                created_new_member: false,
            });
        }

        const memberLookup = await client.query(
            `SELECT *
             FROM members
             WHERE gym_id = $1
               AND deleted_at IS NULL
               AND (phone = $2 OR ($3 <> '' AND lower(email) = $3))
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [gymId, lead.phone, normalizedEmail]
        );

        let member = memberLookup.rows[0] || null;
        let createdNewMember = false;

        if (!member) {
            const [billingConfig, gymBilling, usageSnapshot] = await Promise.all([
                getBillingConfig(),
                getGymBillingSnapshot(client, gymId),
                getGymUsageSnapshot(client, gymId),
            ]);
            if (!gymBilling) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Gym not found.' });
            }

            const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymBilling.current_plan, gymBilling);
            if (effectiveLimits.members !== null && Number(usageSnapshot.members || 0) + 1 > effectiveLimits.members) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: `Your current plan allows up to ${effectiveLimits.members} active members including add-ons. Upgrade the plan or add member capacity before converting this lead.`,
                    allowed_members: effectiveLimits.members,
                    current_members: Number(usageSnapshot.members || 0),
                });
            }

            const createdMember = await client.query(
                `INSERT INTO members (gym_id, full_name, phone, email, joining_date, status)
                 VALUES ($1, $2, $3, $4, CURRENT_DATE, 'UNPAID')
                 RETURNING *`,
                [gymId, lead.full_name, lead.phone, lead.email || null]
            );
            member = createdMember.rows[0];
            createdNewMember = true;
        }

        const updatedLead = await client.query(
            `UPDATE leads
             SET status = 'WON',
                 converted_member_id = $1,
                 last_contacted_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2 AND gym_id = $3
             RETURNING *`,
            [member.id, leadId, gymId]
        );

        await client.query('COMMIT');
        return res.json({
            lead: updatedLead.rows[0],
            member,
            created_new_member: createdNewMember,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('LEAD CONVERT ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to convert lead.' });
    } finally {
        client.release();
    }
});

router.delete('/:id', requirePermission('members:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const leadId = ensureInteger(req.params.id, { field: 'lead id', required: true, min: 1 });

        const result = await pool.query(
            'DELETE FROM leads WHERE id = $1 AND gym_id = $2 RETURNING id',
            [leadId, gymId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found.' });
        }

        return res.json({ message: 'Lead deleted.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('LEAD DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to delete lead.' });
    }
});

module.exports = router;