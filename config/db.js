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
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS branch_directory JSONB DEFAULT '[]'::jsonb;
        `);
        await pool.query(`
            ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_code        VARCHAR(6);
            ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_expires_at  TIMESTAMP;
        `);
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id VARCHAR(255);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'local';
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
        // ── Phase 2-8: New tables for lifecycle, finance, access, scale ──
        await pool.query(`
            ALTER TABLE members ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT '';
            ALTER TABLE members ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
            ALTER TABLE members ADD COLUMN IF NOT EXISTS transfer_status VARCHAR(20);
            ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;
            ALTER TABLE members ADD COLUMN IF NOT EXISTS waiver_signed_at TIMESTAMPTZ;
            ALTER TABLE members ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(120) DEFAULT '';
            ALTER TABLE members ADD COLUMN IF NOT EXISTS gender VARCHAR(20) DEFAULT '';
            ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth DATE;
            ALTER TABLE members ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
            ALTER TABLE members ADD COLUMN IF NOT EXISTS blood_group VARCHAR(10) DEFAULT '';
            ALTER TABLE members ADD COLUMN IF NOT EXISTS medical_notes TEXT DEFAULT '';

            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS grace_end_date DATE;
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT '';
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS transfer_id INTEGER;

            ALTER TABLE plans ADD COLUMN IF NOT EXISTS joining_fee DECIMAL(10,2) DEFAULT 0;
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS freeze_allowance_days INTEGER DEFAULT 0;
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS transfer_fee DECIMAL(10,2) DEFAULT 0;
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS access_hours VARCHAR(60) DEFAULT '';
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS guest_passes INTEGER DEFAULT 0;
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS renewal_policy VARCHAR(40) DEFAULT 'MANUAL';
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_eligibility TEXT DEFAULT '';
            ALTER TABLE plans ADD COLUMN IF NOT EXISTS advanced_rules JSONB DEFAULT '{}'::jsonb;

            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 3;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS member_documents (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
                doc_type    VARCHAR(60) NOT NULL DEFAULT 'ID',
                doc_name    VARCHAR(200) NOT NULL DEFAULT '',
                doc_url     TEXT DEFAULT '',
                uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS member_notes (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
                note        TEXT NOT NULL DEFAULT '',
                created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS member_waivers (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
                waiver_text TEXT DEFAULT '',
                signed_at   TIMESTAMPTZ,
                ip_address  VARCHAR(60) DEFAULT '',
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                category        VARCHAR(60) NOT NULL DEFAULT 'General',
                vendor          VARCHAR(120) DEFAULT '',
                description     TEXT DEFAULT '',
                amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
                bill_date       DATE NOT NULL DEFAULT CURRENT_DATE,
                payment_mode    VARCHAR(50) DEFAULT 'Cash',
                is_recurring    BOOLEAN DEFAULT FALSE,
                recurrence_rule VARCHAR(30) DEFAULT '',
                receipt_url     TEXT DEFAULT '',
                created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                deleted_at      TIMESTAMPTZ,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS payroll_entries (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
                pay_period      VARCHAR(30) NOT NULL DEFAULT '',
                base_pay        DECIMAL(10,2) DEFAULT 0,
                commission      DECIMAL(10,2) DEFAULT 0,
                deductions      DECIMAL(10,2) DEFAULT 0,
                net_pay         DECIMAL(10,2) DEFAULT 0,
                status          VARCHAR(20) DEFAULT 'PENDING',
                paid_at         TIMESTAMPTZ,
                notes           TEXT DEFAULT '',
                created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS pos_products (
                id           SERIAL PRIMARY KEY,
                gym_id       INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                name         VARCHAR(120) NOT NULL,
                category     VARCHAR(60) DEFAULT 'General',
                price        DECIMAL(10,2) NOT NULL DEFAULT 0,
                cost_price   DECIMAL(10,2) DEFAULT 0,
                stock_qty    INTEGER DEFAULT 0,
                low_stock_threshold INTEGER DEFAULT 5,
                sku          VARCHAR(60) DEFAULT '',
                is_active    BOOLEAN DEFAULT TRUE,
                deleted_at   TIMESTAMPTZ,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS pos_sales (
                id           SERIAL PRIMARY KEY,
                gym_id       INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
                total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                payment_mode VARCHAR(50) DEFAULT 'Cash',
                notes        TEXT DEFAULT '',
                sold_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS pos_sale_items (
                id          SERIAL PRIMARY KEY,
                sale_id     INTEGER REFERENCES pos_sales(id) ON DELETE CASCADE,
                product_id  INTEGER REFERENCES pos_products(id) ON DELETE SET NULL,
                product_name VARCHAR(120) NOT NULL DEFAULT '',
                quantity    INTEGER NOT NULL DEFAULT 1,
                unit_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
                total_price DECIMAL(10,2) NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS access_policies (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                plan_id          INTEGER REFERENCES plans(id) ON DELETE CASCADE,
                name             VARCHAR(120) NOT NULL DEFAULT '',
                allowed_days     TEXT DEFAULT '',
                allowed_from     TIME,
                allowed_to       TIME,
                is_offpeak_only  BOOLEAN DEFAULT FALSE,
                enforce_freeze   BOOLEAN DEFAULT TRUE,
                max_daily_visits INTEGER DEFAULT 0,
                is_active        BOOLEAN DEFAULT TRUE,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS saved_reports (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                name        VARCHAR(200) NOT NULL DEFAULT '',
                report_type VARCHAR(60) NOT NULL DEFAULT 'members',
                filters     JSONB DEFAULT '{}'::jsonb,
                schedule    VARCHAR(30) DEFAULT '',
                last_run_at TIMESTAMPTZ,
                created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS api_keys (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                key_name    VARCHAR(120) NOT NULL DEFAULT '',
                key_hash    TEXT NOT NULL,
                key_prefix  VARCHAR(12) NOT NULL DEFAULT '',
                scopes      TEXT[] DEFAULT '{}',
                is_active   BOOLEAN DEFAULT TRUE,
                last_used_at TIMESTAMPTZ,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS webhooks (
                id          SERIAL PRIMARY KEY,
                gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                url         TEXT NOT NULL,
                events      TEXT[] DEFAULT '{}',
                secret_hash TEXT DEFAULT '',
                is_active   BOOLEAN DEFAULT TRUE,
                last_triggered_at TIMESTAMPTZ,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id         SERIAL PRIMARY KEY,
                gym_id     INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                title      VARCHAR(200) NOT NULL,
                message    TEXT NOT NULL,
                is_read    BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS broadcast_logs (
                id             SERIAL PRIMARY KEY,
                gym_id         INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                segment        VARCHAR(50) NOT NULL,
                channel        VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
                message        TEXT NOT NULL,
                sent_to_count  INTEGER DEFAULT 0,
                status         VARCHAR(20) DEFAULT 'SENT',
                created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at     TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS notification_automation_log (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                local_date       DATE NOT NULL,
                slot_key         VARCHAR(30) NOT NULL,
                automation_key   VARCHAR(60) NOT NULL,
                notification_id  INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
                title            VARCHAR(200) NOT NULL,
                message          TEXT NOT NULL,
                context_snapshot JSONB DEFAULT '{}'::jsonb,
                push_sent_count  INTEGER DEFAULT 0,
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (gym_id, local_date, slot_key)
            );
            CREATE TABLE IF NOT EXISTS member_notification_automation_log (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id        INTEGER REFERENCES members(id) ON DELETE CASCADE,
                local_date       DATE NOT NULL,
                slot_key         VARCHAR(30) NOT NULL,
                automation_key   VARCHAR(60) NOT NULL,
                title            VARCHAR(200) NOT NULL,
                message          TEXT NOT NULL,
                push_sent_count  INTEGER DEFAULT 0,
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (gym_id, member_id, local_date)
            );
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_member_documents_member ON member_documents(member_id);
            CREATE INDEX IF NOT EXISTS idx_member_notes_member ON member_notes(member_id);
            CREATE INDEX IF NOT EXISTS idx_member_waivers_member ON member_waivers(member_id);
            CREATE INDEX IF NOT EXISTS idx_expenses_gym_id ON expenses(gym_id);
            CREATE INDEX IF NOT EXISTS idx_expenses_bill_date ON expenses(bill_date);
            CREATE INDEX IF NOT EXISTS idx_payroll_entries_gym_id ON payroll_entries(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payroll_entries_user_id ON payroll_entries(user_id);
            CREATE INDEX IF NOT EXISTS idx_pos_products_gym_id ON pos_products(gym_id);
            CREATE INDEX IF NOT EXISTS idx_pos_sales_gym_id ON pos_sales(gym_id);
            CREATE INDEX IF NOT EXISTS idx_pos_sales_member_id ON pos_sales(member_id);
            CREATE INDEX IF NOT EXISTS idx_access_policies_gym_id ON access_policies(gym_id);
            CREATE INDEX IF NOT EXISTS idx_access_policies_plan_id ON access_policies(plan_id);
            CREATE INDEX IF NOT EXISTS idx_saved_reports_gym_id ON saved_reports(gym_id);
            CREATE INDEX IF NOT EXISTS idx_api_keys_gym_id ON api_keys(gym_id);
            CREATE INDEX IF NOT EXISTS idx_webhooks_gym_id ON webhooks(gym_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_gym_id ON notifications(gym_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
            CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_broadcast_logs_gym_id ON broadcast_logs(gym_id);
            CREATE INDEX IF NOT EXISTS idx_broadcast_logs_created_at ON broadcast_logs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notification_automation_log_gym_date ON notification_automation_log(gym_id, local_date DESC);
            CREATE INDEX IF NOT EXISTS idx_notification_automation_log_created_at ON notification_automation_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_member_notification_automation_log_gym_date ON member_notification_automation_log(gym_id, local_date DESC);
            CREATE INDEX IF NOT EXISTS idx_member_notification_automation_log_member_date ON member_notification_automation_log(member_id, local_date DESC);
        `);
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_members_rfid_tag_unique
            ON members(gym_id, rfid_tag_id)
            WHERE rfid_tag_id IS NOT NULL;
        `);
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
            ON users(google_id)
            WHERE google_id IS NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_id
            ON users(apple_id)
            WHERE apple_id IS NOT NULL;
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