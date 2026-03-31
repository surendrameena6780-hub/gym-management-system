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
        return res.status(401).json({
            success: false,
            code: 'AUTH_MISSING',
            error: 'Invalid credentials. Please login again.',
            message: 'No token, access denied'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // This attaches the user/gym data to the request
        req.user = decoded.user || decoded; 
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