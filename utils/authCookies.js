const OWNER_AUTH_COOKIE = 'gv_auth';
const MEMBER_AUTH_COOKIE = 'gv_member_auth';

const OWNER_AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEMBER_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isProduction = process.env.NODE_ENV === 'production';

const parseCookies = (cookieHeader = '') => {
    return String(cookieHeader || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((accumulator, entry) => {
            const separatorIndex = entry.indexOf('=');
            if (separatorIndex === -1) return accumulator;

            const key = entry.slice(0, separatorIndex).trim();
            const value = entry.slice(separatorIndex + 1).trim();
            if (!key) return accumulator;

            accumulator[key] = decodeURIComponent(value);
            return accumulator;
        }, {});
};

const getRequestCookie = (req, cookieName) => {
    const cookies = parseCookies(req?.headers?.cookie || '');
    return String(cookies[cookieName] || '').trim();
};

const getCookieOptions = (maxAge) => ({
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge,
    path: '/',
});

const setUserAuthCookie = (res, token) => {
    res.cookie(OWNER_AUTH_COOKIE, String(token || '').trim(), getCookieOptions(OWNER_AUTH_TTL_MS));
};

const clearUserAuthCookie = (res) => {
    res.clearCookie(OWNER_AUTH_COOKIE, getCookieOptions(OWNER_AUTH_TTL_MS));
};

const setMemberAuthCookie = (res, token) => {
    res.cookie(MEMBER_AUTH_COOKIE, String(token || '').trim(), getCookieOptions(MEMBER_AUTH_TTL_MS));
};

const clearMemberAuthCookie = (res) => {
    res.clearCookie(MEMBER_AUTH_COOKIE, getCookieOptions(MEMBER_AUTH_TTL_MS));
};

module.exports = {
    OWNER_AUTH_COOKIE,
    MEMBER_AUTH_COOKIE,
    getRequestCookie,
    setUserAuthCookie,
    clearUserAuthCookie,
    setMemberAuthCookie,
    clearMemberAuthCookie,
};