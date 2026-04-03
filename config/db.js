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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                user_id     INTEGER,
                role        VARCHAR(20) DEFAULT 'OWNER',
                endpoint    TEXT NOT NULL UNIQUE,
                p256dh      TEXT NOT NULL,
                auth        TEXT NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_collections (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                payment_id       INTEGER REFERENCES payments(id) ON DELETE CASCADE,
                collected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
                payment_mode     VARCHAR(50) DEFAULT 'Cash',
                transaction_id   VARCHAR(120),
                notes            TEXT DEFAULT '',
                collected_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            ALTER TABLE members ADD COLUMN IF NOT EXISTS rfid_tag_id VARCHAR(120);

            CREATE TABLE IF NOT EXISTS rfid_devices (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                reader_name     VARCHAR(120) NOT NULL,
                reader_serial   VARCHAR(120) NOT NULL UNIQUE,
                reader_location VARCHAR(200) DEFAULT '',
                shared_secret   TEXT NOT NULL,
                status          VARCHAR(20) DEFAULT 'ACTIVE',
                last_heartbeat  TIMESTAMPTZ,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS rfid_events (
                id                   SERIAL PRIMARY KEY,
                gym_id               INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                reader_id            INTEGER REFERENCES rfid_devices(id) ON DELETE SET NULL,
                member_id            INTEGER REFERENCES members(id) ON DELETE SET NULL,
                tag_id               VARCHAR(120) NOT NULL,
                event_timestamp      TIMESTAMPTZ DEFAULT NOW(),
                processed            BOOLEAN DEFAULT FALSE,
                event_status         VARCHAR(30) DEFAULT 'RECEIVED',
                response_message     TEXT DEFAULT '',
                payload              JSONB DEFAULT '{}'::jsonb,
                attendance_record_id INTEGER REFERENCES attendance(id) ON DELETE SET NULL,
                created_at           TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_members_rfid_tag_unique
            ON members(gym_id, rfid_tag_id)
            WHERE rfid_tag_id IS NOT NULL;
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_payment_collections_payment_id ON payment_collections(payment_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_gym_id ON payment_collections(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_created_at ON payment_collections(created_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_collections_transaction_unique
            ON payment_collections(gym_id, transaction_id)
            WHERE transaction_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_rfid_devices_gym_id ON rfid_devices(gym_id);
            CREATE INDEX IF NOT EXISTS idx_rfid_devices_status ON rfid_devices(status);
            CREATE INDEX IF NOT EXISTS idx_rfid_events_gym_id ON rfid_events(gym_id);
            CREATE INDEX IF NOT EXISTS idx_rfid_events_reader_id ON rfid_events(reader_id);
            CREATE INDEX IF NOT EXISTS idx_rfid_events_member_id ON rfid_events(member_id);
            CREATE INDEX IF NOT EXISTS idx_rfid_events_tag_id ON rfid_events(tag_id);
            CREATE INDEX IF NOT EXISTS idx_rfid_events_created_at ON rfid_events(created_at);
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