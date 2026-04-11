const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const webpush = require('web-push');
const { setUserAuthCookie } = require('../utils/authCookies');
const {
    computeEffectiveBillingLimits,
    ensureGymBillingAddonSchema,
    ensurePlatformSettingsBase,
    getBillingConfig,
    getGymBillingSnapshot,
    getGymBranchUsageBreakdown,
    getGymUsageSnapshot,
    normalizeBillingConfig,
    normalizeSupportProfile,
    serializeBillingConfig,
} = require('../utils/platformSettings');
const { getRuntimeTelemetrySnapshot, listRuntimeEvents } = require('../utils/runtimeTelemetry');

// Configure VAPID (shared config)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:admin@gymvault.app',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

const masterPassword = String(process.env.MASTER_PASSWORD || process.env.SUPERADMIN_PASSWORD || '').trim();
const superadminEnabled = masterPassword.length >= 8;
const disabledMessage = 'Superadmin is disabled. Set MASTER_PASSWORD (or SUPERADMIN_PASSWORD) with at least 8 characters.';
const REPORTS_LIGHT_CACHE_TTL_MS = Math.max(10000, parseInt(process.env.SUPERADMIN_REPORTS_LIGHT_CACHE_TTL_MS || '60000', 10) || 60000);
let reportsLightCache = { payload: null, expiresAt: 0 };

const normalizeIp = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw === '::1') return '127.0.0.1';
    if (raw.startsWith('::ffff:')) return raw.slice(7);
    return raw;
};

const securePasswordCompare = (input, expected) => {
    const a = Buffer.from(String(input || ''), 'utf8');
    const b = Buffer.from(String(expected || ''), 'utf8');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
};

const toBool = (value) => String(value || '').toLowerCase() === 'true';

const getClientIp = (req) => {
    return normalizeIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '');
};

const isIpAllowed = (req) => {
    const allowList = String(process.env.SUPERADMIN_ALLOWED_IPS || '')
        .split(',')
        .map((v) => normalizeIp(v))
        .filter(Boolean);

    if (allowList.length === 0) return true;

    const clientIp = getClientIp(req);
    return allowList.includes(clientIp);
};

const superadminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(1, parseInt(process.env.SUPERADMIN_LOGIN_RATE_LIMIT_MAX || '5', 10) || 5),
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
        return res.status(429).json({ message: 'Too many login attempts. Wait a few minutes and try again.' });
    },
});

const defaultAutomationMessageTemplates = {
    SETUP_FOCUS: {
        title: 'Your next move is obvious',
        body: '{{setup_hint}}',
    },
    LEAD_SPRINT: {
        title: 'Lead queue is warm',
        body: '{{count}} follow-up {{lead_label}} {{are_is}} ready today. A quick callback sprint before the day gets noisy can turn curiosity into walk-ins.',
    },
    RENEWAL_RADAR: {
        title: 'Renewals are within reach',
        body: '{{count}} {{membership_label}} {{enter_label}} the final 3-day window today. One crisp follow-up can lock revenue before the day slips away.',
    },
    RENEWAL_WEEK: {
        title: 'Renewal week just opened',
        body: '{{count}} {{member_label}} {{are_is}} now inside renewal week. Get ahead of the rush and make the rejoin decision feel easy.',
    },
    ATTENDANCE_PULSE: {
        title: 'The floor could use a lift',
        body: '{{today_checkins}} check-ins so far against a {{avg_daily}}/day recent rhythm. One story, one class ping, or one comeback call can still lift the evening rush.',
    },
    COLLECTIONS_PUSH: {
        title: 'Collections are still on the table',
        body: '{{due_amount}} is still waiting across {{due_members}} {{account_label}}. Tonight is a clean window to recover dues while intent is still warm.',
    },
    WINBACK_LIST: {
        title: 'Your comeback list is ready',
        body: '{{count}} {{member_label}} {{have_has}} been quiet for 10+ days. A smart nudge tonight can wake up stalled routines before they go cold.',
    },
    MEMBER_RENEWAL: {
        title: 'Your plan is almost out of reps',
        body: '{{first_name}}, {{gym_name}} access wraps in {{days_left}} {{day_label}}. Renew today and keep your streak moving, not paused.',
    },
    MEMBER_DUE: {
        title: 'A quick clear-up keeps you moving',
        body: '{{first_name}}, {{amount_due}} is still pending on your plan. Clear it today and keep your next entry smooth.',
    },
    MEMBER_COMEBACK: {
        title: 'Your spot is still warm',
        body: '{{first_name}}, it has been {{days_inactive}} days since your last workout. One session today can flip the whole week back in your favour.',
    },
};

const defaultAutomationSettings = {
    owner_staff_enabled: true,
    member_push_enabled: true,
    owner_staff_slots: {
        MORNING: true,
        AFTERNOON: true,
        EVENING: true,
    },
    member_slots: {
        MORNING: true,
        AFTERNOON: false,
        EVENING: true,
    },
    owner_staff_daily_limit: 3,
    member_daily_limit: 50,
    member_max_per_slot: 25,
    message_templates: defaultAutomationMessageTemplates,
};

const normalizeAutomationMessageTemplates = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(defaultAutomationMessageTemplates).map(([templateKey, defaults]) => {
        const source = raw[templateKey] && typeof raw[templateKey] === 'object' ? raw[templateKey] : {};
        return [templateKey, {
            title: typeof source.title === 'string' && source.title.trim() ? source.title : defaults.title,
            body: typeof source.body === 'string' && source.body.trim() ? source.body : defaults.body,
        }];
    }));
};

const normalizeAutomationSettings = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    return {
        owner_staff_enabled: raw.owner_staff_enabled !== false,
        member_push_enabled: raw.member_push_enabled !== false,
        owner_staff_slots: {
            ...defaultAutomationSettings.owner_staff_slots,
            ...(raw.owner_staff_slots && typeof raw.owner_staff_slots === 'object' ? raw.owner_staff_slots : {}),
        },
        member_slots: {
            ...defaultAutomationSettings.member_slots,
            ...(raw.member_slots && typeof raw.member_slots === 'object' ? raw.member_slots : {}),
        },
        owner_staff_daily_limit: Math.min(3, Math.max(1, Number.parseInt(raw.owner_staff_daily_limit, 10) || defaultAutomationSettings.owner_staff_daily_limit)),
        member_daily_limit: Math.min(500, Math.max(1, Number.parseInt(raw.member_daily_limit, 10) || defaultAutomationSettings.member_daily_limit)),
        member_max_per_slot: Math.min(100, Math.max(1, Number.parseInt(raw.member_max_per_slot, 10) || defaultAutomationSettings.member_max_per_slot)),
        message_templates: normalizeAutomationMessageTemplates(raw.message_templates),
    };
};

const logAudit = async ({ action, targetType, targetId, targetLabel, details = {}, actorId = 'SUPER_ADMIN' }) => {
    try {
        await pool.query(
            `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, target_label, details)
             VALUES ('SUPER_ADMIN', $1, $2, $3, $4, $5, $6::jsonb)`,
            [
                String(actorId || 'SUPER_ADMIN'),
                String(action || ''),
                String(targetType || ''),
                targetId ? String(targetId) : null,
                targetLabel || null,
                JSON.stringify(details || {}),
            ]
        );
    } catch (err) {
        console.error('AUDIT LOG INSERT ERROR:', err.message);
    }
};

const quoteIdentifier = (value) => `"${String(value || '').replace(/"/g, '""')}"`;

const quoteQualifiedIdentifier = (schemaName, tableName) => {
    return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
};

const ensureOperationalArchiveInfrastructure = async (client) => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS operational_archives (
            id SERIAL PRIMARY KEY,
            source_table VARCHAR(80) NOT NULL,
            record_id INTEGER NOT NULL,
            archived_from_at TIMESTAMPTZ,
            payload JSONB NOT NULL,
            archived_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (source_table, record_id)
        );

        CREATE INDEX IF NOT EXISTS idx_operational_archives_source_time
            ON operational_archives(source_table, archived_from_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operational_archives_archived_at
            ON operational_archives(archived_at DESC);
    `);
};

const listGymDependentTables = async (client) => {
    const result = await client.query(`
        SELECT
            child_ns.nspname AS schema_name,
            child_cls.relname AS table_name,
            cols.column_names
        FROM pg_constraint con
        JOIN pg_class child_cls ON child_cls.oid = con.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child_cls.relnamespace
        CROSS JOIN LATERAL (
            SELECT ARRAY_AGG(att.attname ORDER BY keys.ord) AS column_names
            FROM unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = keys.attnum
        ) cols
        WHERE con.contype = 'f'
          AND con.confrelid = 'public.gyms'::regclass
          AND child_ns.nspname = 'public'
        ORDER BY child_ns.nspname ASC, child_cls.relname ASC
    `);

    return result.rows
        .filter((row) => Array.isArray(row.column_names) && row.column_names.length === 1)
        .map((row) => ({
            schemaName: row.schema_name,
            tableName: row.table_name,
            columnName: row.column_names[0],
        }));
};

const sortGymDependentTables = async (client, dependents) => {
    if (dependents.length <= 1) return dependents;

    const byKey = new Map();
    const outgoing = new Map();
    const indegree = new Map();

    for (const dependent of dependents) {
        const key = `${dependent.schemaName}.${dependent.tableName}`;
        byKey.set(key, dependent);
        outgoing.set(key, new Set());
        indegree.set(key, 0);
    }

    const result = await client.query(`
        SELECT
            child_ns.nspname AS child_schema,
            child_cls.relname AS child_table,
            parent_ns.nspname AS parent_schema,
            parent_cls.relname AS parent_table
        FROM pg_constraint con
        JOIN pg_class child_cls ON child_cls.oid = con.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child_cls.relnamespace
        JOIN pg_class parent_cls ON parent_cls.oid = con.confrelid
        JOIN pg_namespace parent_ns ON parent_ns.oid = parent_cls.relnamespace
        WHERE con.contype = 'f'
          AND child_ns.nspname = 'public'
          AND parent_ns.nspname = 'public'
    `);

    for (const row of result.rows) {
        const childKey = `${row.child_schema}.${row.child_table}`;
        const parentKey = `${row.parent_schema}.${row.parent_table}`;
        if (!byKey.has(childKey) || !byKey.has(parentKey) || childKey === parentKey) continue;
        const edges = outgoing.get(childKey);
        if (edges.has(parentKey)) continue;
        edges.add(parentKey);
        indegree.set(parentKey, (indegree.get(parentKey) || 0) + 1);
    }

    const queue = Array.from(indegree.entries())
        .filter(([, count]) => count === 0)
        .map(([key]) => key)
        .sort((a, b) => a.localeCompare(b));
    const orderedKeys = [];

    while (queue.length > 0) {
        const key = queue.shift();
        orderedKeys.push(key);

        const edges = Array.from(outgoing.get(key) || []).sort((a, b) => a.localeCompare(b));
        for (const nextKey of edges) {
            const nextCount = (indegree.get(nextKey) || 0) - 1;
            indegree.set(nextKey, nextCount);
            if (nextCount === 0) {
                queue.push(nextKey);
                queue.sort((a, b) => a.localeCompare(b));
            }
        }
    }

    if (orderedKeys.length !== dependents.length) {
        for (const key of Array.from(byKey.keys()).sort((a, b) => a.localeCompare(b))) {
            if (!orderedKeys.includes(key)) orderedKeys.push(key);
        }
    }

    return orderedKeys.map((key) => byKey.get(key)).filter(Boolean);
};

const deleteGymDependents = async (client, gymId) => {
    const dependents = await listGymDependentTables(client);
    const orderedDependents = await sortGymDependentTables(client, dependents);

    for (const dependent of orderedDependents) {
        const tableName = quoteQualifiedIdentifier(dependent.schemaName, dependent.tableName);
        const columnName = quoteIdentifier(dependent.columnName);
        await client.query(`DELETE FROM ${tableName} WHERE ${columnName} = $1`, [gymId]);
    }
};

const hardDeleteGym = async (client, gymId) => {
    await client.query(`SELECT set_config('app.allow_gym_hard_delete', 'on', true)`);

    try {
        await client.query('DELETE FROM gyms WHERE id = $1', [gymId]);
    } catch (err) {
        if (err.code !== '23503') throw err;
        await deleteGymDependents(client, gymId);
        await client.query('DELETE FROM gyms WHERE id = $1', [gymId]);
    }
};

const superAuth = (req, res, next) => {
    if (!superadminEnabled) {
        return res.status(503).json({ message: disabledMessage });
    }

    if (!isIpAllowed(req)) {
        return res.status(403).json({ message: 'Access denied from this IP address.' });
    }

    const token = req.header('x-super-token');
    if (!token) return res.status(401).json({ message: 'Master access denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'SUPER_ADMIN') throw new Error('Not a super admin');
        req.superadmin = decoded;
        next();
    } catch (_err) {
        return res.status(401).json({ message: 'Invalid Master Token' });
    }
};

router.post('/login', superadminLoginLimiter, (req, res) => {
    if (!superadminEnabled) {
        return res.status(503).json({ message: disabledMessage });
    }

    if (!isIpAllowed(req)) {
        return res.status(403).json({ message: 'Access denied from this IP address.' });
    }

    const { password } = req.body;

    if (securePasswordCompare(password, masterPassword)) {
        const token = jwt.sign({ role: 'SUPER_ADMIN', scope: 'HQ' }, process.env.JWT_SECRET, { expiresIn: '12h' });
        return res.json({ token, message: 'Welcome, Boss.' });
    }

    return res.status(401).json({ message: 'Access Denied.' });
});

router.get('/overview', superAuth, async (_req, res) => {
    try {
        const totals = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM gyms) AS total_gyms,
                (SELECT COUNT(*) FROM gyms WHERE COALESCE(gym_access_status, 'ACTIVE') = 'ACTIVE' AND COALESCE(is_active, TRUE) = TRUE) AS active_gyms,
                (SELECT COUNT(*) FROM gyms WHERE COALESCE(gym_access_status, 'ACTIVE') = 'BLOCKED') AS blocked_gyms,
                (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE deleted_at IS NULL) AS total_revenue,
                (SELECT COUNT(*) FROM support_tickets WHERE UPPER(COALESCE(status,'OPEN')) IN ('OPEN','PENDING')) AS open_support_tickets
        `);

        const recent = await pool.query(`
            SELECT action, target_type, target_label, created_at
            FROM audit_logs
            ORDER BY created_at DESC
            LIMIT 20
        `);

        return res.json({
            stats: totals.rows[0],
            recent_activity: recent.rows,
        });
    } catch (err) {
        console.error('SUPERADMIN OVERVIEW ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/activities', superAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    try {
        const rows = await pool.query(
            `SELECT id, action, target_type, target_id, target_label, details, created_at
             FROM audit_logs
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
        );
        return res.json(rows.rows);
    } catch (err) {
        console.error('SUPERADMIN ACTIVITIES ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/gyms', superAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const plan = String(req.query.plan || '').trim();
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();

    const params = [];
    const where = [];

    if (q) {
        params.push(`%${q}%`);
        where.push(`(g.name ILIKE $${params.length} OR COALESCE(u.full_name,'') ILIKE $${params.length} OR COALESCE(u.email,'') ILIKE $${params.length})`);
    }

    if (status && ['ACTIVE', 'BLOCKED', 'SUSPENDED'].includes(status)) {
        params.push(status);
        where.push(`COALESCE(g.gym_access_status, 'ACTIVE') = $${params.length}`);
    }

    if (plan) {
        params.push(plan);
        where.push(`COALESCE(g.current_plan, 'pro') = $${params.length}`);
    }

    if (dateFrom) {
        params.push(dateFrom);
        where.push(`g.created_at::date >= $${params.length}::date`);
    }

    if (dateTo) {
        params.push(dateTo);
        where.push(`g.created_at::date <= $${params.length}::date`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
        const result = await pool.query(
            `SELECT
                g.id,
                g.name AS gym_name,
                COALESCE(g.current_plan, 'pro') AS plan,
                COALESCE(g.gym_access_status, 'ACTIVE') AS status,
                COALESCE(g.last_active_at, u.last_login_at, g.created_at) AS last_active,
                g.created_at,
                g.is_active,
                u.id AS owner_id,
                u.full_name AS owner_name,
                u.email AS owner_email,
                (SELECT COUNT(*) FROM members m WHERE m.gym_id = g.id AND m.deleted_at IS NULL) AS total_members,
                (SELECT COALESCE(SUM(p.amount_paid),0) FROM payments p WHERE p.gym_id = g.id AND p.deleted_at IS NULL) AS total_revenue
            FROM gyms g
            LEFT JOIN users u ON g.id = u.gym_id AND UPPER(u.role) = 'OWNER'
            ${whereSql}
            ORDER BY g.created_at DESC`,
            params
        );

        return res.json(result.rows);
    } catch (err) {
        console.error('SUPERADMIN GYMS ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/gyms/:id', superAuth, async (req, res) => {
    const gymId = parseInt(req.params.id, 10);
    if (!Number.isInteger(gymId)) return res.status(400).json({ error: 'Invalid gym id' });

    try {
        await ensureGymBillingAddonSchema();
        const gym = await pool.query(
            `SELECT
                g.id,
                g.name AS gym_name,
                g.phone,
                g.address,
                g.website,
                g.support_email,
                COALESCE(g.current_plan, 'pro') AS plan,
                COALESCE(g.gym_access_status, 'ACTIVE') AS status,
                COALESCE(g.branches_count, 1) AS branches_count,
                COALESCE(g.branch_directory, '[]'::jsonb) AS branch_directory,
                COALESCE(g.addon_extra_whatsapp, 0) AS addon_extra_whatsapp,
                COALESCE(g.addon_extra_staff, 0) AS addon_extra_staff,
                COALESCE(g.addon_extra_members, 0) AS addon_extra_members,
                COALESCE(g.addon_extra_branches, 0) AS addon_extra_branches,
                COALESCE(g.addon_extra_hello, 0) AS addon_extra_hello,
                g.created_at,
                COALESCE(g.last_active_at, u.last_login_at, g.created_at) AS last_active,
                u.id AS owner_id,
                u.full_name AS owner_name,
                u.email AS owner_email,
                u.phone AS owner_phone,
                (SELECT COALESCE(SUM(p.amount_paid),0) FROM payments p WHERE p.gym_id = g.id AND p.deleted_at IS NULL) AS total_revenue,
                (SELECT COUNT(*) FROM users su WHERE su.gym_id = g.id) AS total_users
             FROM gyms g
             LEFT JOIN users u ON g.id = u.gym_id AND UPPER(u.role)='OWNER'
             WHERE g.id = $1`,
            [gymId]
        );

        if (gym.rows.length === 0) {
            return res.status(404).json({ error: 'Gym not found' });
        }

        const gymRow = gym.rows[0];
        const [billingConfig, gymBilling, usageSnapshot, branchUsageBreakdown] = await Promise.all([
            getBillingConfig(),
            getGymBillingSnapshot(pool, gymId),
            getGymUsageSnapshot(pool, gymId),
            getGymBranchUsageBreakdown(pool, gymId, gymRow.branch_directory, Number(gymRow.branches_count || 1)),
        ]);
        const effectiveLimits = computeEffectiveBillingLimits(billingConfig, gymRow.plan, gymBilling || gymRow);

        return res.json({
            ...gymRow,
            total_members: Number(usageSnapshot?.members || 0),
            total_staff: Number(usageSnapshot?.staff || 0),
            effective_limits: effectiveLimits,
            branch_usage_breakdown: branchUsageBreakdown,
        });
    } catch (err) {
        console.error('SUPERADMIN GYM DETAIL ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/gyms/:id', superAuth, async (req, res) => {
    const gymId = parseInt(req.params.id, 10);
    if (!Number.isInteger(gymId)) return res.status(400).json({ error: 'Invalid gym id' });

    const {
        gym_name,
        phone,
        address,
        support_email,
        website,
        plan,
        addon_extra_whatsapp,
        addon_extra_staff,
        addon_extra_members,
        addon_extra_branches,
        addon_extra_hello,
    } = req.body;

    const parseOptionalAddonOverride = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) return Number.NaN;
        return parsed;
    };

    const parsedAddonOverrides = {
        addon_extra_whatsapp: parseOptionalAddonOverride(addon_extra_whatsapp),
        addon_extra_staff: parseOptionalAddonOverride(addon_extra_staff),
        addon_extra_members: parseOptionalAddonOverride(addon_extra_members),
        addon_extra_branches: parseOptionalAddonOverride(addon_extra_branches),
        addon_extra_hello: parseOptionalAddonOverride(addon_extra_hello),
    };

    if (Object.values(parsedAddonOverrides).some((value) => Number.isNaN(value))) {
        return res.status(400).json({ error: 'Add-on overrides must be whole numbers greater than or equal to 0.' });
    }

    if ((parsedAddonOverrides.addon_extra_hello ?? 0) > 0) {
        return res.status(409).json({ error: 'Additional Hello numbers are not supported in the current release.' });
    }

    try {
        await ensureGymBillingAddonSchema();
        const updated = await pool.query(
            `UPDATE gyms
             SET name = COALESCE($1, name),
                 phone = COALESCE($2, phone),
                 address = COALESCE($3, address),
                 support_email = COALESCE($4, support_email),
                 website = COALESCE($5, website),
                 current_plan = COALESCE($6, current_plan),
                 addon_extra_whatsapp = COALESCE($7, addon_extra_whatsapp),
                 addon_extra_staff = COALESCE($8, addon_extra_staff),
                 addon_extra_members = COALESCE($9, addon_extra_members),
                 addon_extra_branches = COALESCE($10, addon_extra_branches),
                 addon_extra_hello = COALESCE($11, addon_extra_hello)
             WHERE id = $12
             RETURNING
                id,
                name AS gym_name,
                phone,
                address,
                support_email,
                website,
                current_plan,
                COALESCE(addon_extra_whatsapp, 0) AS addon_extra_whatsapp,
                COALESCE(addon_extra_staff, 0) AS addon_extra_staff,
                COALESCE(addon_extra_members, 0) AS addon_extra_members,
                COALESCE(addon_extra_branches, 0) AS addon_extra_branches,
                COALESCE(addon_extra_hello, 0) AS addon_extra_hello`,
            [
                gym_name || null,
                phone || null,
                address || null,
                support_email || null,
                website || null,
                plan || null,
                parsedAddonOverrides.addon_extra_whatsapp,
                parsedAddonOverrides.addon_extra_staff,
                parsedAddonOverrides.addon_extra_members,
                parsedAddonOverrides.addon_extra_branches,
                parsedAddonOverrides.addon_extra_hello,
                gymId,
            ]
        );

        if (updated.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

        const billingConfig = await getBillingConfig();
        const gymBilling = await getGymBillingSnapshot(pool, gymId);
        const effectiveLimits = gymBilling
            ? computeEffectiveBillingLimits(billingConfig, gymBilling.current_plan, gymBilling)
            : null;

        await logAudit({
            action: 'GYM_EDITED',
            targetType: 'GYM',
            targetId: gymId,
            targetLabel: updated.rows[0].gym_name,
            details: {
                phone,
                address,
                support_email,
                website,
                plan,
                addon_extra_whatsapp,
                addon_extra_staff,
                addon_extra_members,
                addon_extra_branches,
                addon_extra_hello,
            },
        });

        return res.json({
            ...updated.rows[0],
            effective_limits: effectiveLimits,
        });
    } catch (err) {
        console.error('SUPERADMIN GYM EDIT ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/gyms/:id/status', superAuth, async (req, res) => {
    const gymId = parseInt(req.params.id, 10);
    const status = String(req.body.status || '').trim().toUpperCase();
    const reason = String(req.body.reason || '').trim();

    if (!Number.isInteger(gymId)) return res.status(400).json({ error: 'Invalid gym id' });
    if (!['ACTIVE', 'BLOCKED', 'SUSPENDED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const updated = await pool.query(
            `UPDATE gyms
             SET gym_access_status = $1,
                 is_active = CASE WHEN $1 = 'ACTIVE' THEN TRUE ELSE FALSE END,
                 blocked_at = CASE WHEN $1 = 'BLOCKED' THEN NOW() ELSE blocked_at END,
                 suspended_at = CASE WHEN $1 = 'SUSPENDED' THEN NOW() ELSE suspended_at END,
                 blocked_reason = CASE WHEN $1 = 'BLOCKED' THEN NULLIF($2, '') ELSE blocked_reason END,
                 suspended_reason = CASE WHEN $1 = 'SUSPENDED' THEN NULLIF($2, '') ELSE suspended_reason END
             WHERE id = $3
             RETURNING id, name AS gym_name, gym_access_status AS status`,
            [status, reason, gymId]
        );

        if (updated.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

        await logAudit({
            action: `GYM_${status}`,
            targetType: 'GYM',
            targetId: gymId,
            targetLabel: updated.rows[0].gym_name,
            details: { reason },
        });

        return res.json({ message: 'Gym status updated', ...updated.rows[0] });
    } catch (err) {
        console.error('SUPERADMIN GYM STATUS ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/gyms/:id', superAuth, async (req, res) => {
    const gymId = parseInt(req.params.id, 10);
    if (!Number.isInteger(gymId)) return res.status(400).json({ error: 'Invalid gym id' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await ensureOperationalArchiveInfrastructure(client);

        const gym = await client.query('SELECT row_to_json(g) AS payload, g.name FROM gyms g WHERE g.id = $1', [gymId]);
        if (gym.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Gym not found' });
        }

        await client.query(
            `INSERT INTO operational_archives (source_table, record_id, archived_from_at, payload, archived_at)
             VALUES ($1, $2, NOW(), $3::jsonb, NOW())
             ON CONFLICT (source_table, record_id)
             DO UPDATE SET archived_from_at = EXCLUDED.archived_from_at,
                           payload = EXCLUDED.payload,
                           archived_at = EXCLUDED.archived_at`,
            ['gyms', gymId, JSON.stringify({
                gym: gym.rows[0].payload,
                archived_by: 'SUPERADMIN',
            })]
        );

        await hardDeleteGym(client, gymId);

        await client.query('COMMIT');

        await logAudit({
            action: 'GYM_DELETED',
            targetType: 'GYM',
            targetId: gymId,
            targetLabel: gym.rows[0].name,
        });

        return res.json({ message: 'Gym permanently deleted.' });
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackError) {
            // Preserve the original failure.
        }
        console.error('HQ DELETE ERROR:', err);
        return res.status(500).json({ error: 'Failed to permanently delete gym.' });
    } finally {
        client.release();
    }
});

router.post('/gyms/:id/impersonate', superAuth, async (req, res) => {
    const gymId = parseInt(req.params.id, 10);
    if (!Number.isInteger(gymId)) return res.status(400).json({ error: 'Invalid gym id' });

    try {
        const owner = await pool.query(
            `SELECT id, gym_id, full_name, email, role, staff_role, is_active
             FROM users
             WHERE gym_id = $1 AND UPPER(role) = 'OWNER'
             ORDER BY id ASC
             LIMIT 1`,
            [gymId]
        );

        if (owner.rows.length === 0) {
            return res.status(404).json({ error: 'Owner not found for this gym' });
        }

        const user = owner.rows[0];
        const token = jwt.sign(
            {
                user: {
                    id: user.id,
                    gym_id: user.gym_id,
                    role: user.role,
                    staff_role: user.staff_role,
                    permissions: ['*'],
                    is_active: user.is_active,
                },
                impersonated_by: 'SUPER_ADMIN',
            },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        await logAudit({
            action: 'GYM_IMPERSONATED',
            targetType: 'GYM',
            targetId: gymId,
            targetLabel: user.full_name,
            details: { owner_id: user.id, owner_email: user.email },
        });

        setUserAuthCookie(res, token);

        return res.json({
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                gym_id: user.gym_id,
                role: user.role,
                staff_role: user.staff_role,
                is_active: user.is_active,
                permissions: ['*'],
            }
        });
    } catch (err) {
        console.error('SUPERADMIN IMPERSONATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/users', superAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();

    const params = [];
    const where = [];

    if (q) {
        params.push(`%${q}%`);
        where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR g.name ILIKE $${params.length})`);
    }

    if (status === 'ACTIVE' || status === 'BLOCKED') {
        params.push(status === 'ACTIVE');
        where.push(`COALESCE(u.is_active, TRUE) = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
        const users = await pool.query(
            `SELECT
                u.id,
                u.full_name,
                u.email,
                u.role,
                u.staff_role,
                u.is_active,
                u.last_login_at,
                g.id AS gym_id,
                g.name AS gym_name
             FROM users u
             LEFT JOIN gyms g ON g.id = u.gym_id
             ${whereSql}
             ORDER BY u.created_at DESC`,
            params
        );

        return res.json(users.rows);
    } catch (err) {
        console.error('SUPERADMIN USERS LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/users/:id/reset-password', superAuth, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const newPassword = String(req.body.new_password || '').trim();
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    try {
        const user = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);

        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

        await logAudit({
            action: 'USER_PASSWORD_RESET',
            targetType: 'USER',
            targetId: userId,
            targetLabel: user.rows[0].email,
        });

        return res.json({ message: 'Password reset successfully' });
    } catch (err) {
        console.error('SUPERADMIN USER RESET PASSWORD ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/users/:id/block', superAuth, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const blocked = toBool(req.body.blocked);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    try {
        const updated = await pool.query(
            `UPDATE users
             SET is_active = $1
             WHERE id = $2
             RETURNING id, full_name, email, is_active`,
            [!blocked, userId]
        );

        if (updated.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        await logAudit({
            action: blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
            targetType: 'USER',
            targetId: userId,
            targetLabel: updated.rows[0].email,
        });

        return res.json({ message: 'User status updated', user: updated.rows[0] });
    } catch (err) {
        console.error('SUPERADMIN USER BLOCK ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.delete('/users/:id', superAuth, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    try {
        const user = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        await logAudit({
            action: 'USER_DELETED',
            targetType: 'USER',
            targetId: userId,
            targetLabel: user.rows[0].email,
        });

        return res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error('SUPERADMIN USER DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/support/tickets', superAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const priority = String(req.query.priority || '').trim().toUpperCase();

    const params = [];
    const where = [];

    if (q) {
        params.push(`%${q}%`);
        where.push(`(t.subject ILIKE $${params.length} OR t.description ILIKE $${params.length} OR g.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }

    if (status) {
        params.push(status);
        where.push(`UPPER(COALESCE(t.status,'OPEN')) = $${params.length}`);
    }

    if (priority) {
        params.push(priority);
        where.push(`UPPER(COALESCE(t.priority,'MEDIUM')) = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
        const rows = await pool.query(
            `SELECT
                t.id,
                t.gym_id,
                g.name AS gym_name,
                t.raised_by,
                u.full_name AS user_name,
                u.email AS user_email,
                t.subject,
                t.status,
                t.priority,
                t.category,
                t.tags,
                t.created_at,
                t.updated_at
             FROM support_tickets t
             LEFT JOIN gyms g ON g.id = t.gym_id
             LEFT JOIN users u ON u.id = t.raised_by
             ${whereSql}
             ORDER BY t.created_at DESC`,
            params
        );

        return res.json(rows.rows);
    } catch (err) {
        console.error('SUPERADMIN SUPPORT LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/support/tickets/:id', superAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });

    try {
        const ticket = await pool.query(
            `SELECT
                t.*,
                g.name AS gym_name,
                u.full_name AS user_name,
                u.email AS user_email
             FROM support_tickets t
             LEFT JOIN gyms g ON g.id = t.gym_id
             LEFT JOIN users u ON u.id = t.raised_by
             WHERE t.id = $1`,
            [ticketId]
        );

        if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });

        const messages = await pool.query(
            `SELECT
                m.id,
                m.ticket_id,
                m.author_type,
                m.message,
                m.created_at,
                u.full_name AS author_name,
                u.email AS author_email
             FROM support_ticket_messages m
             LEFT JOIN users u ON u.id = m.author_user_id
             WHERE m.ticket_id = $1
             ORDER BY m.created_at ASC`,
            [ticketId]
        );

        return res.json({ ticket: ticket.rows[0], messages: messages.rows });
    } catch (err) {
        console.error('SUPERADMIN SUPPORT DETAIL ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/support/tickets/:id/reply', superAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;

    if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Message is required' });

    try {
        const ticket = await pool.query('SELECT id, gym_id, subject FROM support_tickets WHERE id = $1', [ticketId]);
        if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });

        const insert = await pool.query(
            `INSERT INTO support_ticket_messages (ticket_id, gym_id, author_type, message)
             VALUES ($1, $2, 'HQ', $3)
             RETURNING id, ticket_id, author_type, message, created_at`,
            [ticketId, ticket.rows[0].gym_id, String(message).trim()]
        );

        await pool.query(
            `UPDATE support_tickets
             SET updated_at = NOW(),
                 status = CASE WHEN UPPER(status) = 'OPEN' THEN 'PENDING' ELSE status END
             WHERE id = $1`,
            [ticketId]
        );

        await logAudit({
            action: 'TICKET_REPLIED',
            targetType: 'TICKET',
            targetId: ticketId,
            targetLabel: ticket.rows[0].subject,
        });

        return res.status(201).json(insert.rows[0]);
    } catch (err) {
        console.error('SUPERADMIN SUPPORT REPLY ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/support/tickets/:id', superAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (!Number.isInteger(ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });

    const status = req.body.status ? String(req.body.status).trim().toUpperCase() : null;
    const priority = req.body.priority ? String(req.body.priority).trim().toUpperCase() : null;
    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((v) => String(v || '').trim()).filter(Boolean) : null;

    try {
        const updated = await pool.query(
            `UPDATE support_tickets
             SET status = COALESCE($1, status),
                 priority = COALESCE($2, priority),
                 tags = COALESCE($3::text[], tags),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING id, subject, status, priority, tags`,
            [status, priority, tags, ticketId]
        );

        if (updated.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });

        await logAudit({
            action: 'TICKET_UPDATED',
            targetType: 'TICKET',
            targetId: ticketId,
            targetLabel: updated.rows[0].subject,
            details: { status, priority, tags },
        });

        return res.json(updated.rows[0]);
    } catch (err) {
        console.error('SUPERADMIN SUPPORT UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/reports/light', superAuth, async (_req, res) => {
    try {
        if (reportsLightCache.payload && reportsLightCache.expiresAt > Date.now()) {
            return res.json(reportsLightCache.payload);
        }

        const totals = await pool.query(`
            SELECT
                (SELECT COALESCE(SUM(amount_paid),0) FROM payments WHERE deleted_at IS NULL) AS total_revenue,
                (SELECT COUNT(*) FROM gyms) AS total_gyms,
                (SELECT COUNT(*) FROM gyms WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())) AS gyms_this_month,
                (SELECT COUNT(*) FROM gyms WHERE COALESCE(gym_access_status,'ACTIVE') IN ('BLOCKED','SUSPENDED')) AS churn_gyms
        `);

        const growth = await pool.query(`
            SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS gyms
            FROM gyms
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY month DESC
            LIMIT 6
        `);

        const payload = { summary: totals.rows[0], growth: growth.rows.reverse() };
        reportsLightCache = {
            payload,
            expiresAt: Date.now() + REPORTS_LIGHT_CACHE_TTL_MS,
        };

        return res.json(payload);
    } catch (err) {
        console.error('SUPERADMIN REPORTS ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

// ── WhatsApp Webhook URL (for MSG91 configuration) ──
router.get('/system/whatsapp-webhook', superAuth, async (req, res) => {
    try {
        const webhookToken = String(process.env.WHATSAPP_DELIVERY_WEBHOOK_TOKEN || process.env.MSG91_WHATSAPP_WEBHOOK_TOKEN || '').trim();
        const appUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
        const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http';
        const forwardedHost = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
        const baseUrl = appUrl || (forwardedHost ? `${forwardedProto}://${forwardedHost}` : 'http://localhost:5000');
        const url = new URL('/api/settings/platform/whatsapp-delivery/webhook', `${baseUrl}/`);
        if (webhookToken) url.searchParams.set('token', webhookToken);
        return res.json({
            callback_url: url.toString(),
            webhook_token_configured: Boolean(webhookToken),
            docs_url: 'https://docs.msg91.com/whatsapp-webhook',
        });
    } catch (err) {
        console.error('SUPERADMIN WHATSAPP WEBHOOK URL ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/system', superAuth, async (_req, res) => {
    try {
        await ensurePlatformSettingsBase();
        const row = await pool.query('SELECT * FROM platform_settings WHERE id = 1');
        const base = row.rows[0] || { maintenance_mode: false, maintenance_message: '', feature_flags: {} };
        return res.json({
            ...base,
            automation_settings: normalizeAutomationSettings(base.automation_settings),
            billing_config: serializeBillingConfig(base.billing_config, { includeAllPlans: true }),
            support_profile: normalizeSupportProfile(base.support_profile),
        });
    } catch (err) {
        console.error('SUPERADMIN SYSTEM GET ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.put('/system', superAuth, async (req, res) => {
    const maintenanceMode = typeof req.body.maintenance_mode === 'boolean' ? req.body.maintenance_mode : null;
    const maintenanceMessage = req.body.maintenance_message == null ? null : String(req.body.maintenance_message);
    const featureFlags = req.body.feature_flags && typeof req.body.feature_flags === 'object' ? req.body.feature_flags : null;
    const supportProfile = req.body.support_profile && typeof req.body.support_profile === 'object'
        ? normalizeSupportProfile(req.body.support_profile)
        : null;
    const automationSettings = req.body.automation_settings && typeof req.body.automation_settings === 'object'
        ? normalizeAutomationSettings(req.body.automation_settings)
        : null;
    const billingConfig = req.body.billing_config && typeof req.body.billing_config === 'object'
        ? normalizeBillingConfig(req.body.billing_config)
        : null;

    try {
        await ensurePlatformSettingsBase();

        const updated = await pool.query(
            `UPDATE platform_settings
             SET maintenance_mode = COALESCE($1, maintenance_mode),
                 maintenance_message = COALESCE($2, maintenance_message),
                 feature_flags = COALESCE($3::jsonb, feature_flags),
                 support_profile = COALESCE($4::jsonb, support_profile),
                 automation_settings = COALESCE($5::jsonb, automation_settings),
                 billing_config = COALESCE($6::jsonb, billing_config),
                 updated_at = NOW()
             WHERE id = 1
             RETURNING *`,
            [
                maintenanceMode,
                maintenanceMessage,
                featureFlags ? JSON.stringify(featureFlags) : null,
                supportProfile ? JSON.stringify(supportProfile) : null,
                automationSettings ? JSON.stringify(automationSettings) : null,
                billingConfig ? JSON.stringify(billingConfig) : null,
            ]
        );

        await logAudit({
            action: 'SYSTEM_SETTINGS_UPDATED',
            targetType: 'SYSTEM',
            targetId: '1',
            targetLabel: 'platform_settings',
            details: { maintenanceMode, maintenanceMessage, featureFlags, supportProfile, automationSettings, billingConfig },
        });

        return res.json(updated.rows[0]);
    } catch (err) {
        console.error('SUPERADMIN SYSTEM UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/system/broadcast', superAuth, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const url = String(req.body.url || '/').trim();
    // roles: array of roles to push to, default owners+staff
    const roles = Array.isArray(req.body.roles) ? req.body.roles : ['OWNER', 'STAFF'];
    // Optional: target a single gym
    const target_gym_id = req.body.target_gym_id ? Number(req.body.target_gym_id) : null;

    if (!title || !message) {
        return res.status(400).json({ error: 'title and message are required' });
    }

    try {
        // Insert in-app notifications for all gyms
        if (target_gym_id) {
            await pool.query(
                `INSERT INTO notifications (gym_id, title, message)
                 SELECT id, $1, $2 FROM gyms WHERE id = $3`,
                [title, message, target_gym_id]
            );
        } else {
            await pool.query(
                `INSERT INTO notifications (gym_id, title, message)
                 SELECT id, $1, $2 FROM gyms`,
                [title, message]
            );
        }

        // Send web push if VAPID is configured
        let pushSent = 0;
        if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
            const payload = JSON.stringify({ title, body: message, icon: '/gymvault-app-icon-192.png', badge: '/gymvault-app-icon-64.png', url });
            let subsQuery;
            if (target_gym_id) {
                subsQuery = await pool.query(
                    'SELECT * FROM push_subscriptions WHERE gym_id = $1 AND role = ANY($2)',
                    [target_gym_id, roles]
                );
            } else {
                subsQuery = await pool.query(
                    'SELECT * FROM push_subscriptions WHERE role = ANY($1)',
                    [roles]
                );
            }
            await Promise.all(subsQuery.rows.map((sub) =>
                webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload
                ).catch((err) => {
                    if (err.statusCode === 410) {
                        pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(() => {});
                    }
                })
            ));
            pushSent = subsQuery.rows.length;
        }

        await logAudit({
            action: 'SYSTEM_BROADCAST_SENT',
            targetType: 'SYSTEM',
            targetId: 'broadcast',
            targetLabel: title,
            details: { message, pushSent, roles, target_gym_id },
        });

        return res.json({ message: target_gym_id ? 'Broadcast sent to selected gym.' : 'Broadcast sent to all gyms.', pushSent });
    } catch (err) {
        console.error('SUPERADMIN BROADCAST ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/telemetry', superAuth, async (_req, res) => {
    try {
        return res.json(getRuntimeTelemetrySnapshot());
    } catch (err) {
        console.error('SUPERADMIN TELEMETRY ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/runtime-events', superAuth, async (req, res) => {
    try {
        const payload = await listRuntimeEvents({
            page: req.query.page,
            limit: req.query.limit,
            search: req.query.q,
            eventType: req.query.event_type,
            severity: req.query.severity,
        });
        return res.json(payload);
    } catch (err) {
        console.error('SUPERADMIN RUNTIME EVENTS ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/logs', superAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '';

    if (q) {
        params.push(`%${q}%`);
        where = `WHERE action ILIKE $1 OR COALESCE(target_label,'') ILIKE $1 OR COALESCE(target_type,'') ILIKE $1`;
    }

    try {
        const rows = await pool.query(
            `SELECT id, action, target_type, target_id, target_label, actor_type, actor_id, details, created_at
             FROM audit_logs
             ${where}
             ORDER BY created_at DESC
             LIMIT 500`,
            params
        );
        return res.json(rows.rows);
    } catch (err) {
        console.error('SUPERADMIN LOGS ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/search', superAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ gyms: [], users: [] });

    try {
        const gyms = await pool.query(
            `SELECT id, name AS gym_name, COALESCE(current_plan,'pro') AS plan, COALESCE(gym_access_status, 'ACTIVE') AS status
             FROM gyms
             WHERE name ILIKE $1
             ORDER BY created_at DESC
             LIMIT 15`,
            [`%${q}%`]
        );

        const users = await pool.query(
            `SELECT u.id, u.full_name, u.email, u.role, g.name AS gym_name
             FROM users u
             LEFT JOIN gyms g ON g.id = u.gym_id
             WHERE u.full_name ILIKE $1 OR u.email ILIKE $1
             ORDER BY u.created_at DESC
             LIMIT 20`,
            [`%${q}%`]
        );

        return res.json({ gyms: gyms.rows, users: users.rows });
    } catch (err) {
        console.error('SUPERADMIN SEARCH ERROR:', err.message);
        return res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
