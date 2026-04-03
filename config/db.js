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
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS freeze_start_date DATE;
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS freeze_end_date DATE;
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS freeze_reason TEXT DEFAULT '';
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS unfrozen_at TIMESTAMPTZ;

            CREATE TABLE IF NOT EXISTS leads (
                id                  SERIAL PRIMARY KEY,
                gym_id              INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                full_name           VARCHAR(120) NOT NULL,
                phone               VARCHAR(20) NOT NULL,
                email               VARCHAR(120) DEFAULT '',
                source              VARCHAR(60) DEFAULT 'Walk-in',
                status              VARCHAR(30) DEFAULT 'NEW',
                priority            VARCHAR(20) DEFAULT 'MEDIUM',
                assigned_to         INTEGER REFERENCES users(id) ON DELETE SET NULL,
                notes               TEXT DEFAULT '',
                last_contacted_at   TIMESTAMPTZ,
                next_follow_up_at   TIMESTAMPTZ,
                trial_date          TIMESTAMPTZ,
                converted_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
                lost_reason         TEXT DEFAULT '',
                created_at          TIMESTAMPTZ DEFAULT NOW(),
                updated_at          TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS class_types (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                title            VARCHAR(120) NOT NULL,
                category         VARCHAR(60) DEFAULT '',
                description      TEXT DEFAULT '',
                trainer_name     VARCHAR(120) DEFAULT '',
                capacity         INTEGER DEFAULT 20,
                duration_minutes INTEGER DEFAULT 60,
                location         VARCHAR(120) DEFAULT '',
                color_theme      VARCHAR(30) DEFAULT 'indigo',
                is_active        BOOLEAN DEFAULT TRUE,
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                updated_at       TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS class_sessions (
                id            SERIAL PRIMARY KEY,
                gym_id        INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                class_type_id INTEGER REFERENCES class_types(id) ON DELETE CASCADE,
                starts_at     TIMESTAMPTZ NOT NULL,
                ends_at       TIMESTAMPTZ NOT NULL,
                trainer_name  VARCHAR(120) DEFAULT '',
                capacity      INTEGER,
                status        VARCHAR(20) DEFAULT 'SCHEDULED',
                notes         TEXT DEFAULT '',
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                updated_at    TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS class_bookings (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                class_session_id INTEGER REFERENCES class_sessions(id) ON DELETE CASCADE,
                member_id        INTEGER REFERENCES members(id) ON DELETE CASCADE,
                status           VARCHAR(20) DEFAULT 'BOOKED',
                booked_at        TIMESTAMPTZ DEFAULT NOW(),
                check_in_time    TIMESTAMPTZ,
                notes            TEXT DEFAULT '',
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (class_session_id, member_id)
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
            CREATE INDEX IF NOT EXISTS idx_leads_gym_id ON leads(gym_id);
            CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
            CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(next_follow_up_at);
            CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
            CREATE INDEX IF NOT EXISTS idx_class_types_gym_id ON class_types(gym_id);
            CREATE INDEX IF NOT EXISTS idx_class_types_active ON class_types(is_active);
            CREATE INDEX IF NOT EXISTS idx_class_sessions_gym_id ON class_sessions(gym_id);
            CREATE INDEX IF NOT EXISTS idx_class_sessions_starts_at ON class_sessions(starts_at);
            CREATE INDEX IF NOT EXISTS idx_class_sessions_status ON class_sessions(status);
            CREATE INDEX IF NOT EXISTS idx_class_bookings_session_id ON class_bookings(class_session_id);
            CREATE INDEX IF NOT EXISTS idx_class_bookings_member_id ON class_bookings(member_id);
            CREATE INDEX IF NOT EXISTS idx_class_bookings_status ON class_bookings(status);
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