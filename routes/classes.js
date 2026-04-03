const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');

const getGymIdFromRequest = (req) => {
    const rawGymId = req?.user?.gym_id ?? req?.user?.gymId;
    const gymId = Number.parseInt(rawGymId, 10);
    return Number.isInteger(gymId) ? gymId : null;
};

const parsePositiveInt = (value, fallback = null) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
};

const parseTimestamp = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

router.use(auth, saasMiddleware);

router.get('/summary', requirePermission('attendance:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const [typesRes, todayRes, upcomingRes, bookedRes, checkinRes] = await Promise.all([
            pool.query('SELECT COUNT(*)::INTEGER AS count FROM class_types WHERE gym_id = $1 AND is_active = TRUE', [gymId]),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM class_sessions
                 WHERE gym_id = $1
                   AND status = 'SCHEDULED'
                   AND starts_at::date = CURRENT_DATE`,
                [gymId]
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM class_sessions
                 WHERE gym_id = $1
                   AND status = 'SCHEDULED'
                   AND starts_at >= NOW()`,
                [gymId]
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM class_bookings cb
                 INNER JOIN class_sessions cs ON cs.id = cb.class_session_id
                 WHERE cb.gym_id = $1
                   AND cs.starts_at::date = CURRENT_DATE
                   AND cb.status IN ('BOOKED', 'CHECKED_IN', 'WAITLISTED')`,
                [gymId]
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM class_bookings cb
                 INNER JOIN class_sessions cs ON cs.id = cb.class_session_id
                 WHERE cb.gym_id = $1
                   AND cs.starts_at::date = CURRENT_DATE
                   AND cb.status = 'CHECKED_IN'`,
                [gymId]
            ),
        ]);

        return res.json({
            active_types: typesRes.rows[0]?.count || 0,
            today_sessions: todayRes.rows[0]?.count || 0,
            upcoming_sessions: upcomingRes.rows[0]?.count || 0,
            booked_today: bookedRes.rows[0]?.count || 0,
            checked_in_today: checkinRes.rows[0]?.count || 0,
        });
    } catch (err) {
        console.error('CLASSES SUMMARY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load class summary.' });
    }
});

router.get('/types', requirePermission('attendance:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';
        const result = await pool.query(
            `SELECT
                ct.*,
                COUNT(cs.id) FILTER (WHERE cs.starts_at >= NOW() AND cs.status = 'SCHEDULED')::INTEGER AS upcoming_sessions
             FROM class_types ct
             LEFT JOIN class_sessions cs ON cs.class_type_id = ct.id AND cs.gym_id = ct.gym_id
             WHERE ct.gym_id = $1
               AND ($2::BOOLEAN = TRUE OR ct.is_active = TRUE)
             GROUP BY ct.id
             ORDER BY ct.is_active DESC, ct.title ASC`,
            [gymId, includeInactive]
        );

        return res.json(result.rows);
    } catch (err) {
        console.error('CLASS TYPES ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load class types.' });
    }
});

router.post('/types', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const title = String(req.body?.title || '').trim();
        const category = String(req.body?.category || '').trim();
        const description = String(req.body?.description || '').trim();
        const trainerName = String(req.body?.trainer_name || '').trim();
        const capacity = parsePositiveInt(req.body?.capacity, 20);
        const durationMinutes = parsePositiveInt(req.body?.duration_minutes, 60);
        const location = String(req.body?.location || '').trim();
        const colorTheme = String(req.body?.color_theme || 'indigo').trim() || 'indigo';

        if (!title) {
            return res.status(400).json({ error: 'title is required.' });
        }

        const result = await pool.query(
            `INSERT INTO class_types (
                gym_id, title, category, description, trainer_name, capacity,
                duration_minutes, location, color_theme
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [gymId, title, category, description, trainerName, capacity, durationMinutes, location, colorTheme]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('CLASS TYPE CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to create class type.' });
    }
});

router.put('/types/:id', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const classTypeId = parsePositiveInt(req.params.id);
        if (!classTypeId) {
            return res.status(400).json({ error: 'Invalid class type id.' });
        }

        const title = String(req.body?.title || '').trim();
        const category = String(req.body?.category || '').trim();
        const description = String(req.body?.description || '').trim();
        const trainerName = String(req.body?.trainer_name || '').trim();
        const capacity = parsePositiveInt(req.body?.capacity, 20);
        const durationMinutes = parsePositiveInt(req.body?.duration_minutes, 60);
        const location = String(req.body?.location || '').trim();
        const colorTheme = String(req.body?.color_theme || 'indigo').trim() || 'indigo';
        const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : true;

        if (!title) {
            return res.status(400).json({ error: 'title is required.' });
        }

        const result = await pool.query(
            `UPDATE class_types
             SET title = $1,
                 category = $2,
                 description = $3,
                 trainer_name = $4,
                 capacity = $5,
                 duration_minutes = $6,
                 location = $7,
                 color_theme = $8,
                 is_active = $9,
                 updated_at = NOW()
             WHERE id = $10 AND gym_id = $11
             RETURNING *`,
            [title, category, description, trainerName, capacity, durationMinutes, location, colorTheme, isActive, classTypeId, gymId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Class type not found.' });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error('CLASS TYPE UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to update class type.' });
    }
});

router.get('/schedule', requirePermission('attendance:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const from = parseTimestamp(req.query.from) || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const to = parseTimestamp(req.query.to) || new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString();

        const result = await pool.query(
            `SELECT
                cs.*,
                ct.title AS class_title,
                ct.category,
                ct.description,
                ct.color_theme,
                ct.duration_minutes,
                ct.location,
                ct.trainer_name AS default_trainer_name,
                COALESCE(cs.capacity, ct.capacity, 20) AS effective_capacity,
                COUNT(cb.id) FILTER (WHERE cb.status IN ('BOOKED', 'CHECKED_IN'))::INTEGER AS booked_count,
                COUNT(cb.id) FILTER (WHERE cb.status = 'WAITLISTED')::INTEGER AS waitlist_count,
                COUNT(cb.id) FILTER (WHERE cb.status = 'CHECKED_IN')::INTEGER AS checked_in_count
             FROM class_sessions cs
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             LEFT JOIN class_bookings cb ON cb.class_session_id = cs.id AND cb.gym_id = cs.gym_id
             WHERE cs.gym_id = $1
               AND cs.starts_at BETWEEN $2 AND $3
             GROUP BY cs.id, ct.id
             ORDER BY cs.starts_at ASC`,
            [gymId, from, to]
        );

        return res.json(result.rows);
    } catch (err) {
        console.error('CLASS SCHEDULE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load class schedule.' });
    }
});

router.post('/sessions', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const classTypeId = parsePositiveInt(req.body?.class_type_id);
        const startsAt = parseTimestamp(req.body?.starts_at);
        const status = String(req.body?.status || 'SCHEDULED').trim().toUpperCase() || 'SCHEDULED';
        const notes = String(req.body?.notes || '').trim();

        if (!classTypeId || !startsAt) {
            return res.status(400).json({ error: 'class_type_id and starts_at are required.' });
        }

        const classTypeRes = await pool.query(
            'SELECT * FROM class_types WHERE id = $1 AND gym_id = $2 LIMIT 1',
            [classTypeId, gymId]
        );
        if (classTypeRes.rows.length === 0) {
            return res.status(404).json({ error: 'Class type not found.' });
        }

        const classType = classTypeRes.rows[0];
        const capacity = parsePositiveInt(req.body?.capacity, classType.capacity || 20);
        const trainerName = String(req.body?.trainer_name || classType.trainer_name || '').trim();
        const startsDate = new Date(startsAt);
        const endsAt = parseTimestamp(req.body?.ends_at)
            || new Date(startsDate.getTime() + ((parsePositiveInt(req.body?.duration_minutes, classType.duration_minutes || 60)) * 60 * 1000)).toISOString();

        const result = await pool.query(
            `INSERT INTO class_sessions (
                gym_id, class_type_id, starts_at, ends_at, trainer_name, capacity, status, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [gymId, classTypeId, startsAt, endsAt, trainerName, capacity, status, notes]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('CLASS SESSION CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to create class session.' });
    }
});

router.put('/sessions/:id', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const sessionId = parsePositiveInt(req.params.id);
        if (!sessionId) {
            return res.status(400).json({ error: 'Invalid class session id.' });
        }

        const currentSessionRes = await pool.query(
            `SELECT cs.*, ct.capacity AS default_capacity, ct.duration_minutes, ct.trainer_name AS default_trainer_name
             FROM class_sessions cs
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             WHERE cs.id = $1 AND cs.gym_id = $2
             LIMIT 1`,
            [sessionId, gymId]
        );

        if (currentSessionRes.rows.length === 0) {
            return res.status(404).json({ error: 'Class session not found.' });
        }

        const currentSession = currentSessionRes.rows[0];
        const startsAt = parseTimestamp(req.body?.starts_at) || currentSession.starts_at;
        const durationMinutes = parsePositiveInt(req.body?.duration_minutes, currentSession.duration_minutes || 60);
        const endsAt = parseTimestamp(req.body?.ends_at)
            || new Date(new Date(startsAt).getTime() + (durationMinutes * 60 * 1000)).toISOString();
        const trainerName = String(req.body?.trainer_name || currentSession.trainer_name || currentSession.default_trainer_name || '').trim();
        const capacity = parsePositiveInt(req.body?.capacity, currentSession.capacity || currentSession.default_capacity || 20);
        const status = String(req.body?.status || currentSession.status || 'SCHEDULED').trim().toUpperCase() || 'SCHEDULED';
        const notes = String(req.body?.notes || '').trim();

        const result = await pool.query(
            `UPDATE class_sessions
             SET starts_at = $1,
                 ends_at = $2,
                 trainer_name = $3,
                 capacity = $4,
                 status = $5,
                 notes = $6,
                 updated_at = NOW()
             WHERE id = $7 AND gym_id = $8
             RETURNING *`,
            [startsAt, endsAt, trainerName, capacity, status, notes, sessionId, gymId]
        );

        return res.json(result.rows[0]);
    } catch (err) {
        console.error('CLASS SESSION UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to update class session.' });
    }
});

router.get('/sessions/:id/bookings', requirePermission('attendance:read'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const sessionId = parsePositiveInt(req.params.id);
        if (!sessionId) {
            return res.status(400).json({ error: 'Invalid class session id.' });
        }

        const result = await pool.query(
            `SELECT
                cb.*,
                m.full_name,
                m.phone,
                m.email,
                m.profile_pic
             FROM class_bookings cb
             INNER JOIN members m ON m.id = cb.member_id AND m.gym_id = cb.gym_id
             WHERE cb.gym_id = $1 AND cb.class_session_id = $2
             ORDER BY
                CASE cb.status
                    WHEN 'CHECKED_IN' THEN 0
                    WHEN 'BOOKED' THEN 1
                    WHEN 'WAITLISTED' THEN 2
                    ELSE 3
                END ASC,
                cb.booked_at ASC`,
            [gymId, sessionId]
        );

        return res.json(result.rows);
    } catch (err) {
        console.error('CLASS BOOKINGS ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load bookings.' });
    }
});

router.post('/sessions/:id/bookings', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const sessionId = parsePositiveInt(req.params.id);
        const memberId = parsePositiveInt(req.body?.member_id);
        const notes = String(req.body?.notes || '').trim();

        if (!sessionId || !memberId) {
            return res.status(400).json({ error: 'session id and member_id are required.' });
        }

        const sessionRes = await pool.query(
            `SELECT cs.id, COALESCE(cs.capacity, ct.capacity, 20) AS effective_capacity
             FROM class_sessions cs
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             WHERE cs.id = $1 AND cs.gym_id = $2
             LIMIT 1`,
            [sessionId, gymId]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ error: 'Class session not found.' });
        }

        const memberRes = await pool.query(
            'SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [memberId, gymId]
        );
        if (memberRes.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const existingBooking = await pool.query(
            `SELECT id, status
             FROM class_bookings
             WHERE gym_id = $1 AND class_session_id = $2 AND member_id = $3
             LIMIT 1`,
            [gymId, sessionId, memberId]
        );

        if (existingBooking.rows.length > 0 && existingBooking.rows[0].status !== 'CANCELLED') {
            return res.status(409).json({ error: 'Member is already booked into this session.' });
        }

        const activeBookingsRes = await pool.query(
            `SELECT COUNT(*)::INTEGER AS count
             FROM class_bookings
             WHERE gym_id = $1
               AND class_session_id = $2
               AND status IN ('BOOKED', 'CHECKED_IN')`,
            [gymId, sessionId]
        );

        const effectiveCapacity = Number(sessionRes.rows[0].effective_capacity || 20);
        const currentBookings = Number(activeBookingsRes.rows[0]?.count || 0);
        const bookingStatus = currentBookings >= effectiveCapacity ? 'WAITLISTED' : 'BOOKED';

        const result = await pool.query(
            `INSERT INTO class_bookings (gym_id, class_session_id, member_id, status, booked_at, notes)
             VALUES ($1, $2, $3, $4, NOW(), $5)
             ON CONFLICT (class_session_id, member_id)
             DO UPDATE SET
                status = EXCLUDED.status,
                booked_at = NOW(),
                notes = EXCLUDED.notes
             RETURNING *`,
            [gymId, sessionId, memberId, bookingStatus, notes]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('CLASS BOOKING CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to create booking.' });
    }
});

router.delete('/sessions/:sessionId/bookings/:memberId', requirePermission('attendance:write'), async (req, res) => {
    try {
        const gymId = getGymIdFromRequest(req);
        const sessionId = parsePositiveInt(req.params.sessionId);
        const memberId = parsePositiveInt(req.params.memberId);

        if (!sessionId || !memberId) {
            return res.status(400).json({ error: 'Invalid booking identifier.' });
        }

        const result = await pool.query(
            `UPDATE class_bookings
             SET status = 'CANCELLED'
             WHERE gym_id = $1 AND class_session_id = $2 AND member_id = $3
             RETURNING id`,
            [gymId, sessionId, memberId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        return res.json({ message: 'Booking removed.' });
    } catch (err) {
        console.error('CLASS BOOKING DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to remove booking.' });
    }
});

router.post('/sessions/:sessionId/bookings/:memberId/check-in', requirePermission('attendance:write'), async (req, res) => {
    const gymId = getGymIdFromRequest(req);
    const sessionId = parsePositiveInt(req.params.sessionId);
    const memberId = parsePositiveInt(req.params.memberId);

    if (!sessionId || !memberId) {
        return res.status(400).json({ error: 'Invalid booking identifier.' });
    }

    try {
        await pool.query('BEGIN');

        const bookingRes = await pool.query(
            `SELECT id, status
             FROM class_bookings
             WHERE gym_id = $1 AND class_session_id = $2 AND member_id = $3
             FOR UPDATE`,
            [gymId, sessionId, memberId]
        );

        if (bookingRes.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ error: 'Booking not found.' });
        }

        if (bookingRes.rows[0].status === 'CANCELLED') {
            await pool.query('ROLLBACK');
            return res.status(400).json({ error: 'Cancelled bookings cannot be checked in.' });
        }

        const memberStatusRes = await pool.query(
            `SELECT COALESCE(ms_latest.status, 'UNPAID') AS membership_status
             FROM members m
             LEFT JOIN LATERAL (
                SELECT ms.status
                FROM memberships ms
                WHERE ms.member_id = m.id AND ms.gym_id = m.gym_id AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC, ms.id DESC
                LIMIT 1
             ) ms_latest ON TRUE
             WHERE m.id = $1 AND m.gym_id = $2 AND m.deleted_at IS NULL
             LIMIT 1`,
            [memberId, gymId]
        );

        const membershipStatus = String(memberStatusRes.rows[0]?.membership_status || 'UNPAID').toUpperCase();
        if (membershipStatus !== 'ACTIVE') {
            await pool.query('ROLLBACK');
            return res.status(403).json({ error: `Access Denied: Membership is ${membershipStatus}` });
        }

        await pool.query(
            `UPDATE class_bookings
             SET status = 'CHECKED_IN',
                 check_in_time = NOW()
             WHERE id = $1`,
            [bookingRes.rows[0].id]
        );

        const attendanceRes = await pool.query(
            `SELECT id
             FROM attendance
             WHERE gym_id = $1
               AND member_id = $2
               AND deleted_at IS NULL
               AND check_in_time::date = CURRENT_DATE
             LIMIT 1`,
            [gymId, memberId]
        );

        let attendanceCreated = false;
        if (attendanceRes.rows.length === 0) {
            await pool.query(
                'INSERT INTO attendance (gym_id, member_id, check_in_time) VALUES ($1, $2, NOW())',
                [gymId, memberId]
            );
            attendanceCreated = true;
        }

        await pool.query(
            'UPDATE members SET last_visit = NOW() WHERE id = $1 AND gym_id = $2',
            [memberId, gymId]
        );

        await pool.query('COMMIT');
        return res.json({ message: 'Class booking checked in.', attendance_created: attendanceCreated });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('CLASS BOOKING CHECK-IN ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to check member into class.' });
    }
});

module.exports = router;