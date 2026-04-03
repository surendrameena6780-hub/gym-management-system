const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'gymvault_dev_secret_2026') {
    throw new Error('FATAL: JWT_SECRET is missing or insecure.');
}

module.exports = (req, res, next) => {
    const headerToken = req.header('x-auth-token');
    const authHeader = req.header('authorization');
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = headerToken || bearerToken;

    if (!token) {
        return res.status(401).json({ message: 'No token, access denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?.member?.id || !decoded?.member?.gym_id) {
            return res.status(401).json({ message: 'Invalid member token.' });
        }

        req.member = decoded.member;
        req.user = {
            id: decoded.member.id,
            gym_id: decoded.member.gym_id,
            role: 'MEMBER',
        };
        next();
    } catch (_err) {
        return res.status(401).json({ message: 'Token is not valid.' });
    }
};