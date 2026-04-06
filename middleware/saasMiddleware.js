const { pool } = require('../config/db');

module.exports = async function(req, res, next) {
    try {
        const gym_id = req.user.gym_id;
        const result = await pool.query(
            `WITH gym_snapshot AS (
                SELECT
                    id,
                    saas_status,
                    saas_valid_until,
                    CASE
                        WHEN saas_valid_until IS NULL THEN saas_status
                        WHEN saas_valid_until < NOW() - INTERVAL '3 days' THEN 'EXPIRED'
                        WHEN saas_valid_until < NOW() THEN 'GRACE_PERIOD'
                        WHEN saas_status IN ('ACTIVE', 'FREE_TRIAL') THEN saas_status
                        ELSE 'ACTIVE'
                    END AS resolved_status,
                    EXTRACT(EPOCH FROM (saas_valid_until - NOW())) / 86400 AS diff_days
                FROM gyms
                WHERE id = $1
            ), updated AS (
                UPDATE gyms g
                SET saas_status = snapshot.resolved_status
                FROM gym_snapshot snapshot
                WHERE g.id = snapshot.id
                  AND snapshot.saas_valid_until IS NOT NULL
                  AND g.saas_status IS DISTINCT FROM snapshot.resolved_status
                RETURNING g.id
            )
            SELECT saas_status, saas_valid_until, resolved_status, diff_days
            FROM gym_snapshot`,
            [gym_id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Gym not found" });
        const gym = result.rows[0];
        
        // No valid_until set — allow (initial setup)
        if (!gym.saas_valid_until) return next();

        const diffDays = Number(gym.diff_days || 0);

        // HARD LOCKOUT: Past 3 days expired (applies to ALL statuses including FREE_TRIAL)
        if (diffDays < -3) {
            return res.status(403).json({ error: "SAAS_EXPIRED", message: "Subscription expired. Please renew." });
        } 
        // GRACE PERIOD: 0 to 3 days expired
        else if (diffDays < 0 && diffDays >= -3) {
            // Allow access but signal grace period in response header
            res.set('X-SaaS-Grace', 'true');
            res.set('X-SaaS-Days-Left', Math.ceil(3 + diffDays).toString());
            return next(); 
        }

        next();
    } catch (err) {
        console.error("SaaS Middleware Error:", err);
        res.status(500).json({ error: "Server Error in SaaS Validation" });
    }
};