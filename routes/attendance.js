const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner, requirePermission } = require('../middleware/rbac');
const { getGymTimezone } = require('../utils/gymTime');

const CHECKIN_METHODS = new Set(['STAFF', 'QR', 'SELF', 'RFID']);

const normalizeMethod = (value) => {
    const method = String(value || 'STAFF').toUpperCase().trim();
    return CHECKIN_METHODS.has(method) ? method : 'STAFF';
};

const asBool = (value) => value === true || value === 'true' || value === 1 || value === '1';

const haversineDistanceMeters = (lat1, lng1, lat2, lng2) => {
    const toRad = (degree) => (degree * Math.PI) / 180;
    const earthRadius = 6371000;
    const deltaLat = toRad(lat2 - lat1);
    const deltaLng = toRad(lng2 - lng1);
    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
};

const getMemberSnapshot = async (gym_id, member_id) => {
    const result = await pool.query(
        `SELECT
            m.id,
            m.full_name,
            m.phone,
            m.email,
            m.last_visit,
            m.status AS member_status,
            COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
            ms_latest.end_date,
            ms_latest.plan_name
         FROM members m
         LEFT JOIN LATERAL (
            SELECT ms.status, ms.end_date, p.name AS plan_name
            FROM memberships ms
            LEFT JOIN plans p ON p.id = ms.plan_id
                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
            ORDER BY ms.end_date DESC NULLS LAST
            LIMIT 1
         ) ms_latest ON true
            WHERE m.gym_id = $1 AND m.id = $2 AND m.deleted_at IS NULL
         LIMIT 1`,
        [gym_id, member_id]
    );

    return result.rows[0] || null;
};

// --- 0. ATTENDANCE MODE SETTINGS ---
router.get('/mode', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym = await pool.query(
            `SELECT attendance_mode, attendance_geo_enabled, gym_latitude, gym_longitude, gym_radius_meters, allow_expired_checkin
             FROM gyms WHERE id = $1`,
            [req.user.gym_id]
        );

        if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
        res.json(gym.rows[0]);
    } catch (err) {
        console.error('ATTENDANCE MODE GET ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/mode', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const attendance_mode = normalizeMethod(req.body.attendance_mode || 'STAFF');
        const attendance_geo_enabled = asBool(req.body.attendance_geo_enabled);
        const allow_expired_checkin = asBool(req.body.allow_expired_checkin);
        const gym_latitude = req.body.gym_latitude ? parseFloat(req.body.gym_latitude) : null;
        const gym_longitude = req.body.gym_longitude ? parseFloat(req.body.gym_longitude) : null;
        const gym_radius_meters = req.body.gym_radius_meters ? parseInt(req.body.gym_radius_meters, 10) : 200;

        await pool.query(
            `UPDATE gyms
             SET attendance_mode = $1,
                 attendance_geo_enabled = $2,
                 gym_latitude = $3,
                 gym_longitude = $4,
                 gym_radius_meters = $5,
                 allow_expired_checkin = $6
             WHERE id = $7`,
            [attendance_mode, attendance_geo_enabled, gym_latitude, gym_longitude, gym_radius_meters, allow_expired_checkin, req.user.gym_id]
        );

        res.json({ message: 'Attendance mode settings updated successfully.' });
    } catch (err) {
        console.error('ATTENDANCE MODE UPDATE ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 1. CHECK-IN A MEMBER ---
router.post('/checkin', auth, saasMiddleware, requirePermission('attendance:write'), async (req, res) => {
    const { member_id, method, notes, latitude, longitude } = req.body;
    const allow_override = asBool(req.body.allow_override);
    const gym_id = req.user.gym_id;
    const checkinMethod = normalizeMethod(method);

    if (!member_id) return res.status(400).json({ message: "member_id is required." });

    try {
        const gymConfigRes = await pool.query(
            `SELECT attendance_geo_enabled, gym_latitude, gym_longitude, gym_radius_meters, allow_expired_checkin
             FROM gyms WHERE id = $1`,
            [gym_id]
        );

        const gymConfig = gymConfigRes.rows[0] || {};
        const member = await getMemberSnapshot(gym_id, member_id);
        if (!member) return res.status(404).json({ message: 'Member not found.' });

        const membershipStatus = String(member.membership_status || 'UNPAID').toUpperCase();
        const isActiveMembership = membershipStatus === 'ACTIVE';
        const canOverrideMembershipRule = !isActiveMembership && allow_override && gymConfig.allow_expired_checkin === true;

        if (!isActiveMembership && !canOverrideMembershipRule) {
            return res.status(403).json({
                code: 'ATTENDANCE_BLOCKED',
                message: `Access Denied: Membership is ${membershipStatus}`,
                warning: 'Membership is not active. Override can be allowed by gym settings.',
                member
            });
        }

        const recentDuplicate = await pool.query(
            `SELECT id, check_in_time
             FROM attendance
             WHERE gym_id = $1 AND member_id = $2 AND deleted_at IS NULL AND check_in_time > NOW() - INTERVAL '10 minutes'
             ORDER BY check_in_time DESC
             LIMIT 1`,
            [gym_id, member_id]
        );

        if (recentDuplicate.rows.length > 0 && !allow_override) {
            return res.status(429).json({
                code: 'DUPLICATE_CHECKIN',
                message: 'Check-in blocked: member already checked in within last 10 minutes.',
                last_checkin_time: recentDuplicate.rows[0].check_in_time,
                member
            });
        }

        const hasGeoConfig = gymConfig.attendance_geo_enabled && gymConfig.gym_latitude && gymConfig.gym_longitude;
        if (checkinMethod === 'SELF' && hasGeoConfig && latitude && longitude) {
            const distanceMeters = haversineDistanceMeters(
                parseFloat(gymConfig.gym_latitude),
                parseFloat(gymConfig.gym_longitude),
                parseFloat(latitude),
                parseFloat(longitude)
            );
            const radius = parseInt(gymConfig.gym_radius_meters || 200, 10);

            if (distanceMeters > radius && !allow_override) {
                return res.status(403).json({
                    code: 'GEO_BLOCKED',
                    message: 'Check-in blocked: device is outside gym location radius.',
                    distance_meters: Math.round(distanceMeters),
                    allowed_radius_meters: radius,
                    member
                });
            }
        }

        const checkinStatus = isActiveMembership ? 'ALLOWED' : 'OVERRIDE';

        const newRecord = await pool.query(
            `INSERT INTO attendance
             (gym_id, member_id, check_in_time, checkin_method, staff_user_id, checkin_status, was_override, notes, latitude, longitude)
             VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
                gym_id,
                member_id,
                checkinMethod,
                req.user.id || null,
                checkinStatus,
                checkinStatus === 'OVERRIDE',
                notes || '',
                latitude ? parseFloat(latitude) : null,
                longitude ? parseFloat(longitude) : null,
            ]
        );

        await pool.query(
            'UPDATE members SET last_visit = NOW() WHERE id = $1 AND gym_id = $2',
            [member_id, gym_id]
        );

        res.json({
            message: checkinStatus === 'OVERRIDE' ? 'Check-in recorded with override.' : 'Check-in Successful!',
            details: newRecord.rows[0],
            member,
            warning: checkinStatus === 'OVERRIDE' ? `Member is ${membershipStatus}. Override recorded.` : null
        });

    } catch (err) {
        console.error("CHECKIN ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 1B. QUICK MEMBER SEARCH FOR CHECK-IN PANEL ---
router.get('/search', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const q = String(req.query.q || '').trim();
        if (!q || q.length < 2) return res.json([]);

        const result = await pool.query(
            `SELECT
                m.id,
                m.full_name,
                m.phone,
                m.email,
                m.last_visit,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                ms_latest.end_date,
                ms_latest.plan_name
             FROM members m
             LEFT JOIN LATERAL (
                SELECT ms.status, ms.end_date, p.name AS plan_name
                FROM memberships ms
                LEFT JOIN plans p ON p.id = ms.plan_id
                                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC NULLS LAST
                LIMIT 1
             ) ms_latest ON true
             WHERE m.gym_id = $1
                             AND m.deleted_at IS NULL
               AND (m.full_name ILIKE $2 OR m.phone ILIKE $2 OR m.email ILIKE $2)
             ORDER BY m.full_name ASC
             LIMIT 12`,
            [gym_id, `%${q}%`]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE SEARCH ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 2. TODAY'S ATTENDANCE LIST ---
router.get('/today', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gymTimezone = await getGymTimezone(pool, req.user.gym_id);
        const list = await pool.query(
            `SELECT
                a.id,
                a.check_in_time,
                a.checkin_method,
                a.checkin_status,
                a.was_override,
                a.staff_user_id,
                m.id         AS member_id,
                m.full_name,
                m.profile_pic,
                u.full_name AS staff_name
             FROM attendance a
             JOIN members m ON a.member_id = m.id
             LEFT JOIN users u ON a.staff_user_id = u.id
             WHERE a.gym_id = $1
                             AND a.deleted_at IS NULL
                             AND m.deleted_at IS NULL
                             AND timezone($2, a.check_in_time)::date = timezone($2, NOW())::date
             ORDER BY a.check_in_time DESC`,
                        [req.user.gym_id, gymTimezone]
        );
        res.json(list.rows);
    } catch (err) {
        console.error("TODAY ATTENDANCE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 3. ATTENDANCE HISTORY FOR A SPECIFIC MEMBER ---
router.get('/history/:member_id', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    const { member_id } = req.params;
    if (!member_id || member_id === 'undefined') return res.json([]);

    try {
        const gymTimezone = await getGymTimezone(pool, req.user.gym_id);
        const history = await pool.query(
            `SELECT
                id,
                check_in_time,
                     checkin_method,
                     checkin_status,
                TO_CHAR(timezone($3, check_in_time), 'DD Mon YYYY') AS date_label,
                TO_CHAR(timezone($3, check_in_time), 'HH12:MI AM')  AS time_label
             FROM attendance
             WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL
             ORDER BY check_in_time DESC
             LIMIT 30`,
            [member_id, req.user.gym_id, gymTimezone]
        );
        res.json(history.rows);
    } catch (err) {
        console.error("ATTENDANCE HISTORY ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. ATTENDANCE SUMMARY (last 7 days by hour — for dashboard heatmap) ---
router.get('/summary', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    const gym_id = req.user.gym_id;
    try {
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const result = await pool.query(
            `SELECT
                EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour,
                COUNT(*)::INTEGER AS count
             FROM attendance
             WHERE gym_id = $1
                             AND deleted_at IS NULL
               AND check_in_time >= NOW() - INTERVAL '7 days'
             GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
             ORDER BY hour ASC`,
            [gym_id, gymTimezone]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("ATTENDANCE SUMMARY ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 5. OVERVIEW KPIS FOR ATTENDANCE PAGE ---
router.get('/overview', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const gymTimezone = await getGymTimezone(pool, gym_id);

        const [today, yesterday, activeToday, peakHour] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND timezone($2, check_in_time)::date = timezone($2, NOW())::date`,
                [gym_id, gymTimezone]
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND timezone($2, check_in_time)::date = (timezone($2, NOW())::date - 1)`,
                [gym_id, gymTimezone]
            ),
            pool.query(
                `SELECT COUNT(DISTINCT a.member_id)::INTEGER AS count
                 FROM attendance a
                 JOIN memberships ms ON ms.member_id = a.member_id AND ms.gym_id = a.gym_id
                 WHERE a.gym_id = $1
                         AND a.deleted_at IS NULL
                         AND ms.deleted_at IS NULL
                   AND timezone($2, a.check_in_time)::date = timezone($2, NOW())::date
                   AND ms.status = 'ACTIVE'`,
                [gym_id, gymTimezone]
            ),
            pool.query(
                `SELECT EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour, COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND timezone($2, check_in_time)::date = timezone($2, NOW())::date
                 GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
                 ORDER BY count DESC
                 LIMIT 1`,
                [gym_id, gymTimezone]
            )
        ]);

        const peak = peakHour.rows[0] || null;
        res.json({
            today_checkins: today.rows[0]?.count || 0,
            yesterday_checkins: yesterday.rows[0]?.count || 0,
            active_members_today: activeToday.rows[0]?.count || 0,
            peak_hour_today: peak ? peak.hour : null,
            peak_hour_count: peak ? peak.count : 0
        });
    } catch (err) {
        console.error('ATTENDANCE OVERVIEW ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 6. LIVE FEED ---
router.get('/feed', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

        const result = await pool.query(
            `SELECT
                a.id,
                a.check_in_time,
                a.checkin_method,
                a.checkin_status,
                a.was_override,
                m.id AS member_id,
                m.full_name,
                m.profile_pic,
                u.full_name AS staff_name
             FROM attendance a
             JOIN members m ON m.id = a.member_id
             LEFT JOIN users u ON u.id = a.staff_user_id
             WHERE a.gym_id = $1
                             AND a.deleted_at IS NULL
                             AND m.deleted_at IS NULL
             ORDER BY a.check_in_time DESC
             LIMIT $2`,
            [gym_id, limit]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE FEED ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 7. FILTERABLE ATTENDANCE TABLE ---
router.get('/records', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const range = String(req.query.range || 'today').toLowerCase();
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;

        let dateClause = 'timezone($2, a.check_in_time)::date = timezone($2, NOW())::date';
        const params = [gym_id, gymTimezone];

        if (range === 'yesterday') {
            dateClause = `timezone($2, a.check_in_time)::date = (timezone($2, NOW())::date - 1)`;
        } else if (range === 'custom' && from && to) {
            params.push(from, to);
            dateClause = `timezone($2, a.check_in_time)::date BETWEEN $3::date AND $4::date`;
        }

        const query = `
            SELECT
                a.id,
                a.check_in_time,
                a.checkin_method,
                a.checkin_status,
                a.was_override,
                m.id AS member_id,
                m.full_name AS member_name,
                m.phone,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                ms_latest.plan_name,
                u.full_name AS staff_name
            FROM attendance a
            JOIN members m ON m.id = a.member_id
            LEFT JOIN users u ON u.id = a.staff_user_id
            LEFT JOIN LATERAL (
                SELECT ms.status, p.name AS plan_name
                FROM memberships ms
                LEFT JOIN plans p ON p.id = ms.plan_id
                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC NULLS LAST
                LIMIT 1
            ) ms_latest ON true
            WHERE a.gym_id = $1 AND a.deleted_at IS NULL AND m.deleted_at IS NULL AND ${dateClause}
            ORDER BY a.check_in_time DESC
            LIMIT 500
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE RECORDS ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 8. HEATMAP DATA (calendar-style intensity) ---
router.get('/heatmap', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const days = Math.min(Math.max(parseInt(req.query.days || '90', 10), 7), 365);

        const result = await pool.query(
            `WITH date_series AS (
                SELECT (timezone($2, NOW())::date - ($3::int - 1) + i)::date AS d
                FROM generate_series(0, $3::int - 1) AS g(i)
            )
            SELECT
                ds.d::text AS date,
                EXTRACT(ISODOW FROM ds.d)::INTEGER AS iso_weekday,
                COALESCE(a.count, 0)::INTEGER AS count
            FROM date_series ds
            LEFT JOIN (
                SELECT timezone($2, check_in_time)::date AS d, COUNT(*)::INTEGER AS count
                FROM attendance
                WHERE gym_id = $1
                                    AND deleted_at IS NULL
                  AND timezone($2, check_in_time)::date >= timezone($2, NOW())::date - ($3::int - 1)
                GROUP BY timezone($2, check_in_time)::date
            ) a ON a.d = ds.d
            ORDER BY ds.d ASC`,
            [gym_id, gymTimezone, days]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE HEATMAP ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 9. PEAK HOUR ANALYSIS ---
router.get('/peak-hours', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const todayOnly = req.query.today === 'true';

        let result;
        if (todayOnly) {
            result = await pool.query(
                `SELECT
                    EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour,
                    COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND timezone($2, check_in_time)::date = timezone($2, NOW())::date
                 GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
                 ORDER BY hour ASC`,
                [gym_id, gymTimezone]
            );
        } else {
            const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 90);
            result = await pool.query(
                `SELECT
                    EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour,
                    COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND check_in_time >= NOW() - ($3::int || ' day')::interval
                 GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
                 ORDER BY hour ASC`,
                [gym_id, gymTimezone, days]
            );
        }

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE PEAK-HOURS ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 10. INACTIVE MEMBERS / RETENTION RISK ---
router.get('/inactive', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const days = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 120);

        const result = await pool.query(
            `SELECT
                m.id,
                m.full_name,
                m.phone,
                m.email,
                m.last_visit,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                ms_latest.plan_name,
                COALESCE(
                    DATE_PART('day', NOW() - COALESCE(m.last_visit, m.joining_date::timestamp, m.created_at))::INTEGER,
                    999
                ) AS days_inactive
             FROM members m
             LEFT JOIN LATERAL (
                SELECT ms.status, p.name AS plan_name
                FROM memberships ms
                LEFT JOIN plans p ON p.id = ms.plan_id
                                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC NULLS LAST
                LIMIT 1
             ) ms_latest ON true
             WHERE m.gym_id = $1
                             AND m.deleted_at IS NULL
               AND COALESCE(ms_latest.status, 'UNPAID') = 'ACTIVE'
               AND (
                    m.last_visit IS NULL
                    OR m.last_visit < NOW() - ($2::int || ' day')::interval
               )
             ORDER BY days_inactive DESC, m.full_name ASC
             LIMIT 100`,
            [gym_id, days]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE INACTIVE ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 11. ENGAGEMENT LEADERBOARD ---
router.get('/leaderboard', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 7), 180);
        const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 3), 50);

        const result = await pool.query(
            `SELECT
                m.id,
                m.full_name,
                m.profile_pic,
                COUNT(a.id)::INTEGER AS visits,
                MAX(a.check_in_time) AS last_check_in,
                ROUND((COUNT(a.id)::decimal / GREATEST($2::decimal / 7, 1)), 2) AS avg_visits_per_week
             FROM attendance a
             JOIN members m ON m.id = a.member_id
             LEFT JOIN LATERAL (
                SELECT status
                FROM memberships ms
                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC NULLS LAST
                LIMIT 1
             ) ms_latest ON true
             WHERE a.gym_id = $1
               AND a.deleted_at IS NULL
               AND m.deleted_at IS NULL
               AND a.check_in_time >= NOW() - ($2::int || ' day')::interval
               AND COALESCE(ms_latest.status, 'UNPAID') = 'ACTIVE'
             GROUP BY m.id, m.full_name, m.profile_pic
             ORDER BY visits DESC, last_check_in DESC
             LIMIT $3`,
            [gym_id, days, limit]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE LEADERBOARD ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;