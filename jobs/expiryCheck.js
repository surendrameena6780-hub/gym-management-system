const { pool } = require('../config/db');

const checkExpirations = async () => {
    try {
        console.log("Running Expiry Janitor...");

        // Step 1: Mark any ACTIVE membership as EXPIRED if the end_date is in the past
        const result = await pool.query(`
            UPDATE memberships
            SET status = 'EXPIRED'
            WHERE end_date < CURRENT_DATE AND status = 'ACTIVE'
        `);

        // Step 2: Sync member status — set ACTIVE members to UNPAID
        // when they no longer have any non-expired, non-deleted memberships.
        const memberResult = await pool.query(`
            UPDATE members
            SET status = 'UNPAID'
            WHERE status = 'ACTIVE'
              AND id NOT IN (
                SELECT DISTINCT member_id
                FROM memberships
                WHERE status = 'ACTIVE' AND deleted_at IS NULL
              )
        `);

        console.log(`✅ Janitor finished. ${result.rowCount} memberships expired. ${memberResult.rowCount} members set to UNPAID.`);
    } catch (err) {
        console.error("Janitor Error:", err.message);
    }
};

module.exports = checkExpirations;