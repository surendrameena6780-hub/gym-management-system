const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { connectDB, pool } = require('./config/db');
const fs = require('fs'); 
const path = require('path');
const { PROFILE_UPLOAD_DIR, allowedProfileImageExtensions } = require('./utils/profileUploads');

// Import Jobs and Middleware
const checkExpirations = require('./jobs/expiryCheck');
const auth = require('./middleware/authMiddleware');

// Import Routes
const authRoutes = require('./routes/auth');
const planRoutes = require('./routes/plans');
const memberRoutes = require('./routes/members');
const membershipRoutes = require('./routes/memberships');
const paymentRoutes = require('./routes/payments');
const attendanceRoutes = require('./routes/attendance');
const insightsRoutes = require('./routes/insights');
const dashboardRoutes = require('./routes/dashboard');
const superAdminRoutes = require('./routes/superadmin');
const settingsRoutes = require('./routes/settings');
const billingRoutes = require('./routes/billing');
const notificationRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');
const supportRoutes = require('./routes/support');

dotenv.config();
const app = express();

const parseTrustProxySetting = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (raw.toLowerCase() === 'true') return true;
    if (raw.toLowerCase() === 'false') return false;
    const asNumber = Number.parseInt(raw, 10);
    if (Number.isInteger(asNumber) && `${asNumber}` === raw) return asNumber;
    return raw;
};

const requiredEnv = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'JWT_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    throw new Error(`FATAL: Missing required env vars: ${missingEnv.join(', ')}`);
}
if (process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is insecure. Set a strong random secret in environment.');
}

const corsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';

const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const trustProxySetting = parseTrustProxySetting(process.env.TRUST_PROXY);

if (isProduction && corsOrigins.length === 0) {
    throw new Error('FATAL: CORS_ORIGIN is required in production.');
}

if (trustProxySetting) {
    app.set('trust proxy', trustProxySetting);
}

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (corsOrigins.includes(origin)) return callback(null, true);

        if (!isProduction && defaultDevOrigins.includes(origin)) return callback(null, true);

        return callback(new Error('Not allowed by CORS'));
    }
};

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json());
app.use(cors(corsOptions));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 600 : 5000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const resetTimeMs = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + (15 * 60 * 1000);
        const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));
        return res.status(429).json({
            success: false,
            data: null,
            error: `Too many requests. Please retry in about ${retryAfterSeconds} seconds.`,
            code: 'RATE_LIMITED',
            retry_after_seconds: retryAfterSeconds,
        });
    },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 25 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
        const resetTimeMs = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + (15 * 60 * 1000);
        const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));
        return res.status(429).json({
            success: false,
            data: null,
            error: `Too many login attempts. Please retry in about ${retryAfterSeconds} seconds.`,
            message: `Too many login attempts. Please retry in about ${retryAfterSeconds} seconds.`,
            code: 'LOGIN_RATE_LIMITED',
            retry_after_seconds: retryAfterSeconds,
        });
    },
});

app.use('/api/', (req, res, next) => {
    if (req.path === '/auth/login' || req.path === '/superadmin/login') {
        return next();
    }
    return apiLimiter(req, res, next);
});
app.use('/api/auth/login', authLimiter);
app.use('/api/superadmin/login', authLimiter);

app.use(
    '/uploads/profiles',
    (req, res, next) => {
        const requestedExtension = path.extname(req.path).toLowerCase();
        if (!allowedProfileImageExtensions.has(requestedExtension)) {
            return res.status(404).json({ error: 'Not found' });
        }
        return next();
    },
    express.static(PROFILE_UPLOAD_DIR, {
        index: false,
        fallthrough: false,
        dotfiles: 'deny',
        maxAge: isProduction ? '7d' : 0,
        immutable: isProduction,
        setHeaders: (res) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Disposition', 'inline');
        },
    })
);

app.use('/api/users', require('./routes/users'));

// Database Connection
connectDB();

// Create uploads folder structure if missing
const uploadDir = path.join(__dirname, 'uploads');
const profileDir = PROFILE_UPLOAD_DIR;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/superadmin', superAdminRoutes); 
app.use('/api/settings', settingsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/support', supportRoutes);

// Auth Status Check
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, gym_id, full_name, email, role, staff_role, is_active, permissions
             FROM users
             WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({
            user: result.rows[0],
        });
    } catch (err) {
        console.error('AUTH ME ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

app.get('/healthz', (_req, res) => {
    return res.status(200).json({
        status: 'ok',
        service: 'gym-management-system',
        timestamp: new Date().toISOString(),
    });
});

app.get('/', (req, res) => {
    res.send('Gym Management System API: Online');
});

app.use((err, req, res, next) => {
    console.error('UNHANDLED ERROR:', err);
    if (res.headersSent) return next(err);
    return res.status(err.status || 500).json({
        error: err?.message || 'Server Error',
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Expiration Janitor
setInterval(() => {
    checkExpirations();
}, 1000 * 60 * 60); 

checkExpirations();