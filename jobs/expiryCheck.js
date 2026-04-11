const { pool } = require('../config/db');

const checkExpirations = async () => {
    const client = await pool.connect();
    try {
        console.log("Running Expiry Janitor...");
        await client.query('BEGIN');

        // Step 1: Mark any ACTIVE membership as EXPIRED if the end_date is in the past
        const result = await client.query(`
            UPDATE memberships
            SET status = 'EXPIRED'
            WHERE end_date < CURRENT_DATE AND status = 'ACTIVE'
        `);

        // Step 1b: Mark FROZEN memberships as EXPIRED if the end_date is in the past
        const frozenResult = await client.query(`
            UPDATE memberships
            SET status = 'EXPIRED'
            WHERE end_date < CURRENT_DATE AND status = 'FROZEN'
        `);

        // Step 2: Sync member status — set ACTIVE members to UNPAID
        // when they no longer have any non-expired, non-deleted memberships.
        const memberResult = await client.query(`
            UPDATE members
            SET status = 'UNPAID'
            WHERE status IN ('ACTIVE', 'FROZEN')
              AND id NOT IN (
                SELECT DISTINCT member_id
                FROM memberships
                WHERE status IN ('ACTIVE', 'FROZEN') AND deleted_at IS NULL
              )
        `);

        await client.query('COMMIT');
        console.log(`✅ Janitor finished. ${result.rowCount} memberships expired, ${frozenResult.rowCount} frozen→expired. ${memberResult.rowCount} members set to UNPAID.`);
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error("Janitor Error:", err.message);
    } finally {
        client.release();
    }
};

module.exports = checkExpirations;