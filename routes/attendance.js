const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const memberAuth = require('../middleware/memberAuthMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner, requirePermission } = require('../middleware/rbac');
const {
    BranchAccessError,
    branchSchemaMiddleware,
    DEFAULT_BRANCH_ID,
    ensureBranchAccess,
    resolveBranchReadScope,
} = require('../utils/branchAccess');
const { writeAuditLog } = require('../utils/auditLog');
const { getGymTimezone } = require('../utils/gymTime');
const { signAttendanceToken, verifyAttendanceToken } = require('../utils/attendanceTokens');
const { sendPushToGym } = require('./push');
const { cacheGet, cacheSet, buildCacheKey } = require('../utils/cache');

const ATTENDANCE_OVERVIEW_TTL = 15; // seconds
const ATTENDANCE_SUMMARY_TTL = 15; // seconds

const CHECKIN_METHODS = new Set(['STAFF', 'QR', 'SELF', 'RFID']);
const RFID_DEVICE_STATUSES = new Set(['ACTIVE', 'PAUSED', 'DISABLED']);
const MEMBER_QR_TTL_MS = Number.parseInt(process.env.ATTENDANCE_MEMBER_QR_TTL_MS || `${12 * 60 * 60 * 1000}`, 10);
const GYM_QR_TTL_MS = Number.parseInt(process.env.ATTENDANCE_GYM_QR_TTL_MS || `${5 * 60 * 1000}`, 10);
const RFID_DUPLICATE_WINDOW_SECONDS = Number.parseInt(process.env.RFID_DUPLICATE_WINDOW_SECONDS || '10', 10);
const RFID_EVENT_MAX_AGE_MS = Number.parseInt(process.env.RFID_EVENT_MAX_AGE_MS || `${5 * 60 * 1000}`, 10);
const RFID_EVENT_MAX_FUTURE_SKEW_MS = Number.parseInt(process.env.RFID_EVENT_MAX_FUTURE_SKEW_MS || '60000', 10);
const ACCESS_ALERT_DEDUP_SECONDS = Number.parseInt(process.env.ATTENDANCE_ALERT_DEDUP_SECONDS || '120', 10);
const ACCESS_ALERT_ROLES = ['OWNER', 'STAFF'];
const DEFAULT_ATTENDANCE_MODE = 'STAFF';
const DEFAULT_GYM_RADIUS_METERS = 200;
const DEFAULT_BRANCH_SQL = `'${DEFAULT_BRANCH_ID}'`;

const METHOD_LABELS = {
    STAFF: 'staff desk',
    QR: 'QR check-in',
    SELF: 'self check-in',
    RFID: 'RFID gate',
};

const normalizeMethod = (value) => {
    const method = String(value || DEFAULT_ATTENDANCE_MODE).toUpperCase().trim();
    return CHECKIN_METHODS.has(method) ? method : DEFAULT_ATTENDANCE_MODE;
};

const normalizeRfidDeviceStatus = (value) => {
    const status = String(value || 'ACTIVE').toUpperCase().trim();
    return RFID_DEVICE_STATUSES.has(status) ? status : null;
};

const asBool = (value) => value === true || value === 'true' || value === 1 || value === '1';

const safeCompareSecret = (expected, provided) => {
    const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
    const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
    if (expectedBuffer.length === 0 || providedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const getBranchFilterSql = (params, branchId, columnExpression = `COALESCE(a.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL})`) => {
    if (!branchId) {
        return '';
    }

    params.push(branchId);
    return ` AND ${columnExpression} = $${params.length}`;
};

const maskRfidTagId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'UNKNOWN';
    return raw.slice(-6);
};

const writeRfidAuditLog = async ({
    device = null,
    action,
    targetType,
    targetId,
    targetLabel,
    details = {},
}) => {
    await writeAuditLog({
        actorType: 'RFID_DEVICE',
        actorId: device ? String(device.id) : 'UNKNOWN_READER',
        action,
        targetType,
        targetId: targetId ? String(targetId) : '',
        targetLabel: targetLabel || '',
        details: {
            gym_id: device?.gym_id || null,
            reader_id: device?.id || null,
            reader_name: device?.reader_name || '',
            reader_serial: device?.reader_serial || '',
            ...details,
        },
    });
};

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

const getMemberSnapshot = async (gym_id, member_id, db = pool) => {
    const result = await db.query(
        `SELECT
            m.id,
            m.full_name,
            m.phone,
            m.email,
            COALESCE(m.branch_id, $3) AS branch_id,
            m.rfid_tag_id,
            m.last_visit,
            m.joining_date,
            m.status AS member_status,
            COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                ms_latest.plan_id,
            ms_latest.end_date,
            ms_latest.plan_name
         FROM members m
         LEFT JOIN LATERAL (
                SELECT ms.status, ms.plan_id, ms.end_date, p.name AS plan_name
            FROM memberships ms
            LEFT JOIN plans p ON p.id = ms.plan_id
                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
            ORDER BY ms.end_date DESC NULLS LAST
            LIMIT 1
         ) ms_latest ON true
            WHERE m.gym_id = $1 AND m.id = $2 AND m.deleted_at IS NULL
         LIMIT 1`,
        [gym_id, member_id, DEFAULT_BRANCH_ID]
    );

    return result.rows[0] || null;
};

const ensureScopedMemberAccess = async (scope, gymId, memberId, db = pool) => {
    const member = await getMemberSnapshot(gymId, memberId, db);
    if (!member) {
        return null;
    }

    ensureBranchAccess(scope, member.branch_id || DEFAULT_BRANCH_ID);
    return member;
};

const createAttendanceError = (statusCode, payload) => {
    const err = new Error(payload?.message || payload?.error || 'Attendance error');
    err.statusCode = statusCode;
    err.payload = payload;
    return err;
};

const sendAttendanceError = (res, err) => {
    if (err instanceof BranchAccessError) {
        return res.status(err.statusCode).json({ error: err.message });
    }

    if (err?.statusCode && err?.payload) {
        return res.status(err.statusCode).json(err.payload);
    }

    console.error('ATTENDANCE ROUTE ERROR:', err.message);
    return res.status(500).json({ error: 'Server Error' });
};

const getGymAttendanceConfig = async (gym_id, db = pool) => {
    const gymConfigRes = await db.query(
        `SELECT id, name, attendance_mode, attendance_geo_enabled, gym_latitude, gym_longitude, gym_radius_meters, allow_expired_checkin
         FROM gyms WHERE id = $1`,
        [gym_id]
    );

    return gymConfigRes.rows[0] || null;
};

const createDedupedGymNotification = async (gym_id, title, message, dedupeSeconds = ACCESS_ALERT_DEDUP_SECONDS) => {
    const existing = await pool.query(
        `SELECT id
         FROM notifications
         WHERE gym_id = $1
           AND title = $2
           AND message = $3
           AND created_at > NOW() - ($4 || ' seconds')::interval
         ORDER BY created_at DESC
         LIMIT 1`,
        [gym_id, title, message, Math.max(1, dedupeSeconds)]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0];
    }

    const inserted = await pool.query(
        `INSERT INTO notifications (gym_id, title, message)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [gym_id, title, message]
    );

    return inserted.rows[0];
};

const notifyStaffAccessAlert = async ({ gym_id, title, message, url = '/attendance' }) => {
    try {
        await createDedupedGymNotification(gym_id, title, message);
        await sendPushToGym(gym_id, {
            title,
            body: message,
            icon: '/gymvault-app-icon-192.png',
            badge: '/gymvault-app-icon-64.png',
            url,
        }, ACCESS_ALERT_ROLES);
    } catch (err) {
        console.error('ATTENDANCE ACCESS ALERT ERROR:', err.message);
    }
};

const notifyBlockedMembershipAttempt = async ({ gym, member, method, membershipStatus }) => {
    const membershipLabel = String(membershipStatus || member?.membership_status || 'UNKNOWN').toUpperCase();
    const methodLabel = METHOD_LABELS[normalizeMethod(method)] || 'attendance';
    const title = 'Attendance Access Alert';
    const message = `${member.full_name} tried ${methodLabel} at ${gym.name}, but membership is ${membershipLabel}. Staff should review or override at the desk.`;
    await notifyStaffAccessAlert({ gym_id: gym.id, title, message });
};

const notifyGeoBlockedAttempt = async ({ gym, member, distance_meters, allowed_radius_meters }) => {
    const title = 'Outside Radius Attempt';
    const message = `${member.full_name} tried self check-in at ${gym.name} from ${distance_meters}m away. Allowed radius is ${allowed_radius_meters}m.`;
    await notifyStaffAccessAlert({ gym_id: gym.id, title, message });
};

const notifyAccessPolicyBlockedAttempt = async ({ gym, member, policyName, reason }) => {
    const title = 'Access Policy Blocked';
    const message = `${member.full_name} was blocked by ${policyName || 'an access policy'} at ${gym.name}. ${reason}`;
    await notifyStaffAccessAlert({ gym_id: gym.id, title, message });
};

const DAY_CODE_MAP = {
    SUN: 'SUN',
    SUNDAY: 'SUN',
    MON: 'MON',
    MONDAY: 'MON',
    TUE: 'TUE',
    TUES: 'TUE',
    TUESDAY: 'TUE',
    WED: 'WED',
    WEDNESDAY: 'WED',
    THU: 'THU',
    THUR: 'THU',
    THURS: 'THU',
    THURSDAY: 'THU',
    FRI: 'FRI',
    FRIDAY: 'FRI',
    SAT: 'SAT',
    SATURDAY: 'SAT',
};

const normalizeAllowedDays = (value) => String(value || '')
    .split(/[\s,|]+/)
    .map((item) => DAY_CODE_MAP[String(item || '').trim().toUpperCase()] || null)
    .filter(Boolean);

const isTimeWithinWindow = (currentTime, startTime, endTime) => {
    const current = String(currentTime || '').slice(0, 5);
    const start = String(startTime || '').slice(0, 5);
    const end = String(endTime || '').slice(0, 5);
    if (!current || !start || !end) return true;
    if (start <= end) return current >= start && current <= end;
    return current >= start || current <= end;
};

const getGymLocalTimeContext = async (gym_id, db = pool) => {
    const timezone = await getGymTimezone(db, gym_id);
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
    return {
        timezone,
        dayCode: DAY_CODE_MAP[String(parts.weekday || '').trim().toUpperCase()] || 'MON',
        currentTime: `${parts.hour || '00'}:${parts.minute || '00'}`,
        localDate: `${parts.year || '1970'}-${parts.month || '01'}-${parts.day || '01'}`,
    };
};

const getApplicableAccessPolicy = async ({ gym_id, plan_id, db = pool }) => {
    if (!plan_id) return null;
    const result = await db.query(
        `SELECT *
         FROM access_policies
         WHERE gym_id = $1
           AND is_active = TRUE
           AND (plan_id = $2 OR plan_id IS NULL)
         ORDER BY CASE WHEN plan_id = $2 THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1`,
        [gym_id, plan_id]
    );
    return result.rows[0] || null;
};

const evaluateAccessPolicy = async ({ gym_id, member, policy, allow_override, db = pool }) => {
    if (!policy) return null;

    const localTime = await getGymLocalTimeContext(gym_id, db);
    const allowedDays = normalizeAllowedDays(policy.allowed_days);
    if (allowedDays.length > 0 && !allowedDays.includes(localTime.dayCode)) {
        return { reason: `Allowed days are ${allowedDays.join(', ')}.`, policy };
    }

    if (!isTimeWithinWindow(localTime.currentTime, policy.allowed_from, policy.allowed_to)) {
        return {
            reason: `Access window is ${String(policy.allowed_from || '00:00').slice(0, 5)} to ${String(policy.allowed_to || '23:59').slice(0, 5)}.`,
            policy,
        };
    }

    if (Boolean(policy.enforce_freeze) && String(member.membership_status || '').toUpperCase() === 'FROZEN' && !allow_override) {
        return { reason: 'Frozen memberships are blocked by this policy.', policy };
    }

    const maxDailyVisits = Number.parseInt(policy.max_daily_visits, 10) || 0;
    if (maxDailyVisits > 0) {
        const visitsRes = await db.query(
            `SELECT COUNT(*)::INTEGER AS count
             FROM attendance
             WHERE gym_id = $1
               AND member_id = $2
               AND deleted_at IS NULL
               AND DATE(check_in_time AT TIME ZONE $3) = $4`,
            [gym_id, member.id, localTime.timezone, localTime.localDate]
        );
        const todaysVisits = Number(visitsRes.rows[0]?.count || 0);
        if (todaysVisits >= maxDailyVisits && !allow_override) {
            return { reason: `Daily visit limit of ${maxDailyVisits} has already been reached.`, policy };
        }
    }

    return null;
};

router.use(branchSchemaMiddleware);

const notifyUnknownRfidAttempt = async ({ gym_id, reader_name, tag_id }) => {
    const safeTag = String(tag_id || '').slice(-6) || 'UNKNOWN';
    const title = 'Unknown RFID Tag';
    const message = `Unknown RFID tag ending ${safeTag} tried entry on ${reader_name || 'RFID reader'}. Pair the tag or stop entry if needed.`;
    await notifyStaffAccessAlert({ gym_id, title, message });
};

const processAttendanceCheckin = async ({
    gym_id,
    member_id,
    method,
    notes = '',
    latitude = null,
    longitude = null,
    allow_override = false,
    staff_user_id = null,
    duplicateWindowSeconds = 600,
}) => {
    const checkinMethod = normalizeMethod(method);
    const client = await pool.connect();
    let transactionFinished = false;

    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`attendance-checkin:${gym_id}:${member_id}`]);

        // Combined gym config + member snapshot in one round-trip
        const combinedRes = await client.query(
            `WITH gym_cfg AS (
                SELECT id, name, attendance_mode, attendance_geo_enabled, gym_latitude, gym_longitude, gym_radius_meters, allow_expired_checkin
                FROM gyms WHERE id = $1
            )
            SELECT
                (SELECT row_to_json(gym_cfg) FROM gym_cfg) AS gym_config,
                row_to_json(member_snap) AS member
            FROM (
                SELECT
                    m.id, m.full_name, m.phone, m.email,
                    COALESCE(m.branch_id, $3) AS branch_id,
                    m.rfid_tag_id, m.last_visit, m.joining_date, m.status AS member_status,
                    COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                    ms_latest.plan_id, ms_latest.end_date, ms_latest.plan_name
                FROM members m
                LEFT JOIN LATERAL (
                    SELECT ms.status, ms.plan_id, ms.end_date, p.name AS plan_name
                    FROM memberships ms
                    LEFT JOIN plans p ON p.id = ms.plan_id
                    WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                    ORDER BY ms.end_date DESC NULLS LAST
                    LIMIT 1
                ) ms_latest ON true
                WHERE m.gym_id = $1 AND m.id = $2 AND m.deleted_at IS NULL
                LIMIT 1
            ) member_snap`,
            [gym_id, member_id, DEFAULT_BRANCH_ID]
        );

        const gymConfig = combinedRes.rows[0]?.gym_config;
        if (!gymConfig) {
            throw createAttendanceError(404, { message: 'Gym not found.' });
        }

        const member = combinedRes.rows[0]?.member;
        if (!member) {
            throw createAttendanceError(404, { message: 'Member not found.' });
        }

        const hasValidCoordinates = Number.isFinite(Number.parseFloat(latitude)) && Number.isFinite(Number.parseFloat(longitude));
        const hasGeoConfig = Boolean(gymConfig.attendance_geo_enabled && gymConfig.gym_latitude && gymConfig.gym_longitude);

        if (checkinMethod === 'SELF') {
            if (!gymConfig.attendance_geo_enabled) {
                throw createAttendanceError(403, {
                    code: 'SELF_CHECKIN_DISABLED',
                    message: 'Self check-in is not enabled for this gym yet.',
                });
            }

            if (!hasGeoConfig) {
                throw createAttendanceError(409, {
                    code: 'SELF_CHECKIN_NOT_CONFIGURED',
                    message: 'Gym location has not been configured yet. Ask the gym owner to finish attendance setup.',
                });
            }

            if (!hasValidCoordinates) {
                throw createAttendanceError(400, {
                    code: 'LOCATION_REQUIRED',
                    message: 'Location is required for self check-in.',
                });
            }
        }

        const membershipStatus = String(member.membership_status || 'UNPAID').toUpperCase();
        const isActiveMembership = membershipStatus === 'ACTIVE';
        const canOverrideMembershipRule = !isActiveMembership && allow_override && gymConfig.allow_expired_checkin === true;

        if (!isActiveMembership && !canOverrideMembershipRule) {
            await client.query('ROLLBACK');
            transactionFinished = true;
            await notifyBlockedMembershipAttempt({
                gym: gymConfig,
                member,
                method: checkinMethod,
                membershipStatus,
            });
            throw createAttendanceError(403, {
                code: 'ATTENDANCE_BLOCKED',
                message: `Access Denied: Membership is ${membershipStatus}`,
                warning: 'Membership is not active. Override can be allowed by gym settings.',
                member,
            });
        }

        const accessPolicy = await getApplicableAccessPolicy({ gym_id, plan_id: member.plan_id, db: client });
        const accessPolicyViolation = await evaluateAccessPolicy({
            gym_id,
            member,
            policy: accessPolicy,
            allow_override: Boolean(allow_override),
            db: client,
        });
        if (accessPolicyViolation) {
            await client.query('ROLLBACK');
            transactionFinished = true;
            await notifyAccessPolicyBlockedAttempt({
                gym: gymConfig,
                member,
                policyName: accessPolicyViolation.policy?.name,
                reason: accessPolicyViolation.reason,
            });
            throw createAttendanceError(403, {
                code: 'ACCESS_POLICY_BLOCKED',
                message: `Access blocked by ${accessPolicyViolation.policy?.name || 'policy'}`,
                warning: accessPolicyViolation.reason,
                member,
                policy: accessPolicyViolation.policy,
            });
        }

        const recentDuplicate = await client.query(
            `SELECT id, check_in_time
             FROM attendance
             WHERE gym_id = $1 AND member_id = $2 AND deleted_at IS NULL AND check_in_time > NOW() - ($3 || ' seconds')::interval
             ORDER BY check_in_time DESC
             LIMIT 1`,
            [gym_id, member_id, Math.max(1, duplicateWindowSeconds)]
        );

        if (recentDuplicate.rows.length > 0 && !allow_override) {
            await client.query('ROLLBACK');
            transactionFinished = true;
            throw createAttendanceError(429, {
                code: 'DUPLICATE_CHECKIN',
                message: 'Check-in blocked: member already checked in very recently.',
                last_checkin_time: recentDuplicate.rows[0].check_in_time,
                member,
            });
        }

        if (checkinMethod === 'SELF') {
            const distanceMeters = haversineDistanceMeters(
                parseFloat(gymConfig.gym_latitude),
                parseFloat(gymConfig.gym_longitude),
                parseFloat(latitude),
                parseFloat(longitude)
            );
            const radius = parseInt(gymConfig.gym_radius_meters || 200, 10);

            if (distanceMeters > radius && !allow_override) {
                await client.query('ROLLBACK');
                transactionFinished = true;
                await notifyGeoBlockedAttempt({
                    gym: gymConfig,
                    member,
                    distance_meters: Math.round(distanceMeters),
                    allowed_radius_meters: radius,
                });
                throw createAttendanceError(403, {
                    code: 'GEO_BLOCKED',
                    message: 'Check-in blocked: device is outside gym location radius.',
                    distance_meters: Math.round(distanceMeters),
                    allowed_radius_meters: radius,
                    member,
                });
            }
        }

        const checkinStatus = isActiveMembership ? 'ALLOWED' : 'OVERRIDE';

        const newRecord = await client.query(
            `INSERT INTO attendance
             (gym_id, member_id, check_in_time, checkin_method, staff_user_id, checkin_status, was_override, notes, latitude, longitude, branch_id)
             VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                gym_id,
                member_id,
                checkinMethod,
                staff_user_id,
                checkinStatus,
                checkinStatus === 'OVERRIDE',
                notes || '',
                latitude ? parseFloat(latitude) : null,
                longitude ? parseFloat(longitude) : null,
                member.branch_id || DEFAULT_BRANCH_ID,
            ]
        );

        await client.query('COMMIT');
        transactionFinished = true;

        // Fire-and-forget: update last_visit outside transaction to reduce latency
        pool.query(
            'UPDATE members SET last_visit = NOW() WHERE id = $1 AND gym_id = $2',
            [member_id, gym_id]
        ).catch(() => {});

        return {
            message: checkinStatus === 'OVERRIDE' ? 'Check-in recorded with override.' : 'Check-in Successful!',
            details: newRecord.rows[0],
            member,
            warning: checkinStatus === 'OVERRIDE' ? `Member is ${membershipStatus}. Override recorded.` : null,
            gym: { id: gymConfig.id, name: gymConfig.name },
        };
    } catch (err) {
        if (!transactionFinished) {
            await client.query('ROLLBACK').catch(() => {});
        }
        throw err;
    } finally {
        client.release();
    }
};

const buildMemberQrPayload = (gym_id, member_id) => {
    const issuedAt = Date.now();
    return {
        type: 'MEMBER_QR',
        gym_id,
        member_id,
        issued_at: issuedAt,
        expires_at: issuedAt + MEMBER_QR_TTL_MS,
    };
};

const buildGymQrPayload = (gym_id) => {
    const issuedAt = Date.now();
    return {
        type: 'GYM_QR',
        gym_id,
        issued_at: issuedAt,
        expires_at: issuedAt + GYM_QR_TTL_MS,
    };
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
        res.json({
            ...gym.rows[0],
            attendance_mode: normalizeMethod(gym.rows[0].attendance_mode),
            gym_radius_meters: Number.parseInt(gym.rows[0].gym_radius_meters || `${DEFAULT_GYM_RADIUS_METERS}`, 10) || DEFAULT_GYM_RADIUS_METERS,
        });
    } catch (err) {
        console.error('ATTENDANCE MODE GET ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/mode', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const attendance_mode = normalizeMethod(req.body.attendance_mode);
        const attendance_geo_enabled = asBool(req.body.attendance_geo_enabled);
        const allow_expired_checkin = asBool(req.body.allow_expired_checkin);
        let gym_latitude = null;
        let gym_longitude = null;
        let gym_radius_meters = DEFAULT_GYM_RADIUS_METERS;

        if (attendance_mode === 'SELF' && !attendance_geo_enabled) {
            return res.status(400).json({ error: 'Enable app location check-in before setting Self Check-In mode.' });
        }

        if (attendance_geo_enabled) {
            gym_latitude = Number.parseFloat(req.body.gym_latitude);
            gym_longitude = Number.parseFloat(req.body.gym_longitude);
            gym_radius_meters = Number.parseInt(req.body.gym_radius_meters || `${DEFAULT_GYM_RADIUS_METERS}`, 10) || DEFAULT_GYM_RADIUS_METERS;

            if (!Number.isFinite(gym_latitude) || !Number.isFinite(gym_longitude)) {
                return res.status(400).json({ error: 'Gym latitude and longitude are required when geo check-in is enabled.' });
            }
        }

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

    if (!member_id) return res.status(400).json({ message: "member_id is required." });

    try {
        const branchScope = await resolveBranchReadScope(pool, req);
        const member = await ensureScopedMemberAccess(branchScope, gym_id, member_id);
        if (!member) {
            return res.status(404).json({ message: 'Member not found.' });
        }

        const payload = await processAttendanceCheckin({
            gym_id,
            member_id,
            method,
            notes,
            latitude,
            longitude,
            allow_override,
            staff_user_id: req.user.id || null,
        });
        res.json(payload);
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.get('/qr/member/:member_id', auth, saasMiddleware, requirePermission('attendance:write'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const branchScope = await resolveBranchReadScope(pool, req);
        const member = await ensureScopedMemberAccess(branchScope, gym_id, req.params.member_id);
        if (!member) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const token = signAttendanceToken(buildMemberQrPayload(gym_id, member.id));
        res.json({
            token,
            expires_at: Date.now() + MEMBER_QR_TTL_MS,
            member,
        });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.get('/qr/gym', auth, saasMiddleware, requirePermission('attendance:write'), async (req, res) => {
    try {
        const gym = await getGymAttendanceConfig(req.user.gym_id);
        if (!gym) {
            return res.status(404).json({ error: 'Gym not found.' });
        }

        const token = signAttendanceToken(buildGymQrPayload(gym.id));
        res.json({
            token,
            expires_at: Date.now() + GYM_QR_TTL_MS,
            gym: {
                id: gym.id,
                name: gym.name,
            },
        });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.get('/member/options', memberAuth, saasMiddleware, async (req, res) => {
    try {
        const gym = await getGymAttendanceConfig(req.member.gym_id);
        if (!gym) {
            return res.status(404).json({ error: 'Gym not found.' });
        }

        const selfCheckinAvailable = Boolean(gym.attendance_geo_enabled && gym.gym_latitude && gym.gym_longitude);

        res.json({
            gym: {
                id: gym.id,
                name: gym.name,
            },
            attendance_mode: normalizeMethod(gym.attendance_mode),
            attendance_geo_enabled: Boolean(gym.attendance_geo_enabled),
            gym_radius_meters: Number.parseInt(gym.gym_radius_meters || `${DEFAULT_GYM_RADIUS_METERS}`, 10) || DEFAULT_GYM_RADIUS_METERS,
            self_checkin_available: selfCheckinAvailable,
            member_qr_available: true,
            gym_qr_available: true,
        });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.get('/member/qr', memberAuth, saasMiddleware, async (req, res) => {
    try {
        const member = await getMemberSnapshot(req.member.gym_id, req.member.id);
        if (!member) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const token = signAttendanceToken(buildMemberQrPayload(req.member.gym_id, req.member.id));
        res.json({
            token,
            expires_at: Date.now() + MEMBER_QR_TTL_MS,
            member,
        });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/checkin/qr', auth, saasMiddleware, requirePermission('attendance:write'), async (req, res) => {
    try {
        const verification = verifyAttendanceToken(req.body?.token);
        if (!verification.valid) {
            return res.status(400).json({ error: verification.reason || 'Invalid QR token.' });
        }

        const payload = verification.payload || {};
        if (payload.type !== 'MEMBER_QR') {
            return res.status(400).json({ error: 'This QR code is not a member attendance code.' });
        }
        if (Number(payload.gym_id) !== Number(req.user.gym_id)) {
            return res.status(403).json({ error: 'This member QR belongs to another gym.' });
        }

        const branchScope = await resolveBranchReadScope(pool, req);
        const member = await ensureScopedMemberAccess(branchScope, req.user.gym_id, payload.member_id);
        if (!member) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const result = await processAttendanceCheckin({
            gym_id: req.user.gym_id,
            member_id: payload.member_id,
            method: 'QR',
            notes: req.body?.notes || '',
            allow_override: asBool(req.body?.allow_override),
            staff_user_id: req.user.id || null,
        });
        res.json(result);
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/member/checkin/qr', memberAuth, saasMiddleware, async (req, res) => {
    try {
        const verification = verifyAttendanceToken(req.body?.token);
        if (!verification.valid) {
            return res.status(400).json({ error: verification.reason || 'Invalid QR token.' });
        }

        const payload = verification.payload || {};
        if (payload.type !== 'GYM_QR') {
            return res.status(400).json({ error: 'This QR code is not a gym self check-in code.' });
        }
        if (Number(payload.gym_id) !== Number(req.member.gym_id)) {
            return res.status(403).json({ error: 'This gym QR belongs to another gym.' });
        }

        const result = await processAttendanceCheckin({
            gym_id: req.member.gym_id,
            member_id: req.member.id,
            method: 'QR',
            notes: 'Member self check-in via gym QR',
            allow_override: false,
            staff_user_id: null,
        });
        res.json(result);
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/member/checkin/self', memberAuth, saasMiddleware, async (req, res) => {
    try {
        const latitude = req.body?.latitude;
        const longitude = req.body?.longitude;

        if (latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: 'latitude and longitude are required.' });
        }

        const result = await processAttendanceCheckin({
            gym_id: req.member.gym_id,
            member_id: req.member.id,
            method: 'SELF',
            notes: 'Member self check-in via location',
            latitude,
            longitude,
            allow_override: false,
            staff_user_id: null,
        });
        res.json(result);
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.get('/rfid/devices', auth, saasMiddleware, requireOwner, async (req, res) => {
    try {
        const devices = await pool.query(
            `SELECT id, reader_name, reader_serial, reader_location, status, last_heartbeat, created_at, updated_at
             FROM rfid_devices
             WHERE gym_id = $1
             ORDER BY created_at DESC`,
            [req.user.gym_id]
        );
        res.json(devices.rows);
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.get('/rfid/events', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 15, 1), 100);
        const requestedStatus = String(req.query.status || '').trim().toUpperCase();
        const hasStatusFilter = requestedStatus.length > 0;

        const events = await pool.query(
            `SELECT
                e.id,
                e.tag_id,
                e.event_timestamp,
                e.processed,
                e.event_status,
                e.response_message,
                e.created_at,
                d.id AS reader_id,
                d.reader_name,
                d.reader_serial,
                d.status AS reader_status,
                     COALESCE(m.id, NULLIF(e.member_snapshot->>'id', '')::INTEGER) AS member_id,
                     COALESCE(m.full_name, e.member_snapshot->>'full_name') AS member_name,
                     COALESCE(m.rfid_tag_id, e.member_snapshot->>'rfid_tag_id', e.tag_id) AS rfid_tag_id,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status
             FROM rfid_events e
             LEFT JOIN rfid_devices d ON d.id = e.reader_id
             LEFT JOIN members m ON m.id = e.member_id
             LEFT JOIN LATERAL (
                SELECT ms.status
                FROM memberships ms
                WHERE ms.member_id = e.member_id
                  AND ms.gym_id = e.gym_id
                  AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC NULLS LAST
                LIMIT 1
             ) ms_latest ON true
             WHERE e.gym_id = $1
               AND ($2::text = '' OR UPPER(COALESCE(e.event_status, '')) = $2)
             ORDER BY e.event_timestamp DESC, e.id DESC
             LIMIT $3`,
            [gym_id, hasStatusFilter ? requestedStatus : '', limit]
        );

        res.json(events.rows);
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/rfid/devices', auth, saasMiddleware, requireOwner, async (req, res) => {
    const reader_name = String(req.body?.reader_name || '').trim();
    const reader_serial = String(req.body?.reader_serial || '').trim();
    const reader_location = String(req.body?.reader_location || '').trim();

    if (!reader_name || !reader_serial) {
        return res.status(400).json({ error: 'reader_name and reader_serial are required.' });
    }

    try {
        const sharedSecret = crypto.randomBytes(24).toString('hex');
        const created = await pool.query(
            `INSERT INTO rfid_devices (gym_id, reader_name, reader_serial, reader_location, shared_secret)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, reader_name, reader_serial, reader_location, status, last_heartbeat, created_at`,
            [req.user.gym_id, reader_name, reader_serial, reader_location, sharedSecret]
        );

        res.status(201).json({
            device: created.rows[0],
            shared_secret: sharedSecret,
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'reader_serial is already registered.' });
        }
        sendAttendanceError(res, err);
    }
});

router.put('/rfid/devices/:id', auth, saasMiddleware, requireOwner, async (req, res) => {
    const deviceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(deviceId)) {
        return res.status(400).json({ error: 'Valid device id is required.' });
    }

    const reader_name = typeof req.body?.reader_name === 'string' ? req.body.reader_name.trim() : null;
    const reader_location = typeof req.body?.reader_location === 'string' ? req.body.reader_location.trim() : null;
    const rawStatus = req.body?.status;
    const nextStatus = rawStatus === undefined || rawStatus === null || rawStatus === ''
        ? null
        : normalizeRfidDeviceStatus(rawStatus);

    if (rawStatus !== undefined && rawStatus !== null && rawStatus !== '' && !nextStatus) {
        return res.status(400).json({ error: 'status must be ACTIVE, PAUSED, or DISABLED.' });
    }

    try {
        const current = await pool.query(
            `SELECT id, reader_name, reader_serial, reader_location, status, last_heartbeat, created_at, updated_at
             FROM rfid_devices
             WHERE id = $1 AND gym_id = $2
             LIMIT 1`,
            [deviceId, req.user.gym_id]
        );
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'RFID reader not found.' });
        }

        const device = current.rows[0];
        const finalName = reader_name || device.reader_name;
        if (!finalName) {
            return res.status(400).json({ error: 'reader_name cannot be empty.' });
        }

        const updated = await pool.query(
            `UPDATE rfid_devices
             SET reader_name = $1,
                 reader_location = $2,
                 status = $3,
                 updated_at = NOW()
             WHERE id = $4 AND gym_id = $5
             RETURNING id, reader_name, reader_serial, reader_location, status, last_heartbeat, created_at, updated_at`,
            [
                finalName,
                reader_location !== null ? reader_location : device.reader_location,
                nextStatus || device.status,
                deviceId,
                req.user.gym_id,
            ]
        );

        res.json({ message: 'RFID reader updated successfully.', device: updated.rows[0] });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/rfid/devices/:id/rotate-secret', auth, saasMiddleware, requireOwner, async (req, res) => {
    const deviceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(deviceId)) {
        return res.status(400).json({ error: 'Valid device id is required.' });
    }

    try {
        const sharedSecret = crypto.randomBytes(24).toString('hex');
        const updated = await pool.query(
            `UPDATE rfid_devices
             SET shared_secret = $1,
                 updated_at = NOW()
             WHERE id = $2 AND gym_id = $3
             RETURNING id, reader_name, reader_serial, reader_location, status, last_heartbeat, created_at, updated_at`,
            [sharedSecret, deviceId, req.user.gym_id]
        );

        if (updated.rows.length === 0) {
            return res.status(404).json({ error: 'RFID reader not found.' });
        }

        res.json({
            message: 'RFID reader key rotated successfully.',
            device: updated.rows[0],
            shared_secret: sharedSecret,
        });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/rfid/pair-member', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    const member_id = Number.parseInt(req.body?.member_id, 10);
    const tag_id = String(req.body?.tag_id || '').trim();

    if (!Number.isInteger(member_id) || !tag_id) {
        return res.status(400).json({ error: 'member_id and tag_id are required.' });
    }

    try {
        const member = await pool.query(
            'SELECT id, full_name FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [member_id, req.user.gym_id]
        );
        if (member.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        await pool.query(
            'UPDATE members SET rfid_tag_id = $1 WHERE id = $2 AND gym_id = $3',
            [tag_id, member_id, req.user.gym_id]
        );
        res.json({ message: 'RFID tag paired successfully.', member: member.rows[0], tag_id });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'That RFID tag is already paired to another member in this gym.' });
        }
        sendAttendanceError(res, err);
    }
});

router.post('/rfid/unpair-member', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    const member_id = Number.parseInt(req.body?.member_id, 10);

    if (!Number.isInteger(member_id)) {
        return res.status(400).json({ error: 'member_id is required.' });
    }

    try {
        const member = await pool.query(
            `SELECT id, full_name, rfid_tag_id
             FROM members
             WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [member_id, req.user.gym_id]
        );
        if (member.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        await pool.query(
            'UPDATE members SET rfid_tag_id = NULL WHERE id = $1 AND gym_id = $2',
            [member_id, req.user.gym_id]
        );

        res.json({
            message: member.rows[0].rfid_tag_id
                ? 'RFID tag removed from member successfully.'
                : 'Member did not have an RFID tag paired.',
            member: {
                id: member.rows[0].id,
                full_name: member.rows[0].full_name,
                rfid_tag_id: null,
            },
            previous_tag_id: member.rows[0].rfid_tag_id || null,
        });
    } catch (err) {
        sendAttendanceError(res, err);
    }
});

router.post('/rfid/event', async (req, res) => {
    const readerSerial = String(req.body?.reader_serial || '').trim();
    const tagId = String(req.body?.tag_id || '').trim();
    const readerKey = String(req.header('x-reader-key') || req.body?.reader_key || '').trim();
    const scannedAt = req.body?.scanned_at ? new Date(req.body.scanned_at) : new Date();
    const notes = String(req.body?.notes || '').trim();

    if (!readerSerial || !readerKey || !tagId) {
        return res.status(400).json({ error: 'RFID event rejected.', code: 'RFID_FIELDS_REQUIRED' });
    }

    if (Number.isNaN(scannedAt.getTime())) {
        return res.status(400).json({ error: 'RFID event rejected.', code: 'RFID_INVALID_TIMESTAMP' });
    }

    const nowMs = Date.now();
    const scannedAtMs = scannedAt.getTime();
    if (scannedAtMs < nowMs - RFID_EVENT_MAX_AGE_MS || scannedAtMs > nowMs + RFID_EVENT_MAX_FUTURE_SKEW_MS) {
        return res.status(400).json({ error: 'RFID event rejected.', code: 'RFID_EVENT_STALE' });
    }

    let eventId = null;
    let device = null;
    try {
        const deviceResult = await pool.query(
            `SELECT id, gym_id, reader_name, reader_serial, reader_location, shared_secret, status
             FROM rfid_devices
             WHERE reader_serial = $1
             LIMIT 1`,
            [readerSerial]
        );
        device = deviceResult.rows[0];
        if (!device || device.status !== 'ACTIVE' || !safeCompareSecret(device.shared_secret, readerKey)) {
            return res.status(403).json({ error: 'RFID event rejected.', code: 'RFID_READER_AUTH_FAILED' });
        }

        const eventInsert = await pool.query(
            `INSERT INTO rfid_events (gym_id, reader_id, tag_id, event_timestamp, payload)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING id`,
            [device.gym_id, device.id, tagId, scannedAt, JSON.stringify(req.body || {})]
        );
        eventId = eventInsert.rows[0]?.id || null;

        await pool.query(
            'UPDATE rfid_devices SET last_heartbeat = NOW(), updated_at = NOW() WHERE id = $1',
            [device.id]
        );

        const memberResult = await pool.query(
            `SELECT id, full_name, phone, email, rfid_tag_id
             FROM members
             WHERE gym_id = $1 AND rfid_tag_id = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [device.gym_id, tagId]
        );
        const member = memberResult.rows[0];
        if (!member) {
            if (eventId) {
                await pool.query(
                    `UPDATE rfid_events
                     SET processed = TRUE, event_status = 'UNKNOWN_TAG', response_message = 'No member is paired to this RFID tag.'
                     WHERE id = $1`,
                    [eventId]
                );
            }
            await writeRfidAuditLog({
                device,
                action: 'RFID_UNKNOWN_TAG',
                targetType: 'RFID_TAG',
                targetId: maskRfidTagId(tagId),
                targetLabel: `RFID tag ending ${maskRfidTagId(tagId)}`,
                details: {
                    event_id: eventId,
                    scanned_at: scannedAt.toISOString(),
                },
            });
            await notifyUnknownRfidAttempt({
                gym_id: device.gym_id,
                reader_name: device.reader_name,
                tag_id: tagId,
            });
            return res.status(404).json({ error: 'RFID event rejected.', code: 'RFID_UNKNOWN_TAG' });
        }

        const result = await processAttendanceCheckin({
            gym_id: device.gym_id,
            member_id: member.id,
            method: 'RFID',
            notes: notes || `RFID reader: ${device.reader_name}`,
            allow_override: false,
            staff_user_id: null,
            duplicateWindowSeconds: RFID_DUPLICATE_WINDOW_SECONDS,
        });

        if (eventId) {
            await pool.query(
                `UPDATE rfid_events
                 SET member_id = $2,
                     member_snapshot = $3::jsonb,
                     processed = TRUE,
                     event_status = 'ACCEPTED',
                     response_message = $4,
                     attendance_record_id = $5
                 WHERE id = $1`,
                [
                    eventId,
                    member.id,
                    JSON.stringify({
                        id: member.id,
                        full_name: member.full_name,
                        phone: member.phone,
                        email: member.email,
                        rfid_tag_id: member.rfid_tag_id || tagId,
                    }),
                    result.message || 'RFID check-in accepted.',
                    result.details?.id || null,
                ]
            );
        }

        await writeRfidAuditLog({
            device,
            action: 'RFID_CHECKIN_ACCEPTED',
            targetType: 'MEMBER',
            targetId: member.id,
            targetLabel: member.full_name,
            details: {
                event_id: eventId,
                attendance_record_id: result.details?.id || null,
                tag_suffix: maskRfidTagId(tagId),
                scanned_at: scannedAt.toISOString(),
            },
        });

        res.json({
            message: result.message,
            member: result.member,
            attendance: result.details,
            reader: {
                id: device.id,
                name: device.reader_name,
                serial: device.reader_serial,
            },
        });
    } catch (err) {
        if (eventId) {
            await pool.query(
                `UPDATE rfid_events
                 SET processed = TRUE,
                     event_status = 'REJECTED',
                     response_message = $2
                 WHERE id = $1`,
                [eventId, err?.payload?.message || err?.payload?.error || err.message || 'RFID event rejected.']
            ).catch(() => {});
        }

        await writeRfidAuditLog({
            device,
            action: 'RFID_CHECKIN_REJECTED',
            targetType: 'RFID_TAG',
            targetId: maskRfidTagId(tagId),
            targetLabel: `RFID tag ending ${maskRfidTagId(tagId)}`,
            details: {
                event_id: eventId,
                status_code: err?.statusCode || 500,
                reason: err?.payload?.message || err?.payload?.error || err.message || 'RFID event rejected.',
                scanned_at: scannedAt.toISOString(),
            },
        });

        return res.status(err?.statusCode || 500).json({
            error: 'RFID event rejected.',
            code: err?.payload?.code || 'RFID_EVENT_REJECTED',
        });
    }
});

// --- 1B. QUICK MEMBER SEARCH FOR CHECK-IN PANEL ---
router.get('/search', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const { branchId } = await resolveBranchReadScope(pool, req);
        const q = String(req.query.q || '').trim();
        if (!q || q.length < 2) return res.json([]);

        const params = [gym_id, `%${q}%`];
        const branchClause = getBranchFilterSql(params, branchId, `COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL})`);

        const result = await pool.query(
            `SELECT
                m.id,
                m.full_name,
                m.phone,
                m.email,
                COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                m.rfid_tag_id,
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
                             ${branchClause}
               AND (m.full_name ILIKE $2 OR m.phone ILIKE $2 OR m.email ILIKE $2)
             ORDER BY m.full_name ASC
             LIMIT 12`,
                        params
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
        const { branchId } = await resolveBranchReadScope(pool, req);
        const gymTimezone = await getGymTimezone(pool, req.user.gym_id);
        const params = [req.user.gym_id, gymTimezone];
        const branchClause = getBranchFilterSql(params, branchId);
        const list = await pool.query(
            `WITH day_bounds AS (
                SELECT
                    (date_trunc('day', timezone($2, NOW())) AT TIME ZONE $2) AS day_start_utc,
                    ((date_trunc('day', timezone($2, NOW())) + INTERVAL '1 day') AT TIME ZONE $2) AS day_end_utc
             )
             SELECT
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
             CROSS JOIN day_bounds db
             JOIN members m ON a.member_id = m.id
             LEFT JOIN users u ON a.staff_user_id = u.id
             WHERE a.gym_id = $1
               AND a.deleted_at IS NULL
               AND m.deleted_at IS NULL
                             ${branchClause}
               AND a.check_in_time >= db.day_start_utc
               AND a.check_in_time < db.day_end_utc
             ORDER BY a.check_in_time DESC`,
                        params
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
        const branchScope = await resolveBranchReadScope(pool, req);
        const member = await ensureScopedMemberAccess(branchScope, req.user.gym_id, member_id);
        if (!member) {
            return res.json([]);
        }
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
        const { branchId } = await resolveBranchReadScope(pool, req);

        const cacheKey = buildCacheKey('attendance', 'summary', gym_id, branchId || 'all');
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const gymTimezone = await getGymTimezone(pool, gym_id);
        const params = [gym_id, gymTimezone];
        const branchClause = getBranchFilterSql(params, branchId, `COALESCE(a.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const result = await pool.query(
            `WITH window_bounds AS (
                SELECT
                    ((date_trunc('day', timezone($2, NOW())) - INTERVAL '6 days') AT TIME ZONE $2) AS range_start_utc,
                    ((date_trunc('day', timezone($2, NOW())) + INTERVAL '1 day') AT TIME ZONE $2) AS range_end_utc
             )
             SELECT
                EXTRACT(HOUR FROM timezone($2, a.check_in_time))::INTEGER AS hour,
                COUNT(*)::INTEGER AS count
             FROM attendance a
             CROSS JOIN window_bounds wb
             WHERE a.gym_id = $1
               AND a.deleted_at IS NULL
                             ${branchClause}
               AND a.check_in_time >= wb.range_start_utc
               AND a.check_in_time < wb.range_end_utc
             GROUP BY EXTRACT(HOUR FROM timezone($2, a.check_in_time))
             ORDER BY hour ASC`,
                        params
        );
        await cacheSet(cacheKey, result.rows, ATTENDANCE_SUMMARY_TTL);
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
        const { branchId } = await resolveBranchReadScope(pool, req);

        const cacheKey = buildCacheKey('attendance', 'overview', gym_id, branchId || 'all');
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const gymTimezone = await getGymTimezone(pool, gym_id);
        const todayParams = [gym_id, gymTimezone];
        const todayBranchClause = getBranchFilterSql(todayParams, branchId, `COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})`);
        const activeParams = [gym_id, gymTimezone];
        const activeBranchClause = getBranchFilterSql(activeParams, branchId, `COALESCE(a.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL})`);

        const [today, yesterday, activeToday, peakHour] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   ${todayBranchClause}
                   AND timezone($2, check_in_time)::date = timezone($2, NOW())::date`,
                todayParams
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   ${todayBranchClause}
                   AND timezone($2, check_in_time)::date = (timezone($2, NOW())::date - 1)`,
                todayParams
            ),
            pool.query(
                `SELECT COUNT(DISTINCT a.member_id)::INTEGER AS count
                 FROM attendance a
                 JOIN members m ON m.id = a.member_id AND m.gym_id = a.gym_id AND m.deleted_at IS NULL
                 JOIN memberships ms ON ms.member_id = a.member_id AND ms.gym_id = a.gym_id
                 WHERE a.gym_id = $1
                   AND a.deleted_at IS NULL
                   AND ms.deleted_at IS NULL
                   ${activeBranchClause}
                   AND timezone($2, a.check_in_time)::date = timezone($2, NOW())::date
                   AND ms.status = 'ACTIVE'`,
                activeParams
            ),
            pool.query(
                `SELECT EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour, COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   ${todayBranchClause}
                   AND timezone($2, check_in_time)::date = timezone($2, NOW())::date
                 GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
                 ORDER BY count DESC
                 LIMIT 1`,
                todayParams
            )
        ]);

        const peak = peakHour.rows[0] || null;
        const overviewResponse = {
            today_checkins: today.rows[0]?.count || 0,
            yesterday_checkins: yesterday.rows[0]?.count || 0,
            active_members_today: activeToday.rows[0]?.count || 0,
            peak_hour_today: peak ? peak.hour : null,
            peak_hour_count: peak ? peak.count : 0
        };
        await cacheSet(cacheKey, overviewResponse, ATTENDANCE_OVERVIEW_TTL);
        res.json(overviewResponse);
    } catch (err) {
        console.error('ATTENDANCE OVERVIEW ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 6. LIVE FEED ---
router.get('/feed', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const { branchId } = await resolveBranchReadScope(pool, req);
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
        const params = [gym_id, limit];
        const branchClause = getBranchFilterSql(params, branchId);

        const result = await pool.query(
            `SELECT
                a.id,
                a.check_in_time,
                a.checkin_method,
                a.checkin_status,
                a.was_override,
                COALESCE(a.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
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
               ${branchClause}
             ORDER BY a.check_in_time DESC
             LIMIT $2`,
            params
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
        const { branchId } = await resolveBranchReadScope(pool, req);
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const range = String(req.query.range || 'today').toLowerCase();
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;
        const paginate = String(req.query.paginate || '').toLowerCase() === 'true' || req.query.page !== undefined || req.query.limit !== undefined;
        const page = Math.max(Number.parseInt(req.query.page || '1', 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '50', 10) || 50, 1), 200);
        const offset = (page - 1) * limit;

        let dateClause = 'timezone($2, a.check_in_time)::date = timezone($2, NOW())::date';
        const params = [gym_id, gymTimezone];

        if (range === 'yesterday') {
            dateClause = `timezone($2, a.check_in_time)::date = (timezone($2, NOW())::date - 1)`;
        } else if (range === 'custom' && from && to) {
            params.push(from, to);
            dateClause = `timezone($2, a.check_in_time)::date BETWEEN $3::date AND $4::date`;
        }

        const branchClause = getBranchFilterSql(params, branchId);

        const query = `
            SELECT
                a.id,
                a.check_in_time,
                a.checkin_method,
                a.checkin_status,
                a.was_override,
                COALESCE(a.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
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
            WHERE a.gym_id = $1 AND a.deleted_at IS NULL AND m.deleted_at IS NULL AND ${dateClause}${branchClause}
            ORDER BY a.check_in_time DESC
            ${paginate ? `LIMIT $${params.length + 1} OFFSET $${params.length + 2}` : 'LIMIT 50'}
        `;

        const result = await pool.query(query, paginate ? [...params, limit, offset] : params);

        if (!paginate) {
            return res.json(result.rows);
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM attendance a
             JOIN members m ON m.id = a.member_id
             WHERE a.gym_id = $1 AND a.deleted_at IS NULL AND m.deleted_at IS NULL AND ${dateClause}${branchClause}`,
            params
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
        console.error('ATTENDANCE RECORDS ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 8. HEATMAP DATA (calendar-style intensity) ---
router.get('/heatmap', auth, saasMiddleware, requirePermission('attendance:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const { branchId } = await resolveBranchReadScope(pool, req);
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const days = Math.min(Math.max(parseInt(req.query.days || '90', 10), 7), 365);
        const params = [gym_id, gymTimezone, days];
        let branchClause = '';

        if (branchId) {
            params.push(branchId);
            branchClause = ` AND COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) = $4`;
        }

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
                  ${branchClause}
                  AND timezone($2, check_in_time)::date >= timezone($2, NOW())::date - ($3::int - 1)
                GROUP BY timezone($2, check_in_time)::date
            ) a ON a.d = ds.d
            ORDER BY ds.d ASC`,
            params
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
        const { branchId } = await resolveBranchReadScope(pool, req);
        const gymTimezone = await getGymTimezone(pool, gym_id);
        const todayOnly = req.query.today === 'true';

        let result;
        if (todayOnly) {
            const params = [gym_id, gymTimezone];
            const branchClause = getBranchFilterSql(params, branchId, `COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})`);
            result = await pool.query(
                `SELECT
                    EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour,
                    COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   ${branchClause}
                   AND timezone($2, check_in_time)::date = timezone($2, NOW())::date
                 GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
                 ORDER BY hour ASC`,
                params
            );
        } else {
            const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 90);
            const params = [gym_id, gymTimezone, days];
            let branchClause = '';

            if (branchId) {
                params.push(branchId);
                branchClause = ` AND COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) = $4`;
            }

            result = await pool.query(
                `SELECT
                    EXTRACT(HOUR FROM timezone($2, check_in_time))::INTEGER AS hour,
                    COUNT(*)::INTEGER AS count
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   ${branchClause}
                   AND check_in_time >= NOW() - ($3::int || ' day')::interval
                 GROUP BY EXTRACT(HOUR FROM timezone($2, check_in_time))
                 ORDER BY hour ASC`,
                params
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
        const { branchId } = await resolveBranchReadScope(pool, req);
        const days = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 120);
        const inactiveBucket = (() => {
            if (days <= 7) {
                return { minDays: 1, maxDays: 7 };
            }
            if (days <= 14) {
                return { minDays: 8, maxDays: 14 };
            }
            return { minDays: 15, maxDays: null };
        })();

        const params = [gym_id, inactiveBucket.minDays, inactiveBucket.maxDays];
        const branchClause = getBranchFilterSql(params, branchId, `COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL})`);

        const result = await pool.query(
            `WITH inactive_pool AS (
                SELECT
                    m.id,
                    m.full_name,
                    m.phone,
                    m.email,
                    COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
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
                                    ${branchClause}
                  AND COALESCE(ms_latest.status, 'UNPAID') = 'ACTIVE'
            )
            SELECT *
            FROM inactive_pool
            WHERE days_inactive >= $2
              AND ($3::int IS NULL OR days_inactive <= $3)
            ORDER BY days_inactive DESC, full_name ASC
            LIMIT 100`,
                        params
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
        const { branchId } = await resolveBranchReadScope(pool, req);
        const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 7), 180);
        const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 3), 50);
        const params = [gym_id, days, limit];
        const branchClause = branchId
            ? (() => {
                params.push(branchId);
                return ` AND COALESCE(a.branch_id, m.branch_id, ${DEFAULT_BRANCH_SQL}) = $4`;
            })()
            : '';

        const result = await pool.query(
            `SELECT
                m.id,
                m.full_name,
                m.profile_pic,
                COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
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
                             ${branchClause}
               AND a.check_in_time >= NOW() - ($2::int || ' day')::interval
               AND COALESCE(ms_latest.status, 'UNPAID') = 'ACTIVE'
             GROUP BY m.id, m.full_name, m.profile_pic
             ORDER BY visits DESC, last_check_in DESC
             LIMIT $3`,
                        params
        );

        res.json(result.rows);
    } catch (err) {
        console.error('ATTENDANCE LEADERBOARD ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;