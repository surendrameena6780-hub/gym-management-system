const crypto = require('crypto');

const getAttendanceSecret = () => {
    const secret = process.env.ATTENDANCE_QR_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('ATTENDANCE_QR_SECRET or JWT_SECRET is required for attendance tokens.');
    }
    return secret;
};

const toBase64Url = (value) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value) => Buffer.from(String(value || ''), 'base64url').toString('utf8');

const signAttendanceToken = (payload) => {
    const normalized = {
        version: 1,
        ...payload,
    };
    const encodedPayload = toBase64Url(JSON.stringify(normalized));
    const signature = crypto
        .createHmac('sha256', getAttendanceSecret())
        .update(encodedPayload)
        .digest('base64url');

    return `${encodedPayload}.${signature}`;
};

const verifyAttendanceToken = (token) => {
    const rawToken = String(token || '').trim();
    const [encodedPayload, encodedSignature] = rawToken.split('.');

    if (!encodedPayload || !encodedSignature) {
        return { valid: false, reason: 'Malformed token.' };
    }

    const expectedSignature = crypto
        .createHmac('sha256', getAttendanceSecret())
        .update(encodedPayload)
        .digest('base64url');

    const actualBuffer = Buffer.from(encodedSignature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
        return { valid: false, reason: 'Invalid signature.' };
    }

    try {
        const payload = JSON.parse(fromBase64Url(encodedPayload));
        if (!payload || payload.version !== 1) {
            return { valid: false, reason: 'Unsupported attendance token version.' };
        }

        const expiresAt = Number(payload.expires_at || 0);
        if (expiresAt > 0 && Date.now() > expiresAt) {
            return { valid: false, reason: 'Attendance token expired.' };
        }

        return { valid: true, payload };
    } catch (_err) {
        return { valid: false, reason: 'Unreadable token payload.' };
    }
};

module.exports = {
    signAttendanceToken,
    verifyAttendanceToken,
};