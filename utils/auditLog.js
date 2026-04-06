const { pool } = require('../config/db');

const writeAuditLog = async ({
    actorType = 'GYM_USER',
    actorId = '',
    action,
    targetType,
    targetId = '',
    targetLabel = '',
    details = {},
}) => {
    if (!action || !targetType) {
        return;
    }

    try {
        await pool.query(
            `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, target_label, details)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
                String(actorType || 'GYM_USER').trim().slice(0, 20),
                String(actorId || '').trim().slice(0, 100) || null,
                String(action || '').trim().slice(0, 100),
                String(targetType || '').trim().slice(0, 50),
                String(targetId || '').trim().slice(0, 100) || null,
                String(targetLabel || '').trim().slice(0, 255) || null,
                JSON.stringify(details || {}),
            ]
        );
    } catch (err) {
        console.error('AUDIT LOG INSERT ERROR:', err.message);
    }
};

module.exports = {
    writeAuditLog,
};