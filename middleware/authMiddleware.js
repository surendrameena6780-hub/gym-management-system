const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getRequestCookie, OWNER_AUTH_COOKIE } = require('../utils/authCookies');
const { DEFAULT_BRANCH_ID, ensureBranchScopeSchema } = require('../utils/branchAccess');
const { cacheGet, cacheSet, buildCacheKey } = require('../utils/cache');
const { getDefaultPermissionsByStaffRole } = require('./rbac');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_SESSION_CACHE_TTL = 60; // seconds

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is missing or insecure.');
}

module.exports = async (req, res, next) => {
    const headerToken = req.header('x-auth-token');
    const authHeader = req.header('authorization');
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookieToken = getRequestCookie(req, OWNER_AUTH_COOKIE);
    const token = headerToken || bearerToken || cookieToken;
    const tokenSource = headerToken ? 'header' : bearerToken ? 'bearer' : cookieToken ? 'cookie' : '';

    if (!token) {
        return res.status(401).json({
            success: false,
            code: 'AUTH_MISSING',
            error: 'Invalid credentials. Please login again.',
            message: 'No token, access denied'
        });
    }

    if (!SAFE_METHODS.has(req.method) && tokenSource === 'cookie') {
        return res.status(401).json({
            success: false,
            code: 'AUTH_HEADER_REQUIRED',
            error: 'Refresh your session and try again.',
            message: 'Explicit auth token required for this action.'
        });
    }

    try {
        await ensureBranchScopeSchema();
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const decodedUser = decoded.user || decoded;
        const userId = Number.parseInt(decodedUser?.id, 10);
        const gymId = Number.parseInt(decodedUser?.gym_id ?? decodedUser?.gymId, 10);

        if (!Number.isInteger(userId) || !Number.isInteger(gymId)) {
            return res.status(401).json({
                success: false,
                code: 'AUTH_INVALID',
                error: 'Invalid credentials. Please login again.',
                message: 'Invalid Token'
            });
        }

        const sessionCacheKey = buildCacheKey('auth', 'session', userId, gymId);
        let session = await cacheGet(sessionCacheKey);

        if (!session) {
            const sessionResult = await pool.query(
                `SELECT u.id,
                        u.gym_id,
                        u.role,
                        u.staff_role,
                        u.branch_id,
                        u.permissions,
                        COALESCE(u.is_active, TRUE) AS user_is_active,
                        COALESCE(g.is_active, TRUE) AS gym_is_active,
                        UPPER(COALESCE(g.gym_access_status, 'ACTIVE')) AS gym_access_status
                 FROM users u
                 JOIN gyms g ON g.id = u.gym_id
                 WHERE u.id = $1 AND u.gym_id = $2
                 LIMIT 1`,
                [userId, gymId]
            );
            session = sessionResult.rows[0] || null;
            if (session) {
                await cacheSet(sessionCacheKey, session, AUTH_SESSION_CACHE_TTL);
            }
        }
        if (!session) {
            return res.status(401).json({
                success: false,
                code: 'AUTH_INVALID',
                error: 'Invalid credentials. Please login again.',
                message: 'Invalid Token'
            });
        }

        if (session.user_is_active === false) {
            return res.status(403).json({
                success: false,
                code: 'AUTH_USER_INACTIVE',
                error: 'Your account is inactive. Contact the gym owner.',
                message: 'Account inactive'
            });
        }

        if (session.gym_is_active === false || session.gym_access_status === 'BLOCKED' || session.gym_access_status === 'SUSPENDED') {
            return res.status(403).json({
                success: false,
                code: 'AUTH_GYM_INACTIVE',
                error: 'Gym access is inactive. Contact support.',
                message: 'Gym access inactive'
            });
        }

        const resolvedPermissions = Array.isArray(session.permissions)
            ? session.permissions
            : String(session.role || decodedUser.role || '').toUpperCase() === 'OWNER'
                ? ['*']
                : getDefaultPermissionsByStaffRole(session.staff_role || decodedUser.staff_role);

        req.user = {
            ...decodedUser,
            id: session.id,
            gym_id: session.gym_id,
            gymId: session.gym_id,
            role: session.role || decodedUser.role,
            staff_role: session.staff_role || decodedUser.staff_role,
            branch_id: session.branch_id || decodedUser.branch_id || DEFAULT_BRANCH_ID,
            permissions: resolvedPermissions,
            is_active: session.user_is_active,
        };
        req.authToken = token;
        req.authTokenSource = tokenSource;
        next();
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.error("JWT Error Details:", err.message);
        }
        res.status(401).json({
            success: false,
            code: 'AUTH_INVALID',
            error: 'Invalid credentials. Please login again.',
            message: 'Invalid Token'
        });
    }
};