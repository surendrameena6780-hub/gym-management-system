const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getDefaultPermissionsByStaffRole } = require('../middleware/rbac');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is missing or insecure.');
}

// POST /api/auth/check-email — real-time duplicate check (called on blur during signup)
router.post('/check-email', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ message: 'Email required.' });
    try {
        const existing = await pool.query('SELECT id, gym_id FROM users WHERE email = $1', [email]);
        if (existing.rows.length === 0) return res.json({ available: true });
        // Ghost check: if their gym was deleted treat account as available
        const gymId = existing.rows[0].gym_id;
        if (!gymId) return res.json({ available: true });
        const gymExists = await pool.query('SELECT id FROM gyms WHERE id = $1', [gymId]);
        if (gymExists.rows.length === 0) return res.json({ available: true });
        return res.status(409).json({ message: 'An account with this email already exists.' });
    } catch (err) {
        return res.status(500).json({ message: 'Check failed.' });
    }
});

// POST /api/auth/check-phone — real-time duplicate check for owner phone
router.post('/check-phone', async (req, res) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
    if (!phone || phone.length < 10) return res.status(400).json({ message: 'Valid 10-digit phone required.' });
    try {
        const existing = await pool.query('SELECT id FROM users WHERE phone LIKE $1', [`%${phone}`]);
        if (existing.rows.length > 0) return res.status(409).json({ message: 'This phone number is already registered.' });
        return res.json({ available: true });
    } catch (err) {
        return res.status(500).json({ message: 'Check failed.' });
    }
});

// POST /api/auth/register-owner
// Creates a new gym + owner account securely. Includes Self-Healing for deleted HQ accounts.
router.post('/register-owner', async (req, res) => {
    const gym_name      = String(req.body?.gym_name  || '').trim();
    const full_name     = String(req.body?.full_name || '').trim();
    const email         = String(req.body?.email     || '').trim().toLowerCase();
    const password      = String(req.body?.password  || '');
    const owner_phone   = String(req.body?.owner_phone   || '').replace(/\D/g, '').slice(-10);
    const gym_address   = req.body?.gym_address   ? String(req.body.gym_address).trim()   : null;
    const gym_city      = req.body?.gym_city      ? String(req.body.gym_city).trim()      : null;
    const branches_count = parseInt(req.body?.branches_count) || 1;
    const selected_plan = ['basic', 'pro', 'elite'].includes(req.body?.selected_plan) ? req.body.selected_plan : 'basic';

    if (!gym_name || !full_name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    try {
        await pool.query('BEGIN'); // Start transaction for safety

        // 🚨 THE SELF-HEALING GHOST CHECK 🚨
        // If the email exists, check if their gym was deleted by the Super Admin.
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            const oldGymId = existingUser.rows[0].gym_id;
            const gymStillExists = await pool.query('SELECT id FROM gyms WHERE id = $1', [oldGymId]);
            
            if (gymStillExists.rows.length === 0 || oldGymId === null) {
                // The gym was deleted! This is a ghost account. Delete it so they can register fresh.
                await pool.query('DELETE FROM users WHERE email = $1', [email]);
            } else {
                // The gym still exists, so it's a real duplicate. Block it.
                await pool.query('ROLLBACK');
                return res.status(400).json({ message: 'An account with this email already exists.' });
            }
        }

        // Duplicate phone check (if phone provided)
        if (owner_phone && owner_phone.length === 10) {
            const existingPhone = await pool.query('SELECT id FROM users WHERE phone LIKE $1', [`%${owner_phone}`]);
            if (existingPhone.rows.length > 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ message: 'This phone number is already registered.' });
            }
        }

        // Encrypt the password before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newGym = await pool.query(
            `INSERT INTO gyms (name, address, city, branches_count, current_plan, saas_status)
             VALUES ($1, $2, $3, $4, $5, 'FREE_TRIAL') RETURNING id`,
            [gym_name, gym_address, gym_city, branches_count, selected_plan]
        );
        const gymId = newGym.rows[0].id;

        const newUser = await pool.query(
            `INSERT INTO users (gym_id, full_name, email, phone, password_hash, role, staff_role, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [gymId, full_name, email, owner_phone || null, hashedPassword, 'OWNER', 'OWNER', true]
        );

        await pool.query('COMMIT');

        return res.json({
            message: "Gym and Owner created successfully!",
            gym_id: gymId,
            user_id: newUser.rows[0].id
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("REGISTER ERROR:", err.message);
        if (err.code === '23505') {
            return res.status(400).json({ message: "An account with this email already exists." });
        }
        return res.status(500).json({ message: "Server Error" });
    }
});

// POST /api/auth/login
// SECURE MODE: Authenticates using strict email checks and bcrypt password verification.
router.post('/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
    }

    try {
        // 1. Verify email AND fetch the gym's is_active status (THE KILL SWITCH CHECK)
        const userResult = await pool.query(
            `SELECT u.*, g.is_active AS gym_is_active, g.gym_access_status
             FROM users u 
             JOIN gyms g ON u.gym_id = g.id 
             WHERE u.email = $1`, 
            [email]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(400).json({ message: "Invalid email or password." });
        }

        const user = userResult.rows[0];

        // 🚨 CHECK THE KILL SWITCH 🚨
        if (user.gym_is_active === false) {
            return res.status(403).json({ message: "Account Suspended. Please contact GymVault HQ." });
        }

        const accessStatus = String(user.gym_access_status || 'ACTIVE').toUpperCase();
        if (accessStatus === 'BLOCKED') {
            return res.status(403).json({ message: 'Gym account is blocked by HQ. Contact support.' });
        }
        if (accessStatus === 'SUSPENDED') {
            return res.status(403).json({ message: 'Gym account is suspended by HQ. Contact support.' });
        }

        if (user.is_active === false) {
            return res.status(403).json({ message: "Staff account is inactive. Contact gym owner." });
        }

        // 2. Securely verify the password typed against the database hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid email or password." });
        }

        // 3. Issue the JWT Token ONLY if the password is correct
        const permissions = String(user.role || '').toUpperCase() === 'OWNER'
            ? ['*']
            : (Array.isArray(user.permissions)
                ? user.permissions
                : getDefaultPermissionsByStaffRole(user.staff_role));

        const token = jwt.sign(
            {
                user: {
                    id: user.id,
                    gym_id: user.gym_id,
                    role: user.role,
                    staff_role: user.staff_role,
                    permissions,
                    is_active: user.is_active,
                }
            },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        return res.json({
            token,
            message: "Login successful!",
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                gym_id: user.gym_id,
                role: user.role,
                staff_role: user.staff_role,
                is_active: user.is_active,
                permissions,
            }
        });

    } catch (err) {
        console.error("LOGIN ERROR:", err.message);
        return res.status(500).json({ message: "Server Error" });
    }
});

// ─── AUTH CONFIG ──────────────────────────────────────────────────────────────
// Returns which social providers are configured (for frontend feature detection)
router.get('/config', (req, res) => {
    res.json({
        google_auth_enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        apple_client_id: process.env.APPLE_CLIENT_ID || null,
    });
});

// ─── GOOGLE OAUTH 2.0 ─────────────────────────────────────────────────────────
// GET /api/auth/google — Redirect user to Google consent screen
router.get('/google', (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        return res.redirect(`${frontendUrl}/?auth_error=google_not_configured`);
    }
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/google/callback`;
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'email profile',
        access_type: 'offline',
        prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback — Google sends back the auth code
router.get('/google/callback', async (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const code = String(req.query?.code || '');
    if (!code) {
        return res.redirect(`${frontendUrl}/?auth_error=google_cancelled`);
    }

    try {
        const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/google/callback`;

        // Exchange code for access token
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            return res.redirect(`${frontendUrl}/?auth_error=google_token_failed`);
        }

        // Fetch Google profile
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileRes.json();

        const email = String(profile.email || '').toLowerCase();
        const googleId = String(profile.id || '');
        const fullName = String(profile.name || '');
        const avatarUrl = String(profile.picture || '');

        if (!email || !googleId) {
            return res.redirect(`${frontendUrl}/?auth_error=google_profile_failed`);
        }

        await pool.query('BEGIN');

        // 1. Check existing Google user
        let userResult = await pool.query(
            `SELECT u.*, g.is_active AS gym_is_active, g.gym_access_status
             FROM users u JOIN gyms g ON u.gym_id = g.id
             WHERE u.google_id = $1`,
            [googleId]
        );

        let user;
        if (userResult.rows.length > 0) {
            user = userResult.rows[0];
            if (!user.gym_is_active) {
                await pool.query('ROLLBACK');
                return res.redirect(`${frontendUrl}/?auth_error=account_suspended`);
            }
            await pool.query(
                'UPDATE users SET avatar_url = $1, last_login_at = NOW() WHERE id = $2',
                [avatarUrl, user.id]
            );
        } else {
            // 2. Check if email already has a local account
            const emailResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (emailResult.rows.length > 0) {
                // Link Google to existing account
                user = emailResult.rows[0];
                await pool.query(
                    'UPDATE users SET google_id = $1, avatar_url = $2, auth_provider = $3, last_login_at = NOW() WHERE id = $4',
                    [googleId, avatarUrl, 'google', user.id]
                );
            } else {
                // 3. Brand new user — auto-create gym + owner account
                const gymName = fullName ? `${fullName.split(' ')[0]}'s Gym` : 'My Gym';
                const newGym = await pool.query('INSERT INTO gyms (name) VALUES ($1) RETURNING id', [gymName]);
                const gymId = newGym.rows[0].id;

                const newUser = await pool.query(
                    `INSERT INTO users (gym_id, full_name, email, password_hash, role, staff_role, is_active, google_id, avatar_url, auth_provider)
                     VALUES ($1, $2, $3, 'OAUTH_NO_PASSWORD', 'OWNER', 'OWNER', true, $4, $5, 'google')
                     RETURNING *`,
                    [gymId, fullName || email.split('@')[0], email, googleId, avatarUrl]
                );
                user = newUser.rows[0];
                user.gym_id = gymId;
            }
        }

        await pool.query('COMMIT');

        const permissions = user.role === 'OWNER' ? ['*'] : (Array.isArray(user.permissions) ? user.permissions : []);
        const token = jwt.sign(
            { user: { id: user.id, gym_id: user.gym_id, role: user.role || 'OWNER', staff_role: user.staff_role || 'OWNER', permissions, is_active: true } },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.redirect(`${frontendUrl}/?token=${encodeURIComponent(token)}&auth_source=google`);
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('GOOGLE OAUTH ERROR:', err.message);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/?auth_error=server_error`);
    }
});

// ─── APPLE SIGN-IN ────────────────────────────────────────────────────────────
// POST /api/auth/apple — Receives id_token from Apple JS SDK on frontend
router.post('/apple', async (req, res) => {
    const idToken = String(req.body?.id_token || '');
    const fullName = String(req.body?.full_name || '').trim();

    if (!idToken) {
        return res.status(400).json({ message: 'id_token is required.' });
    }

    if (!process.env.APPLE_CLIENT_ID) {
        return res.status(503).json({ message: 'Apple Sign-In is not configured on this server.' });
    }

    try {
        const appleSignin = require('apple-signin-auth');
        const payload = await appleSignin.verifyIdToken(idToken, {
            audience: process.env.APPLE_CLIENT_ID,
            ignoreExpiration: false,
        });

        const email = String(payload.email || '').toLowerCase();
        const appleId = String(payload.sub || '');

        if (!appleId) {
            return res.status(400).json({ message: 'Apple token is invalid.' });
        }

        await pool.query('BEGIN');

        let userResult = await pool.query('SELECT * FROM users WHERE apple_id = $1', [appleId]);
        let user;

        if (userResult.rows.length > 0) {
            user = userResult.rows[0];
            await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        } else if (email) {
            const emailResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (emailResult.rows.length > 0) {
                user = emailResult.rows[0];
                await pool.query(
                    'UPDATE users SET apple_id = $1, auth_provider = $2, last_login_at = NOW() WHERE id = $3',
                    [appleId, 'apple', user.id]
                );
            } else {
                const gymName = fullName ? `${fullName.split(' ')[0]}'s Gym` : 'My Gym';
                const newGym = await pool.query('INSERT INTO gyms (name) VALUES ($1) RETURNING id', [gymName]);
                const gymId = newGym.rows[0].id;

                const newUser = await pool.query(
                    `INSERT INTO users (gym_id, full_name, email, password_hash, role, staff_role, is_active, apple_id, auth_provider)
                     VALUES ($1, $2, $3, 'OAUTH_NO_PASSWORD', 'OWNER', 'OWNER', true, $4, 'apple')
                     RETURNING *`,
                    [gymId, fullName || email.split('@')[0], email, appleId]
                );
                user = newUser.rows[0];
                user.gym_id = gymId;
            }
        } else {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot create account: Apple did not provide an email address.' });
        }

        await pool.query('COMMIT');

        const permissions = user.role === 'OWNER' ? ['*'] : (Array.isArray(user.permissions) ? user.permissions : []);
        const token = jwt.sign(
            { user: { id: user.id, gym_id: user.gym_id, role: user.role || 'OWNER', staff_role: user.staff_role || 'OWNER', permissions, is_active: true } },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.json({
            token,
            user: { id: user.id, full_name: user.full_name, email: user.email, gym_id: user.gym_id, role: user.role, permissions }
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('APPLE AUTH ERROR:', err.message);
        return res.status(500).json({ message: 'Apple Sign-In failed. Please try again.' });
    }
});

// ─── MEMBER PORTAL: OTP-based self-service login ──────────────────────────────
// POST /api/auth/member/send-otp
router.post('/member/send-otp', async (req, res) => {
    const rawPhone = String(req.body?.phone || '').trim().replace(/\D/g, '');
    const phone = rawPhone.slice(-10);

    if (!phone || phone.length < 10) {
        return res.status(400).json({ message: 'Please enter a valid 10-digit phone number.' });
    }

    try {
        const memberResult = await pool.query(
            `SELECT m.id, m.full_name, m.gym_id FROM members m
             WHERE m.phone LIKE $1 AND m.deleted_at IS NULL
             LIMIT 1`,
            [`%${phone}`]
        );

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ message: 'No member found with this phone number. Please contact your gym.' });
        }

        const member = memberResult.rows[0];
        // OTP bypass — set MEMBER_OTP_BYPASS=false in env to require real OTP
        const bypassMode = process.env.MEMBER_OTP_BYPASS !== 'false';
        const otp = bypassMode ? 'BYPASS' : String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            'UPDATE members SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
            [otp, expiresAt, member.id]
        );

        // ── Send OTP: try each channel in priority order ───────────────────
        const toPhone = `+91${phone}`;
        const otpMsg  = `Your GymVault OTP is: ${otp}. Valid for 10 minutes. Do not share this.`;
        let sent = false;

        // 1. Fast2SMS (free Indian SMS — set FAST2SMS_API_KEY in .env)
        if (!sent && process.env.FAST2SMS_API_KEY) {
            try {
                const axios = require('axios');
                const res2 = await axios.post('https://www.fast2sms.com/dev/bulkV2', {
                    route: 'otp',
                    variables_values: otp,
                    numbers: phone,
                }, { headers: { authorization: process.env.FAST2SMS_API_KEY }, timeout: 8000 });
                if (res2.data?.return === true) {
                    console.log(`[OTP] Fast2SMS sent to ${phone}`);
                    sent = true;
                }
            } catch (e) { console.error('[OTP] Fast2SMS failed:', e.message); }
        }

        // 2. Twilio WhatsApp sandbox (free, no payment needed)
        if (!sent && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
            try {
                const twilio = require('twilio');
                const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                await client.messages.create({
                    body: otpMsg,
                    from: process.env.TWILIO_WHATSAPP_FROM,
                    to: `whatsapp:${toPhone}`,
                });
                console.log(`[OTP] WhatsApp sent to ${toPhone}`);
                sent = true;
            } catch (e) { console.error('[OTP] Twilio WhatsApp failed:', e.message); }
        }

        // 3. Twilio SMS (paid)
        if (!sent && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM) {
            try {
                const twilio = require('twilio');
                const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                await client.messages.create({ body: otpMsg, from: process.env.TWILIO_SMS_FROM, to: toPhone });
                console.log(`[OTP] SMS sent to ${toPhone}`);
                sent = true;
            } catch (e) { console.error('[OTP] Twilio SMS failed:', e.message); }
        }

        // 4. Dev fallback — print to console
        if (!sent && !bypassMode) {
            console.log(`[DEV] OTP for ${phone}: ${otp}`);
        }

        return res.json({
            message: bypassMode ? 'Logging you in...' : (sent ? 'OTP sent successfully.' : 'OTP generated (dev mode — check server console).'),
            member_name: member.full_name.split(' ')[0],
            dev_otp: bypassMode ? otp : undefined,
        });
    } catch (err) {
        console.error('MEMBER OTP SEND ERROR:', err.message);
        return res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
    }
});

// POST /api/auth/member/verify-otp
router.post('/member/verify-otp', async (req, res) => {
    const rawPhone = String(req.body?.phone || '').trim().replace(/\D/g, '');
    const phone = rawPhone.slice(-10);
    const otp = String(req.body?.otp || '').trim();

    if (!phone || !otp) {
        return res.status(400).json({ message: 'Phone and OTP are required.' });
    }

    try {
        const memberResult = await pool.query(
            `SELECT m.*, g.name AS gym_name,
                    ms.start_date, ms.end_date, ms.status AS membership_status,
                    p.name AS plan_name
             FROM members m
             JOIN gyms g ON m.gym_id = g.id
             LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.status = 'ACTIVE' AND ms.deleted_at IS NULL
             LEFT JOIN plans p ON p.id = ms.plan_id
             WHERE m.phone LIKE $1 AND m.deleted_at IS NULL
             LIMIT 1`,
            [`%${phone}`]
        );

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found.' });
        }

        const member = memberResult.rows[0];

        // Skip OTP check if bypass mode (member.otp_code === 'BYPASS')
        const isBypass = member.otp_code === 'BYPASS';
        if (!isBypass) {
            if (!member.otp_code || member.otp_code !== otp) {
                return res.status(400).json({ message: 'Invalid OTP. Please try again.' });
            }
            if (!member.otp_expires_at || new Date() > new Date(member.otp_expires_at)) {
                return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
            }
        }

        // Clear OTP after use
        await pool.query('UPDATE members SET otp_code = NULL, otp_expires_at = NULL WHERE id = $1', [member.id]);

        const token = jwt.sign(
            { member: { id: member.id, gym_id: member.gym_id, role: 'MEMBER' } },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.json({
            token,
            member: {
                id: member.id,
                full_name: member.full_name,
                email: member.email,
                gym_name: member.gym_name,
                plan_name: member.plan_name,
                membership_start: member.start_date,
                membership_end: member.end_date,
                membership_status: member.membership_status,
                status: member.status,
            }
        });
    } catch (err) {
        console.error('MEMBER OTP VERIFY ERROR:', err.message);
        return res.status(500).json({ message: 'Verification failed. Please try again.' });
    }
});

// GET /api/auth/member/me — returns member profile (authenticated via member JWT)
router.get('/member/me', async (req, res) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ message: 'No token.' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const memberId = decoded?.member?.id;
        if (!memberId) return res.status(401).json({ message: 'Invalid token.' });

        const result = await pool.query(
            `SELECT m.*, g.name AS gym_name,
                    ms.end_date, ms.start_date, ms.status AS membership_status,
                    p.name AS plan_name, p.price AS plan_price
             FROM members m
             JOIN gyms g ON m.gym_id = g.id
             LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.status = 'ACTIVE' AND ms.deleted_at IS NULL
             LEFT JOIN plans p ON p.id = ms.plan_id
             WHERE m.id = $1 AND m.deleted_at IS NULL`,
            [memberId]
        );

        if (result.rows.length === 0) return res.status(404).json({ message: 'Member not found.' });

        const m = result.rows[0];
        return res.json({
            id: m.id,
            full_name: m.full_name,
            email: m.email,
            phone: m.phone,
            profile_pic: m.profile_pic,
            gym_name: m.gym_name,
            plan_name: m.plan_name,
            membership_end: m.end_date,
            membership_status: m.membership_status,
            status: m.status,
            joining_date: m.joining_date,
        });
    } catch (err) {
        return res.status(401).json({ message: 'Token is not valid.' });
    }
});

// GET /api/auth/member/attendance — last 30 days attendance (member JWT required)
router.get('/member/attendance', async (req, res) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ message: 'No token.' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const memberId = decoded?.member?.id;
        if (!memberId) return res.status(401).json({ message: 'Invalid token.' });

        const result = await pool.query(
            `SELECT DATE(check_in_time AT TIME ZONE 'Asia/Kolkata') AS date,
                    COUNT(*) AS count
             FROM attendance
             WHERE member_id = $1 AND deleted_at IS NULL
               AND check_in_time >= NOW() - INTERVAL '30 days'
             GROUP BY DATE(check_in_time AT TIME ZONE 'Asia/Kolkata')
             ORDER BY date DESC`,
            [memberId]
        );
        return res.json({ attendance: result.rows });
    } catch (err) {
        return res.status(401).json({ message: 'Token is not valid.' });
    }
});

module.exports = router;