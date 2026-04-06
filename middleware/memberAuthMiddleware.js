const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getRequestCookie, MEMBER_AUTH_COOKIE } = require('../utils/authCookies');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is missing or insecure.');
}

module.exports = async (req, res, next) => {
    const headerToken = req.header('x-auth-token');
    const authHeader = req.header('authorization');
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookieToken = getRequestCookie(req, MEMBER_AUTH_COOKIE);
    const token = headerToken || bearerToken || cookieToken;
    const tokenSource = headerToken ? 'header' : bearerToken ? 'bearer' : cookieToken ? 'cookie' : '';

    if (!token) {
        return res.status(401).json({ message: 'No token, access denied' });
    }

    if (!SAFE_METHODS.has(req.method) && tokenSource === 'cookie') {
        return res.status(401).json({ message: 'Refresh your session and try again.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?.member?.id || !decoded?.member?.gym_id) {
            return res.status(401).json({ message: 'Invalid member token.' });
        }

        const memberResult = await pool.query(
            `SELECT id, gym_id, status
             FROM members
             WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [decoded.member.id, decoded.member.gym_id]
        );

        if (memberResult.rows.length === 0) {
            return res.status(401).json({ message: 'Member account is no longer available.' });
        }

        const memberRow = memberResult.rows[0];

        req.member = {
            ...decoded.member,
            id: memberRow.id,
            gym_id: memberRow.gym_id,
            status: memberRow.status,
        };
        req.user = {
            id: memberRow.id,
            gym_id: memberRow.gym_id,
            role: 'MEMBER',
        };
        req.memberAuthToken = token;
        req.memberAuthTokenSource = tokenSource;
        next();
    } catch (_err) {
        return res.status(401).json({ message: 'Token is not valid.' });
    }
};