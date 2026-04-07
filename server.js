const express = require('express');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { connectDB, pool } = require('./config/db');
const fs = require('fs'); 
const path = require('path');
const { PROFILE_UPLOAD_DIR, allowedProfileImageExtensions } = require('./utils/profileUploads');
const { setUserAuthCookie } = require('./utils/authCookies');
const { DEFAULT_BRANCH_ID } = require('./utils/branchAccess');
const { enforceRequestPayloadLimits } = require('./utils/requestPayloadGuards');
const {
    runtimeTelemetryMiddleware,
    captureExpressError,
    captureProcessError,
    capturePoolError,
} = require('./utils/runtimeTelemetry');

// Import Jobs and Middleware
const checkExpirations = require('./jobs/expiryCheck');
const { runAutomatedNotificationNudges } = require('./jobs/notificationAutomation');
const { runRetentionMaintenance } = require('./jobs/retentionMaintenance');
const { runDatabaseBackup } = require('./jobs/databaseBackup');
const auth = require('./middleware/authMiddleware');

// Import Routes
const authRoutes = require('./routes/auth');
const planRoutes = require('./routes/plans');
const memberRoutes = require('./routes/members');
const memberSelfServiceRoutes = require('./routes/member');
const membershipRoutes = require('./routes/memberships');
const paymentRoutes = require('./routes/payments');
const attendanceRoutes = require('./routes/attendance');
const leadsRoutes = require('./routes/leads');
const classesRoutes = require('./routes/classes');
const insightsRoutes = require('./routes/insights');
const dashboardRoutes = require('./routes/dashboard');
const superAdminRoutes = require('./routes/superadmin');
const settingsRoutes = require('./routes/settings');
const billingRoutes = require('./routes/billing');
const notificationRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');
const supportRoutes = require('./routes/support');
const financeRoutes = require('./routes/finance');
const exportRoutes = require('./routes/exports');

dotenv.config();
const app = express();
let httpServer = null;
let stopBackgroundJobRunner = null;
let shuttingDown = false;

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
const REQUIRED_NODE_VERSION = '20.18.0';
const currentNodeVersion = String(process.version || '').replace(/^v/, '');

if (isProduction && currentNodeVersion !== REQUIRED_NODE_VERSION) {
    throw new Error(`FATAL: Production backend requires Node ${REQUIRED_NODE_VERSION}. Current runtime is ${currentNodeVersion}.`);
}

if (!isProduction && currentNodeVersion !== REQUIRED_NODE_VERSION) {
    console.warn(`Node ${currentNodeVersion} detected. Production is pinned to ${REQUIRED_NODE_VERSION}.`);
}

const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const trustProxySetting = parseTrustProxySetting(process.env.TRUST_PROXY);

if (isProduction && corsOrigins.length === 0) {
    throw new Error('FATAL: CORS_ORIGIN is required in production.');
}

if (trustProxySetting) {
    app.set('trust proxy', trustProxySetting);
}

const corsOptions = {
    credentials: true,
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
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(cors(corsOptions));
app.use(compression({ threshold: 1024 }));
app.use(enforceRequestPayloadLimits);
app.use(runtimeTelemetryMiddleware);

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

const buildScopedLimiter = ({ windowMs, productionMax, developmentMax, code, description }) => rateLimit({
    windowMs,
    max: isProduction ? productionMax : developmentMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const resetTimeMs = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + windowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));
        return res.status(429).json({
            success: false,
            code,
            error: `Too many ${description}. Retry in about ${retryAfterSeconds} seconds.`,
            retry_after_seconds: retryAfterSeconds,
        });
    },
});

const limitMethods = (methods, limiter) => (req, res, next) => {
    if (!methods.includes(req.method)) {
        return next();
    }
    return limiter(req, res, next);
};

const memberCreateLimiter = buildScopedLimiter({
    windowMs: 15 * 60 * 1000,
    productionMax: 60,
    developmentMax: 600,
    code: 'MEMBER_CREATE_RATE_LIMITED',
    description: 'member creations',
});

const leadCreateLimiter = buildScopedLimiter({
    windowMs: 15 * 60 * 1000,
    productionMax: 80,
    developmentMax: 800,
    code: 'LEAD_CREATE_RATE_LIMITED',
    description: 'lead creations',
});

const notificationSendLimiter = buildScopedLimiter({
    windowMs: 15 * 60 * 1000,
    productionMax: 20,
    developmentMax: 200,
    code: 'NOTIFICATION_SEND_RATE_LIMITED',
    description: 'notification sends',
});

const exportLimiter = buildScopedLimiter({
    windowMs: 15 * 60 * 1000,
    productionMax: 30,
    developmentMax: 300,
    code: 'EXPORT_RATE_LIMITED',
    description: 'exports',
});

const pushSubscribeLimiter = buildScopedLimiter({
    windowMs: 60 * 60 * 1000,
    productionMax: 40,
    developmentMax: 400,
    code: 'PUSH_SUBSCRIBE_RATE_LIMITED',
    description: 'push subscription registrations',
});

const rfidEventLimiter = buildScopedLimiter({
    windowMs: 5 * 60 * 1000,
    productionMax: 1200,
    developmentMax: 12000,
    code: 'RFID_EVENT_RATE_LIMITED',
    description: 'RFID events',
});

app.use('/api/', (req, res, next) => {
    if (req.path === '/auth/login' || req.path === '/superadmin/login') {
        return next();
    }
    return apiLimiter(req, res, next);
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/admin/send-otp', authLimiter);
app.use('/api/auth/admin/verify-otp', authLimiter);
app.use('/api/superadmin/login', authLimiter);
app.use('/api/auth/member/send-otp', authLimiter);
app.use('/api/auth/member/verify-otp', authLimiter);
app.use('/api/auth/password-reset/request', authLimiter);
app.use('/api/auth/password-reset/confirm', authLimiter);
app.use('/api/members/add', limitMethods(['POST'], memberCreateLimiter));
app.use('/api/leads', limitMethods(['POST'], leadCreateLimiter));
app.use('/api/notifications/reminders/send', limitMethods(['POST'], notificationSendLimiter));
app.use('/api/notifications/campaign/run', limitMethods(['POST'], notificationSendLimiter));
app.use('/api/exports', limitMethods(['GET'], exportLimiter));
app.use('/api/push/subscribe-member', limitMethods(['POST'], pushSubscribeLimiter));
app.use('/api/push/subscribe', limitMethods(['POST'], pushSubscribeLimiter));
app.use('/api/attendance/rfid/event', limitMethods(['POST'], rfidEventLimiter));

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

// Create uploads folder structure if missing
const uploadDir = path.join(__dirname, 'uploads');
const profileDir = PROFILE_UPLOAD_DIR;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/member', memberSelfServiceRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/superadmin', superAdminRoutes); 
app.use('/api/settings', settingsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/exports', exportRoutes);

// Auth Status Check
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.gym_id, u.full_name, u.email, u.role, u.staff_role, u.is_active, u.permissions,
                    COALESCE(u.branch_id, $2) AS branch_id,
                    g.saas_status, g.saas_valid_until, g.current_plan
             FROM users u
             LEFT JOIN gyms g ON g.id = u.gym_id
             WHERE u.id = $1`,
            [req.user.id, DEFAULT_BRANCH_ID]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const row = result.rows[0];
        if (req.authToken) {
            setUserAuthCookie(res, req.authToken);
        }

        return res.json({
            token: req.authToken || null,
            user: {
                id: row.id,
                gym_id: row.gym_id,
                full_name: row.full_name,
                email: row.email,
                role: row.role,
                staff_role: row.staff_role,
                branch_id: row.branch_id,
                is_active: row.is_active,
                permissions: row.permissions,
            },
            saas: {
                status: row.saas_status || 'ACTIVE',
                valid_until: row.saas_valid_until,
                plan: row.current_plan,
            },
        });
    } catch (err) {
        console.error('AUTH ME ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

app.get('/healthz', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        return res.status(200).json({
            status: 'ok',
            service: 'gym-management-system',
            database: 'reachable',
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('HEALTH CHECK ERROR:', err.message);
        return res.status(503).json({
            status: 'degraded',
            service: 'gym-management-system',
            database: 'unreachable',
            timestamp: new Date().toISOString(),
        });
    }
});

app.get('/', (req, res) => {
    res.send('Gym Management System API: Online');
});

app.use(async (err, req, res, next) => {
    console.error('UNHANDLED ERROR:', err);
    await captureExpressError(err, req);
    if (res.headersSent) return next(err);
    return res.status(err.status || 500).json({
        error: 'Server Error',
    });
});

const PORT = process.env.PORT || 5000;
const automatedNudgeIntervalMs = 1000 * 60 * 30;
const retentionMaintenanceIntervalMs = 1000 * 60 * 60 * 12;
const databaseBackupIntervalMs = Math.max(1, parseInt(process.env.DB_BACKUP_INTERVAL_HOURS || '24', 10) || 24) * 60 * 60 * 1000;
const shutdownTimeoutMs = Math.max(5000, parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '20000', 10) || 20000);

const scheduleRecurringJob = (job, intervalMs, runImmediately = true) => {
    let timer = null;
    let stopped = false;

    const run = async () => {
        if (stopped) {
            return;
        }

        try {
            await Promise.resolve(job());
        } finally {
            if (!stopped) {
                timer = setTimeout(run, intervalMs);
            }
        }
    };

    if (runImmediately) {
        void run();
    } else {
        timer = setTimeout(run, intervalMs);
    }

    return () => {
        stopped = true;
        if (timer) {
            clearTimeout(timer);
        }
    };
};

const startBackgroundJobs = () => {
    const stopJobs = [];

    stopJobs.push(scheduleRecurringJob(() => checkExpirations().catch((err) => {
        console.error('EXPIRY CHECK ERROR:', err.message);
    }), 1000 * 60 * 60));

    stopJobs.push(scheduleRecurringJob(() => runAutomatedNotificationNudges().catch((err) => {
        console.error('AUTOMATED NOTIFICATION NUDGE ERROR:', err.message);
    }), automatedNudgeIntervalMs));

    stopJobs.push(scheduleRecurringJob(() => runRetentionMaintenance().catch((err) => {
        console.error('RETENTION MAINTENANCE ERROR:', err.message);
    }), retentionMaintenanceIntervalMs));

    if (String(process.env.DB_BACKUP_ENABLED || 'false').trim().toLowerCase() === 'true') {
        stopJobs.push(scheduleRecurringJob(() => runDatabaseBackup().catch((err) => {
            console.error('DATABASE BACKUP ERROR:', err.message);
        }), databaseBackupIntervalMs));
    }

    return () => {
        for (const stopJob of stopJobs) {
            try {
                stopJob();
            } catch (err) {
                console.error('BACKGROUND JOB STOP ERROR:', err.message);
            }
        }
    };
};

pool.on('error', (err) => {
    void capturePoolError(err);
});

const closeHttpServer = () => new Promise((resolve) => {
    if (!httpServer) {
        resolve();
        return;
    }

    httpServer.close((err) => {
        if (err) {
            console.error('HTTP SERVER CLOSE ERROR:', err.message);
        }
        resolve();
    });
});

const initiateShutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.log(`Shutdown requested: ${reason}`);

    if (typeof stopBackgroundJobRunner === 'function') {
        stopBackgroundJobRunner();
        stopBackgroundJobRunner = null;
    }

    const forceExitTimer = setTimeout(() => {
        console.error('Shutdown timed out. Exiting forcefully.');
        process.exit(exitCode || 1);
    }, shutdownTimeoutMs);
    if (typeof forceExitTimer.unref === 'function') {
        forceExitTimer.unref();
    }

    try {
        await closeHttpServer();
        await pool.end();
    } catch (err) {
        console.error('SHUTDOWN ERROR:', err.message);
        exitCode = exitCode || 1;
    } finally {
        clearTimeout(forceExitTimer);
        process.exit(exitCode);
    }
};

process.on('SIGTERM', () => {
    void initiateShutdown('SIGTERM');
});

process.on('SIGINT', () => {
    void initiateShutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
    const error = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled rejection'));
    void captureProcessError(error, 'unhandledRejection');
    void initiateShutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    void captureProcessError(err, 'uncaughtException');
    void initiateShutdown('uncaughtException', 1);
});

const bootstrap = async () => {
    try {
        await connectDB();

        httpServer = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        stopBackgroundJobRunner = startBackgroundJobs();
    } catch (err) {
        console.error('STARTUP ERROR:', err.message);
        process.exit(1);
    }
};

bootstrap();