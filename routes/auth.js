const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getDefaultPermissionsByStaffRole } = require('../middleware/rbac');
const { isEmailTransportConfigured, sendTransactionalEmail } = require('../utils/email');
const {
    OTP_MODES,
    getMsg91OtpMode,
    maskPhone,
    normalizeLocalIndianPhone,
    requestMsg91Otp,
    verifyMsg91Otp,
} = require('../utils/msg91');
const {
    getRequestCookie,
    OWNER_AUTH_COOKIE,
    MEMBER_AUTH_COOKIE,
    setUserAuthCookie,
    clearUserAuthCookie,
    setMemberAuthCookie,
    clearMemberAuthCookie,
} = require('../utils/authCookies');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is missing or insecure.');
}

if (process.env.NODE_ENV === 'production' && String(process.env.MEMBER_OTP_BYPASS || '').trim().toLowerCase() === 'true') {
    throw new Error('FATAL: MEMBER_OTP_BYPASS cannot be enabled in production.');
}

const isProduction = process.env.NODE_ENV === 'production';

const normalizeAuthMode = (value) => (String(value || '').trim().toLowerCase() === 'signup' ? 'signup' : 'login');

const stripTrailingSlash = (value, fallback) => {
    const raw = String(value || fallback || '').trim();
    return raw.replace(/\/+$/, '');
};

const getFrontendUrl = () => stripTrailingSlash(process.env.FRONTEND_URL, 'http://localhost:5173');
const getAppUrl = () => stripTrailingSlash(process.env.APP_URL, 'http://localhost:5000');

const getGoogleRedirectUri = () => {
    const configured = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
    if (configured) return configured;
    return `${getAppUrl()}/api/auth/google/callback`;
};

const buildFrontendAuthRedirect = ({ mode = 'login', error = '', token = '', source = '', extraParams = {} } = {}) => {
    const targetPath = mode === 'signup' ? '/signup' : '/login';
    const params = new URLSearchParams();
    if (error) params.set('auth_error', error);
    if (token) params.set('token', token);
    if (source) params.set('auth_source', source);
    Object.entries(extraParams || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value) !== '') {
            params.set(key, String(value));
        }
    });
    const query = params.toString();
    return `${getFrontendUrl()}${targetPath}${query ? `?${query}` : ''}`;
};

const GOOGLE_SIGNUP_TOKEN_TTL_SECONDS = 15 * 60;
const PASSWORD_RESET_PURPOSE = 'PASSWORD_RESET';
const SIGNUP_EMAIL_VERIFY_PURPOSE = 'SIGNUP_EMAIL_VERIFY';
const PASSWORD_RESET_OTP_TTL_MINUTES = 10;
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;
const PASSWORD_RESET_MAX_VERIFY_ATTEMPTS = 5;
const ADMIN_LOGIN_PURPOSE = 'ADMIN_LOGIN';
const ADMIN_EMAIL_LOGIN_PURPOSE = 'ADMIN_EMAIL_LOGIN';
const ADMIN_LOGIN_OTP_TTL_MINUTES = 10;
const ADMIN_LOGIN_RESEND_COOLDOWN_SECONDS = 60;
const ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS = 5;
const SIGNUP_EMAIL_VERIFY_TOKEN_TTL = '30m';

const AUTH_CONTEXT_SELECT = `
    SELECT u.*, g.is_active AS gym_is_active, g.gym_access_status, g.saas_status, g.saas_valid_until, g.current_plan
    FROM users u
    JOIN gyms g ON u.gym_id = g.id
`;

const truncateText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
const isValidEmailAddress = (value) => /^\S+@\S+\.\S+$/.test(String(value || '').trim().toLowerCase());
const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildOAuthOwnerName = (fullName, email) => {
    const fallbackName = String(email || '').includes('@') ? String(email).split('@')[0] : 'GymVault Owner';
    return truncateText(fullName || fallbackName, 100) || 'GymVault Owner';
};

const buildOAuthGymName = (ownerName) => {
    const firstToken = String(ownerName || 'My Gym').trim().split(/\s+/)[0] || 'My';
    return truncateText(`${firstToken}'s Gym`, 100) || 'My Gym';
};

const maskEmailAddress = (email) => {
    const [localPart, domainPart] = String(email || '').trim().toLowerCase().split('@');
    if (!localPart || !domainPart) return '';

    const safeLocal = localPart.length <= 2
        ? `${localPart[0] || ''}*`
        : `${localPart.slice(0, 2)}${'*'.repeat(Math.max(1, localPart.length - 2))}`;

    const [domainName, ...domainRest] = domainPart.split('.');
    const safeDomain = domainName
        ? `${domainName.slice(0, 1)}${'*'.repeat(Math.max(1, domainName.length - 1))}`
        : '***';

    return `${safeLocal}@${[safeDomain, ...domainRest].filter(Boolean).join('.')}`;
};

const buildGenericAdminOtpDispatch = (phone) => ({
    message: `If an owner or staff account exists for ${maskPhone(phone)}, a login code is on the way.`,
    masked_phone: maskPhone(phone),
    expires_in_minutes: ADMIN_LOGIN_OTP_TTL_MINUTES,
    preview_otp: '',
    preview_notice: '',
});

const buildGenericPasswordResetDispatch = (email) => {
    const maskedEmail = maskEmailAddress(email) || String(email || '').trim().toLowerCase();
    return {
        message: `If an account exists for ${maskedEmail}, a reset code is on the way.`,
        delivery_channel: 'email',
        masked_email: maskedEmail,
        expires_in_minutes: PASSWORD_RESET_OTP_TTL_MINUTES,
        preview_otp: '',
        preview_notice: '',
    };
};

const getPasswordResetDeliveryMode = () => {
    const mode = String(process.env.PASSWORD_RESET_DELIVERY_MODE || 'preview').trim().toLowerCase();
    return mode === 'email' && isEmailTransportConfigured() ? 'email' : 'preview';
};

const getSignupEmailOtpMode = () => (isEmailTransportConfigured() ? 'email' : 'preview');

const generatePasswordResetOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const sendOtpEmail = async ({ to, subject, title, intro, otp, footer }) => {
    const safeTitle = escapeHtml(title);
    const safeIntro = escapeHtml(intro);
    const safeOtp = escapeHtml(otp);
    const safeFooter = escapeHtml(footer);

    return sendTransactionalEmail({
        to,
        subject,
        text: `${title}\n\n${intro}\n\nOTP: ${otp}\n\n${footer}`,
        html: `
            <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
                <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:28px;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#6366f1;">GymVault</p>
                    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">${safeTitle}</h1>
                    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">${safeIntro}</p>
                    <div style="margin:0 0 20px;padding:18px;border-radius:16px;background:#0f172a;text-align:center;">
                        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#94a3b8;">One-Time Password</p>
                        <p style="margin:10px 0 0;font-size:32px;font-weight:800;letter-spacing:0.35em;color:#ffffff;">${safeOtp}</p>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">${safeFooter}</p>
                </div>
            </div>
        `,
    });
};

const buildPasswordResetDelivery = async ({ email, otp, userName }) => {
    const requestedMode = String(process.env.PASSWORD_RESET_DELIVERY_MODE || 'preview').trim().toLowerCase();
    const maskedEmail = maskEmailAddress(email);

    if (requestedMode === 'email' && isEmailTransportConfigured()) {
        const greetingName = String(userName || '').trim().split(/\s+/)[0] || 'there';
        await sendOtpEmail({
            to: email,
            subject: 'GymVault password reset code',
            title: 'Password reset code',
            intro: `Hi ${greetingName}, use this code to reset your GymVault password. It expires in 10 minutes.`,
            otp,
            footer: 'If you did not request this password reset, you can ignore this email.',
        });

        return {
            channel: 'email',
            masked_email: maskedEmail,
            preview_otp: '',
            preview_notice: '',
        };
    }

    return {
        channel: 'preview',
        masked_email: maskedEmail,
        preview_otp: otp,
        preview_notice: requestedMode === 'email'
            ? 'Email delivery mode is enabled, but SMTP is not configured yet, so a preview OTP is shown for now.'
            : 'Email delivery is not configured yet. Use this preview OTP for now.',
    };
};

const buildAdminEmailOtpDelivery = async ({ email, otp, userName }) => {
    const maskedEmail = maskEmailAddress(email);

    if (isEmailTransportConfigured()) {
        const greetingName = String(userName || '').trim().split(/\s+/)[0] || 'there';
        await sendOtpEmail({
            to: email,
            subject: 'Your GymVault sign-in code',
            title: 'Sign in to GymVault',
            intro: `Hi ${greetingName}, use this one-time code to sign in to your GymVault owner or staff account. It expires in 10 minutes.`,
            otp,
            footer: 'If you did not request this sign-in code, you can ignore this email.',
        });

        return {
            channel: 'email',
            masked_email: maskedEmail,
            preview_otp: '',
            preview_notice: '',
        };
    }

    return {
        channel: 'preview',
        masked_email: maskedEmail,
        preview_otp: otp,
        preview_notice: 'SMTP is not configured yet, so the login code is shown directly here for preview.',
    };
};

const buildSignupEmailOtpDelivery = async ({ email, otp }) => {
    const maskedEmail = maskEmailAddress(email);

    if (isEmailTransportConfigured()) {
        await sendOtpEmail({
            to: email,
            subject: 'Verify your GymVault email',
            title: 'Verify your email address',
            intro: 'Use this one-time code to verify your email before creating your GymVault account. It expires in 10 minutes.',
            otp,
            footer: 'If you did not start a GymVault signup, you can ignore this email.',
        });

        return {
            channel: 'email',
            masked_email: maskedEmail,
            preview_otp: '',
            preview_notice: '',
        };
    }

    return {
        channel: 'preview',
        masked_email: maskedEmail,
        preview_otp: otp,
        preview_notice: 'SMTP is not configured yet, so the signup verification code is shown directly here for preview.',
    };
};

const createSignupEmailVerificationToken = (email) => jwt.sign(
    {
        type: 'signup_email_verified',
        email: String(email || '').trim().toLowerCase(),
    },
    process.env.JWT_SECRET,
    { expiresIn: SIGNUP_EMAIL_VERIFY_TOKEN_TTL }
);

const assertSignupEmailVerificationToken = (token, email) => {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.type !== 'signup_email_verified') {
        throw new Error('invalid_signup_email_verification_token');
    }
    if (String(decoded.email || '').trim().toLowerCase() !== String(email || '').trim().toLowerCase()) {
        throw new Error('signup_email_mismatch');
    }
    return decoded;
};

const getAuthPermissions = (user) => (
    String(user?.role || '').toUpperCase() === 'OWNER'
        ? ['*']
        : (Array.isArray(user?.permissions)
            ? user.permissions
            : getDefaultPermissionsByStaffRole(user?.staff_role))
);

const issueAuthToken = (user) => {
    const permissions = getAuthPermissions(user);
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

    return { token, permissions };
};
const buildAuthSuccessPayload = (user, message = 'Login successful!') => {
    const { token, permissions } = issueAuthToken(user);

    return {
        token,
        message,
        user: {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            gym_id: user.gym_id,
            role: user.role,
            staff_role: user.staff_role,
            is_active: user.is_active,
            permissions,
        },
        saas: {
            status: user.saas_status || 'ACTIVE',
            valid_until: user.saas_valid_until,
            plan: user.current_plan,
        },
    };
};

const sendUserAuthResponse = (res, user, message = 'Login successful!') => {
    const payload = buildAuthSuccessPayload(user, message);
    setUserAuthCookie(res, payload.token);
    return res.json(payload);
};

const getPasswordlessProviderMessage = (user) => {
    if (user?.google_id || String(user?.auth_provider || '').toLowerCase() === 'google') {
        return 'This account uses Google sign-in. Continue with Google.';
    }
    if (user?.apple_id || String(user?.auth_provider || '').toLowerCase() === 'apple') {
        return 'This account uses Apple Sign-In. Continue with Apple.';
    }
    return 'This account uses social sign-in. Continue with the original sign-in method.';
};

const createGoogleSignupToken = ({ googleId, email, fullName, avatarUrl }) => jwt.sign(
    {
        type: 'google_signup',
        google_id: googleId,
        email,
        full_name: fullName,
        avatar_url: avatarUrl || '',
    },
    process.env.JWT_SECRET,
    { expiresIn: GOOGLE_SIGNUP_TOKEN_TTL_SECONDS }
);

const verifyGoogleSignupToken = (signupToken) => {
    const decoded = jwt.verify(String(signupToken || ''), process.env.JWT_SECRET);
    if (!decoded || decoded.type !== 'google_signup' || !decoded.google_id || !decoded.email) {
        throw new Error('INVALID_GOOGLE_SIGNUP_TOKEN');
    }
    return decoded;
};

const getOauthAccountError = (user) => {
    if (!user) return 'server_error';
    if (user.gym_is_active === false || user.is_active === false) return 'account_suspended';

    const accessStatus = String(user.gym_access_status || 'ACTIVE').toUpperCase();
    if (accessStatus === 'BLOCKED' || accessStatus === 'SUSPENDED') {
        return 'account_suspended';
    }

    return null;
};

const loadUserAuthContextById = async (userId) => {
    const result = await pool.query(`${AUTH_CONTEXT_SELECT} WHERE u.id = $1`, [userId]);
    return result.rows[0] || null;
};

const loadUserAuthContextByEmail = async (email) => {
    const result = await pool.query(`${AUTH_CONTEXT_SELECT} WHERE LOWER(u.email) = LOWER($1) LIMIT 1`, [email]);
    return result.rows[0] || null;
};

const loadAdminAuthContextByEmail = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmailAddress(normalizedEmail)) return null;

    const result = await pool.query(
        `${AUTH_CONTEXT_SELECT}
                 WHERE LOWER(u.email) = LOWER($1)
           AND UPPER(COALESCE(u.role, 'OWNER')) IN ('OWNER', 'STAFF')
         ORDER BY CASE WHEN UPPER(COALESCE(u.role, 'OWNER')) = 'OWNER' THEN 0 ELSE 1 END, u.id ASC
         LIMIT 1`,
        [normalizedEmail]
    );

    return result.rows[0] || null;
};

const loadAdminAuthContextByPhone = async (phone) => {
    const normalizedPhone = normalizeLocalIndianPhone(phone);
    if (!normalizedPhone) return null;

    const result = await pool.query(
        `${AUTH_CONTEXT_SELECT}
                 WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 10) = $1
           AND UPPER(COALESCE(u.role, 'OWNER')) IN ('OWNER', 'STAFF')
         ORDER BY CASE WHEN UPPER(COALESCE(u.role, 'OWNER')) = 'OWNER' THEN 0 ELSE 1 END, u.id ASC
         LIMIT 1`,
        [normalizedPhone]
    );

    return result.rows[0] || null;
};

const loadUserAuthContextByProvider = async (providerField, providerValue) => {
    const allowedFields = {
        google_id: 'u.google_id',
        apple_id: 'u.apple_id',
    };

    const fieldSql = allowedFields[providerField];
    if (!fieldSql) {
        throw new Error(`Unsupported auth provider field: ${providerField}`);
    }

    const result = await pool.query(`${AUTH_CONTEXT_SELECT} WHERE ${fieldSql} = $1`, [providerValue]);
    return result.rows[0] || null;
};

const generateAdminLoginOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const cleanupExpiredAdminLoginOtps = async () => {
    await pool.query(`
        DELETE FROM user_login_otps
        WHERE expires_at < NOW()
           OR (consumed_at IS NOT NULL AND created_at < NOW() - INTERVAL '2 days')
    `);
};

const cleanupExpiredEmailOtps = async () => {
    await pool.query(`
        DELETE FROM password_reset_otps
        WHERE expires_at < NOW()
           OR (consumed_at IS NOT NULL AND created_at < NOW() - INTERVAL '2 days')
    `);
};

const isSignupEmailAvailable = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmailAddress(normalizedEmail)) return false;

    const existing = await pool.query('SELECT id, gym_id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length === 0) return true;

    const gymId = existing.rows[0].gym_id;
    if (!gymId) return true;

    const gymExists = await pool.query('SELECT id FROM gyms WHERE id = $1', [gymId]);
    return gymExists.rows.length === 0;
};

const findExistingOauthEmailUser = async (email) => {
    const existing = await pool.query('SELECT id, gym_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length === 0) return null;

    const userId = existing.rows[0].id;
    const gymId = existing.rows[0].gym_id;

    if (!gymId) {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        return null;
    }

    const gymExists = await pool.query('SELECT id FROM gyms WHERE id = $1', [gymId]);
    if (gymExists.rows.length === 0) {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        return null;
    }

    return loadUserAuthContextById(userId);
};

const createOauthOwnerAccount = async ({
    email,
    fullName,
    authProvider,
    providerField,
    providerValue,
    avatarUrl = null,
    ownerPhone = null,
    gymName = null,
    gymCity = null,
    gymAddress = null,
    branchesCount = 1,
    selectedPlan = 'pro',
}) => {
    if (!['google_id', 'apple_id'].includes(providerField)) {
        throw new Error(`Unsupported OAuth provider field: ${providerField}`);
    }

    const ownerName = buildOAuthOwnerName(fullName, email);
    const resolvedGymName = truncateText(gymName || buildOAuthGymName(ownerName), 100) || 'My Gym';
    const resolvedPlan = ['basic', 'pro', 'elite'].includes(String(selectedPlan || '').toLowerCase())
        ? String(selectedPlan).toLowerCase()
        : 'pro';
    const resolvedBranchesCount = Math.max(1, Number.parseInt(branchesCount, 10) || 1);
    const normalizedPhone = String(ownerPhone || '').replace(/\D/g, '').slice(-10) || null;

    const newGym = await pool.query(
        `INSERT INTO gyms (name, address, city, branches_count, current_plan, saas_status)
         VALUES ($1, $2, $3, $4, $5, 'FREE_TRIAL') RETURNING id`,
        [resolvedGymName, gymAddress || null, gymCity || null, resolvedBranchesCount, resolvedPlan]
    );
    const gymId = newGym.rows[0].id;

    const providerColumns = providerField === 'google_id'
        ? 'google_id, avatar_url, auth_provider'
        : 'apple_id, auth_provider';
    const providerValues = providerField === 'google_id'
        ? [providerValue, avatarUrl || null, authProvider]
        : [providerValue, authProvider];

    const newUser = await pool.query(
        `INSERT INTO users (gym_id, full_name, email, phone, password_hash, role, staff_role, is_active, ${providerColumns})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${providerField === 'google_id' ? '$9, $10, $11' : '$9, $10'})
         RETURNING id`,
        [gymId, ownerName, email, normalizedPhone, 'OAUTH_NO_PASSWORD', 'OWNER', 'OWNER', true, ...providerValues]
    );

    return loadUserAuthContextById(newUser.rows[0].id);
};

// POST /api/auth/check-email — real-time duplicate check (called on blur during signup)
router.post('/check-email', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ message: 'Email required.' });
    try {
        const available = await isSignupEmailAvailable(email);
        if (available) return res.json({ available: true });
        return res.status(409).json({ message: 'An account with this email already exists.' });
    } catch (err) {
        return res.status(500).json({ message: 'Check failed.' });
    }
});

router.post('/signup/send-email-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    try {
        await cleanupExpiredEmailOtps();

        if (!(await isSignupEmailAvailable(email))) {
            return res.status(409).json({ message: 'An account with this email already exists.' });
        }

        const activeOtp = await pool.query(
            `SELECT created_at
             FROM password_reset_otps
             WHERE email = $1
               AND purpose = $2
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [email, SIGNUP_EMAIL_VERIFY_PURPOSE]
        );

        if (activeOtp.rows[0]?.created_at) {
            const elapsedSeconds = Math.floor((Date.now() - new Date(activeOtp.rows[0].created_at).getTime()) / 1000);
            const retryAfterSeconds = Math.max(0, PASSWORD_RESET_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
            if (retryAfterSeconds > 0) {
                return res.status(429).json({
                    message: `Please wait ${retryAfterSeconds} seconds before requesting a new code.`,
                    retry_after_seconds: retryAfterSeconds,
                });
            }
        }

        const otp = generatePasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));

        await pool.query('BEGIN');
        await pool.query(
            `UPDATE password_reset_otps
             SET consumed_at = NOW()
             WHERE email = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [email, SIGNUP_EMAIL_VERIFY_PURPOSE]
        );
        await pool.query(
            `INSERT INTO password_reset_otps (user_id, email, purpose, otp_hash, expires_at)
             VALUES (NULL, $1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
            [email, SIGNUP_EMAIL_VERIFY_PURPOSE, otpHash, PASSWORD_RESET_OTP_TTL_MINUTES]
        );
        await pool.query('COMMIT');

        const delivery = await buildSignupEmailOtpDelivery({ email, otp });
        return res.json({
            message: delivery.channel === 'email'
                ? `A verification code was sent to ${delivery.masked_email}.`
                : `A preview verification code is ready for ${delivery.masked_email}.`,
            delivery_mode: delivery.channel,
            masked_email: delivery.masked_email,
            expires_in_minutes: PASSWORD_RESET_OTP_TTL_MINUTES,
            preview_otp: delivery.preview_otp,
            preview_notice: delivery.preview_notice,
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('SIGNUP SEND EMAIL OTP ERROR:', err.message);
        return res.status(500).json({ message: 'Could not prepare signup verification. Please try again.' });
    }
});

router.post('/signup/verify-email-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').replace(/\D/g, '').slice(0, 6);

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (otp.length !== 6) {
        return res.status(400).json({ message: 'Please enter the 6-digit OTP.' });
    }

    try {
        await cleanupExpiredEmailOtps();

        if (!(await isSignupEmailAvailable(email))) {
            return res.status(409).json({ message: 'An account with this email already exists.' });
        }

        const activeOtp = await pool.query(
            `SELECT id, otp_hash, attempts
             FROM password_reset_otps
             WHERE email = $1
               AND purpose = $2
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [email, SIGNUP_EMAIL_VERIFY_PURPOSE]
        );

        const otpRow = activeOtp.rows[0];
        if (!otpRow) {
            return res.status(400).json({ message: 'The verification code is invalid or expired. Request a new one.' });
        }

        const previousAttempts = Number(otpRow.attempts || 0);
        if (previousAttempts >= PASSWORD_RESET_MAX_VERIFY_ATTEMPTS) {
            await pool.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = $1', [otpRow.id]);
            return res.status(400).json({ message: 'Too many invalid attempts. Request a new code.' });
        }

        const isMatch = await bcrypt.compare(otp, String(otpRow.otp_hash || ''));
        if (!isMatch) {
            const nextAttempts = previousAttempts + 1;
            await pool.query(
                `UPDATE password_reset_otps
                 SET attempts = $1,
                     consumed_at = CASE WHEN $1 >= $2 THEN NOW() ELSE consumed_at END
                 WHERE id = $3`,
                [nextAttempts, PASSWORD_RESET_MAX_VERIFY_ATTEMPTS, otpRow.id]
            );

            const attemptsLeft = Math.max(0, PASSWORD_RESET_MAX_VERIFY_ATTEMPTS - nextAttempts);
            return res.status(400).json({
                message: attemptsLeft > 0
                    ? `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`
                    : 'Too many invalid attempts. Request a new code.',
            });
        }

        await pool.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = $1', [otpRow.id]);

        return res.json({
            message: 'Email verified successfully.',
            email_verification_token: createSignupEmailVerificationToken(email),
        });
    } catch (err) {
        console.error('SIGNUP VERIFY EMAIL OTP ERROR:', err.message);
        return res.status(500).json({ message: 'Could not verify signup email OTP. Please try again.' });
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
    const email_verification_token = String(req.body?.email_verification_token || '').trim();
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
    if (!email_verification_token) {
        return res.status(400).json({ message: 'Please verify your email before creating your gym account.' });
    }

    try {
        assertSignupEmailVerificationToken(email_verification_token, email);
    } catch (_err) {
        return res.status(400).json({ message: 'Your email verification has expired. Verify your email again.' });
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
            `SELECT u.*, g.is_active AS gym_is_active, g.gym_access_status, g.saas_status, g.saas_valid_until, g.current_plan
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

        if (String(user.password_hash || '') === 'OAUTH_NO_PASSWORD') {
            return res.status(400).json({ message: getPasswordlessProviderMessage(user) });
        }

        // 2. Securely verify the password typed against the database hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid email or password." });
        }

        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        return sendUserAuthResponse(res, user, 'Login successful!');

    } catch (err) {
        console.error("LOGIN ERROR:", err.message);
        return res.status(500).json({ message: "Server Error" });
    }
});

router.post('/admin/send-otp', async (req, res) => {
    const phone = normalizeLocalIndianPhone(req.body?.phone);

    if (!phone) {
        return res.status(400).json({ message: 'Please enter the registered 10-digit mobile number.' });
    }

    try {
        await cleanupExpiredAdminLoginOtps();

        const user = await loadAdminAuthContextByPhone(phone);
        if (!user) {
            if (isProduction) {
                return res.json(buildGenericAdminOtpDispatch(phone));
            }
            return res.status(404).json({ message: 'No owner or staff account was found with that mobile number.' });
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            if (isProduction) {
                return res.json(buildGenericAdminOtpDispatch(phone));
            }
            return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
        }

        if (user.is_active === false) {
            if (isProduction) {
                return res.json(buildGenericAdminOtpDispatch(phone));
            }
            return res.status(403).json({ message: 'Staff account is inactive. Contact gym owner.' });
        }

        const activeOtp = await pool.query(
            `SELECT created_at
             FROM user_login_otps
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [user.id, ADMIN_LOGIN_PURPOSE]
        );

        if (activeOtp.rows[0]?.created_at) {
            const elapsedSeconds = Math.floor((Date.now() - new Date(activeOtp.rows[0].created_at).getTime()) / 1000);
            const retryAfterSeconds = Math.max(0, ADMIN_LOGIN_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
            if (retryAfterSeconds > 0) {
                return res.status(429).json({
                    message: `Please wait ${retryAfterSeconds} seconds before requesting a new OTP.`,
                    retry_after_seconds: retryAfterSeconds,
                });
            }
        }

        const deliveryMode = getMsg91OtpMode();
        const previewOtp = deliveryMode === OTP_MODES.PREVIEW ? generateAdminLoginOtp() : '';
        const otpHash = previewOtp ? await bcrypt.hash(previewOtp, await bcrypt.genSalt(10)) : null;
        let providerRequestId = null;

        if (deliveryMode === OTP_MODES.MSG91) {
            try {
                const providerResponse = await requestMsg91Otp(phone);
                providerRequestId = providerResponse?.request_id || providerResponse?.data?.request_id || null;
            } catch (providerErr) {
                console.error('ADMIN SEND OTP PROVIDER ERROR:', providerErr.message);
                return res.status(502).json({ message: 'Could not send the OTP right now. Please try again shortly.' });
            }
        }

        await pool.query('BEGIN');
        await pool.query(
            `UPDATE user_login_otps
             SET consumed_at = NOW()
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [user.id, ADMIN_LOGIN_PURPOSE]
        );
        await pool.query(
            `INSERT INTO user_login_otps (user_id, phone, purpose, otp_hash, delivery_mode, provider_request_id, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' minutes')::interval)`,
            [user.id, phone, ADMIN_LOGIN_PURPOSE, otpHash, deliveryMode, providerRequestId, ADMIN_LOGIN_OTP_TTL_MINUTES]
        );
        await pool.query('COMMIT');

        return res.json({
            message: isProduction
                ? buildGenericAdminOtpDispatch(phone).message
                : deliveryMode === OTP_MODES.PREVIEW
                    ? 'Preview OTP prepared for your owner login.'
                    : 'OTP sent to your registered mobile number.',
            delivery_mode: deliveryMode.toLowerCase(),
            masked_phone: maskPhone(phone),
            expires_in_minutes: ADMIN_LOGIN_OTP_TTL_MINUTES,
            preview_otp: isProduction ? '' : previewOtp,
            preview_notice: isProduction
                ? ''
                : deliveryMode === OTP_MODES.PREVIEW
                    ? 'MSG91 owner OTP is still in preview mode, so the code is shown directly here.'
                    : '',
            user_name: String(user.full_name || '').trim().split(/\s+/)[0] || '',
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('ADMIN SEND OTP ERROR:', err.message);
        return res.status(500).json({ message: 'Could not prepare login OTP. Please try again.' });
    }
});

router.post('/admin/verify-otp', async (req, res) => {
    const phone = normalizeLocalIndianPhone(req.body?.phone);
    const otp = String(req.body?.otp || '').replace(/\D/g, '').slice(0, 6);

    if (!phone) {
        return res.status(400).json({ message: 'Please enter the registered 10-digit mobile number.' });
    }
    if (otp.length !== 6) {
        return res.status(400).json({ message: 'Please enter the 6-digit OTP.' });
    }

    try {
        await cleanupExpiredAdminLoginOtps();

        const user = await loadAdminAuthContextByPhone(phone);
        if (!user) {
            return res.status(400).json({ message: 'The OTP is invalid or expired. Request a new one.' });
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
        }

        if (user.is_active === false) {
            return res.status(403).json({ message: 'Staff account is inactive. Contact gym owner.' });
        }

        const activeOtp = await pool.query(
            `SELECT id, otp_hash, attempts, delivery_mode
             FROM user_login_otps
             WHERE user_id = $1
               AND phone = $2
               AND purpose = $3
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [user.id, phone, ADMIN_LOGIN_PURPOSE]
        );

        const otpRow = activeOtp.rows[0];
        if (!otpRow) {
            return res.status(400).json({ message: 'The OTP is invalid or expired. Request a new one.' });
        }

        const previousAttempts = Number(otpRow.attempts || 0);
        if (previousAttempts >= ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS) {
            await pool.query('UPDATE user_login_otps SET consumed_at = NOW() WHERE id = $1', [otpRow.id]);
            return res.status(400).json({ message: 'Too many invalid attempts. Request a new OTP.' });
        }

        let isValidOtp = false;
        let invalidMessage = 'Invalid OTP. Please try again.';
        let shouldConsumeOtp = false;

        if (String(otpRow.delivery_mode || OTP_MODES.PREVIEW).toUpperCase() === OTP_MODES.MSG91) {
            let verifyResult;
            try {
                verifyResult = await verifyMsg91Otp(phone, otp);
            } catch (providerErr) {
                console.error('ADMIN VERIFY OTP PROVIDER ERROR:', providerErr.message);
                return res.status(502).json({ message: 'Could not verify the OTP right now. Please try again.' });
            }
            isValidOtp = Boolean(verifyResult.verified);
            shouldConsumeOtp = Boolean(verifyResult.expired);
            invalidMessage = verifyResult.expired
                ? 'OTP expired. Request a new OTP.'
                : (verifyResult.message || 'Invalid OTP. Please try again.');
        } else {
            isValidOtp = await bcrypt.compare(otp, String(otpRow.otp_hash || ''));
        }

        if (!isValidOtp) {
            const nextAttempts = previousAttempts + 1;
            await pool.query(
                `UPDATE user_login_otps
                 SET attempts = $1,
                     consumed_at = CASE WHEN $1 >= $2 OR $3 THEN NOW() ELSE consumed_at END
                 WHERE id = $4`,
                [nextAttempts, ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS, shouldConsumeOtp, otpRow.id]
            );

            if (shouldConsumeOtp) {
                return res.status(400).json({ message: invalidMessage });
            }

            const attemptsLeft = Math.max(0, ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS - nextAttempts);
            return res.status(400).json({
                message: attemptsLeft > 0
                    ? `${invalidMessage} ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`
                    : 'Too many invalid attempts. Request a new OTP.',
            });
        }

        await pool.query('BEGIN');
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        await pool.query(
            `UPDATE user_login_otps
             SET consumed_at = NOW()
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [user.id, ADMIN_LOGIN_PURPOSE]
        );
        await pool.query('COMMIT');

        return sendUserAuthResponse(res, user, 'OTP verified. Login successful!');
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('ADMIN VERIFY OTP ERROR:', err.message);
        return res.status(500).json({ message: 'Could not complete OTP login. Please try again.' });
    }
});

router.post('/admin/send-email-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ message: 'Please enter the registered email address.' });
    }

    try {
        await cleanupExpiredEmailOtps();

        const user = await loadAdminAuthContextByEmail(email);
        if (!user) {
            return res.status(404).json({ message: 'No owner or staff account was found with that email address.' });
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
        }

        if (user.is_active === false) {
            return res.status(403).json({ message: 'Staff account is inactive. Contact gym owner.' });
        }

        const activeOtp = await pool.query(
            `SELECT created_at
             FROM password_reset_otps
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [user.id, ADMIN_EMAIL_LOGIN_PURPOSE]
        );

        if (activeOtp.rows[0]?.created_at) {
            const elapsedSeconds = Math.floor((Date.now() - new Date(activeOtp.rows[0].created_at).getTime()) / 1000);
            const retryAfterSeconds = Math.max(0, ADMIN_LOGIN_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
            if (retryAfterSeconds > 0) {
                return res.status(429).json({
                    message: `Please wait ${retryAfterSeconds} seconds before requesting a new OTP.`,
                    retry_after_seconds: retryAfterSeconds,
                });
            }
        }

        const otp = generateAdminLoginOtp();
        const otpHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));

        await pool.query('BEGIN');
        await pool.query(
            `UPDATE password_reset_otps
             SET consumed_at = NOW()
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [user.id, ADMIN_EMAIL_LOGIN_PURPOSE]
        );
        await pool.query(
            `INSERT INTO password_reset_otps (user_id, email, purpose, otp_hash, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
            [user.id, email, ADMIN_EMAIL_LOGIN_PURPOSE, otpHash, ADMIN_LOGIN_OTP_TTL_MINUTES]
        );
        await pool.query('COMMIT');

        const delivery = await buildAdminEmailOtpDelivery({ email, otp, userName: user.full_name });
        return res.json({
            message: delivery.channel === 'email'
                ? `A sign-in code was sent to ${delivery.masked_email}.`
                : `A preview sign-in code is ready for ${delivery.masked_email}.`,
            delivery_mode: delivery.channel,
            masked_email: delivery.masked_email,
            expires_in_minutes: ADMIN_LOGIN_OTP_TTL_MINUTES,
            preview_otp: delivery.preview_otp,
            preview_notice: delivery.preview_notice,
            user_name: String(user.full_name || '').trim().split(/\s+/)[0] || '',
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('ADMIN SEND EMAIL OTP ERROR:', err.message);
        return res.status(500).json({ message: 'Could not prepare email OTP login. Please try again.' });
    }
});

router.post('/admin/verify-email-otp', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').replace(/\D/g, '').slice(0, 6);

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ message: 'Please enter the registered email address.' });
    }
    if (otp.length !== 6) {
        return res.status(400).json({ message: 'Please enter the 6-digit OTP.' });
    }

    try {
        await cleanupExpiredEmailOtps();

        const user = await loadAdminAuthContextByEmail(email);
        if (!user) {
            return res.status(400).json({ message: 'The OTP is invalid or expired. Request a new one.' });
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
        }

        if (user.is_active === false) {
            return res.status(403).json({ message: 'Staff account is inactive. Contact gym owner.' });
        }

        const activeOtp = await pool.query(
            `SELECT id, otp_hash, attempts
             FROM password_reset_otps
             WHERE user_id = $1
               AND email = $2
               AND purpose = $3
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [user.id, email, ADMIN_EMAIL_LOGIN_PURPOSE]
        );

        const otpRow = activeOtp.rows[0];
        if (!otpRow) {
            return res.status(400).json({ message: 'The OTP is invalid or expired. Request a new one.' });
        }

        const previousAttempts = Number(otpRow.attempts || 0);
        if (previousAttempts >= ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS) {
            await pool.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = $1', [otpRow.id]);
            return res.status(400).json({ message: 'Too many invalid attempts. Request a new OTP.' });
        }

        const isMatch = await bcrypt.compare(otp, String(otpRow.otp_hash || ''));
        if (!isMatch) {
            const nextAttempts = previousAttempts + 1;
            await pool.query(
                `UPDATE password_reset_otps
                 SET attempts = $1,
                     consumed_at = CASE WHEN $1 >= $2 THEN NOW() ELSE consumed_at END
                 WHERE id = $3`,
                [nextAttempts, ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS, otpRow.id]
            );

            const attemptsLeft = Math.max(0, ADMIN_LOGIN_MAX_VERIFY_ATTEMPTS - nextAttempts);
            return res.status(400).json({
                message: attemptsLeft > 0
                    ? `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`
                    : 'Too many invalid attempts. Request a new OTP.',
            });
        }

        await pool.query('BEGIN');
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        await pool.query(
            `UPDATE password_reset_otps
             SET consumed_at = NOW()
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [user.id, ADMIN_EMAIL_LOGIN_PURPOSE]
        );
        await pool.query('COMMIT');

        return sendUserAuthResponse(res, user, 'OTP verified. Login successful!');
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('ADMIN VERIFY EMAIL OTP ERROR:', err.message);
        return res.status(500).json({ message: 'Could not complete email OTP login. Please try again.' });
    }
});

router.post('/password-reset/request', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    try {
        await cleanupExpiredEmailOtps();

        const user = await loadUserAuthContextByEmail(email);
        if (!user) {
            if (isProduction) {
                return res.json(buildGenericPasswordResetDispatch(email));
            }
            return res.status(404).json({ message: 'No account was found with that email address.' });
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            if (isProduction) {
                return res.json(buildGenericPasswordResetDispatch(email));
            }
            return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
        }

        if (user.is_active === false) {
            if (isProduction) {
                return res.json(buildGenericPasswordResetDispatch(email));
            }
            return res.status(403).json({ message: 'Staff account is inactive. Contact gym owner.' });
        }

        if (String(user.password_hash || '') === 'OAUTH_NO_PASSWORD') {
            if (isProduction) {
                return res.json(buildGenericPasswordResetDispatch(email));
            }
            return res.status(400).json({ message: getPasswordlessProviderMessage(user) });
        }

        const activeReset = await pool.query(
            `SELECT id, created_at
             FROM password_reset_otps
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [user.id, PASSWORD_RESET_PURPOSE]
        );

        if (activeReset.rows[0]?.created_at) {
            const elapsedSeconds = Math.floor((Date.now() - new Date(activeReset.rows[0].created_at).getTime()) / 1000);
            const retryAfterSeconds = Math.max(0, PASSWORD_RESET_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
            if (retryAfterSeconds > 0) {
                return res.status(429).json({
                    message: `Please wait ${retryAfterSeconds} seconds before requesting a new code.`,
                    retry_after_seconds: retryAfterSeconds,
                });
            }
        }

        const otp = generatePasswordResetOtp();
        const salt = await bcrypt.genSalt(10);
        const otpHash = await bcrypt.hash(otp, salt);

        await pool.query('BEGIN');
        await pool.query(
            `UPDATE password_reset_otps
             SET consumed_at = NOW()
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [user.id, PASSWORD_RESET_PURPOSE]
        );
        await pool.query(
            `INSERT INTO password_reset_otps (user_id, email, purpose, otp_hash, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
            [user.id, email, PASSWORD_RESET_PURPOSE, otpHash, PASSWORD_RESET_OTP_TTL_MINUTES]
        );
        await pool.query('COMMIT');

        const delivery = await buildPasswordResetDelivery({ email, otp, userName: user.full_name });
        return res.json({
            message: isProduction
                ? buildGenericPasswordResetDispatch(email).message
                : `A reset code is ready for ${delivery.masked_email}.`,
            delivery_channel: isProduction ? 'email' : delivery.channel,
            masked_email: delivery.masked_email,
            expires_in_minutes: PASSWORD_RESET_OTP_TTL_MINUTES,
            preview_otp: isProduction ? '' : delivery.preview_otp,
            preview_notice: isProduction ? '' : delivery.preview_notice,
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('PASSWORD RESET REQUEST ERROR:', err.message);
        return res.status(500).json({ message: 'Could not start password recovery. Please try again.' });
    }
});

router.post('/password-reset/confirm', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').replace(/\D/g, '').slice(0, 6);
    const newPassword = String(req.body?.new_password || '');

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!otp || otp.length !== 6) {
        return res.status(400).json({ message: 'Please enter the 6-digit OTP.' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    try {
        const user = await loadUserAuthContextByEmail(email);
        if (!user) {
            return res.status(400).json({ message: 'The reset code is invalid or expired. Request a new one.' });
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
        }

        if (user.is_active === false) {
            return res.status(403).json({ message: 'Staff account is inactive. Contact gym owner.' });
        }

        if (String(user.password_hash || '') === 'OAUTH_NO_PASSWORD') {
            return res.status(400).json({ message: getPasswordlessProviderMessage(user) });
        }

        const activeReset = await pool.query(
            `SELECT id, otp_hash, attempts
             FROM password_reset_otps
             WHERE user_id = $1
               AND email = $2
               AND purpose = $3
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [user.id, email, PASSWORD_RESET_PURPOSE]
        );

        const resetRow = activeReset.rows[0];
        if (!resetRow) {
            return res.status(400).json({ message: 'The reset code is invalid or expired. Request a new one.' });
        }

        const previousAttempts = Number(resetRow.attempts || 0);
        if (previousAttempts >= PASSWORD_RESET_MAX_VERIFY_ATTEMPTS) {
            await pool.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = $1', [resetRow.id]);
            return res.status(400).json({ message: 'Too many invalid attempts. Request a new code.' });
        }

        const isMatch = await bcrypt.compare(otp, resetRow.otp_hash);
        if (!isMatch) {
            const nextAttempts = previousAttempts + 1;
            await pool.query(
                `UPDATE password_reset_otps
                 SET attempts = $1,
                     consumed_at = CASE WHEN $1 >= $2 THEN NOW() ELSE consumed_at END
                 WHERE id = $3`,
                [nextAttempts, PASSWORD_RESET_MAX_VERIFY_ATTEMPTS, resetRow.id]
            );

            const attemptsLeft = Math.max(0, PASSWORD_RESET_MAX_VERIFY_ATTEMPTS - nextAttempts);
            return res.status(400).json({
                message: attemptsLeft > 0
                    ? `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`
                    : 'Too many invalid attempts. Request a new code.',
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await pool.query('BEGIN');
        await pool.query(
            `UPDATE users
             SET password_hash = $1,
                 auth_provider = COALESCE(NULLIF(auth_provider, ''), 'local')
             WHERE id = $2`,
            [hashedPassword, user.id]
        );
        await pool.query(
            `UPDATE password_reset_otps
             SET consumed_at = NOW()
             WHERE user_id = $1
               AND purpose = $2
               AND consumed_at IS NULL`,
            [user.id, PASSWORD_RESET_PURPOSE]
        );
        await pool.query('COMMIT');

        return res.json({ message: 'Password updated successfully. Sign in with your new password.' });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('PASSWORD RESET CONFIRM ERROR:', err.message);
        return res.status(500).json({ message: 'Could not reset password. Please try again.' });
    }
});

// ─── AUTH CONFIG ──────────────────────────────────────────────────────────────
// Returns which social providers are configured (for frontend feature detection)
router.get('/config', (req, res) => {
    res.json({
        google_auth_enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        apple_client_id: process.env.APPLE_CLIENT_ID || null,
        signup_email_otp_enabled: true,
        signup_email_otp_mode: getSignupEmailOtpMode(),
        admin_email_otp_enabled: false,
        admin_email_otp_mode: 'disabled',
        admin_phone_otp_enabled: false,
        admin_phone_otp_mode: 'disabled',
    });
});

// ─── GOOGLE OAUTH 2.0 ─────────────────────────────────────────────────────────
// GET /api/auth/google — Redirect user to Google consent screen
router.get('/google', (req, res) => {
    const mode = normalizeAuthMode(req.query?.mode);
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_not_configured' }));
    }
    const redirectUri = getGoogleRedirectUri();
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'email profile',
        access_type: 'offline',
        prompt: 'select_account',
        state: mode,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback — Google sends back the auth code
router.get('/google/callback', async (req, res) => {
    const mode = normalizeAuthMode(req.query?.state);
    const code = String(req.query?.code || '');
    if (!code) {
        return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_cancelled' }));
    }

    try {
        const redirectUri = getGoogleRedirectUri();

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
            return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_token_failed' }));
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
            return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_profile_failed' }));
        }

        if (mode === 'signup') {
            const existingGoogleUser = await loadUserAuthContextByProvider('google_id', googleId);
            if (existingGoogleUser) {
                return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_account_exists' }));
            }

            const emailUser = await findExistingOauthEmailUser(email);
            if (emailUser) {
                return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_email_in_use' }));
            }

            const signupToken = createGoogleSignupToken({
                googleId,
                email,
                fullName,
                avatarUrl,
            });

            return res.redirect(buildFrontendAuthRedirect({
                mode,
                source: 'google',
                extraParams: {
                    google_signup_token: signupToken,
                    signup_email: email,
                    signup_name: fullName,
                    signup_avatar: avatarUrl,
                },
            }));
        }

        await pool.query('BEGIN');

        let user = await loadUserAuthContextByProvider('google_id', googleId);
        if (!user) {
            await pool.query('ROLLBACK');
            const emailUser = await findExistingOauthEmailUser(email);
            const error = emailUser ? 'google_use_email_login' : 'google_signup_required';
            return res.redirect(buildFrontendAuthRedirect({ mode, error }));
        }

        const authError = getOauthAccountError(user);
        if (authError) {
            await pool.query('ROLLBACK');
            return res.redirect(buildFrontendAuthRedirect({ mode, error: authError }));
        }

        if (String(user.password_hash || '') !== 'OAUTH_NO_PASSWORD') {
            await pool.query('ROLLBACK');
            return res.redirect(buildFrontendAuthRedirect({ mode, error: 'google_use_email_login' }));
        }

        await pool.query(
            'UPDATE users SET avatar_url = $1, last_login_at = NOW() WHERE id = $2',
            [avatarUrl, user.id]
        );
        user = await loadUserAuthContextById(user.id);

        await pool.query('COMMIT');

        const { token } = issueAuthToken({
            ...user,
            role: user.role || 'OWNER',
            staff_role: user.staff_role || 'OWNER',
            is_active: true,
        });

        setUserAuthCookie(res, token);
        res.redirect(buildFrontendAuthRedirect({ mode, token, source: 'google' }));
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('GOOGLE OAUTH ERROR:', err);
        res.redirect(buildFrontendAuthRedirect({ mode, error: 'server_error' }));
    }
});

router.post('/google/signup/complete', async (req, res) => {
    const signupToken = String(req.body?.signup_token || '').trim();
    const gymName = String(req.body?.gym_name || '').trim();
    const fullName = String(req.body?.full_name || '').trim();
    const ownerPhone = String(req.body?.owner_phone || '').replace(/\D/g, '').slice(-10);
    const gymAddress = req.body?.gym_address ? String(req.body.gym_address).trim() : null;
    const gymCity = req.body?.gym_city ? String(req.body.gym_city).trim() : null;
    const branchesCount = Number.parseInt(req.body?.branches_count, 10) || 1;
    const selectedPlan = ['basic', 'pro', 'elite'].includes(String(req.body?.selected_plan || '').toLowerCase())
        ? String(req.body.selected_plan).toLowerCase()
        : 'basic';

    if (!signupToken) {
        return res.status(400).json({ message: 'Google signup session is missing. Please continue with Google again.' });
    }
    if (!gymName || !fullName || !gymCity) {
        return res.status(400).json({ message: 'Gym name, owner name, and city are required.' });
    }
    if (!ownerPhone || ownerPhone.length < 10) {
        return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number.' });
    }

    try {
        const payload = verifyGoogleSignupToken(signupToken);
        const email = String(payload.email || '').trim().toLowerCase();
        const googleId = String(payload.google_id || '').trim();
        const avatarUrl = String(payload.avatar_url || '').trim();
        const ownerName = fullName || String(payload.full_name || '').trim();

        await pool.query('BEGIN');

        const existingGoogleUser = await loadUserAuthContextByProvider('google_id', googleId);
        if (existingGoogleUser) {
            await pool.query('ROLLBACK');
            return res.status(409).json({ message: 'This Google account is already registered. Sign in with Google instead.' });
        }

        const existingEmailUser = await findExistingOauthEmailUser(email);
        if (existingEmailUser) {
            await pool.query('ROLLBACK');
            return res.status(409).json({ message: 'An account with this email already exists. Use the original sign-in method.' });
        }

        const existingPhone = await pool.query('SELECT id FROM users WHERE phone LIKE $1', [`%${ownerPhone}`]);
        if (existingPhone.rows.length > 0) {
            await pool.query('ROLLBACK');
            return res.status(409).json({ message: 'This phone number is already registered.' });
        }

        const user = await createOauthOwnerAccount({
            email,
            fullName: ownerName,
            authProvider: 'google',
            providerField: 'google_id',
            providerValue: googleId,
            avatarUrl,
            ownerPhone,
            gymName,
            gymCity,
            gymAddress,
            branchesCount,
            selectedPlan,
        });

        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

        await pool.query('COMMIT');

        const { token, permissions } = issueAuthToken({
            ...user,
            role: user.role || 'OWNER',
            staff_role: user.staff_role || 'OWNER',
            is_active: true,
        });

        const payloadResponse = {
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                gym_id: user.gym_id,
                role: user.role,
                staff_role: user.staff_role,
                is_active: user.is_active,
                permissions,
            },
            saas: {
                status: user.saas_status || 'ACTIVE',
                valid_until: user.saas_valid_until,
                plan: user.current_plan,
            }
        };

        setUserAuthCookie(res, token);
        return res.json(payloadResponse);
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        if (err?.message === 'INVALID_GOOGLE_SIGNUP_TOKEN' || err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
            return res.status(400).json({ message: 'Google signup session expired. Please continue with Google again.' });
        }
        console.error('GOOGLE SIGNUP COMPLETE ERROR:', err);
        return res.status(500).json({ message: 'Could not finish Google signup. Please try again.' });
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

        let user = await loadUserAuthContextByProvider('apple_id', appleId);

        if (user) {
            const authError = getOauthAccountError(user);
            if (authError) {
                await pool.query('ROLLBACK');
                return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
            }
            await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
            user = await loadUserAuthContextById(user.id);
        } else if (email) {
            const emailUser = await findExistingOauthEmailUser(email);
            if (emailUser) {
                const authError = getOauthAccountError(emailUser);
                if (authError) {
                    await pool.query('ROLLBACK');
                    return res.status(403).json({ message: 'Account Suspended. Please contact GymVault HQ.' });
                }
                await pool.query(
                    'UPDATE users SET apple_id = $1, auth_provider = $2, last_login_at = NOW() WHERE id = $3',
                    [appleId, 'apple', emailUser.id]
                );
                user = await loadUserAuthContextById(emailUser.id);
            } else {
                user = await createOauthOwnerAccount({
                    email,
                    fullName,
                    authProvider: 'apple',
                    providerField: 'apple_id',
                    providerValue: appleId,
                });
            }
        } else {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot create account: Apple did not provide an email address.' });
        }

        await pool.query('COMMIT');

        const permissions = getAuthPermissions(user);
        const token = jwt.sign(
            { user: { id: user.id, gym_id: user.gym_id, role: user.role || 'OWNER', staff_role: user.staff_role || 'OWNER', permissions, is_active: true } },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        setUserAuthCookie(res, token);
        return res.json({
            token,
            user: { id: user.id, full_name: user.full_name, email: user.email, gym_id: user.gym_id, role: user.role, permissions }
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('APPLE AUTH ERROR:', err);
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
        // OTP bypass — set MEMBER_OTP_BYPASS=true in env to skip real OTP (dev only)
        const bypassMode = process.env.MEMBER_OTP_BYPASS === 'true';
        const otp = bypassMode ? 'BYPASS' : String(require('crypto').randomInt(100000, 999999));
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

        setMemberAuthCookie(res, token);
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

router.post('/logout', (_req, res) => {
    clearUserAuthCookie(res);
    clearMemberAuthCookie(res);
    return res.json({ success: true });
});

// GET /api/auth/member/me — returns member profile (authenticated via member JWT)
router.get('/member/me', async (req, res) => {
    const token = req.header('x-auth-token') || getRequestCookie(req, MEMBER_AUTH_COOKIE);
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
    const token = req.header('x-auth-token') || getRequestCookie(req, MEMBER_AUTH_COOKIE);
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