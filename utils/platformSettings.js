const { pool } = require('../config/db');

const defaultFeatureFlags = {
    support: true,
    attendance: true,
    billing: true,
};

const defaultPlatformAutomationSettings = {
    owner_staff_enabled: true,
    member_push_enabled: true,
    owner_staff_slots: {
        MORNING: true,
        AFTERNOON: true,
        EVENING: true,
    },
    member_slots: {
        MORNING: true,
        AFTERNOON: false,
        EVENING: true,
    },
    member_max_per_slot: 25,
};

const defaultSupportProfile = {
    phone: '+91 00000 00000',
    email: 'support@gymvault.com',
    whatsapp: '+91 00000 00000',
    about: 'GymVault helps gym owners run operations with fast, reliable support.',
    address: 'Head Office, India',
    timings: 'Mon-Sat · 9:00 AM to 7:00 PM IST',
};

const toSqlJson = (value) => JSON.stringify(value).replace(/'/g, "''");
const featureFlagsSql = toSqlJson(defaultFeatureFlags);
const automationSettingsSql = toSqlJson(defaultPlatformAutomationSettings);
const supportProfileSql = toSqlJson(defaultSupportProfile);

let ensurePlatformSettingsBasePromise;
const ensurePlatformSettingsBase = async () => {
    if (!ensurePlatformSettingsBasePromise) {
        ensurePlatformSettingsBasePromise = pool.query(`
            CREATE TABLE IF NOT EXISTS platform_settings (
                id INTEGER PRIMARY KEY,
                maintenance_mode BOOLEAN DEFAULT FALSE,
                maintenance_message TEXT DEFAULT '',
                feature_flags JSONB DEFAULT '${featureFlagsSql}'::jsonb,
                automation_settings JSONB DEFAULT '${automationSettingsSql}'::jsonb,
                support_profile JSONB DEFAULT '${supportProfileSql}'::jsonb,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE platform_settings
            ADD COLUMN IF NOT EXISTS feature_flags JSONB
            DEFAULT '${featureFlagsSql}'::jsonb;
            ALTER TABLE platform_settings
            ADD COLUMN IF NOT EXISTS automation_settings JSONB
            DEFAULT '${automationSettingsSql}'::jsonb;
            ALTER TABLE platform_settings
            ADD COLUMN IF NOT EXISTS support_profile JSONB
            DEFAULT '${supportProfileSql}'::jsonb;
            INSERT INTO platform_settings (id)
            VALUES (1)
            ON CONFLICT (id) DO NOTHING;
            UPDATE platform_settings
            SET maintenance_mode = COALESCE(maintenance_mode, FALSE),
                maintenance_message = COALESCE(maintenance_message, ''),
                feature_flags = COALESCE(feature_flags, '${featureFlagsSql}'::jsonb),
                automation_settings = COALESCE(automation_settings, '${automationSettingsSql}'::jsonb),
                support_profile = COALESCE(support_profile, '${supportProfileSql}'::jsonb),
                updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
            WHERE id = 1;
        `).catch((err) => {
            ensurePlatformSettingsBasePromise = null;
            throw err;
        });
    }

    await ensurePlatformSettingsBasePromise;
};

const readText = (value) => String(value == null ? '' : value).trim();

const normalizeSupportProfile = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    const phone = readText(raw.phone);
    const email = readText(raw.email);
    const whatsapp = readText(raw.whatsapp);
    const about = readText(raw.about || raw.mission);
    const address = readText(raw.address);
    const timings = readText(raw.timings || raw.support_window);

    return {
        phone: phone || defaultSupportProfile.phone,
        email: email || defaultSupportProfile.email,
        whatsapp: whatsapp || phone || defaultSupportProfile.whatsapp,
        about: about || defaultSupportProfile.about,
        address: address || defaultSupportProfile.address,
        timings: timings || defaultSupportProfile.timings,
    };
};

module.exports = {
    defaultSupportProfile,
    ensurePlatformSettingsBase,
    normalizeSupportProfile,
};