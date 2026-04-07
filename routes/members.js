const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const {
    createProfileUploadMiddleware,
    cleanupUploadedFile,
    resolveStoredProfileImagePath,
} = require('../utils/profileUploads');
const {
    ensureTrimmedString,
    ensureEmail,
    ensurePhone10,
    ensureInteger,
    ensureDateOnly,
    isValidationError,
    normalizeDigits,
} = require('../utils/fieldValidation');

const getGymIdFromRequest = (req) => {
    const rawGymId = req?.user?.gym_id ?? req?.user?.gymId;
    const gymId = Number.parseInt(rawGymId, 10);
    return Number.isInteger(gymId) ? gymId : null;
};

const uploadProfilePic = createProfileUploadMiddleware({
    prefix: 'member',
    getActorId: (req) => req.params.id || req.user?.id || 'member',
    storageMode: 'inline',
});

const discardUploadedProfile = async (req) => {
    await cleanupUploadedFile(req?.file);
};

const buildPicUrl = (filename) => {
    return `/uploads/profiles/${filename}`;
};

const getStoredProfileValue = (file) => {
    if (!file) return null;
    if (typeof file.inlineDataUrl === 'string' && file.inlineDataUrl) {
        return file.inlineDataUrl;
    }
    return buildPicUrl(file.filename);
};

const memberSchemaCache = new Map();

const getTableColumns = async (tableName) => {
    if (!memberSchemaCache.has(tableName)) {
        const lookup = pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            [tableName]
        ).then((result) => new Set(result.rows.map((row) => row.column_name)));
        memberSchemaCache.set(tableName, lookup);
    }

    return memberSchemaCache.get(tableName);
};

const tableHasColumn = async (tableName, columnName) => {
    const columns = await getTableColumns(tableName);
    return columns.has(columnName);
};

const normalizeDocumentUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
        return raw;
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;

    try {
        const parsed = new URL(withProtocol);
        if (!/^https?:$/i.test(parsed.protocol)) return '';
        return parsed.toString();
    } catch (_err) {
        return '';
    }
};

const normalizeMemberIdentityPayload = (payload = {}) => ({
    full_name: ensureTrimmedString(payload.full_name, { field: 'full_name', required: true, min: 2, max: 100 }),
    email: ensureEmail(payload.email, { field: 'email', required: true, max: 120 }),
    phone: ensurePhone10(payload.phone, { field: 'phone', required: true }),
});

const normalizeMemberDocumentPayload = (payload = {}) => ({
    doc_type: ensureTrimmedString(payload.doc_type, { field: 'doc_type', required: true, max: 60 }),
    doc_name: ensureTrimmedString(payload.doc_name, { field: 'doc_name', max: 120 }),
    notes: ensureTrimmedString(payload.notes, { field: 'notes', max: 1000 }),
});

const normalizeMemberNotePayload = (payload = {}) => ({
    note: ensureTrimmedString(payload.note, { field: 'note', required: true, min: 1, max: 2000 }),
    note_type: ensureTrimmedString(payload.note_type, { field: 'note_type', max: 40, defaultValue: 'general' }) || 'general',
});

const normalizeMemberWaiverPayload = (payload = {}) => ({
    waiver_type: ensureTrimmedString(payload.waiver_type, { field: 'waiver_type', max: 40, defaultValue: 'general' }) || 'general',
    waiver_text: ensureTrimmedString(payload.waiver_text, { field: 'waiver_text', max: 4000, defaultValue: 'Standard gym liability waiver' }) || 'Standard gym liability waiver',
    signature_data: payload.signature_data || null,
});

const normalizeOnboardingPatch = (payload = {}) => {
    const updates = {};

    if (payload.onboarding_complete !== undefined) {
        updates.onboarding_complete = Boolean(payload.onboarding_complete);
    }
    if (payload.emergency_contact !== undefined) {
        updates.emergency_contact = ensureTrimmedString(payload.emergency_contact, { field: 'emergency_contact', max: 120 });
    }
    if (payload.gender !== undefined) {
        updates.gender = ensureTrimmedString(payload.gender, { field: 'gender', max: 20 });
    }
    if (payload.date_of_birth !== undefined) {
        updates.date_of_birth = ensureDateOnly(payload.date_of_birth, { field: 'date_of_birth', allowFuture: false });
    }
    if (payload.address !== undefined) {
        updates.address = ensureTrimmedString(payload.address, { field: 'address', max: 500 });
    }
    if (payload.blood_group !== undefined) {
        updates.blood_group = ensureTrimmedString(payload.blood_group, { field: 'blood_group', max: 20, uppercase: true });
    }
    if (payload.medical_notes !== undefined) {
        updates.medical_notes = ensureTrimmedString(payload.medical_notes, { field: 'medical_notes', max: 2000 });
    }

    return updates;
};

const buildMemberLifecycleStatusCase = (alias) => `
    CASE
        WHEN UPPER(COALESCE(${alias}.membership_status, 'UNPAID')) = 'FROZEN' THEN 'FROZEN'
        WHEN UPPER(COALESCE(${alias}.membership_status, 'UNPAID')) = 'UNPAID' OR ${alias}.plan_name IS NULL THEN 'UNPAID'
        WHEN COALESCE(${alias}.days_left, 0) <= 0 THEN 'EXPIRED'
        WHEN COALESCE(${alias}.days_left, 0) <= 7 THEN 'EXPIRING SOON'
        WHEN CURRENT_DATE - COALESCE(COALESCE(${alias}.latest_payment_date::date, ${alias}.joining_date::date), CURRENT_DATE) <= 14 THEN 'ACTIVE'
        WHEN CURRENT_DATE - COALESCE(COALESCE(${alias}.last_visit::date, ${alias}.latest_payment_date::date, ${alias}.joining_date::date), CURRENT_DATE) > 14 THEN 'INACTIVE'
        ELSE 'ACTIVE'
    END
`;

const buildMemberBaseQuery = ({ includeSearch = false } = {}) => `
    WITH member_base AS (
        SELECT
            m.id,
            m.full_name,
            m.email,
            m.phone,
            m.joining_date,
            m.profile_pic,
            m.last_visit
        FROM members m
        WHERE m.gym_id = $1
          AND m.deleted_at IS NULL
          ${includeSearch ? `
          AND (
                m.full_name ILIKE $2
             OR m.email ILIKE $2
             OR m.phone ILIKE $2
          )` : ''}
    ),
    payment_totals AS (
        SELECT
            p.user_id AS member_id,
            COALESCE(SUM(p.amount_paid), 0) AS total_paid,
            MAX(p.payment_date) AS latest_payment_date
        FROM payments p
        INNER JOIN member_base mb ON mb.id = p.user_id
        WHERE p.gym_id = $1
          AND p.deleted_at IS NULL
        GROUP BY p.user_id
    ),
    latest_membership AS (
        SELECT
            ranked.member_id,
            ranked.status,
            ranked.end_date,
            ranked.plan_name,
            ranked.freeze_start_date,
            ranked.freeze_end_date,
            ranked.freeze_reason
        FROM (
            SELECT
                ms.member_id,
                ms.status,
                ms.end_date,
                p.name AS plan_name,
                ms.freeze_start_date,
                ms.freeze_end_date,
                ms.freeze_reason,
                ROW_NUMBER() OVER (
                    PARTITION BY ms.member_id
                    ORDER BY ms.end_date DESC, ms.id DESC
                ) AS row_number
            FROM memberships ms
            LEFT JOIN plans p ON p.id = ms.plan_id
            INNER JOIN member_base mb ON mb.id = ms.member_id
            WHERE ms.gym_id = $1
              AND ms.deleted_at IS NULL
        ) ranked
        WHERE ranked.row_number = 1
    )
    SELECT
        mb.id,
        mb.full_name,
        mb.email,
        mb.phone,
        mb.joining_date,
        mb.profile_pic,
        mb.last_visit,
        COALESCE(lm.status, 'UNPAID') AS membership_status,
        CASE
            WHEN lm.end_date IS NULL THEN 0
            ELSE GREATEST(0, (lm.end_date::date - CURRENT_DATE::date))
        END AS days_left,
        COALESCE(pt.total_paid, 0) AS total_paid,
        pt.latest_payment_date,
        lm.plan_name,
        lm.end_date AS expiry_date,
        lm.freeze_start_date,
        lm.freeze_end_date,
        lm.freeze_reason
    FROM member_base mb
    LEFT JOIN latest_membership lm ON lm.member_id = mb.id
    LEFT JOIN payment_totals pt ON pt.member_id = mb.id
`;

// --- 1. GET ALL MEMBERS ---
router.get('/', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const page = Math.max(parseInt(req.query.page || '1', 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10), 1), 200);
        const offset = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const status = String(req.query.status || '').trim().toUpperCase();
        const paginate = String(req.query.paginate || '').toLowerCase() === 'true' || req.query.page !== undefined || req.query.limit !== undefined;

        const queryParams = [gym_id];
        if (search) {
            queryParams.push(`%${search}%`);
        }

        const baseQuery = buildMemberBaseQuery({ includeSearch: Boolean(search) });

        const labeledQuery = `
            SELECT members_base.*, ${buildMemberLifecycleStatusCase('members_base')} AS member_lifecycle_status
            FROM (${baseQuery}) members_base
        `;

        const filteredParams = [...queryParams];
        let filteredQuery = labeledQuery;

        if (status && status !== 'ALL') {
            filteredParams.push(status);
            filteredQuery = `
                SELECT *
                FROM (${labeledQuery}) filtered_members
                WHERE member_lifecycle_status = $${filteredParams.length}
            `;
        }

        const orderedQuery = `${filteredQuery} ORDER BY id DESC`;

        if (!paginate) {
            const result = await pool.query(orderedQuery, filteredParams);
            return res.json(result.rows);
        }

        const pagedParams = [...filteredParams, limit, offset];
        const pagedResult = await pool.query(`${orderedQuery} LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`, pagedParams);
        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total FROM (${filteredQuery}) counted_members`,
            filteredParams
        );

        const total = countResult.rows[0]?.total || 0;

        return res.json({
            items: pagedResult.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                hasNext: page * limit < total,
                hasPrev: page > 1
            }
        });

    } catch (err) {
        console.error("MEMBER LIST ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

router.get('/summary', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const result = await pool.query(
            `SELECT
                COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (WHERE member_lifecycle_status = 'ACTIVE')::INTEGER AS active,
                COUNT(*) FILTER (WHERE member_lifecycle_status = 'INACTIVE')::INTEGER AS inactive,
                COUNT(*) FILTER (WHERE member_lifecycle_status = 'EXPIRING SOON')::INTEGER AS expiring_soon,
                COUNT(*) FILTER (WHERE member_lifecycle_status = 'EXPIRED')::INTEGER AS expired,
                COUNT(*) FILTER (WHERE member_lifecycle_status = 'UNPAID')::INTEGER AS unpaid,
                COUNT(*) FILTER (WHERE member_lifecycle_status = 'FROZEN')::INTEGER AS frozen
             FROM (
                SELECT ${buildMemberLifecycleStatusCase('members_base')} AS member_lifecycle_status
                FROM (
                    ${buildMemberBaseQuery()}
                ) members_base
             ) member_summary`,
            [gym_id]
        );

        return res.json(result.rows[0] || {
            total: 0,
            active: 0,
            inactive: 0,
            expiring_soon: 0,
            expired: 0,
            unpaid: 0,
            frozen: 0,
        });
    } catch (err) {
        console.error('MEMBER SUMMARY ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/options', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const search = String(req.query.search || '').trim();
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 50);
        const params = [gym_id];
        let whereClause = 'WHERE gym_id = $1 AND deleted_at IS NULL';

        if (search) {
            params.push(`%${search}%`);
            whereClause += ` AND (full_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`;
        }

        params.push(limit);
        const result = await pool.query(
            `SELECT id, full_name, phone, email, profile_pic
             FROM members
             ${whereClause}
             ORDER BY last_visit DESC NULLS LAST, id DESC
             LIMIT $${params.length}`,
            params
        );

        return res.json(result.rows);
    } catch (err) {
        console.error('MEMBER OPTIONS ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

// --- 2. GET SINGLE MEMBER ---
router.get('/:id', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const result = await pool.query(`
            SELECT
                m.*,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                CASE
                    WHEN ms_latest.end_date IS NULL THEN 0
                    ELSE GREATEST(0, (ms_latest.end_date::date - CURRENT_DATE::date))
                END AS days_left,
                ms_latest.plan_name,
                ms_latest.end_date AS expiry_date,
                COALESCE((SELECT SUM(amount_paid) FROM payments WHERE user_id = m.id AND gym_id = $2 AND deleted_at IS NULL), 0) AS total_paid,
                (
                    SELECT MAX(pay.payment_date)
                    FROM payments pay WHERE pay.user_id = m.id AND gym_id = $2 AND pay.deleted_at IS NULL
                ) AS latest_payment_date,
                COALESCE((
                    SELECT json_agg(pay ORDER BY pay.payment_date DESC)
                    FROM payments pay WHERE pay.user_id = m.id AND gym_id = $2 AND pay.deleted_at IS NULL
                ), '[]') AS payment_history
            FROM members m
            LEFT JOIN LATERAL (
                SELECT ms.status, ms.end_date, p.name AS plan_name, ms.freeze_start_date, ms.freeze_end_date, ms.freeze_reason
                FROM memberships ms
                LEFT JOIN plans p ON ms.plan_id = p.id
                WHERE ms.member_id = m.id AND ms.gym_id = $2 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC, ms.id DESC
                LIMIT 1
            ) ms_latest ON true
            WHERE m.id = $1 AND m.gym_id = $2 AND m.deleted_at IS NULL
        `, [req.params.id, gym_id]);

        if (result.rows.length === 0) return res.status(404).json({ error: "Member not found" });
        res.json(result.rows[0]);
   } catch (err) {
        console.error("ADD MEMBER ERROR:", err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: "This email is already registered to a member in YOUR gym." });
        }
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 3. ADD MEMBER ---
router.post('/add', auth, saasMiddleware, requirePermission('members:write'), uploadProfilePic, async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const gym_id = getGymIdFromRequest(req);
        const normalizedIdentity = normalizeMemberIdentityPayload(payload);

        if (!gym_id) {
            await discardUploadedProfile(req);
            return res.status(401).json({ error: 'Invalid session. Please login again.' });
        }

        const profile_pic = getStoredProfileValue(req.file);

        const existingPhone = await pool.query(
            'SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1',
            [gym_id, normalizedIdentity.phone]
        );
        if (existingPhone.rows.length > 0) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'This phone is already registered in your gym.' });
        }

        const existingEmail = await pool.query(
            'SELECT id FROM members WHERE gym_id = $1 AND lower(email) = $2 AND deleted_at IS NULL LIMIT 1',
            [gym_id, normalizedIdentity.email]
        );
        if (existingEmail.rows.length > 0) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'This email is already registered in your gym.' });
        }

        const newMember = await pool.query(
            `INSERT INTO members (full_name, email, phone, profile_pic, gym_id, joining_date, last_visit, status)
             VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, NULL, 'UNPAID')
             RETURNING *`,
            [normalizedIdentity.full_name, normalizedIdentity.email, normalizedIdentity.phone, profile_pic, gym_id]
        );

        res.json(newMember.rows[0]);
    } catch (err) {
        console.error("ADD MEMBER ERROR:", err.message);
        await discardUploadedProfile(req);
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (err.code === '23505') {
            return res.status(400).json({ error: "This email or phone is already registered to another member." });
        }
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. UPDATE MEMBER ---
router.put('/:id', auth, saasMiddleware, requirePermission('members:write'), uploadProfilePic, async (req, res) => {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const gym_id = getGymIdFromRequest(req);
    let memberId;
    let normalizedIdentity;

    try {
        memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        normalizedIdentity = normalizeMemberIdentityPayload(payload);
    } catch (err) {
        await discardUploadedProfile(req);
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        throw err;
    }

    if (!gym_id) {
        await discardUploadedProfile(req);
        return res.status(401).json({ error: 'Invalid session. Please login again.' });
    }

    try {
        const currentMemberResult = await pool.query(
            'SELECT id, email, phone, profile_pic FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
            [memberId, gym_id]
        );
        if (currentMemberResult.rows.length === 0) {
            await discardUploadedProfile(req);
            return res.status(404).json({ error: 'Member not found.' });
        }

        const currentMember = currentMemberResult.rows[0];
        const currentPhone = normalizeDigits(currentMember.phone);
        const currentEmail = String(currentMember.email || '').trim().toLowerCase();

        if (normalizedIdentity.phone !== currentPhone) {
            const existingPhone = await pool.query(
                'SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1',
                [gym_id, normalizedIdentity.phone, memberId]
            );
            if (existingPhone.rows.length > 0) {
                await discardUploadedProfile(req);
                return res.status(400).json({ error: 'This phone is already registered in your gym.' });
            }
        }

        if (normalizedIdentity.email !== currentEmail) {
            const existingEmail = await pool.query(
                'SELECT id FROM members WHERE gym_id = $1 AND lower(email) = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1',
                [gym_id, normalizedIdentity.email, memberId]
            );
            if (existingEmail.rows.length > 0) {
                await discardUploadedProfile(req);
                return res.status(400).json({ error: 'This email is already registered in your gym.' });
            }
        }

        if (req.file) {
            const profile_pic = getStoredProfileValue(req.file);
            const updateResult = await pool.query(
                "UPDATE members SET full_name = $1, email = $2, phone = $3, profile_pic = $4 WHERE id = $5 AND gym_id = $6 AND deleted_at IS NULL",
                [normalizedIdentity.full_name, normalizedIdentity.email, normalizedIdentity.phone, profile_pic, memberId, gym_id]
            );
            if (updateResult.rowCount === 0) {
                await discardUploadedProfile(req);
                return res.status(404).json({ error: 'Member not found.' });
            }

            const previousProfilePath = resolveStoredProfileImagePath(currentMember.profile_pic);
            if (previousProfilePath && previousProfilePath !== req.file.path) {
                await cleanupUploadedFile(previousProfilePath);
            }
        } else {
            const updateResult = await pool.query(
                "UPDATE members SET full_name = $1, email = $2, phone = $3 WHERE id = $4 AND gym_id = $5 AND deleted_at IS NULL",
                [normalizedIdentity.full_name, normalizedIdentity.email, normalizedIdentity.phone, memberId, gym_id]
            );
            if (updateResult.rowCount === 0) {
                await discardUploadedProfile(req);
                return res.status(404).json({ error: 'Member not found.' });
            }
        }
        res.json({ message: "Member updated" });
    } catch (err) {
        console.error("UPDATE MEMBER ERROR:", err.message);
        await discardUploadedProfile(req);
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        if (err.code === '23505') {
            const detail = String(err.detail || '').toLowerCase();
            if (detail.includes('(email)')) {
                return res.status(400).json({ error: 'This email is already registered in your gym.' });
            }
            if (detail.includes('(phone)')) {
                return res.status(400).json({ error: 'This phone is already registered in your gym.' });
            }
            return res.status(400).json({ error: 'This email or phone is already registered in your gym.' });
        }
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- 5. MANUAL CHECK-IN ---
router.put('/:id/check-in', auth, saasMiddleware, requirePermission('attendance:write'), async (req, res) => {
    const gym_id = req.user.gym_id;
    try {
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const member = await pool.query(
            `SELECT
                m.id,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status
             FROM members m
             LEFT JOIN LATERAL (
                SELECT ms.status
                FROM memberships ms
                WHERE ms.member_id = m.id AND ms.gym_id = m.gym_id AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC, ms.id DESC
                LIMIT 1
             ) ms_latest ON TRUE
             WHERE m.id = $1 AND m.gym_id = $2 AND m.deleted_at IS NULL`,
            [memberId, gym_id]
        );
        if(member.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        const membershipStatus = String(member.rows[0].membership_status || 'UNPAID').toUpperCase();
        if (membershipStatus !== 'ACTIVE') {
            return res.status(403).json({ error: `Access Denied: Membership is ${membershipStatus}` });
        }

        await pool.query(
            "INSERT INTO attendance (gym_id, member_id, check_in_time) VALUES ($1, $2, NOW())",
            [gym_id, memberId]
        );
        await pool.query(
            "UPDATE members SET last_visit = NOW() WHERE id = $1 AND gym_id = $2",
            [memberId, gym_id]
        );
        res.json({ message: "Member Checked In" });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("CHECK-IN ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 6. DELETE MEMBER ---
router.delete('/:id', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    let client;
    try {
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        client = await pool.connect();

        const check = await client.query('SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL', [memberId, gym_id]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        await client.query('BEGIN');
        await client.query('UPDATE payments    SET deleted_at = NOW() WHERE user_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [memberId, gym_id]);
        await client.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [memberId, gym_id]);
        await client.query('UPDATE attendance  SET deleted_at = NOW() WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [memberId, gym_id]);
        await client.query("UPDATE members     SET deleted_at = NOW(), status = 'UNPAID' WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL", [memberId, gym_id]);
        await client.query('COMMIT');
        res.json({ message: "Member archived" });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("DELETE MEMBER ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// --- 7. CANCEL MEMBER ---
router.post('/:id/cancel', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    let client;
    try {
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const cancellationReason = ensureTrimmedString(req.body?.cancellation_reason, { field: 'cancellation_reason', max: 500 }) || null;
        client = await pool.connect();

        const check = await client.query('SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL', [memberId, gym_id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Member not found' });
        await client.query('BEGIN');
        await client.query(
            `UPDATE members SET status='CANCELLED', cancellation_reason=$3, cancelled_at=NOW() WHERE id=$1 AND gym_id=$2`,
            [memberId, gym_id, cancellationReason]
        );
        await client.query(
            `UPDATE memberships SET status='CANCELLED', cancellation_reason=$3, cancelled_at=NOW() WHERE member_id=$1 AND gym_id=$2 AND deleted_at IS NULL AND status IN ('ACTIVE','FROZEN')`,
            [memberId, gym_id, cancellationReason]
        );
        await client.query('COMMIT');
        res.json({ message: 'Member cancelled' });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('CANCEL MEMBER ERROR:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// --- 8. TRANSFER MEMBER ---
router.post('/:id/transfer', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    let client;
    try {
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const gym_id = req.user.gym_id;
        const transferToMemberId = ensureInteger(req.body?.transfer_to_member_id, { field: 'transfer_to_member_id', required: true, min: 1 });
        const notes = ensureTrimmedString(req.body?.notes, { field: 'notes', max: 1000 });

        if (memberId === transferToMemberId) {
            return res.status(400).json({ error: 'transfer_to_member_id must be different from the source member.' });
        }

        client = await pool.connect();
        const [src, dst] = await Promise.all([
            client.query('SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL', [memberId, gym_id]),
            client.query('SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL', [transferToMemberId, gym_id]),
        ]);
        if (!src.rows.length) return res.status(404).json({ error: 'Source member not found' });
        if (!dst.rows.length) return res.status(404).json({ error: 'Destination member not found' });
        await client.query('BEGIN');
        const ms = await client.query(
            `SELECT id, plan_id, start_date, end_date FROM memberships
             WHERE member_id=$1 AND gym_id=$2 AND deleted_at IS NULL AND status IN ('ACTIVE','FROZEN')
             ORDER BY end_date DESC LIMIT 1`, [memberId, gym_id]);
        if (!ms.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No active membership to transfer' }); }
        const old = ms.rows[0];
        await client.query(`UPDATE memberships SET status='TRANSFERRED', cancelled_at=NOW(), transfer_id=$3 WHERE id=$1 AND gym_id=$2`, [old.id, gym_id, transferToMemberId]);
        await client.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status, amount_paid, total_amount)
             SELECT $1, $2, plan_id, NOW(), end_date, 'ACTIVE', amount_paid, total_amount FROM memberships WHERE id=$3`,
            [gym_id, transferToMemberId, old.id]);
        await client.query(`UPDATE members SET transfer_status='TRANSFERRED' WHERE id=$1 AND gym_id=$2`, [memberId, gym_id]);
        await client.query('COMMIT');
        res.json({ message: 'Membership transferred', notes });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('TRANSFER MEMBER ERROR:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// --- 9. MEMBER DOCUMENTS ---
router.get('/:id/documents', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        const [hasNotesColumn, hasUploadedAtColumn] = await Promise.all([
            tableHasColumn('member_documents', 'notes'),
            tableHasColumn('member_documents', 'uploaded_at'),
        ]);
        const notesSelect = hasNotesColumn ? 'md.notes' : 'NULL';
        const uploadedAtSelect = hasUploadedAtColumn ? 'md.uploaded_at' : 'md.created_at';
        const result = await pool.query(
            `SELECT md.*, ${notesSelect} AS notes, ${uploadedAtSelect} AS uploaded_at
             FROM member_documents md
             WHERE md.member_id = $1 AND md.gym_id = $2
             ORDER BY ${uploadedAtSelect} DESC`,
            [req.params.id, gid]
        );
        res.json(result.rows);
    } catch(err) { console.error('GET DOCS:', err.message); res.status(500).json({ error: 'Server error' }); }
});
router.post('/:id/documents', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const payload = normalizeMemberDocumentPayload(req.body || {});
        const normalizedDocUrl = normalizeDocumentUrl(req.body?.doc_url);
        if (!normalizedDocUrl) {
            return res.status(400).json({ error: 'doc_type and a valid document are required' });
        }
        const [hasNotesColumn, hasDocNameColumn, hasUploadedByColumn] = await Promise.all([
            tableHasColumn('member_documents', 'notes'),
            tableHasColumn('member_documents', 'doc_name'),
            tableHasColumn('member_documents', 'uploaded_by'),
        ]);
        const columns = ['gym_id', 'member_id', 'doc_type', 'doc_url'];
        const values = [gid, memberId, payload.doc_type, normalizedDocUrl];
        if (hasNotesColumn) {
            columns.push('notes');
            values.push(payload.notes || null);
        }
        if (hasDocNameColumn) {
            columns.push('doc_name');
            values.push(payload.doc_name || payload.doc_type);
        }
        if (hasUploadedByColumn) {
            columns.push('uploaded_by');
            values.push(req.user?.id || null);
        }
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const result = await pool.query(
            `INSERT INTO member_documents (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            values
        );
        res.status(201).json(result.rows[0]);
    } catch(err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('ADD DOC:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});
router.delete('/:mid/documents/:did', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        await pool.query('DELETE FROM member_documents WHERE id=$1 AND member_id=$2 AND gym_id=$3', [req.params.did, req.params.mid, gid]);
        res.json({ message: 'Document deleted' });
    } catch(err) { console.error('DEL DOC:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// --- 10. MEMBER NOTES ---
router.get('/:id/notes', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        const result = await pool.query(
            `SELECT mn.*, u.full_name as author_name FROM member_notes mn
             LEFT JOIN users u ON u.id = mn.created_by
             WHERE mn.member_id=$1 AND mn.gym_id=$2 ORDER BY mn.created_at DESC`, [req.params.id, gid]);
        res.json(result.rows);
    } catch(err) { console.error('GET NOTES:', err.message); res.status(500).json({ error: 'Server error' }); }
});
router.post('/:id/notes', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const payload = normalizeMemberNotePayload(req.body || {});
        const hasNoteTypeColumn = await tableHasColumn('member_notes', 'note_type');
        const columns = ['gym_id', 'member_id', 'created_by', 'note'];
        const values = [gid, memberId, req.user.id, payload.note];
        if (hasNoteTypeColumn) {
            columns.push('note_type');
            values.push(payload.note_type);
        }
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const result = await pool.query(
            `INSERT INTO member_notes (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            values
        );
        res.status(201).json(result.rows[0]);
    } catch(err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('ADD NOTE:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});
router.delete('/:mid/notes/:nid', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        await pool.query('DELETE FROM member_notes WHERE id=$1 AND member_id=$2 AND gym_id=$3', [req.params.nid, req.params.mid, gid]);
        res.json({ message: 'Note deleted' });
    } catch(err) { console.error('DEL NOTE:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// --- 11. MEMBER WAIVERS ---
router.post('/:id/waiver', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    let client;
    try {
        const gid = req.user.gym_id;
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const payload = normalizeMemberWaiverPayload(req.body || {});
        client = await pool.connect();
        const [hasWaiverTypeColumn, hasSignatureColumn, hasIpAddressColumn] = await Promise.all([
            tableHasColumn('member_waivers', 'waiver_type'),
            tableHasColumn('member_waivers', 'signature_data'),
            tableHasColumn('member_waivers', 'ip_address'),
        ]);
        const columns = ['gym_id', 'member_id', 'waiver_text'];
        const values = [gid, memberId, payload.waiver_text];
        const pushValue = (column, value) => {
            columns.push(column);
            values.push(value);
        };
        if (hasWaiverTypeColumn) {
            pushValue('waiver_type', payload.waiver_type);
        }
        if (hasSignatureColumn) {
            pushValue('signature_data', payload.signature_data);
        }
        if (hasIpAddressColumn) {
            pushValue('ip_address', String(req.ip || '').slice(0, 60));
        }
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

        await client.query('BEGIN');
        await client.query(
            `INSERT INTO member_waivers (${columns.join(', ')}, signed_at) VALUES (${placeholders}, NOW())`,
            values
        );
        await client.query('UPDATE members SET waiver_signed_at=NOW() WHERE id=$1 AND gym_id=$2', [memberId, gid]);
        await client.query('COMMIT');
        res.json({ message: 'Waiver signed' });
    } catch(err) {
        try {
            if (client) {
                await client.query('ROLLBACK');
            }
        } catch (_rollbackErr) {
            // ignore rollback errors after failed inserts
        }
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('WAIVER:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});
router.get('/:id/waivers', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        const result = await pool.query('SELECT * FROM member_waivers WHERE member_id=$1 AND gym_id=$2 ORDER BY signed_at DESC', [req.params.id, gid]);
        res.json(result.rows);
    } catch(err) { console.error('GET WAIVERS:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// --- 12. UPDATE ONBOARDING ---
router.patch('/:id/onboarding', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    try {
        const gid = req.user.gym_id;
        const memberId = ensureInteger(req.params.id, { field: 'member id', required: true, min: 1 });
        const payload = normalizeOnboardingPatch(req.body || {});
        const updates = [];
        const vals = [];
        let idx = 3;
        if (payload.onboarding_complete !== undefined) { updates.push(`onboarding_complete=$${idx++}`); vals.push(payload.onboarding_complete); }
        if (payload.emergency_contact !== undefined) { updates.push(`emergency_contact=$${idx++}`); vals.push(payload.emergency_contact); }
        if (payload.gender !== undefined) { updates.push(`gender=$${idx++}`); vals.push(payload.gender); }
        if (payload.date_of_birth !== undefined) { updates.push(`date_of_birth=$${idx++}`); vals.push(payload.date_of_birth || null); }
        if (payload.address !== undefined) { updates.push(`address=$${idx++}`); vals.push(payload.address); }
        if (payload.blood_group !== undefined) { updates.push(`blood_group=$${idx++}`); vals.push(payload.blood_group); }
        if (payload.medical_notes !== undefined) { updates.push(`medical_notes=$${idx++}`); vals.push(payload.medical_notes); }
        if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
        const result = await pool.query(
            `UPDATE members SET ${updates.join(', ')} WHERE id=$1 AND gym_id=$2 RETURNING *`,
            [memberId, gid, ...vals]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Member not found' });
        res.json(result.rows[0]);
    } catch(err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('ONBOARDING:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;