const os = require('os');
const { pool } = require('../config/db');

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const RUNTIME_SLOW_REQUEST_THRESHOLD_MS = parsePositiveInt(process.env.RUNTIME_SLOW_REQUEST_MS, 1200);
const MAX_RECENT_EVENTS = parsePositiveInt(process.env.RUNTIME_RECENT_EVENT_COUNT, 12);
const MAX_ENDPOINT_STATS = parsePositiveInt(process.env.RUNTIME_ENDPOINT_STATS_MAX, 200);
const MAX_EVENT_ROWS = parsePositiveInt(process.env.RUNTIME_EVENT_MAX_ROWS, 5000);
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;

const state = {
    startedAtMs: Date.now(),
    requestCount: 0,
    totalDurationMs: 0,
    activeRequests: 0,
    errorCount: 0,
    slowCount: 0,
    clientErrorCount: 0,
    poolErrorCount: 0,
    processErrorCount: 0,
    endpointStats: new Map(),
    recentSlowRequests: [],
    recentErrors: [],
};

let trimScheduled = false;

const pushRecent = (collection, entry) => {
    collection.unshift(entry);
    if (collection.length > MAX_RECENT_EVENTS) {
        collection.length = MAX_RECENT_EVENTS;
    }
};

const normalizeRoute = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '/';
    const [pathOnly] = raw.split('?');
    if (!pathOnly) return '/';
    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
};

const buildRouteKey = (req) => {
    const routePath = req?.route?.path ? `${req.baseUrl || ''}${req.route.path}` : (req?.originalUrl || req?.path || '/');
    return normalizeRoute(routePath);
};

const sanitizeStack = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.split('\n').slice(0, 10).join('\n').slice(0, MAX_STACK_LENGTH);
};

const serializeMetadata = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    try {
        return JSON.stringify(raw);
    } catch (_err) {
        return JSON.stringify({ serialization_error: true });
    }
};

const scheduleTrim = () => {
    if (trimScheduled) {
        return;
    }

    trimScheduled = true;
    setImmediate(async () => {
        trimScheduled = false;
        try {
            await pool.query(
                `WITH stale AS (
                    SELECT id
                    FROM system_runtime_events
                    ORDER BY created_at DESC
                    OFFSET $1
                 )
                 DELETE FROM system_runtime_events
                 WHERE id IN (SELECT id FROM stale)`,
                [MAX_EVENT_ROWS]
            );
        } catch (_err) {
            // Ignore retention cleanup errors so telemetry never blocks requests.
        }
    });
};

const updateEndpointStats = ({ route, method, durationMs, statusCode }) => {
    const key = `${String(method || 'GET').toUpperCase()} ${normalizeRoute(route)}`;
    const existing = state.endpointStats.get(key) || {
        route: normalizeRoute(route),
        method: String(method || 'GET').toUpperCase(),
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastStatusCode: 0,
        lastSeenAt: null,
    };

    existing.count += 1;
    existing.totalDurationMs += Math.max(0, Number(durationMs) || 0);
    existing.maxDurationMs = Math.max(existing.maxDurationMs, Math.max(0, Number(durationMs) || 0));
    existing.lastStatusCode = Number(statusCode) || 0;
    existing.lastSeenAt = new Date().toISOString();
    state.endpointStats.set(key, existing);

    if (state.endpointStats.size > MAX_ENDPOINT_STATS) {
        const oldestKey = [...state.endpointStats.entries()]
            .sort((a, b) => String(a[1].lastSeenAt || '').localeCompare(String(b[1].lastSeenAt || '')))[0]?.[0];
        if (oldestKey) {
            state.endpointStats.delete(oldestKey);
        }
    }
};

const recordRuntimeEvent = async ({
    eventType,
    severity,
    source,
    message,
    route,
    method,
    statusCode,
    durationMs,
    gymId,
    userId,
    actorRole,
    metadata,
}) => {
    try {
        await pool.query(
            `INSERT INTO system_runtime_events (
                event_type,
                severity,
                source,
                message,
                route,
                method,
                status_code,
                duration_ms,
                gym_id,
                user_id,
                actor_role,
                metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
            [
                String(eventType || 'UNKNOWN').trim().toUpperCase(),
                String(severity || 'INFO').trim().toUpperCase(),
                String(source || 'server').trim().toLowerCase(),
                String(message || 'Unknown runtime event').trim().slice(0, MAX_MESSAGE_LENGTH),
                route ? normalizeRoute(route) : null,
                method ? String(method).toUpperCase() : null,
                Number.isInteger(statusCode) ? statusCode : null,
                Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
                Number.isInteger(Number(gymId)) ? Number(gymId) : null,
                Number.isInteger(Number(userId)) ? Number(userId) : null,
                actorRole ? String(actorRole).toUpperCase() : null,
                serializeMetadata(metadata),
            ]
        );
        scheduleTrim();
    } catch (err) {
        console.error('RUNTIME EVENT LOG ERROR:', err.message);
    }
};

const runtimeTelemetryMiddleware = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    req._runtimeTelemetryStartedAt = startedAt;
    state.activeRequests += 1;

    let finalized = false;
    const finalize = () => {
        if (finalized) {
            return;
        }
        finalized = true;

        state.activeRequests = Math.max(0, state.activeRequests - 1);
        const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6));
        const route = buildRouteKey(req);
        const statusCode = Number(res.statusCode) || 0;

        state.requestCount += 1;
        state.totalDurationMs += durationMs;
        updateEndpointStats({ route, method: req.method, durationMs, statusCode });

        if (statusCode >= 500 && !req._runtimeTelemetryErrorCaptured) {
            state.errorCount += 1;
            const entry = {
                created_at: new Date().toISOString(),
                method: String(req.method || 'GET').toUpperCase(),
                route,
                status_code: statusCode,
                duration_ms: durationMs,
                source: 'server',
                message: `${String(req.method || 'GET').toUpperCase()} ${route} failed with ${statusCode}`,
            };
            pushRecent(state.recentErrors, entry);
            void recordRuntimeEvent({
                eventType: 'REQUEST_ERROR',
                severity: 'ERROR',
                source: 'server',
                message: entry.message,
                route,
                method: req.method,
                statusCode,
                durationMs,
                gymId: req.user?.gym_id,
                userId: req.user?.id,
                actorRole: req.user?.role,
                metadata: {
                    query: req.query || {},
                },
            });
            return;
        }

        if (durationMs >= RUNTIME_SLOW_REQUEST_THRESHOLD_MS) {
            state.slowCount += 1;
            const entry = {
                created_at: new Date().toISOString(),
                method: String(req.method || 'GET').toUpperCase(),
                route,
                status_code: statusCode,
                duration_ms: durationMs,
                source: 'server',
            };
            pushRecent(state.recentSlowRequests, entry);
            void recordRuntimeEvent({
                eventType: 'SLOW_REQUEST',
                severity: 'WARN',
                source: 'server',
                message: `${String(req.method || 'GET').toUpperCase()} ${route} took ${durationMs}ms`,
                route,
                method: req.method,
                statusCode,
                durationMs,
                gymId: req.user?.gym_id,
                userId: req.user?.id,
                actorRole: req.user?.role,
                metadata: {
                    threshold_ms: RUNTIME_SLOW_REQUEST_THRESHOLD_MS,
                    query: req.query || {},
                },
            });
        }
    };

    res.on('finish', finalize);
    res.on('close', finalize);
    next();
};

const captureExpressError = async (err, req) => {
    req._runtimeTelemetryErrorCaptured = true;
    state.errorCount += 1;
    const route = buildRouteKey(req);
    const durationMs = req?._runtimeTelemetryStartedAt
        ? Math.max(0, Math.round(Number(process.hrtime.bigint() - req._runtimeTelemetryStartedAt) / 1e6))
        : null;
    const entry = {
        created_at: new Date().toISOString(),
        method: String(req?.method || 'GET').toUpperCase(),
        route,
        status_code: Number(err?.statusCode || err?.status || 500) || 500,
        duration_ms: Number.isFinite(durationMs) ? durationMs : null,
        source: 'server',
        message: String(err?.message || 'Unhandled server error').slice(0, MAX_MESSAGE_LENGTH),
    };
    pushRecent(state.recentErrors, entry);

    await recordRuntimeEvent({
        eventType: 'REQUEST_ERROR',
        severity: 'ERROR',
        source: 'server',
        message: entry.message,
        route,
        method: req?.method,
        statusCode: entry.status_code,
        durationMs,
        gymId: req?.user?.gym_id,
        userId: req?.user?.id,
        actorRole: req?.user?.role,
        metadata: {
            name: err?.name || 'Error',
            code: err?.code || null,
            stack: sanitizeStack(err?.stack),
        },
    });
};

const captureProcessError = async (error, source = 'process') => {
    state.processErrorCount += 1;
    const message = String(error?.message || `${source} failure`).slice(0, MAX_MESSAGE_LENGTH);
    const entry = {
        created_at: new Date().toISOString(),
        source,
        message,
    };
    pushRecent(state.recentErrors, entry);

    await recordRuntimeEvent({
        eventType: 'PROCESS_ERROR',
        severity: 'ERROR',
        source,
        message,
        metadata: {
            name: error?.name || 'Error',
            code: error?.code || null,
            stack: sanitizeStack(error?.stack),
        },
    });
};

const capturePoolError = async (error) => {
    state.poolErrorCount += 1;
    const message = String(error?.message || 'Database pool error').slice(0, MAX_MESSAGE_LENGTH);
    const entry = {
        created_at: new Date().toISOString(),
        source: 'database',
        message,
    };
    pushRecent(state.recentErrors, entry);

    await recordRuntimeEvent({
        eventType: 'POOL_ERROR',
        severity: 'ERROR',
        source: 'database',
        message,
        metadata: {
            name: error?.name || 'Error',
            code: error?.code || null,
            stack: sanitizeStack(error?.stack),
        },
    });
};

const captureClientError = async (req, payload = {}) => {
    state.clientErrorCount += 1;
    const route = normalizeRoute(payload.route || req?.body?.route || req?.originalUrl || '/');
    const message = String(payload.message || payload.error || 'Client error').slice(0, MAX_MESSAGE_LENGTH);
    const entry = {
        created_at: new Date().toISOString(),
        route,
        source: 'client',
        message,
    };
    pushRecent(state.recentErrors, entry);

    await recordRuntimeEvent({
        eventType: 'CLIENT_ERROR',
        severity: 'ERROR',
        source: 'client',
        message,
        route,
        method: 'CLIENT',
        gymId: req?.user?.gym_id,
        userId: req?.user?.id,
        actorRole: req?.user?.role,
        metadata: {
            scope: payload.scope || null,
            page: payload.page || null,
            stack: sanitizeStack(payload.stack),
            componentStack: sanitizeStack(payload.componentStack),
            extra: payload.extra && typeof payload.extra === 'object' ? payload.extra : {},
            userAgent: String(req?.headers?.['user-agent'] || ''),
        },
    });
};

const getRuntimeTelemetrySnapshot = () => {
    const memory = process.memoryUsage();
    const endpointStats = [...state.endpointStats.values()].map((entry) => ({
        ...entry,
        avgDurationMs: entry.count > 0 ? Math.round(entry.totalDurationMs / entry.count) : 0,
    }));

    return {
        generated_at: new Date().toISOString(),
        slow_request_threshold_ms: RUNTIME_SLOW_REQUEST_THRESHOLD_MS,
        process: {
            pid: process.pid,
            node_version: String(process.version || '').replace(/^v/, ''),
            platform: process.platform,
            uptime_seconds: Math.round(process.uptime()),
            rss_mb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
            heap_used_mb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
            heap_total_mb: Math.round((memory.heapTotal / 1024 / 1024) * 10) / 10,
            external_mb: Math.round((memory.external / 1024 / 1024) * 10) / 10,
            load_average: os.loadavg(),
            started_at: new Date(state.startedAtMs).toISOString(),
        },
        requests: {
            total: state.requestCount,
            active: state.activeRequests,
            errors: state.errorCount,
            slow: state.slowCount,
            avg_duration_ms: state.requestCount > 0 ? Math.round(state.totalDurationMs / state.requestCount) : 0,
            client_errors: state.clientErrorCount,
        },
        database: {
            pool_total: Number(pool.totalCount || 0),
            pool_idle: Number(pool.idleCount || 0),
            pool_waiting: Number(pool.waitingCount || 0),
            pool_errors: state.poolErrorCount,
        },
        process_errors: state.processErrorCount,
        busiest_endpoints: endpointStats
            .slice()
            .sort((a, b) => b.count - a.count)
            .slice(0, 8),
        slowest_endpoints: endpointStats
            .slice()
            .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
            .slice(0, 8),
        recent_slow_requests: [...state.recentSlowRequests],
        recent_errors: [...state.recentErrors],
    };
};

const listRuntimeEvents = async ({ page = 1, limit = 50, search = '', eventType = '', severity = '' } = {}) => {
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    const offset = (safePage - 1) * safeLimit;
    const params = [];
    const clauses = [];

    if (search) {
        params.push(`%${String(search).trim()}%`);
        clauses.push(`(
            message ILIKE $${params.length}
            OR COALESCE(route, '') ILIKE $${params.length}
            OR COALESCE(source, '') ILIKE $${params.length}
            OR COALESCE(method, '') ILIKE $${params.length}
        )`);
    }

    if (eventType) {
        params.push(String(eventType).trim().toUpperCase());
        clauses.push(`event_type = $${params.length}`);
    }

    if (severity) {
        params.push(String(severity).trim().toUpperCase());
        clauses.push(`severity = $${params.length}`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const listParams = [...params, safeLimit, offset];

    const [rows, totalResult] = await Promise.all([
        pool.query(
            `SELECT id, event_type, severity, source, message, route, method, status_code, duration_ms, gym_id, user_id, actor_role, metadata, created_at
             FROM system_runtime_events
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
            listParams
        ),
        pool.query(
            `SELECT COUNT(*)::INTEGER AS total
             FROM system_runtime_events
             ${whereClause}`,
            params
        ),
    ]);

    const total = Number(totalResult.rows[0]?.total || 0);
    return {
        items: rows.rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            total,
            totalPages: Math.max(1, Math.ceil(total / safeLimit)),
            hasNext: safePage * safeLimit < total,
            hasPrev: safePage > 1,
        },
    };
};

module.exports = {
    RUNTIME_SLOW_REQUEST_THRESHOLD_MS,
    runtimeTelemetryMiddleware,
    recordRuntimeEvent,
    captureExpressError,
    captureProcessError,
    capturePoolError,
    captureClientError,
    getRuntimeTelemetrySnapshot,
    listRuntimeEvents,
};