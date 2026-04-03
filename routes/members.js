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

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const isValidPhone = (value) => /^\d{10}$/.test(value);

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

// --- 1. GET ALL MEMBERS ---
router.get('/', auth, saasMiddleware, requirePermission('members:read'), async (req, res) => {
    try {
        const gym_id = req.user.gym_id;
        const page = Math.max(parseInt(req.query.page || '1', 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10), 1), 200);
        const offset = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const status = String(req.query.status || '').trim().toUpperCase();
        const paginate = String(req.query.paginate || '').toLowerCase() === 'true';

        const queryParams = [gym_id];
        let whereClause = 'WHERE m.gym_id = $1 AND m.deleted_at IS NULL';

        if (search) {
            queryParams.push(`%${search}%`);
            whereClause += ` AND (m.full_name ILIKE $${queryParams.length} OR m.email ILIKE $${queryParams.length} OR m.phone ILIKE $${queryParams.length})`;
        }

        if (status) {
            queryParams.push(status);
            whereClause += ` AND COALESCE(ms_latest.status, 'UNPAID') = $${queryParams.length}`;
        }

        const baseQuery = `
            SELECT
                m.id,
                m.full_name,
                m.email,
                m.phone,
                m.joining_date,
                m.profile_pic,
                m.last_visit,
                COALESCE(ms_latest.status, 'UNPAID') AS membership_status,
                CASE
                    WHEN ms_latest.end_date IS NULL THEN 0
                    ELSE GREATEST(0, (ms_latest.end_date::date - CURRENT_DATE::date))
                END AS days_left,
                COALESCE((
                    SELECT SUM(amount_paid) FROM payments WHERE user_id = m.id AND gym_id = $1 AND deleted_at IS NULL
                ), 0) AS total_paid,
                COALESCE((
                    SELECT json_agg(pay ORDER BY pay.payment_date DESC)
                    FROM payments pay WHERE pay.user_id = m.id AND gym_id = $1 AND pay.deleted_at IS NULL
                ), '[]') AS payment_history,
                ms_latest.plan_name,
                ms_latest.end_date AS expiry_date,
                ms_latest.freeze_start_date,
                ms_latest.freeze_end_date,
                ms_latest.freeze_reason
            FROM members m
            LEFT JOIN LATERAL (
                SELECT ms.status, ms.end_date, p.name AS plan_name, ms.freeze_start_date, ms.freeze_end_date, ms.freeze_reason
                FROM memberships ms
                LEFT JOIN plans p ON ms.plan_id = p.id
                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC, ms.id DESC
                LIMIT 1
            ) ms_latest ON true
            ${whereClause}
            ORDER BY m.id DESC`;

        if (!paginate) {
            const result = await pool.query(baseQuery, queryParams);
            return res.json(result.rows);
        }

        const pagedParams = [...queryParams, limit, offset];
        const pagedResult = await pool.query(`${baseQuery} LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`, pagedParams);

        // Count query must mirror the exact same WHERE clause (including status filter)
        // so pagination totals are accurate when filtering by membership status.
        const countParams = [gym_id];
        let countWhere = 'WHERE m.gym_id = $1 AND m.deleted_at IS NULL';

        if (search) {
            countParams.push(`%${search}%`);
            countWhere += ` AND (m.full_name ILIKE $${countParams.length} OR m.email ILIKE $${countParams.length} OR m.phone ILIKE $${countParams.length})`;
        }

        if (status) {
            countParams.push(status);
            countWhere += ` AND COALESCE(ms_count.status, 'UNPAID') = $${countParams.length}`;
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM members m
             LEFT JOIN LATERAL (
                 SELECT ms.status
                 FROM memberships ms
                 WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                 ORDER BY ms.end_date DESC
                 LIMIT 1
             ) ms_count ON true
             ${countWhere}`,
            countParams
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
        const full_name = payload.full_name;
        const email = payload.email;
        const phone = payload.phone;
        const gym_id = getGymIdFromRequest(req);
        const normalizedPhone = normalizePhone(phone);
        const normalizedName = String(full_name || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();

        if (!gym_id) {
            await discardUploadedProfile(req);
            return res.status(401).json({ error: 'Invalid session. Please login again.' });
        }
        if (!normalizedName || !normalizedEmail || !normalizedPhone) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'full_name, email and phone are required.' });
        }
        if (!isValidPhone(normalizedPhone)) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'Phone must be exactly 10 digits.' });
        }

        const profile_pic = getStoredProfileValue(req.file);

        const existingPhone = await pool.query(
            'SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1',
            [gym_id, normalizedPhone]
        );
        if (existingPhone.rows.length > 0) {
            await discardUploadedProfile(req);
            return res.status(400).json({ error: 'This phone is already registered in your gym.' });
        }

        const newMember = await pool.query(
            `INSERT INTO members (full_name, email, phone, profile_pic, gym_id, joining_date, last_visit, status)
             VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, NULL, 'UNPAID')
             RETURNING *`,
            [normalizedName, normalizedEmail, normalizedPhone, profile_pic, gym_id]
        );

        res.json(newMember.rows[0]);
    } catch (err) {
        console.error("ADD MEMBER ERROR:", err.message);
        await discardUploadedProfile(req);
        if (err.code === '23505') {
            return res.status(400).json({ error: "This email or phone is already registered to another member." });
        }
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. UPDATE MEMBER ---
router.put('/:id', auth, saasMiddleware, requirePermission('members:write'), uploadProfilePic, async (req, res) => {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const full_name = payload.full_name;
    const email = payload.email;
    const phone = payload.phone;
    const normalizedPhone = normalizePhone(phone);
    const normalizedName = String(full_name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const gym_id = getGymIdFromRequest(req);
    const memberId = Number.parseInt(req.params.id, 10);

    if (!gym_id) {
        await discardUploadedProfile(req);
        return res.status(401).json({ error: 'Invalid session. Please login again.' });
    }
    if (!Number.isInteger(memberId)) {
        await discardUploadedProfile(req);
        return res.status(400).json({ error: 'Invalid member id.' });
    }
    if (!normalizedName || !normalizedEmail || !normalizedPhone) {
        await discardUploadedProfile(req);
        return res.status(400).json({ error: 'full_name, email and phone are required.' });
    }
    if (!isValidPhone(normalizedPhone)) {
        await discardUploadedProfile(req);
        return res.status(400).json({ error: 'Phone must be exactly 10 digits.' });
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
        const currentPhone = normalizePhone(currentMember.phone);
        const currentEmail = String(currentMember.email || '').trim().toLowerCase();

        if (normalizedPhone !== currentPhone) {
            const existingPhone = await pool.query(
                'SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1',
                [gym_id, normalizedPhone, memberId]
            );
            if (existingPhone.rows.length > 0) {
                await discardUploadedProfile(req);
                return res.status(400).json({ error: 'This phone is already registered in your gym.' });
            }
        }

        if (normalizedEmail !== currentEmail) {
            const existingEmail = await pool.query(
                'SELECT id FROM members WHERE gym_id = $1 AND lower(email) = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1',
                [gym_id, normalizedEmail, memberId]
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
                [normalizedName, normalizedEmail, normalizedPhone, profile_pic, memberId, gym_id]
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
                [normalizedName, normalizedEmail, normalizedPhone, memberId, gym_id]
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
            [req.params.id, gym_id]
        );
        if(member.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        const membershipStatus = String(member.rows[0].membership_status || 'UNPAID').toUpperCase();
        if (membershipStatus !== 'ACTIVE') {
            return res.status(403).json({ error: `Access Denied: Membership is ${membershipStatus}` });
        }

        await pool.query(
            "INSERT INTO attendance (gym_id, member_id, check_in_time) VALUES ($1, $2, NOW())",
            [gym_id, req.params.id]
        );
        await pool.query(
            "UPDATE members SET last_visit = NOW() WHERE id = $1 AND gym_id = $2",
            [req.params.id, gym_id]
        );
        res.json({ message: "Member Checked In" });
    } catch (err) {
        console.error("CHECK-IN ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 6. DELETE MEMBER ---
router.delete('/:id', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    const memberId = req.params.id;
    const gym_id = req.user.gym_id;
    try {
        const check = await pool.query('SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL', [memberId, gym_id]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        await pool.query('BEGIN');
        await pool.query('UPDATE payments    SET deleted_at = NOW() WHERE user_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [memberId, gym_id]);
        await pool.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [memberId, gym_id]);
        await pool.query('UPDATE attendance  SET deleted_at = NOW() WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL', [memberId, gym_id]);
        await pool.query("UPDATE members     SET deleted_at = NOW(), status = 'UNPAID' WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL", [memberId, gym_id]);
        await pool.query('COMMIT');
        res.json({ message: "Member archived" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("DELETE MEMBER ERROR:", err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 7. CANCEL MEMBER ---
router.post('/:id/cancel', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    const memberId = req.params.id;
    const gym_id = req.user.gym_id;
    const { cancellation_reason } = req.body || {};
    try {
        const check = await pool.query('SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL', [memberId, gym_id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Member not found' });
        await pool.query('BEGIN');
        await pool.query(
            `UPDATE members SET status='CANCELLED', cancellation_reason=$3, cancelled_at=NOW() WHERE id=$1 AND gym_id=$2`,
            [memberId, gym_id, String(cancellation_reason || '').trim() || null]
        );
        await pool.query(
            `UPDATE memberships SET status='CANCELLED', cancellation_reason=$3, cancelled_at=NOW() WHERE member_id=$1 AND gym_id=$2 AND deleted_at IS NULL AND status IN ('ACTIVE','FROZEN')`,
            [memberId, gym_id, String(cancellation_reason || '').trim() || null]
        );
        await pool.query('COMMIT');
        res.json({ message: 'Member cancelled' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('CANCEL MEMBER ERROR:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 8. TRANSFER MEMBER ---
router.post('/:id/transfer', auth, saasMiddleware, requirePermission('members:write'), async (req, res) => {
    const memberId = req.params.id;
    const gym_id = req.user.gym_id;
    const { transfer_to_member_id, notes } = req.body || {};
    if (!transfer_to_member_id) return res.status(400).json({ error: 'transfer_to_member_id required' });
    try {
        const [src, dst] = await Promise.all([
            pool.query('SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL', [memberId, gym_id]),
            pool.query('SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND deleted_at IS NULL', [transfer_to_member_id, gym_id]),
        ]);
        if (!src.rows.length) return res.status(404).json({ error: 'Source member not found' });
        if (!dst.rows.length) return res.status(404).json({ error: 'Destination member not found' });
        await pool.query('BEGIN');
        const ms = await pool.query(
            `SELECT id, plan_id, start_date, end_date FROM memberships
             WHERE member_id=$1 AND gym_id=$2 AND deleted_at IS NULL AND status IN ('ACTIVE','FROZEN')
             ORDER BY end_date DESC LIMIT 1`, [memberId, gym_id]);
        if (!ms.rows.length) { await pool.query('ROLLBACK'); return res.status(400).json({ error: 'No active membership to transfer' }); }
        const old = ms.rows[0];
        await pool.query(`UPDATE memberships SET status='TRANSFERRED', cancelled_at=NOW(), transfer_id=$3 WHERE id=$1 AND gym_id=$2`, [old.id, gym_id, transfer_to_member_id]);
        await pool.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status, amount_paid, total_amount)
             SELECT $1, $2, plan_id, NOW(), end_date, 'ACTIVE', amount_paid, total_amount FROM memberships WHERE id=$3`,
            [gym_id, transfer_to_member_id, old.id]);
        await pool.query(`UPDATE members SET transfer_status='TRANSFERRED' WHERE id=$1 AND gym_id=$2`, [memberId, gym_id]);
        await pool.query('COMMIT');
        res.json({ message: 'Membership transferred', notes });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('TRANSFER MEMBER ERROR:', err.message);
        res.status(500).json({ error: 'Server error' });
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
        const { doc_type, doc_url, doc_name, notes } = req.body || {};
        const normalizedDocType = String(doc_type || '').trim();
        const normalizedDocUrl = normalizeDocumentUrl(doc_url);
        const normalizedDocName = String(doc_name || '').trim();
        const normalizedNotes = String(notes || '').trim();
        if (!normalizedDocType || !normalizedDocUrl) {
            return res.status(400).json({ error: 'doc_type and a valid document are required' });
        }
        const [hasNotesColumn, hasDocNameColumn, hasUploadedByColumn] = await Promise.all([
            tableHasColumn('member_documents', 'notes'),
            tableHasColumn('member_documents', 'doc_name'),
            tableHasColumn('member_documents', 'uploaded_by'),
        ]);
        const columns = ['gym_id', 'member_id', 'doc_type', 'doc_url'];
        const values = [gid, req.params.id, normalizedDocType, normalizedDocUrl];
        if (hasNotesColumn) {
            columns.push('notes');
            values.push(normalizedNotes || null);
        }
        if (hasDocNameColumn) {
            columns.push('doc_name');
            values.push(normalizedDocName || normalizedDocType);
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
    } catch(err) { console.error('ADD DOC:', err.message); res.status(500).json({ error: 'Server error' }); }
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
        const { note, note_type } = req.body || {};
        if (!note) return res.status(400).json({ error: 'note is required' });
        const hasNoteTypeColumn = await tableHasColumn('member_notes', 'note_type');
        const columns = ['gym_id', 'member_id', 'created_by', 'note'];
        const values = [gid, req.params.id, req.user.id, String(note).trim()];
        if (hasNoteTypeColumn) {
            columns.push('note_type');
            values.push(String(note_type || 'general').trim());
        }
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const result = await pool.query(
            `INSERT INTO member_notes (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            values
        );
        res.status(201).json(result.rows[0]);
    } catch(err) { console.error('ADD NOTE:', err.message); res.status(500).json({ error: 'Server error' }); }
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
        client = await pool.connect();
        const gid = req.user.gym_id;
        const { waiver_type, waiver_text, signature_data } = req.body || {};
        const [hasWaiverTypeColumn, hasSignatureColumn, hasIpAddressColumn] = await Promise.all([
            tableHasColumn('member_waivers', 'waiver_type'),
            tableHasColumn('member_waivers', 'signature_data'),
            tableHasColumn('member_waivers', 'ip_address'),
        ]);
        const columns = ['gym_id', 'member_id', 'waiver_text'];
        const values = [gid, req.params.id, String(waiver_text || 'Standard gym liability waiver').trim()];
        const pushValue = (column, value) => {
            columns.push(column);
            values.push(value);
        };
        if (hasWaiverTypeColumn) {
            pushValue('waiver_type', String(waiver_type || 'general').trim());
        }
        if (hasSignatureColumn) {
            pushValue('signature_data', signature_data || null);
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
        await client.query('UPDATE members SET waiver_signed_at=NOW() WHERE id=$1 AND gym_id=$2', [req.params.id, gid]);
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
        const { onboarding_complete, emergency_contact, gender, date_of_birth, address, blood_group, medical_notes } = req.body || {};
        const updates = [];
        const vals = [];
        let idx = 3;
        if (onboarding_complete !== undefined) { updates.push(`onboarding_complete=$${idx++}`); vals.push(!!onboarding_complete); }
        if (emergency_contact !== undefined) { updates.push(`emergency_contact=$${idx++}`); vals.push(String(emergency_contact).trim()); }
        if (gender !== undefined) { updates.push(`gender=$${idx++}`); vals.push(String(gender).trim()); }
        if (date_of_birth !== undefined) { updates.push(`date_of_birth=$${idx++}`); vals.push(date_of_birth || null); }
        if (address !== undefined) { updates.push(`address=$${idx++}`); vals.push(String(address).trim()); }
        if (blood_group !== undefined) { updates.push(`blood_group=$${idx++}`); vals.push(String(blood_group).trim()); }
        if (medical_notes !== undefined) { updates.push(`medical_notes=$${idx++}`); vals.push(String(medical_notes).trim()); }
        if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
        const result = await pool.query(
            `UPDATE members SET ${updates.join(', ')} WHERE id=$1 AND gym_id=$2 RETURNING *`,
            [req.params.id, gid, ...vals]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Member not found' });
        res.json(result.rows[0]);
    } catch(err) { console.error('ONBOARDING:', err.message); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;