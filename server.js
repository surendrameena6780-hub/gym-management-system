const express = require('express');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { connectDB, pool } = require('./config/db');
const { disconnectCache } = require('./utils/cache');
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
const { runPayrollAutoPay } = require('./jobs/payrollAutoPay');
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
const trainerRoutes = require('./routes/trainers');

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

const toOrigin = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    try {
        const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(normalized).origin;
    } catch (_err) {
        return null;
    }
};

const collectCorsOrigins = (...values) => Array.from(new Set(
    values
        .flatMap((value) => String(value || '').split(','))
        .map((entry) => toOrigin(entry))
        .filter(Boolean)
));

const requiredEnv = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'JWT_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    throw new Error(`FATAL: Missing required env vars: ${missingEnv.join(', ')}`);
}
if (process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is insecure. Set a strong random secret in environment.');
}

const corsOrigins = collectCorsOrigins(
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.PUBLIC_FRONTEND_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
);
const isProduction = process.env.NODE_ENV === 'production';
const PROFILE_IMAGE_PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Profile image unavailable">
    <rect width="96" height="96" rx="48" fill="#e2e8f0"/>
    <circle cx="48" cy="36" r="18" fill="#94a3b8"/>
    <path d="M20 82c4.8-15.2 16.1-23 28-23s23.2 7.8 28 23" fill="#94a3b8"/>
</svg>`;
const PROFILE_IMAGE_PLACEHOLDER_BUFFER = Buffer.from(PROFILE_IMAGE_PLACEHOLDER_SVG, 'utf8');

const sendProfileImagePlaceholder = (res) => {
        res.status(200);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', isProduction ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
        return res.end(PROFILE_IMAGE_PLACEHOLDER_BUFFER);
};
const REQUIRED_NODE_VERSION = '20.18.0';
const currentNodeVersion = String(process.version || '').replace(/^v/, '');

if (isProduction && currentNodeVersion !== REQUIRED_NODE_VERSION) {
    throw new Error(`FATAL: Production backend requires Node ${REQUIRED_NODE_VERSION}. Current runtime is ${currentNodeVersion}.`);
}

if (!isProduction && currentNodeVersion !== REQUIRED_NODE_VERSION) {
    console.warn(`Node ${currentNodeVersion} detected. Production is pinned to ${REQUIRED_NODE_VERSION}.`);
}

const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const rawTrustProxySetting = parseTrustProxySetting(process.env.TRUST_PROXY);
const trustProxySetting = isProduction && rawTrustProxySetting === true ? 1 : rawTrustProxySetting;

if (isProduction && corsOrigins.length === 0) {
    throw new Error('FATAL: At least one frontend origin must be configured for CORS in production.');
}

if (trustProxySetting) {
    app.set('trust proxy', trustProxySetting);
}

const corsOptionsDelegate = (req, callback) => {
    const origin = req.headers.origin;
    const opts = { credentials: true };

    // No Origin header (same-origin GET, server-to-server, etc.) — allow
    if (!origin) return callback(null, { ...opts, origin: true });

    // Explicitly whitelisted origin
    if (corsOrigins.includes(origin)) return callback(null, { ...opts, origin: true });

    // Dev-mode fallback origins
    if (!isProduction && defaultDevOrigins.includes(origin)) return callback(null, { ...opts, origin: true });

    // Proxied same-origin: Origin matches the forwarded host (e.g. Vercel rewrite)
    const fwdHost = req.headers['x-forwarded-host'];
    if (fwdHost) {
        const fwdProto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        if (origin === `${fwdProto}://${fwdHost}`) {
            return callback(null, { ...opts, origin: true });
        }
    }

    // Soft reject — omit CORS headers instead of crashing with 500
    if (isProduction) {
        console.warn(`CORS soft-reject: origin=${origin} fwdHost=${fwdHost || '(none)'} allowed=[${corsOrigins.join(',')}]`);
    }
    return callback(null, { ...opts, origin: false });
};

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    permissionsPolicy: {
        features: {
            accelerometer: ['self', 'https://api.razorpay.com'],
            gyroscope: ['self', 'https://api.razorpay.com'],
            magnetometer: ['self', 'https://api.razorpay.com'],
            payment: ['self', 'https://api.razorpay.com'],
        },
    },
}));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(cors(corsOptionsDelegate));
app.use(compression({ threshold: 1024 }));
app.use(enforceRequestPayloadLimits);
app.use(runtimeTelemetryMiddleware);

const isLoadTest = process.env.LOAD_TEST_MODE === 'true';
if (isLoadTest) console.log('⚡ LOAD_TEST_MODE enabled — rate limiters set to 999999');

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isLoadTest ? 999999 : (isProduction ? 600 : 5000),
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
    max: isLoadTest ? 999999 : (isProduction ? 25 : 500),
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
    max: isLoadTest ? 999999 : (isProduction ? productionMax : developmentMax),
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
        fallthrough: true,
        dotfiles: 'deny',
        maxAge: isProduction ? '7d' : 0,
        immutable: isProduction,
        setHeaders: (res) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Disposition', 'inline');
        },
    }),
    (_req, res) => sendProfileImagePlaceholder(res)
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
app.use('/api/trainers', trainerRoutes);

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
                saas_plan: row.current_plan,
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
    // PM2 cluster mode: only instance 0 should run background jobs to prevent duplicates.
    // INSTANCE_ID is set by PM2 via the instance_var config in ecosystem.config.js.
    const instanceId = process.env.INSTANCE_ID;
    if (instanceId !== undefined && instanceId !== '0') {
        console.log(`Worker ${instanceId}: skipping background jobs (handled by instance 0)`);
        return () => {};
    }

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

    // Payroll auto-pay: runs every 6 hours, checks if today is pay day for any staff
    stopJobs.push(scheduleRecurringJob(() => runPayrollAutoPay().catch((err) => {
        console.error('PAYROLL AUTO-PAY ERROR:', err.message);
    }), 1000 * 60 * 60 * 6));

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
        await disconnectCache();
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
        const { maintenanceMode, maintenancePromise } = await connectDB();

        const startJobsWhenReady = () => {
            if (!stopBackgroundJobRunner) {
                stopBackgroundJobRunner = startBackgroundJobs();
            }
        };

        httpServer = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        if (maintenanceMode === 'deferred') {
            console.log('ℹ️ Background jobs will start after database maintenance completes.');
            maintenancePromise
                .then(() => {
                    startJobsWhenReady();
                })
                .catch((err) => {
                    console.error('BACKGROUND JOB STARTUP ERROR:', err.message);
                });
            return;
        }

        startJobsWhenReady();
    } catch (err) {
        console.error('STARTUP ERROR:', err.message);
        process.exit(1);
    }
};

bootstrap();