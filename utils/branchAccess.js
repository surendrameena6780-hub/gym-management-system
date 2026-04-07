const { pool } = require('../config/db');

const DEFAULT_BRANCH_ID = 'branch-1';

class BranchAccessError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'BranchAccessError';
        this.statusCode = statusCode;
    }
}

const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBranchId = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/[^a-z0-9_-]/g, '').slice(0, 60);
};

const buildDefaultBranchDirectory = (count = 1) => Array.from({ length: Math.max(1, count) }, (_item, index) => ({
    id: `branch-${index + 1}`,
    name: index === 0 ? 'Main Branch' : `Branch ${index + 1}`,
    address: '',
    phone: '',
}));

const normalizeBranchDirectory = (value, branchesCount = 1) => {
    const requestedCount = Math.min(25, Math.max(1, toPositiveInt(branchesCount, 1)));
    const items = Array.isArray(value) ? value : [];
    const normalized = items
        .map((item, index) => ({
            id: normalizeBranchId(item?.id) || `branch-${index + 1}`,
            name: String(item?.name || '').trim() || (index === 0 ? 'Main Branch' : `Branch ${index + 1}`),
            address: String(item?.address || '').trim(),
            phone: String(item?.phone || '').trim(),
        }))
        .slice(0, requestedCount);

    if (normalized.length === 0) {
        return buildDefaultBranchDirectory(requestedCount);
    }

    while (normalized.length < requestedCount) {
        normalized.push({
            id: `branch-${normalized.length + 1}`,
            name: normalized.length === 0 ? 'Main Branch' : `Branch ${normalized.length + 1}`,
            address: '',
            phone: '',
        });
    }

    return normalized;
};

const getDefaultBranchId = (branchDirectory = []) => normalizeBranchId(branchDirectory[0]?.id) || DEFAULT_BRANCH_ID;

const getBranchMap = (branchDirectory = []) => new Map(
    normalizeBranchDirectory(branchDirectory, Math.max(1, branchDirectory.length || 1)).map((branch) => [branch.id, branch])
);

const getBranchName = (branchDirectory = [], branchId) => {
    const normalizedBranchId = normalizeBranchId(branchId);
    if (!normalizedBranchId) return '';
    return getBranchMap(branchDirectory).get(normalizedBranchId)?.name || '';
};

const validateBranchId = (branchDirectory = [], branchId) => {
    const normalizedBranchId = normalizeBranchId(branchId);
    if (!normalizedBranchId) return '';
    return getBranchMap(branchDirectory).has(normalizedBranchId) ? normalizedBranchId : '';
};

let ensureBranchScopeSchemaPromise = null;

const ensureBranchScopeSchema = async () => {
    if (!ensureBranchScopeSchemaPromise) {
        ensureBranchScopeSchemaPromise = pool.query(`
            ALTER TABLE IF EXISTS gyms ADD COLUMN IF NOT EXISTS branches_count INTEGER DEFAULT 1;
            ALTER TABLE IF EXISTS gyms ADD COLUMN IF NOT EXISTS branch_directory JSONB DEFAULT '[]'::jsonb;

            ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS members ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS memberships ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS payment_collections ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS attendance ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS class_types ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS class_sessions ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS class_bookings ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS pos_products ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';
            ALTER TABLE IF EXISTS pos_sales ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '${DEFAULT_BRANCH_ID}';

            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payout_mode VARCHAR(40) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payout_reference VARCHAR(120) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payout_notes TEXT DEFAULT '';
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT '';

            UPDATE gyms
            SET branches_count = GREATEST(COALESCE(branches_count, 1), 1)
            WHERE COALESCE(branches_count, 0) < 1;

            UPDATE users SET branch_id = '${DEFAULT_BRANCH_ID}' WHERE COALESCE(branch_id, '') = '';
            UPDATE members SET branch_id = '${DEFAULT_BRANCH_ID}' WHERE COALESCE(branch_id, '') = '';
            UPDATE class_types SET branch_id = '${DEFAULT_BRANCH_ID}' WHERE COALESCE(branch_id, '') = '';
            UPDATE expenses SET branch_id = '${DEFAULT_BRANCH_ID}' WHERE COALESCE(branch_id, '') = '';
            UPDATE pos_products SET branch_id = '${DEFAULT_BRANCH_ID}' WHERE COALESCE(branch_id, '') = '';
            UPDATE pos_sales SET branch_id = '${DEFAULT_BRANCH_ID}' WHERE COALESCE(branch_id, '') = '';

            UPDATE memberships ms
            SET branch_id = COALESCE(NULLIF(ms.branch_id, ''), NULLIF(m.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM members m
            WHERE ms.member_id = m.id
              AND ms.gym_id = m.gym_id
              AND COALESCE(ms.branch_id, '') = '';

            UPDATE payments p
            SET branch_id = COALESCE(NULLIF(p.branch_id, ''), NULLIF(m.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM members m
            WHERE p.user_id = m.id
              AND p.gym_id = m.gym_id
              AND COALESCE(p.branch_id, '') = '';

            UPDATE payment_collections pc
            SET branch_id = COALESCE(NULLIF(pc.branch_id, ''), NULLIF(p.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM payments p
            WHERE pc.payment_id = p.id
              AND pc.gym_id = p.gym_id
              AND COALESCE(pc.branch_id, '') = '';

            UPDATE attendance a
            SET branch_id = COALESCE(NULLIF(a.branch_id, ''), NULLIF(m.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM members m
            WHERE a.member_id = m.id
              AND a.gym_id = m.gym_id
              AND COALESCE(a.branch_id, '') = '';

            UPDATE class_sessions cs
            SET branch_id = COALESCE(NULLIF(cs.branch_id, ''), NULLIF(ct.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM class_types ct
            WHERE cs.class_type_id = ct.id
              AND cs.gym_id = ct.gym_id
              AND COALESCE(cs.branch_id, '') = '';

            UPDATE class_bookings cb
            SET branch_id = COALESCE(NULLIF(cb.branch_id, ''), NULLIF(cs.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM class_sessions cs
            WHERE cb.class_session_id = cs.id
              AND cb.gym_id = cs.gym_id
              AND COALESCE(cb.branch_id, '') = '';

            UPDATE payroll_entries pe
            SET branch_id = COALESCE(NULLIF(pe.branch_id, ''), NULLIF(u.branch_id, ''), '${DEFAULT_BRANCH_ID}')
            FROM users u
            WHERE pe.user_id = u.id
              AND pe.gym_id = u.gym_id
              AND COALESCE(pe.branch_id, '') = '';

            UPDATE payroll_entries
            SET status = 'PENDING_APPROVAL'
            WHERE UPPER(COALESCE(status, '')) = 'PENDING';

            CREATE INDEX IF NOT EXISTS idx_users_gym_branch_id ON users(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_members_gym_branch_id ON members(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_memberships_gym_branch_id ON memberships(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_payments_gym_branch_id ON payments(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_gym_branch_id ON payment_collections(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_attendance_gym_branch_id ON attendance(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_class_types_gym_branch_id ON class_types(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_class_sessions_gym_branch_id ON class_sessions(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_class_bookings_gym_branch_id ON class_bookings(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_expenses_gym_branch_id ON expenses(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_payroll_entries_gym_branch_id ON payroll_entries(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_pos_products_gym_branch_id ON pos_products(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_pos_sales_gym_branch_id ON pos_sales(gym_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_payroll_entries_status ON payroll_entries(gym_id, status, created_at DESC);
        `).catch((error) => {
            ensureBranchScopeSchemaPromise = null;
            throw error;
        });
    }

    await ensureBranchScopeSchemaPromise;
};

const branchSchemaMiddleware = async (_req, res, next) => {
    try {
        await ensureBranchScopeSchema();
        next();
    } catch (error) {
        console.error('BRANCH SCHEMA INIT ERROR:', error.message);
        res.status(500).json({ error: 'Failed to initialize branch support.' });
    }
};

const getGymBranchDirectory = async (db, gymId) => {
    await ensureBranchScopeSchema();
    const result = await db.query(
        `SELECT branches_count, branch_directory
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId]
    );

    const row = result.rows[0] || {};
    return normalizeBranchDirectory(row.branch_directory, row.branches_count || 1);
};

const resolveBranchReadScope = async (db, req, requestedBranchId = undefined) => {
    const gymId = Number.parseInt(req?.user?.gym_id ?? req?.user?.gymId, 10);
    const branchDirectory = await getGymBranchDirectory(db, gymId);
    const defaultBranchId = getDefaultBranchId(branchDirectory);
    const userRole = String(req?.user?.role || '').trim().toUpperCase();
    const requested = requestedBranchId === undefined
        ? (req?.query?.branch_id ?? req?.body?.branch_id ?? null)
        : requestedBranchId;
    const requestedIsAll = String(requested || '').trim().toLowerCase() === 'all';
    const validatedRequestedBranchId = requestedIsAll ? '' : validateBranchId(branchDirectory, requested);

    if (userRole === 'OWNER') {
        if (requested && !requestedIsAll && !validatedRequestedBranchId) {
            throw new BranchAccessError('Selected branch is not available for this gym.', 400);
        }

        return {
            branchId: validatedRequestedBranchId || null,
            defaultBranchId,
            branchDirectory,
            branchMap: getBranchMap(branchDirectory),
        };
    }

    const userBranchId = validateBranchId(branchDirectory, req?.user?.branch_id) || defaultBranchId;
    if (validatedRequestedBranchId && validatedRequestedBranchId !== userBranchId) {
        throw new BranchAccessError('You can only access data for your assigned branch.', 403);
    }

    return {
        branchId: userBranchId,
        defaultBranchId,
        branchDirectory,
        branchMap: getBranchMap(branchDirectory),
    };
};

const resolveBranchWriteScope = async (db, req, requestedBranchId = undefined) => {
    const scope = await resolveBranchReadScope(db, req, requestedBranchId);

    if (scope.branchId) {
        return scope;
    }

    const validatedBranchId = validateBranchId(scope.branchDirectory, requestedBranchId);
    return {
        ...scope,
        branchId: validatedBranchId || scope.defaultBranchId,
    };
};

const ensureBranchAccess = (scope, recordBranchId, message = 'This record belongs to another branch.') => {
    const normalizedRecordBranchId = normalizeBranchId(recordBranchId) || scope.defaultBranchId;
    if (scope.branchId && normalizedRecordBranchId !== scope.branchId) {
        throw new BranchAccessError(message, 403);
    }
    return normalizedRecordBranchId;
};

const getMemberBranchId = async (db, gymId, memberId) => {
    await ensureBranchScopeSchema();
    const result = await db.query(
        `SELECT branch_id
         FROM members
         WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [memberId, gymId]
    );
    return normalizeBranchId(result.rows[0]?.branch_id) || DEFAULT_BRANCH_ID;
};

const getOutOfDirectoryBranchUsage = async (db, gymId, activeBranchIds = []) => {
    await ensureBranchScopeSchema();
    const normalizedActiveBranchIds = Array.from(new Set(activeBranchIds.map((branchId) => normalizeBranchId(branchId)).filter(Boolean)));

    if (normalizedActiveBranchIds.length === 0) {
        return [];
    }

    const result = await db.query(
        `WITH used_branches AS (
            SELECT branch_id FROM users WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM members WHERE gym_id = $1 AND deleted_at IS NULL AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM memberships WHERE gym_id = $1 AND deleted_at IS NULL AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM payments WHERE gym_id = $1 AND deleted_at IS NULL AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM payment_collections WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM attendance WHERE gym_id = $1 AND deleted_at IS NULL AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM class_types WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM class_sessions WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM class_bookings WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM expenses WHERE gym_id = $1 AND deleted_at IS NULL AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM payroll_entries WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM pos_products WHERE gym_id = $1 AND deleted_at IS NULL AND COALESCE(branch_id, '') <> ''
            UNION
            SELECT branch_id FROM pos_sales WHERE gym_id = $1 AND COALESCE(branch_id, '') <> ''
        )
        SELECT DISTINCT branch_id
        FROM used_branches
        WHERE NOT (branch_id = ANY($2::text[]))
        ORDER BY branch_id ASC`,
        [gymId, normalizedActiveBranchIds]
    );

    return result.rows.map((row) => row.branch_id).filter(Boolean);
};

module.exports = {
    DEFAULT_BRANCH_ID,
    BranchAccessError,
    normalizeBranchId,
    normalizeBranchDirectory,
    getDefaultBranchId,
    getBranchMap,
    getBranchName,
    ensureBranchScopeSchema,
    branchSchemaMiddleware,
    getGymBranchDirectory,
    resolveBranchReadScope,
    resolveBranchWriteScope,
    ensureBranchAccess,
    getMemberBranchId,
    getOutOfDirectoryBranchUsage,
};