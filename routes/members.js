const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const getGymIdFromRequest = (req) => {
    const rawGymId = req?.user?.gym_id ?? req?.user?.gymId;
    const gymId = Number.parseInt(rawGymId, 10);
    return Number.isInteger(gymId) ? gymId : null;
};

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        const uploadPath = path.join(__dirname, '..', 'uploads', 'profiles');
        try {
            fs.mkdirSync(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const gymId = getGymIdFromRequest(req) || 'unknown';
        cb(null, `member-${gymId}-${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
    }
});

const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!allowedImageMimeTypes.has(file.mimetype)) {
            return cb(new Error('Only JPG, JPEG, PNG, and WEBP files are allowed'));
        }
        cb(null, true);
    }
});

const uploadProfilePic = (req, res, next) => {
    upload.single('profile_pic')(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Image too large. Max size is 2MB.' });
            }
            return res.status(400).json({ error: err.message || 'Invalid image upload.' });
        }

        const msg = String(err.message || '');
        if (msg.includes('Only JPG') || msg.includes('Unexpected end of form') || msg.includes('Multipart')) {
            return res.status(400).json({ error: 'Invalid image upload payload. Please reselect image and try again.' });
        }

        if (['ENOENT', 'EACCES', 'EPERM'].includes(err.code)) {
            return res.status(500).json({ error: 'Unable to store uploaded image on server.' });
        }

        return res.status(500).json({ error: 'Image upload failed.' });
    });
};

const buildPicUrl = (filename) => {
    return `/uploads/profiles/${filename}`;
};

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const isValidPhone = (value) => /^\d{10}$/.test(value);

// --- 1. GET ALL MEMBERS ---
router.get('/', auth, saasMiddleware, async (req, res) => {
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
                ms_latest.end_date AS expiry_date
            FROM members m
            LEFT JOIN LATERAL (
                SELECT ms.status, ms.end_date, p.name AS plan_name
                FROM memberships ms
                LEFT JOIN plans p ON ms.plan_id = p.id
                WHERE ms.member_id = m.id AND ms.gym_id = $1 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC
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

        const countResult = await pool.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM members m
             WHERE m.gym_id = $1 AND m.deleted_at IS NULL
               ${search ? `AND (m.full_name ILIKE $2 OR m.email ILIKE $2 OR m.phone ILIKE $2)` : ''}`,
            search ? [gym_id, `%${search}%`] : [gym_id]
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
router.get('/:id', auth, saasMiddleware, async (req, res) => {
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
                SELECT ms.status, ms.end_date, p.name AS plan_name
                FROM memberships ms
                LEFT JOIN plans p ON ms.plan_id = p.id
                WHERE ms.member_id = m.id AND ms.gym_id = $2 AND ms.deleted_at IS NULL
                ORDER BY ms.end_date DESC
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
router.post('/add', auth, saasMiddleware, uploadProfilePic, async (req, res) => {
    try {
        const { full_name, email, phone } = req.body;
        const normalizedPhone = normalizePhone(phone);
        if (!full_name || !email || !normalizedPhone) {
            return res.status(400).json({ error: 'full_name, email and phone are required.' });
        }
        if (!isValidPhone(normalizedPhone)) {
            return res.status(400).json({ error: 'Phone must be exactly 10 digits.' });
        }

        const profile_pic = req.file ? buildPicUrl(req.file.filename) : null;
        const gym_id = req.user.gym_id;

        const existingPhone = await pool.query(
            'SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1',
            [gym_id, normalizedPhone]
        );
        if (existingPhone.rows.length > 0) {
            return res.status(400).json({ error: 'This phone is already registered in your gym.' });
        }

        const newMember = await pool.query(
            `INSERT INTO members (full_name, email, phone, profile_pic, gym_id, joining_date, last_visit, status)
             VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, NULL, 'UNPAID')
             RETURNING *`,
            [full_name, email, normalizedPhone, profile_pic, gym_id]
        );

        res.json(newMember.rows[0]);
    } catch (err) {
        console.error("ADD MEMBER ERROR:", err.message);
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: 'Image too large. Max size is 2MB.' });
        }
        if (err.message && err.message.includes('Only JPG')) {
            return res.status(400).json({ error: err.message });
        }
        if (err.code === '23505') {
            return res.status(400).json({ error: "This email or phone is already registered to another member." });
        }
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. UPDATE MEMBER ---
router.put('/:id', auth, saasMiddleware, uploadProfilePic, async (req, res) => {
    const { full_name, email, phone } = req.body;
    const normalizedPhone = normalizePhone(phone);
    const normalizedName = String(full_name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const gym_id = getGymIdFromRequest(req);
    const memberId = Number.parseInt(req.params.id, 10);

    if (!gym_id) {
        return res.status(401).json({ error: 'Invalid session. Please login again.' });
    }
    if (!Number.isInteger(memberId)) {
        return res.status(400).json({ error: 'Invalid member id.' });
    }
    if (!normalizedName || !normalizedEmail || !normalizedPhone) {
        return res.status(400).json({ error: 'full_name, email and phone are required.' });
    }
    if (!isValidPhone(normalizedPhone)) {
        return res.status(400).json({ error: 'Phone must be exactly 10 digits.' });
    }

    try {
        const existingPhone = await pool.query(
            'SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1',
            [gym_id, normalizedPhone, memberId]
        );
        if (existingPhone.rows.length > 0) {
            return res.status(400).json({ error: 'This phone is already registered in your gym.' });
        }

        const existingEmail = await pool.query(
            'SELECT id FROM members WHERE gym_id = $1 AND lower(email) = $2 AND id <> $3 AND deleted_at IS NULL LIMIT 1',
            [gym_id, normalizedEmail, memberId]
        );
        if (existingEmail.rows.length > 0) {
            return res.status(400).json({ error: 'This email is already registered in your gym.' });
        }

        if (req.file) {
            const profile_pic = buildPicUrl(req.file.filename);
            const updateResult = await pool.query(
                "UPDATE members SET full_name = $1, email = $2, phone = $3, profile_pic = $4 WHERE id = $5 AND gym_id = $6 AND deleted_at IS NULL",
                [normalizedName, normalizedEmail, normalizedPhone, profile_pic, memberId, gym_id]
            );
            if (updateResult.rowCount === 0) {
                return res.status(404).json({ error: 'Member not found.' });
            }
        } else {
            const updateResult = await pool.query(
                "UPDATE members SET full_name = $1, email = $2, phone = $3 WHERE id = $4 AND gym_id = $5 AND deleted_at IS NULL",
                [normalizedName, normalizedEmail, normalizedPhone, memberId, gym_id]
            );
            if (updateResult.rowCount === 0) {
                return res.status(404).json({ error: 'Member not found.' });
            }
        }
        res.json({ message: "Member updated" });
    } catch (err) {
        console.error("UPDATE MEMBER ERROR:", err.message);
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: 'Image too large. Max size is 2MB.' });
        }
        if (err.message && err.message.includes('Only JPG')) {
            return res.status(400).json({ error: err.message });
        }
        if (['ENOENT', 'EACCES', 'EPERM'].includes(err.code)) {
            return res.status(500).json({ error: 'Unable to store uploaded image on server.' });
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
router.put('/:id/check-in', auth, saasMiddleware, async (req, res) => {
    const gym_id = req.user.gym_id;
    try {
        const member = await pool.query("SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL", [req.params.id, gym_id]);
        if(member.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

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
        res.status(500).json({ error: err.message });
    }
});

// --- 6. DELETE MEMBER ---
router.delete('/:id', auth, saasMiddleware, async (req, res) => {
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
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;