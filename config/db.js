const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

const connectDB = async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Database Connected!');

        // Always run idempotent column migrations (safe to run every boot)
        await pool.query(`
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS city            VARCHAR(100);
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS branches_count  INTEGER DEFAULT 1;
        `);
        await pool.query(`
            ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_code        VARCHAR(6);
            ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_expires_at  TIMESTAMP;
        `);
        // Fix gyms that got saas_status='ACTIVE' from the old DB default but have never paid
        // (saas_valid_until is within 14 days of creation = still in trial window, no razorpay customer)
        await pool.query(`
            UPDATE gyms SET saas_status = 'FREE_TRIAL'
            WHERE saas_status = 'ACTIVE'
              AND razorpay_customer_id IS NULL
              AND saas_valid_until <= (CURRENT_TIMESTAMP + INTERVAL '14 days' + INTERVAL '1 hour')
        `);

        const isProduction = process.env.NODE_ENV === 'production';
        const runInitOnBoot = String(process.env.RUN_DB_INIT_ON_BOOT || '').toLowerCase() === 'true';

        if (!isProduction || runInitOnBoot) {
            const sqlPath = path.join(__dirname, 'init.sql');
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
            console.log('✅ Schema initialization completed from init.sql');
        } else {
            console.log('ℹ️ Skipping init.sql on boot (production mode). Set RUN_DB_INIT_ON_BOOT=true to enable.');
        }

    } catch (err) {
        console.error('❌ Database Error:', err.message);
        process.exit(1);
    }
};

module.exports = { pool, connectDB };