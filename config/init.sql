-- =============================================================
-- GymVault: Production Database Schema
-- Safe to run on BOTH fresh and existing databases.
-- CREATE TABLE IF NOT EXISTS = safe for new installs.
-- ALTER TABLE ADD COLUMN IF NOT EXISTS = safe for existing DBs.
-- =============================================================

-- 1. GYMS: The top-level tenant bucket
CREATE TABLE IF NOT EXISTS gyms (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. USERS: Gym owners and staff who log in
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    gym_id        INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          VARCHAR(20) DEFAULT 'OWNER', -- OWNER, STAFF
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. PLANS: The membership menu (1 Month, 3 Month, etc.)
CREATE TABLE IF NOT EXISTS plans (
    id                   SERIAL PRIMARY KEY,
    gym_id               INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    name                 VARCHAR(100) NOT NULL,
    price                DECIMAL(10, 2) NOT NULL,
    duration_days        INTEGER NOT NULL,
    duration_months      INTEGER DEFAULT 1,
    features             TEXT[] DEFAULT '{}',
    color_theme          VARCHAR(50) DEFAULT 'blue',
    is_popular           BOOLEAN DEFAULT FALSE,
    description          TEXT DEFAULT '',
    discount_percent     INTEGER DEFAULT 0,
    discount_valid_until DATE,
    deleted_at           TIMESTAMP,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. MEMBERS: People who come to the gym
CREATE TABLE IF NOT EXISTS members (
    id           SERIAL PRIMARY KEY,
    gym_id       INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    full_name    VARCHAR(100) NOT NULL,
    phone        VARCHAR(20),
    email        VARCHAR(100),
    profile_pic  TEXT,
    joining_date DATE,
    last_visit   TIMESTAMP,
    status       VARCHAR(20) DEFAULT 'UNPAID', -- ACTIVE, UNPAID
    deleted_at   TIMESTAMP,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. MEMBERSHIPS: The active subscription link (who bought what, when does it expire)
CREATE TABLE IF NOT EXISTS memberships (
    id         SERIAL PRIMARY KEY,
    gym_id     INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id  INTEGER REFERENCES members(id) ON DELETE CASCADE,
    plan_id    INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    status     VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, EXPIRED, FROZEN
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. PAYMENTS: The financial ledger — the most critical table
CREATE TABLE IF NOT EXISTS payments (
    id             SERIAL PRIMARY KEY,
    gym_id         INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    user_id        INTEGER REFERENCES members(id) ON DELETE CASCADE,
    plan_id        INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    amount_paid    DECIMAL(10, 2) NOT NULL DEFAULT 0,
    amount_due     DECIMAL(10, 2) DEFAULT 0,
    total_amount   DECIMAL(10, 2) DEFAULT 0,
    payment_mode   VARCHAR(50) DEFAULT 'Cash',  -- Cash, Online, Card
    transaction_id VARCHAR(100),
    invoice_id     VARCHAR(100),
    notes          TEXT DEFAULT '',
    status         VARCHAR(20) DEFAULT 'Completed', -- Completed, Pending
    payment_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. ATTENDANCE: Every check-in event — enables real-time tracking
CREATE TABLE IF NOT EXISTS attendance (
    id            SERIAL PRIMARY KEY,
    gym_id        INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id     INTEGER REFERENCES members(id) ON DELETE CASCADE,
    check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP
);

-- 8. NOTIFICATIONS: In-app alerts and unread badge support
CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    gym_id     INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    message    TEXT NOT NULL,
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. BROADCAST LOGS: campaign automation audit trail
CREATE TABLE IF NOT EXISTS broadcast_logs (
    id             SERIAL PRIMARY KEY,
    gym_id         INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    segment        VARCHAR(50) NOT NULL,
    channel        VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
    message        TEXT NOT NULL,
    sent_to_count  INTEGER DEFAULT 0,
    status         VARCHAR(20) DEFAULT 'SENT',
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================
-- SAFE MIGRATIONS: Add missing columns to existing tables.
-- ADD COLUMN IF NOT EXISTS is idempotent — safe to run repeatedly.
-- =============================================================

-- plans: extended fields
ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_months      INTEGER DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS features             TEXT[] DEFAULT '{}';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS color_theme          VARCHAR(50) DEFAULT 'blue';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_popular           BOOLEAN DEFAULT FALSE;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description          TEXT DEFAULT '';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS discount_percent     INTEGER DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS discount_valid_until DATE;

-- members: extended fields
ALTER TABLE members ADD COLUMN IF NOT EXISTS profile_pic  TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS joining_date DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_visit   TIMESTAMP;
ALTER TABLE members ADD COLUMN IF NOT EXISTS status       VARCHAR(20) DEFAULT 'UNPAID';
ALTER TABLE members ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMP;

-- payments: extended fields (the old schema had 'amount' and 'payment_method', we add new ones)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id        INTEGER REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id        INTEGER REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_paid    DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_due     DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS total_amount   DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_mode   VARCHAR(50) DEFAULT 'Cash';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id     VARCHAR(100);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes          TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMP;

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP;
ALTER TABLE attendance  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP;
ALTER TABLE plans       ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP;

-- =============================================================
-- PERFORMANCE INDEXES
-- =============================================================

-- Memberships: fast lookup by member and status (used in every page load)
CREATE INDEX IF NOT EXISTS idx_memberships_member_id ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status    ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_end_date  ON memberships(end_date);
CREATE INDEX IF NOT EXISTS idx_memberships_gym_id    ON memberships(gym_id);
CREATE INDEX IF NOT EXISTS idx_memberships_deleted   ON memberships(deleted_at);

-- Payments: fast lookup by member and gym
CREATE INDEX IF NOT EXISTS idx_payments_user_id      ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_gym_id       ON payments(gym_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_deleted      ON payments(deleted_at);

-- Attendance: fast lookup for today's check-ins and member history
CREATE INDEX IF NOT EXISTS idx_attendance_member_id     ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_gym_id        ON attendance(gym_id);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in_time ON attendance(check_in_time);
CREATE INDEX IF NOT EXISTS idx_attendance_deleted       ON attendance(deleted_at);

-- Members: fast search and gym scoping
CREATE INDEX IF NOT EXISTS idx_members_gym_id    ON members(gym_id);
CREATE INDEX IF NOT EXISTS idx_members_status    ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_deleted   ON members(deleted_at);


-- =============================================================
-- POST-CREATION MIGRATIONS FOR THE USERS TABLE
-- =============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'OWNER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_role VARCHAR(30) DEFAULT 'OWNER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

ALTER TABLE users DROP COLUMN IF EXISTS name;
ALTER TABLE users DROP COLUMN IF EXISTS password;

-- =============================================================
-- MULTI-TENANCY FIX: Allow same email in different gyms.
-- =============================================================
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_email_key;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_gym_email_key;
ALTER TABLE members ADD CONSTRAINT members_gym_email_key UNIQUE (gym_id, email);

-- =============================================================
-- SUPER ADMIN: The Gym Kill Switch
-- =============================================================
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- =============================================================
-- SETTINGS PAGE EXPANSION: New Gym Profile & Preferences columns
-- =============================================================
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT '₹';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Kolkata';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS support_email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_pic VARCHAR(255);

-- HQ control and visibility metadata
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_access_status VARCHAR(20) DEFAULT 'ACTIVE';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- =============================================================
-- SAAS BILLING: Tracking Owner Subscriptions to GymVault
-- =============================================================
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS saas_plan VARCHAR(50) DEFAULT 'FREE_TRIAL'; 
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS current_plan VARCHAR(50) DEFAULT 'pro';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS saas_status VARCHAR(20) DEFAULT 'ACTIVE'; 
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS saas_valid_until TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days');
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS razorpay_customer_id VARCHAR(100);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS saas_billing_cycle VARCHAR(20) DEFAULT 'monthly';

-- Gym-level member payment gateway (separate from SaaS billing gateway)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_razorpay_key_id VARCHAR(120);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_razorpay_key_secret_enc TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_updated_at TIMESTAMP;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_connect_mode VARCHAR(20) DEFAULT 'MANUAL';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_onboarding_status VARCHAR(30) DEFAULT 'NOT_CONNECTED';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_razorpay_connected_account_id VARCHAR(120);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_connect_meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_connected_at TIMESTAMP;

-- Attendance platform configuration (supports STAFF/QR/SELF/RFID modes)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) DEFAULT 'STAFF';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS attendance_geo_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_latitude DECIMAL(9,6);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_longitude DECIMAL(9,6);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_radius_meters INTEGER DEFAULT 200;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS allow_expired_checkin BOOLEAN DEFAULT FALSE;

-- Attendance event metadata for operational + analytical usage
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkin_method VARCHAR(20) DEFAULT 'STAFF';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS staff_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkin_status VARCHAR(20) DEFAULT 'ALLOWED';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS was_override BOOLEAN DEFAULT FALSE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6);

-- =============================================================
-- HELP & SUPPORT: Ticketing system
-- =============================================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    raised_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(200) NOT NULL,
    category VARCHAR(50) DEFAULT 'GENERAL',
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    status VARCHAR(20) DEFAULT 'OPEN',
    description TEXT NOT NULL,
    assigned_to VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE,
    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_type VARCHAR(20) DEFAULT 'GYM',
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gym_support_profiles (
    gym_id INTEGER PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
    whatsapp VARCHAR(30),
    about_mission TEXT,
    support_window VARCHAR(255),
    sla TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_gym_id ON support_tickets(gym_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON support_ticket_messages(ticket_id);

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    actor_type VARCHAR(20) DEFAULT 'SUPER_ADMIN',
    actor_id VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100),
    target_label VARCHAR(255),
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_type ON audit_logs(target_type);

CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY,
    maintenance_mode BOOLEAN DEFAULT FALSE,
    maintenance_message TEXT DEFAULT '',
    feature_flags JSONB DEFAULT '{"support": true, "attendance": true, "billing": true}'::jsonb,
    support_profile JSONB DEFAULT '{"phone":"+91 00000 00000","email":"support@gymvault.com","whatsapp":"+91 00000 00000","about":"GymVault helps gym owners run operations with fast, reliable support.","address":"Head Office, India","timings":"Mon-Sat · 9:00 AM to 7:00 PM IST"}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS support_profile JSONB DEFAULT '{"phone":"+91 00000 00000","email":"support@gymvault.com","whatsapp":"+91 00000 00000","about":"GymVault helps gym owners run operations with fast, reliable support.","address":"Head Office, India","timings":"Mon-Sat · 9:00 AM to 7:00 PM IST"}'::jsonb;

INSERT INTO platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Tenant-safe uniqueness for phone numbers (safe migration: skip if duplicates exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'members_gym_phone_key'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM members
        WHERE phone IS NOT NULL
        GROUP BY gym_id, phone
        HAVING COUNT(*) > 1
    ) THEN
        ALTER TABLE members ADD CONSTRAINT members_gym_phone_key UNIQUE (gym_id, phone);
    END IF;
END $$;

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_gym_id     ON notifications(gym_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read    ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_gym_id    ON broadcast_logs(gym_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_created   ON broadcast_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_attendance_method       ON attendance(checkin_method);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_user   ON attendance(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_member_time  ON attendance(member_id, check_in_time DESC);

-- =============================================================
-- MESSAGING: Gym-level WhatsApp / SMS message templates
-- =============================================================
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS messaging_owner_mobile VARCHAR(30);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_monthly_limit INTEGER DEFAULT 500;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_per_campaign_limit INTEGER DEFAULT 50;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS bulk_channels JSONB DEFAULT '{"whatsapp": true, "sms": false}'::jsonb;

CREATE TABLE IF NOT EXISTS gym_message_templates (
    id            SERIAL PRIMARY KEY,
    gym_id        INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    template_key  VARCHAR(60) NOT NULL,
    title         VARCHAR(120) NOT NULL,
    whatsapp_text TEXT NOT NULL,
    sms_text      TEXT NOT NULL,
    is_active     BOOLEAN DEFAULT TRUE,
    updated_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(gym_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_gym_message_templates_gym_id ON gym_message_templates(gym_id);