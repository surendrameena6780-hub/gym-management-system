const STAFF_ROLE_PERMISSIONS = {
    MANAGER: [
        'members:create',
        'members:read',
        'members:write',
        'attendance:read',
        'attendance:write',
        'payments:read',
        'support:read',
        'support:write',
    ],
    RECEPTION: [
        'members:create',
        'members:read',
        'members:write',
        'attendance:read',
        'attendance:write',
        'payments:read',
        'payments:write',
        'support:read',
        'support:write',
    ],
    TRAINER: [
        'members:create',
        'members:read',
        'attendance:read',
        'attendance:write',
        'support:read',
        'support:write',
    ],
    WORKER: [
        'members:create',
        'members:read',
        'attendance:read',
        'support:read',
        'support:write',
    ],
    CLEANER: [
        'attendance:read',
        'support:read',
        'support:write',
    ],
    ACCOUNTANT: [
        'members:create',
        'members:read',
        'payments:read',
        'payments:write',
        'support:read',
        'support:write',
    ],
    STAFF: [
        'members:create',
        'members:read',
        'attendance:read',
        'support:read',
        'support:write',
    ],
};

const normalizeString = (value) => String(value || '').trim().toUpperCase();

const getDefaultPermissionsByStaffRole = (staffRole) => {
    const normalized = normalizeString(staffRole) || 'STAFF';
    return STAFF_ROLE_PERMISSIONS[normalized] || STAFF_ROLE_PERMISSIONS.STAFF;
};

const resolvePermissions = (user = {}) => {
    const role = normalizeString(user.role);
    if (role === 'OWNER') return ['*'];

    if (Array.isArray(user.permissions) && user.permissions.length > 0) {
        return user.permissions;
    }

    return getDefaultPermissionsByStaffRole(user.staff_role);
};

const hasPermission = (user, permission) => {
    const permissions = resolvePermissions(user);
    if (permissions.includes('*')) return true;
    if (permissions.includes(permission)) return true;

    const [scope] = String(permission || '').split(':');
    if (scope && permissions.includes(`${scope}:*`)) return true;

    return false;
};

const hasAnyPermission = (user, permissions = []) => {
    if (normalizeString(user?.role) === 'OWNER') return true;
    return permissions.some((permission) => hasPermission(user, permission));
};

const requireOwner = (req, res, next) => {
    if (normalizeString(req.user?.role) === 'OWNER') return next();
    return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_OWNER_ONLY',
        error: 'Only gym owner can access this action.',
    });
};

const requirePermission = (permission) => (req, res, next) => {
    if (normalizeString(req.user?.role) === 'OWNER') return next();
    if (hasPermission(req.user, permission)) return next();

    return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_PERMISSION',
        error: 'You do not have permission to perform this action.',
        required_permission: permission,
    });
};

const requireAnyPermission = (permissions = []) => (req, res, next) => {
    if (normalizeString(req.user?.role) === 'OWNER') return next();
    if (hasAnyPermission(req.user, permissions)) return next();

    return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_PERMISSION',
        error: 'You do not have permission to perform this action.',
        required_permission: permissions,
    });
};

module.exports = {
    STAFF_ROLE_PERMISSIONS,
    getDefaultPermissionsByStaffRole,
    resolvePermissions,
    hasPermission,
    hasAnyPermission,
    requireOwner,
    requirePermission,
    requireAnyPermission,
};
