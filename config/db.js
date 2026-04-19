const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const quoteIdentifier = (value) => `"${String(value || '').replace(/"/g, '""')}"`;

const ensureSchemaMigrationsTable = async (client) => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            executed_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
};

const runNamedMigration = async (client, name, runner) => {
    const existing = await client.query('SELECT name FROM schema_migrations WHERE name = $1 LIMIT 1', [name]);
    if (existing.rows.length > 0) {
        return false;
    }

    await client.query('BEGIN');
    try {
        await runner(client);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        return true;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
};

const normalizeLegacyTimestampColumns = async (client) => {
    const timestampColumns = await client.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type = 'timestamp without time zone'
          AND table_name <> 'schema_migrations'
        ORDER BY table_name ASC, ordinal_position ASC
    `);

    for (const row of timestampColumns.rows) {
        const tableName = quoteIdentifier(row.table_name);
        const columnName = quoteIdentifier(row.column_name);
        await client.query(`
            ALTER TABLE ${tableName}
            ALTER COLUMN ${columnName}
            TYPE TIMESTAMPTZ
            USING CASE
                WHEN ${columnName} IS NULL THEN NULL
                ELSE ${columnName} AT TIME ZONE COALESCE(NULLIF(current_setting('TIMEZONE', true), ''), 'UTC')
            END
        `);
    }
};

const createOperationalArchiveInfrastructure = async (client) => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS operational_archives (
            id SERIAL PRIMARY KEY,
            source_table VARCHAR(80) NOT NULL,
            record_id INTEGER NOT NULL,
            archived_from_at TIMESTAMPTZ,
            payload JSONB NOT NULL,
            archived_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (source_table, record_id)
        );

        CREATE INDEX IF NOT EXISTS idx_operational_archives_source_time
            ON operational_archives(source_table, archived_from_at DESC);
        CREATE INDEX IF NOT EXISTS idx_operational_archives_archived_at
            ON operational_archives(archived_at DESC);
    `);
};

const protectGymHardDeletes = async (client) => {
    await client.query(`
        CREATE OR REPLACE FUNCTION prevent_gym_hard_delete()
        RETURNS trigger AS $$
        BEGIN
            IF COALESCE(current_setting('app.allow_gym_hard_delete', true), '') = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'Hard delete of gyms is disabled. Archive or suspend the gym instead.';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_prevent_gym_hard_delete ON gyms;

        CREATE TRIGGER trg_prevent_gym_hard_delete
        BEFORE DELETE ON gyms
        FOR EACH ROW
        EXECUTE FUNCTION prevent_gym_hard_delete();
    `);
};

const enforceMembersPhonePresence = async (client) => {
    await client.query(`
        UPDATE members
        SET phone = NULL
        WHERE phone IS NOT NULL AND BTRIM(phone) = '';

        ALTER TABLE members DROP CONSTRAINT IF EXISTS members_phone_present;
        ALTER TABLE members ADD CONSTRAINT members_phone_present
            CHECK (phone IS NOT NULL AND BTRIM(phone) <> '') NOT VALID;
    `);

    const result = await client.query('SELECT COUNT(*)::INTEGER AS count FROM members WHERE phone IS NULL');
    if (Number(result.rows[0]?.count || 0) === 0) {
        await client.query('ALTER TABLE members ALTER COLUMN phone SET NOT NULL');
    }
};

const repairMemberUniqueness = async (client) => {
    await client.query(`
        UPDATE members
        SET email = NULL
        WHERE email IS NOT NULL AND BTRIM(email) = '';

        UPDATE members
        SET email = LOWER(BTRIM(email))
        WHERE email IS NOT NULL;

        UPDATE members
        SET phone = NULL
        WHERE phone IS NOT NULL AND BTRIM(phone) = '';
    `);

    const duplicateEmails = await client.query(`
        SELECT gym_id, LOWER(BTRIM(email)) AS normalized_email, COUNT(*)::INTEGER AS count
        FROM members
        WHERE deleted_at IS NULL
          AND email IS NOT NULL
          AND BTRIM(email) <> ''
        GROUP BY gym_id, LOWER(BTRIM(email))
        HAVING COUNT(*) > 1
        LIMIT 5
    `);

    if (duplicateEmails.rows.length > 0) {
        throw new Error('Cannot repair member email uniqueness because duplicate active member emails still exist.');
    }

    const duplicatePhones = await client.query(`
        SELECT gym_id, RIGHT(REGEXP_REPLACE(BTRIM(phone), '[^0-9]', '', 'g'), 10) AS normalized_phone, COUNT(*)::INTEGER AS count
        FROM members
        WHERE deleted_at IS NULL
          AND phone IS NOT NULL
          AND BTRIM(phone) <> ''
        GROUP BY gym_id, RIGHT(REGEXP_REPLACE(BTRIM(phone), '[^0-9]', '', 'g'), 10)
        HAVING COUNT(*) > 1
        LIMIT 5
    `);

    if (duplicatePhones.rows.length > 0) {
        throw new Error('Cannot repair member phone uniqueness because duplicate active member phones still exist.');
    }

    await client.query(`
        ALTER TABLE members DROP CONSTRAINT IF EXISTS members_email_key;
        ALTER TABLE members DROP CONSTRAINT IF EXISTS members_gym_email_key;
        ALTER TABLE members DROP CONSTRAINT IF EXISTS members_gym_phone_key;

        DROP INDEX IF EXISTS members_email_key;
        DROP INDEX IF EXISTS members_gym_email_key;
        DROP INDEX IF EXISTS members_gym_phone_key;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_members_gym_email_active_unique
            ON members(gym_id, LOWER(BTRIM(email)))
            WHERE email IS NOT NULL AND BTRIM(email) <> '' AND deleted_at IS NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_members_gym_phone_active_unique
            ON members(gym_id, RIGHT(REGEXP_REPLACE(BTRIM(phone), '[^0-9]', '', 'g'), 10))
            WHERE phone IS NOT NULL AND BTRIM(phone) <> '' AND deleted_at IS NULL;
    `);
};

const addRfidEventSnapshots = async (client) => {
    await client.query(`
        ALTER TABLE rfid_events ADD COLUMN IF NOT EXISTS member_snapshot JSONB DEFAULT '{}'::jsonb
    `);

    await client.query(`
        UPDATE rfid_events e
        SET member_snapshot = jsonb_build_object(
            'id', m.id,
            'full_name', m.full_name,
            'phone', m.phone,
            'email', m.email,
            'rfid_tag_id', m.rfid_tag_id
        )
        FROM members m
        WHERE e.member_id = m.id
          AND (e.member_snapshot IS NULL OR e.member_snapshot = '{}'::jsonb)
    `);

    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rfid_events_member_snapshot_gin
            ON rfid_events USING GIN (member_snapshot)
    `);
};

const createPerformanceIndexes = async (client) => {
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_memberships_member_gym_end_active
            ON memberships(member_id, gym_id, end_date DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_attendance_gym_member_time_active
            ON attendance(gym_id, member_id, check_in_time DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_payments_gym_user_plan_date_active
            ON payments(gym_id, user_id, plan_id, payment_date DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_rfid_events_gym_processed_event_time
            ON rfid_events(gym_id, processed, event_timestamp DESC);
    `);
};

const createReadRoutePerformanceIndexes = async (client) => {
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_members_gym_id_active_desc
            ON members(gym_id, id DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_members_gym_last_visit_active
            ON members(gym_id, last_visit DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_memberships_gym_status_end_active
            ON memberships(gym_id, status, end_date DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_payments_gym_user_date_active
            ON payments(gym_id, user_id, payment_date DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_payments_gym_date_active
            ON payments(gym_id, payment_date DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_attendance_gym_time_active
            ON attendance(gym_id, check_in_time DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_notifications_gym_created_desc
            ON notifications(gym_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_notifications_gym_unread_created_desc
            ON notifications(gym_id, is_read, created_at DESC);
    `);
};

const createRuntimeTelemetryInfrastructure = async (client) => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS system_runtime_events (
            id SERIAL PRIMARY KEY,
            event_type VARCHAR(40) NOT NULL,
            severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
            source VARCHAR(40) NOT NULL DEFAULT 'server',
            message TEXT NOT NULL,
            route VARCHAR(255),
            method VARCHAR(20),
            status_code INTEGER,
            duration_ms INTEGER,
            gym_id INTEGER,
            user_id INTEGER,
            actor_role VARCHAR(30),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_system_runtime_events_created_at
            ON system_runtime_events(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_system_runtime_events_type_created
            ON system_runtime_events(event_type, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_system_runtime_events_severity_created
            ON system_runtime_events(severity, created_at DESC);
    `);
};

const runSchemaMigrations = async () => {
    const client = await pool.connect();

    try {
        await ensureSchemaMigrationsTable(client);
        await client.query('SELECT pg_advisory_lock(hashtext($1))', ['gymvault-schema-migrations']);

        await runNamedMigration(client, '2026-04-06-timestamptz-normalization', normalizeLegacyTimestampColumns);
        await runNamedMigration(client, '2026-04-06-operational-archives', createOperationalArchiveInfrastructure);
        await runNamedMigration(client, '2026-04-06-protect-gym-hard-deletes', protectGymHardDeletes);
        await runNamedMigration(client, '2026-04-11-refresh-gym-hard-delete-trigger', protectGymHardDeletes);
        await runNamedMigration(client, '2026-04-06-members-phone-required', enforceMembersPhonePresence);
        await runNamedMigration(client, '2026-04-07-member-uniqueness-repair', repairMemberUniqueness);
        await runNamedMigration(client, '2026-04-06-rfid-event-snapshots', addRfidEventSnapshots);
        await runNamedMigration(client, '2026-04-07-performance-indexes', createPerformanceIndexes);
        await runNamedMigration(client, '2026-04-07-read-route-performance-indexes', createReadRoutePerformanceIndexes);
        await runNamedMigration(client, '2026-04-07-runtime-telemetry', createRuntimeTelemetryInfrastructure);
    } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['gymvault-schema-migrations']).catch(() => {});
        client.release();
    }
};

const isLoadTest = process.env.LOAD_TEST_MODE === 'true';

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    max: isLoadTest ? 200 : parsePositiveInt(process.env.DB_POOL_MAX, 100),
    min: isLoadTest ? 20 : parsePositiveInt(process.env.DB_POOL_MIN, 10),
    idleTimeoutMillis: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_MS, 60000),
    connectionTimeoutMillis: isLoadTest ? 30000 : parsePositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 5000),
    query_timeout: parsePositiveInt(process.env.DB_QUERY_TIMEOUT_MS, 30000),
    statement_timeout: parsePositiveInt(process.env.DB_STATEMENT_TIMEOUT_MS, 30000),
    keepAliveInitialDelayMillis: parsePositiveInt(process.env.DB_KEEPALIVE_INITIAL_DELAY_MS, 10000),
    allowExitOnIdle: false,
    application_name: process.env.DB_APPLICATION_NAME || 'gym-management-system',
});

pool.on('error', (err) => {
    console.error('UNEXPECTED DATABASE POOL ERROR:', err.message);
});

const connectDB = async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Database Connected!');

        const runMaintenance = async () => {

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
            CREATE TABLE IF NOT EXISTS password_reset_otps (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
                email       VARCHAR(100) NOT NULL,
                purpose     VARCHAR(40) NOT NULL DEFAULT 'PASSWORD_RESET',
                otp_hash    TEXT NOT NULL,
                attempts    INTEGER NOT NULL DEFAULT 0,
                expires_at  TIMESTAMPTZ NOT NULL,
                consumed_at TIMESTAMPTZ,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_purpose
                ON password_reset_otps (user_id, purpose, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_active
                ON password_reset_otps (email, purpose, expires_at DESC);
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_login_otps (
                id                  SERIAL PRIMARY KEY,
                user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
                phone               VARCHAR(20) NOT NULL,
                purpose             VARCHAR(40) NOT NULL DEFAULT 'ADMIN_LOGIN',
                otp_hash            TEXT,
                delivery_mode       VARCHAR(20) NOT NULL DEFAULT 'PREVIEW',
                provider_request_id VARCHAR(120),
                attempts            INTEGER NOT NULL DEFAULT 0,
                expires_at          TIMESTAMPTZ NOT NULL,
                consumed_at         TIMESTAMPTZ,
                created_at          TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_user_login_otps_user_purpose
                ON user_login_otps (user_id, purpose, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_user_login_otps_phone_active
                ON user_login_otps (phone, purpose, expires_at DESC);
        `);
        await pool.query(`
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_owner_mobile VARCHAR(30);
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_number VARCHAR(30);
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_display_name VARCHAR(120);
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_category VARCHAR(60);
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_status VARCHAR(30) DEFAULT 'NOT_CONFIGURED';
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_connected_at TIMESTAMPTZ;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_last_checked_at TIMESTAMPTZ;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_last_error TEXT;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_templates_status VARCHAR(30) DEFAULT 'NOT_SYNCED';
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_whatsapp_templates_last_synced_at TIMESTAMPTZ;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_enabled BOOLEAN DEFAULT FALSE;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_monthly_limit INTEGER DEFAULT 500;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_per_campaign_limit INTEGER DEFAULT 50;
            ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_channels JSONB DEFAULT '{"whatsapp": true, "sms": false}'::jsonb;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_gyms_messaging_whatsapp_number_unique
                ON gyms (messaging_whatsapp_number)
                WHERE messaging_whatsapp_number IS NOT NULL;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gym_message_templates (
                id                       SERIAL PRIMARY KEY,
                gym_id                   INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
                template_key             VARCHAR(60) NOT NULL,
                title                    VARCHAR(120) NOT NULL,
                whatsapp_text            TEXT NOT NULL,
                sms_text                 TEXT NOT NULL,
                whatsapp_template_name   VARCHAR(120),
                whatsapp_template_language VARCHAR(20) DEFAULT 'en_US',
                whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY',
                whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_SYNCED',
                whatsapp_template_error  TEXT,
                is_active                BOOLEAN DEFAULT TRUE,
                updated_at               TIMESTAMP DEFAULT NOW(),
                UNIQUE(gym_id, template_key)
            );

            ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_name VARCHAR(120);
            ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(20) DEFAULT 'en_US';
            ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY';
            ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_SYNCED';
            ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_error TEXT;

            CREATE INDEX IF NOT EXISTS idx_gym_message_templates_gym_id
                ON gym_message_templates(gym_id);
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
            ALTER TABLE rfid_events ADD COLUMN IF NOT EXISTS member_snapshot JSONB DEFAULT '{}'::jsonb;
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

            ALTER TABLE member_waivers ADD COLUMN IF NOT EXISTS waiver_type VARCHAR(40) DEFAULT 'general';
            ALTER TABLE member_waivers ADD COLUMN IF NOT EXISTS signature_data TEXT;

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
                waiver_type VARCHAR(40) DEFAULT 'general',
                waiver_text TEXT DEFAULT '',
                signature_data TEXT,
                signed_at   TIMESTAMPTZ,
                ip_address  VARCHAR(60) DEFAULT '',
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS staff_tasks (
                id                SERIAL PRIMARY KEY,
                gym_id            INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                branch_id         VARCHAR(60) DEFAULT 'branch-1',
                assigned_to       INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title             VARCHAR(160) NOT NULL,
                description       TEXT DEFAULT '',
                category          VARCHAR(40) DEFAULT 'OTHER',
                priority          VARCHAR(20) DEFAULT 'MEDIUM',
                status            VARCHAR(20) DEFAULT 'OPEN',
                due_at            TIMESTAMPTZ,
                completion_notes  TEXT DEFAULT '',
                completion_photos JSONB DEFAULT '[]'::jsonb,
                completed_at      TIMESTAMPTZ,
                created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                updated_at        TIMESTAMPTZ DEFAULT NOW()
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
                status          VARCHAR(20) DEFAULT 'PENDING_APPROVAL',
                branch_id       VARCHAR(60) DEFAULT 'branch-1',
                approved_at     TIMESTAMPTZ,
                approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                paid_at         TIMESTAMPTZ,
                paid_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
                payout_mode     VARCHAR(40) DEFAULT '',
                payout_channel  VARCHAR(40) DEFAULT '',
                payout_destination_label VARCHAR(160) DEFAULT '',
                payout_reference VARCHAR(120) DEFAULT '',
                payout_notes    TEXT DEFAULT '',
                rejection_reason TEXT DEFAULT '',
                notes           TEXT DEFAULT '',
                created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS payroll_auto_config (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
                base_pay        DECIMAL(10,2) DEFAULT 0,
                auto_enabled    BOOLEAN DEFAULT FALSE,
                pay_day         INTEGER DEFAULT 1,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(gym_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS payroll_payout_settings (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE UNIQUE,
                default_online_channel VARCHAR(40) DEFAULT 'UPI',
                payout_note_prefix VARCHAR(120) DEFAULT 'Salary',
                allow_cash_payouts BOOLEAN DEFAULT TRUE,
                allow_manual_bank_transfer BOOLEAN DEFAULT TRUE,
                updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS payroll_staff_destinations (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
                upi_id          VARCHAR(120) DEFAULT '',
                bank_account_holder VARCHAR(120) DEFAULT '',
                bank_account_number_enc TEXT DEFAULT '',
                bank_ifsc       VARCHAR(20) DEFAULT '',
                bank_name       VARCHAR(120) DEFAULT '',
                notes           TEXT DEFAULT '',
                updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(gym_id, user_id)
            );
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payout_channel VARCHAR(40) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payout_destination_label VARCHAR(160) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS default_online_channel VARCHAR(40) DEFAULT 'UPI';
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS payout_note_prefix VARCHAR(120) DEFAULT 'Salary';
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS allow_cash_payouts BOOLEAN DEFAULT TRUE;
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS allow_manual_bank_transfer BOOLEAN DEFAULT TRUE;
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE IF EXISTS payroll_payout_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS upi_id VARCHAR(120) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS bank_account_holder VARCHAR(120) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS bank_account_number_enc TEXT DEFAULT '';
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120) DEFAULT '';
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE IF EXISTS payroll_staff_destinations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
            CREATE INDEX IF NOT EXISTS idx_payroll_auto_config_gym ON payroll_auto_config(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payroll_entries_gym_period_status ON payroll_entries(gym_id, pay_period, status);
            CREATE INDEX IF NOT EXISTS idx_payroll_payout_settings_gym ON payroll_payout_settings(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payroll_staff_destinations_gym ON payroll_staff_destinations(gym_id);
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
            CREATE INDEX IF NOT EXISTS idx_staff_tasks_gym_id ON staff_tasks(gym_id);
            CREATE INDEX IF NOT EXISTS idx_staff_tasks_assigned_to ON staff_tasks(assigned_to);
            CREATE INDEX IF NOT EXISTS idx_staff_tasks_due_at ON staff_tasks(due_at);
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
            CREATE INDEX IF NOT EXISTS idx_attendance_gym_checkin_time ON attendance(gym_id, check_in_time DESC);
            CREATE INDEX IF NOT EXISTS idx_payments_gym_status_active ON payments(gym_id, status) WHERE deleted_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_memberships_gym_end_status_active ON memberships(gym_id, end_date, status) WHERE deleted_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_members_gym_phone_active ON members(gym_id, phone) WHERE deleted_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_leads_gym_follow_up_status ON leads(gym_id, next_follow_up_at, status);
            CREATE INDEX IF NOT EXISTS idx_expenses_gym_bill_date_active ON expenses(gym_id, bill_date DESC) WHERE deleted_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_payroll_entries_gym_period_status ON payroll_entries(gym_id, pay_period, status);
            CREATE INDEX IF NOT EXISTS idx_class_bookings_session_status ON class_bookings(class_session_id, status);
        `);
        // Fix gyms that got saas_status='ACTIVE' from the old DB default but have never paid
        // (saas_valid_until is within 14 days of creation = still in trial window, no razorpay customer)
        await pool.query(`
            UPDATE gyms SET saas_status = 'FREE_TRIAL'
            WHERE saas_status = 'ACTIVE'
              AND razorpay_customer_id IS NULL
              AND saas_valid_until <= (CURRENT_TIMESTAMP + INTERVAL '14 days' + INTERVAL '1 hour')
        `);

        // ── Platform Expansion: new columns ──
        await pool.query(`
            ALTER TABLE payment_collections ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
            ALTER TABLE broadcast_logs ADD COLUMN IF NOT EXISTS request_hash VARCHAR(120);
            ALTER TABLE broadcast_logs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
            ALTER TABLE broadcast_logs ADD COLUMN IF NOT EXISTS dashboard_action_key VARCHAR(80) DEFAULT '';
            ALTER TABLE broadcast_logs ADD COLUMN IF NOT EXISTS dashboard_audience_hash VARCHAR(120) DEFAULT '';
            ALTER TABLE broadcast_logs ADD COLUMN IF NOT EXISTS dashboard_expected_count INTEGER DEFAULT 0;
            ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ;
            ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS daily_send_count INTEGER DEFAULT 0;
            ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS daily_send_date DATE;
            ALTER TABLE user_login_otps ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ;
            ALTER TABLE user_login_otps ADD COLUMN IF NOT EXISTS daily_send_count INTEGER DEFAULT 0;
            ALTER TABLE user_login_otps ADD COLUMN IF NOT EXISTS daily_send_date DATE;
            ALTER TABLE memberships ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT FALSE;
            ALTER TABLE members ADD COLUMN IF NOT EXISTS family_group_id INTEGER;
            ALTER TABLE leads ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '';
            ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '';
            ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS branch_id VARCHAR(60) DEFAULT '';
            ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
            ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS voided_by INTEGER;
            ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS void_reason VARCHAR(500) DEFAULT '';
        `);
        // ── Platform Expansion: new tables ──
        await pool.query(`
            CREATE TABLE IF NOT EXISTS trainer_assignments (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                trainer_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
                assigned_at     TIMESTAMPTZ DEFAULT NOW(),
                notes           TEXT DEFAULT '',
                is_active       BOOLEAN DEFAULT TRUE,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(gym_id, trainer_user_id, member_id)
            );
            CREATE TABLE IF NOT EXISTS trainer_tasks (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                trainer_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
                title           VARCHAR(200) NOT NULL,
                description     TEXT DEFAULT '',
                status          VARCHAR(20) DEFAULT 'PENDING',
                due_date        DATE,
                completed_at    TIMESTAMPTZ,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS member_streaks (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
                current_streak  INTEGER DEFAULT 0,
                longest_streak  INTEGER DEFAULT 0,
                last_checkin_date DATE,
                updated_at      TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(gym_id, member_id)
            );
            CREATE TABLE IF NOT EXISTS member_badges (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
                badge_key       VARCHAR(60) NOT NULL,
                unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
                notified        BOOLEAN DEFAULT FALSE,
                UNIQUE(gym_id, member_id, badge_key)
            );
            CREATE TABLE IF NOT EXISTS family_groups (
                id                SERIAL PRIMARY KEY,
                gym_id            INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                name              VARCHAR(120) NOT NULL DEFAULT '',
                primary_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
                created_at        TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS payment_retry_schedule (
                id              SERIAL PRIMARY KEY,
                gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                payment_id      INTEGER REFERENCES payments(id) ON DELETE CASCADE,
                retry_at        TIMESTAMPTZ NOT NULL,
                attempt_count   INTEGER DEFAULT 0,
                last_error      TEXT DEFAULT '',
                status          VARCHAR(20) DEFAULT 'PENDING',
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_trainer_assignments_gym ON trainer_assignments(gym_id);
            CREATE INDEX IF NOT EXISTS idx_trainer_assignments_trainer ON trainer_assignments(trainer_user_id);
            CREATE INDEX IF NOT EXISTS idx_trainer_assignments_member ON trainer_assignments(member_id);
            CREATE INDEX IF NOT EXISTS idx_trainer_tasks_gym ON trainer_tasks(gym_id);
            CREATE INDEX IF NOT EXISTS idx_trainer_tasks_trainer ON trainer_tasks(trainer_user_id);
            CREATE INDEX IF NOT EXISTS idx_trainer_tasks_member ON trainer_tasks(member_id);
            CREATE INDEX IF NOT EXISTS idx_trainer_tasks_status ON trainer_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_member_streaks_gym ON member_streaks(gym_id);
            CREATE INDEX IF NOT EXISTS idx_member_streaks_member ON member_streaks(member_id);
            CREATE INDEX IF NOT EXISTS idx_member_badges_gym ON member_badges(gym_id);
            CREATE INDEX IF NOT EXISTS idx_member_badges_member ON member_badges(member_id);
            CREATE INDEX IF NOT EXISTS idx_family_groups_gym ON family_groups(gym_id);
            CREATE INDEX IF NOT EXISTS idx_family_groups_primary ON family_groups(primary_member_id);
            CREATE INDEX IF NOT EXISTS idx_members_family_group ON members(family_group_id) WHERE family_group_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_payment_retry_schedule_gym ON payment_retry_schedule(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payment_retry_schedule_retry ON payment_retry_schedule(retry_at, status);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_collections_idempotency
                ON payment_collections(gym_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_logs_idempotency
                ON broadcast_logs(gym_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL;
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

        await runSchemaMigrations();
        console.log('✅ Schema migrations checked');

        };

        const isProductionBoot = process.env.NODE_ENV === 'production';
        const maintenanceMode = String(process.env.DB_BOOT_MAINTENANCE_MODE || (isProductionBoot ? 'deferred' : 'blocking')).trim().toLowerCase();

        if (maintenanceMode === 'deferred') {
            console.log('ℹ️ Scheduling database maintenance in background after startup.');
            const maintenancePromise = new Promise((resolve, reject) => {
                setTimeout(() => {
                    void runMaintenance()
                        .then(() => {
                            console.log('✅ Background database maintenance completed');
                            resolve();
                        })
                        .catch((err) => {
                            console.error('❌ Background database maintenance error:', err.message);
                            reject(err);
                        });
                }, 0);
            });
            return {
                maintenanceMode,
                maintenancePromise,
            };
        }

        await runMaintenance();
        return {
            maintenanceMode,
            maintenancePromise: Promise.resolve(),
        };

    } catch (err) {
        console.error('❌ Database Error:', err.message);
        throw err;
    }
};

module.exports = { pool, connectDB };