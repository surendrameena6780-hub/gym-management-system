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