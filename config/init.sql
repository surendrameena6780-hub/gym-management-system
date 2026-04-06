-- =============================================================
-- GymVault: Production Database Schema
-- Safe to run on BOTH fresh and existing databases.
-- CREATE TABLE IF NOT EXISTS = safe for new installs.
-- ALTER TABLE ADD COLUMN IF NOT EXISTS = safe for existing DBs.
-- =============================================================

-- 1. GYMS: The top-level tenant bucket
CREATE TABLE IF NOT EXISTS gyms (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    city            VARCHAR(100),
    branches_count  INTEGER DEFAULT 1,
    branch_directory JSONB DEFAULT '[]'::jsonb,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS password_reset_otps (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email       VARCHAR(100) NOT NULL,
    purpose     VARCHAR(40) NOT NULL DEFAULT 'PASSWORD_RESET',
    otp_hash    TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_purpose
    ON password_reset_otps (user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_active
    ON password_reset_otps (email, purpose, expires_at DESC);

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
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_login_otps_user_purpose
    ON user_login_otps (user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_login_otps_phone_active
    ON user_login_otps (phone, purpose, expires_at DESC);

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
    rfid_tag_id  VARCHAR(120),
    joining_date DATE,
    last_visit   TIMESTAMPTZ,
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
    freeze_start_date DATE,
    freeze_end_date   DATE,
    freeze_reason     TEXT DEFAULT '',
    frozen_at         TIMESTAMPTZ,
    unfrozen_at       TIMESTAMPTZ,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS class_bookings (
    id               SERIAL PRIMARY KEY,
    gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    class_session_id INTEGER REFERENCES class_sessions(id) ON DELETE CASCADE,
    member_id        INTEGER REFERENCES members(id) ON DELETE CASCADE,
    status           VARCHAR(20) DEFAULT 'BOOKED',
    booked_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    check_in_time    TIMESTAMPTZ,
    notes            TEXT DEFAULT '',
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_session_id, member_id)
);

-- MEMBER LIFECYCLE: Documents, notes, waivers
CREATE TABLE IF NOT EXISTS member_documents (
    id          SERIAL PRIMARY KEY,
    gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
    doc_type    VARCHAR(60) NOT NULL DEFAULT 'ID',
    doc_name    VARCHAR(200) NOT NULL DEFAULT '',
    doc_url     TEXT DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS member_notes (
    id          SERIAL PRIMARY KEY,
    gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
    note        TEXT NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS member_waivers (
    id          SERIAL PRIMARY KEY,
    gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
    waiver_text TEXT DEFAULT '',
    signed_at   TIMESTAMPTZ,
    ip_address  VARCHAR(60) DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- FINANCE: Expenses, payroll, POS
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
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pos_sales (
    id           SERIAL PRIMARY KEY,
    gym_id       INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_mode VARCHAR(50) DEFAULT 'Cash',
    notes        TEXT DEFAULT '',
    sold_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

-- ACCESS CONTROL & SCALE
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
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS webhooks (
    id          SERIAL PRIMARY KEY,
    gym_id      INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    events      TEXT[] DEFAULT '{}',
    secret_hash TEXT DEFAULT '',
    is_active   BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    payment_date   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at     TIMESTAMP,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payment_collections (
    id               SERIAL PRIMARY KEY,
    gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    payment_id       INTEGER REFERENCES payments(id) ON DELETE CASCADE,
    collected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_mode     VARCHAR(50) DEFAULT 'Cash',
    transaction_id   VARCHAR(120),
    notes            TEXT DEFAULT '',
    collected_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. ATTENDANCE: Every check-in event — enables real-time tracking
CREATE TABLE IF NOT EXISTS attendance (
    id            SERIAL PRIMARY KEY,
    gym_id        INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    member_id     INTEGER REFERENCES members(id) ON DELETE CASCADE,
    check_in_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
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
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
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
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (gym_id, member_id, local_date)
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
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_visit   TIMESTAMPTZ;
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
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_date   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMP;

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS freeze_start_date DATE;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS freeze_end_date   DATE;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS freeze_reason     TEXT DEFAULT '';
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS frozen_at         TIMESTAMPTZ;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS unfrozen_at       TIMESTAMPTZ;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS grace_end_date    DATE;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT '';
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS transfer_id       INTEGER;

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

ALTER TABLE plans ADD COLUMN IF NOT EXISTS joining_fee DECIMAL(10,2) DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS freeze_allowance_days INTEGER DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS transfer_fee DECIMAL(10,2) DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS access_hours VARCHAR(60) DEFAULT '';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS guest_passes INTEGER DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS renewal_policy VARCHAR(40) DEFAULT 'MANUAL';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_eligibility TEXT DEFAULT '';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS advanced_rules JSONB DEFAULT '{}'::jsonb;

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 3;

ALTER TABLE attendance  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP;
ALTER TABLE plans       ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMP;
ALTER TABLE members    ALTER COLUMN last_visit TYPE TIMESTAMPTZ USING last_visit AT TIME ZONE current_setting('TIMEZONE');
ALTER TABLE payments   ALTER COLUMN payment_date TYPE TIMESTAMPTZ USING payment_date AT TIME ZONE current_setting('TIMEZONE');
ALTER TABLE attendance ALTER COLUMN check_in_time TYPE TIMESTAMPTZ USING check_in_time AT TIME ZONE current_setting('TIMEZONE');

-- =============================================================
-- PERFORMANCE INDEXES
-- =============================================================

-- Memberships: fast lookup by member and status (used in every page load)
CREATE INDEX IF NOT EXISTS idx_memberships_member_id ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status    ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_end_date  ON memberships(end_date);
CREATE INDEX IF NOT EXISTS idx_memberships_gym_id    ON memberships(gym_id);
CREATE INDEX IF NOT EXISTS idx_memberships_deleted   ON memberships(deleted_at);
CREATE INDEX IF NOT EXISTS idx_leads_gym_id          ON leads(gym_id);
CREATE INDEX IF NOT EXISTS idx_leads_status          ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up       ON leads(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at      ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_class_types_gym_id    ON class_types(gym_id);
CREATE INDEX IF NOT EXISTS idx_class_types_active    ON class_types(is_active);
CREATE INDEX IF NOT EXISTS idx_class_sessions_gym_id ON class_sessions(gym_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_status ON class_sessions(status);
CREATE INDEX IF NOT EXISTS idx_class_sessions_starts ON class_sessions(starts_at);
CREATE INDEX IF NOT EXISTS idx_class_bookings_session ON class_bookings(class_session_id);
CREATE INDEX IF NOT EXISTS idx_class_bookings_member  ON class_bookings(member_id);
CREATE INDEX IF NOT EXISTS idx_class_bookings_status  ON class_bookings(status);

-- Lifecycle, Finance, Access indexes
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

-- Payments: fast lookup by member and gym
CREATE INDEX IF NOT EXISTS idx_payments_user_id      ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_gym_id       ON payments(gym_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_deleted      ON payments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_payment_collections_payment_id ON payment_collections(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_collections_gym_id     ON payment_collections(gym_id);
CREATE INDEX IF NOT EXISTS idx_payment_collections_created_at ON payment_collections(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_collections_transaction_unique
ON payment_collections(gym_id, transaction_id)
WHERE transaction_id IS NOT NULL;

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
ALTER TABLE users ALTER COLUMN profile_pic TYPE TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS interface_reduce_motion BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS interface_compact_mode BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS interface_dark_mode BOOLEAN DEFAULT TRUE;
ALTER TABLE gyms ALTER COLUMN interface_dark_mode SET DEFAULT TRUE;

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

-- =============================================================
-- OAUTH & MEMBER PORTAL: Google, Apple, and OTP-based member login
-- =============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id    VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id     VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'local';

-- Create unique indexes (safer than UNIQUE constraint on nullable columns)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_id  ON users(apple_id)  WHERE apple_id  IS NOT NULL;

-- Members OTP for self-service portal login
ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_code       VARCHAR(10);
ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;

-- Gym-level member payment gateway (separate from SaaS billing gateway)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_razorpay_key_id VARCHAR(120);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_razorpay_key_secret_enc TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_updated_at TIMESTAMP;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_connect_mode VARCHAR(20) DEFAULT 'MANUAL';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_onboarding_status VARCHAR(30) DEFAULT 'NOT_CONNECTED';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_razorpay_connected_account_id VARCHAR(120);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_connect_meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS member_payments_connected_at TIMESTAMP;

-- =============================================================
-- SIGNUP EXPANSION: Gym city, branch count
-- =============================================================
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS city            VARCHAR(100);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS branches_count  INTEGER DEFAULT 1;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS branch_directory JSONB DEFAULT '[]'::jsonb;

-- Attendance platform configuration (supports STAFF/QR/SELF/RFID modes)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) DEFAULT 'STAFF';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS attendance_geo_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_latitude DECIMAL(9,6);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_longitude DECIMAL(9,6);
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS gym_radius_meters INTEGER DEFAULT 200;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS allow_expired_checkin BOOLEAN DEFAULT FALSE;
ALTER TABLE members ALTER COLUMN phone SET NOT NULL;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_phone_present;
ALTER TABLE members ADD CONSTRAINT members_phone_present CHECK (phone IS NOT NULL AND BTRIM(phone) <> '');
ALTER TABLE members ADD COLUMN IF NOT EXISTS rfid_tag_id VARCHAR(120);

-- Attendance event metadata for operational + analytical usage
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkin_method VARCHAR(20) DEFAULT 'STAFF';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS staff_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkin_status VARCHAR(20) DEFAULT 'ALLOWED';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS was_override BOOLEAN DEFAULT FALSE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6);

CREATE TABLE IF NOT EXISTS rfid_devices (
    id              SERIAL PRIMARY KEY,
    gym_id          INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    reader_name     VARCHAR(120) NOT NULL,
    reader_serial   VARCHAR(120) NOT NULL UNIQUE,
    reader_location VARCHAR(200) DEFAULT '',
    shared_secret   TEXT NOT NULL,
    status          VARCHAR(20) DEFAULT 'ACTIVE',
    last_heartbeat  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rfid_events (
    id                   SERIAL PRIMARY KEY,
    gym_id               INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    reader_id            INTEGER REFERENCES rfid_devices(id) ON DELETE SET NULL,
    member_id            INTEGER REFERENCES members(id) ON DELETE SET NULL,
    member_snapshot      JSONB DEFAULT '{}'::jsonb,
    tag_id               VARCHAR(120) NOT NULL,
    event_timestamp      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    processed            BOOLEAN DEFAULT FALSE,
    event_status         VARCHAR(30) DEFAULT 'RECEIVED',
    response_message     TEXT DEFAULT '',
    payload              JSONB DEFAULT '{}'::jsonb,
    attendance_record_id INTEGER REFERENCES attendance(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_rfid_tag_unique ON members(gym_id, rfid_tag_id) WHERE rfid_tag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfid_devices_gym_id ON rfid_devices(gym_id);
CREATE INDEX IF NOT EXISTS idx_rfid_devices_status ON rfid_devices(status);
CREATE INDEX IF NOT EXISTS idx_rfid_events_gym_id ON rfid_events(gym_id);
CREATE INDEX IF NOT EXISTS idx_rfid_events_reader_id ON rfid_events(reader_id);
CREATE INDEX IF NOT EXISTS idx_rfid_events_member_id ON rfid_events(member_id);
CREATE INDEX IF NOT EXISTS idx_rfid_events_tag_id ON rfid_events(tag_id);
CREATE INDEX IF NOT EXISTS idx_rfid_events_created_at ON rfid_events(created_at);
CREATE INDEX IF NOT EXISTS idx_rfid_events_member_snapshot_gin ON rfid_events USING GIN (member_snapshot);

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
    automation_settings JSONB DEFAULT '{"owner_staff_enabled": true, "member_push_enabled": true, "owner_staff_slots": {"MORNING": true, "AFTERNOON": true, "EVENING": true}, "member_slots": {"MORNING": true, "AFTERNOON": false, "EVENING": true}, "member_max_per_slot": 25}'::jsonb,
    support_profile JSONB DEFAULT '{"phone":"+91 00000 00000","email":"support@gymvault.com","whatsapp":"+91 00000 00000","about":"GymVault helps gym owners run operations with fast, reliable support.","address":"Head Office, India","timings":"Mon-Sat · 9:00 AM to 7:00 PM IST"}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS automation_settings JSONB DEFAULT '{"owner_staff_enabled": true, "member_push_enabled": true, "owner_staff_slots": {"MORNING": true, "AFTERNOON": true, "EVENING": true}, "member_slots": {"MORNING": true, "AFTERNOON": false, "EVENING": true}, "member_max_per_slot": 25}'::jsonb;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS support_profile JSONB DEFAULT '{"phone":"+91 00000 00000","email":"support@gymvault.com","whatsapp":"+91 00000 00000","about":"GymVault helps gym owners run operations with fast, reliable support.","address":"Head Office, India","timings":"Mon-Sat · 9:00 AM to 7:00 PM IST"}'::jsonb;

INSERT INTO platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_gym_hard_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Hard delete of gyms is disabled. Archive or suspend the gym instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_gym_hard_delete ON gyms;

CREATE TRIGGER trg_prevent_gym_hard_delete
BEFORE DELETE ON gyms
FOR EACH ROW
EXECUTE FUNCTION prevent_gym_hard_delete();

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
CREATE INDEX IF NOT EXISTS idx_notification_automation_log_gym_date ON notification_automation_log(gym_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_notification_automation_log_created_at ON notification_automation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_notification_automation_log_gym_date ON member_notification_automation_log(gym_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_member_notification_automation_log_member_date ON member_notification_automation_log(member_id, local_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_method       ON attendance(checkin_method);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_user   ON attendance(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_member_time  ON attendance(member_id, check_in_time DESC);

-- =============================================================
-- MESSAGING: Gym-level WhatsApp state and templates
-- =============================================================
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
    ON gyms(messaging_whatsapp_number)
    WHERE messaging_whatsapp_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS gym_message_templates (
    id                          SERIAL PRIMARY KEY,
    gym_id                      INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    template_key                VARCHAR(60) NOT NULL,
    title                       VARCHAR(120) NOT NULL,
    whatsapp_text               TEXT NOT NULL,
    sms_text                    TEXT NOT NULL,
    whatsapp_template_name      VARCHAR(120),
    whatsapp_template_language  VARCHAR(20) DEFAULT 'en_US',
    whatsapp_template_category  VARCHAR(30) DEFAULT 'UTILITY',
    whatsapp_template_status    VARCHAR(30) DEFAULT 'NOT_SYNCED',
    whatsapp_template_error     TEXT,
    is_active                   BOOLEAN DEFAULT TRUE,
    updated_at                  TIMESTAMP DEFAULT NOW(),
    UNIQUE(gym_id, template_key)
);

ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_name VARCHAR(120);
ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(20) DEFAULT 'en_US';
ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_category VARCHAR(30) DEFAULT 'UTILITY';
ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_status VARCHAR(30) DEFAULT 'NOT_SYNCED';
ALTER TABLE gym_message_templates ADD COLUMN IF NOT EXISTS whatsapp_template_error TEXT;

CREATE INDEX IF NOT EXISTS idx_gym_message_templates_gym_id ON gym_message_templates(gym_id);