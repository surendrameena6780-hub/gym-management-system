const { pool } = require('../config/db');
const { getBranchName, normalizeBranchDirectory } = require('./branchAccess');

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

const BILLING_PLAN_ORDER = ['test', 'basic', 'growth', 'pro'];
const BILLING_CORE_PLAN_IDS = ['basic', 'growth', 'pro'];
const BILLING_ADDON_ORDER = ['extra_whatsapp_250', 'extra_staff_1', 'extra_members_100', 'extra_branch_1', 'extra_hello_1'];
const BILLING_CAPABILITY_KEYS = ['custom_templates'];
const BILLING_CYCLE_KEYS = ['monthly', 'annual'];
const BILLING_COUPON_TYPES = ['PERCENT', 'AMOUNT'];
const BRANCH_SCALING_LIMIT_KEYS = new Set(['members', 'staff', 'whatsapp', 'hello']);

const defaultBillingCapabilities = {
    test: {
        custom_templates: true,
    },
    basic: {
        custom_templates: false,
    },
    growth: {
        custom_templates: true,
    },
    pro: {
        custom_templates: true,
    },
};

const defaultBillingConfig = {
    plan_order: [...BILLING_PLAN_ORDER],
    addon_order: BILLING_ADDON_ORDER,
    plans: {
        test: {
            id: 'test',
            name: 'Test Drive',
            monthly_price: 1,
            annual_price: 1,
            popular: false,
            features: [
                'Unlimited members, staff users, branches, and outbound WhatsApp for testing',
                'Hello inbound available on unlimited numbers during the test window',
                '2 GB cloud storage for QA data and trial media',
                'All billing, automation, and integration flows unlocked for QA',
                'Rs 1 live payment test checkout',
                'Expires automatically in 1 day',
            ],
            capabilities: { ...defaultBillingCapabilities.test },
            limits: {
                members: null,
                staff: null,
                storage: 2,
                branches: null,
                whatsapp: null,
                hello: null,
            },
        },
        basic: {
            id: 'basic',
            name: 'Basic',
            monthly_price: 1,
            annual_price: 10,
            popular: false,
            features: [
                'Up to 150 members',
                '1 branch included',
                '1 owner + 2 staff users',
                '500 WhatsApp messages per month',
                'Hello inbound not included on this plan',
                '5 GB cloud storage',
                'Members, attendance, plans, payments, dues, and leads',
                'Dashboard with basic insights and renewal reminders',
                '14-day free trial',
                'Email support',
            ],
            capabilities: { ...defaultBillingCapabilities.basic },
            limits: {
                members: 150,
                staff: 2,
                storage: 5,
                branches: 1,
                whatsapp: 500,
                hello: 0,
            },
        },
        growth: {
            id: 'growth',
            name: 'Growth',
            monthly_price: 2,
            annual_price: 20,
            popular: true,
            features: [
                'Up to 800 members total',
                'Up to 2 branches',
                '1 owner + 10 staff users total',
                'Up to 2,000 WhatsApp messages per month',
                'Hello inbound on up to 2 numbers',
                '10 GB cloud storage',
                'WhatsApp reply-to-lead capture',
                'Custom WhatsApp templates',
                'Advanced insights, reports, and branch-wise reporting',
                'Class and staff operations',
                '14-day free trial',
                'Priority support',
            ],
            capabilities: { ...defaultBillingCapabilities.growth },
            limits: {
                members: 400,
                staff: 5,
                storage: 10,
                branches: 2,
                whatsapp: 1000,
                hello: 1,
            },
        },
        pro: {
            id: 'pro',
            name: 'Pro',
            monthly_price: 3,
            annual_price: 30,
            popular: false,
            features: [
                'Up to 3,000 members total',
                'Up to 3 branches',
                '1 owner + 30 staff users total',
                'Up to 6,000 WhatsApp messages per month',
                'Hello inbound on up to 3 numbers',
                '20 GB cloud storage',
                'Full reply-to-lead workflow',
                'Custom WhatsApp templates',
                'Advanced insights and performance analytics',
                'Staff, payroll, and RFID-ready operations',
                '14-day free trial',
                'Fastest support response',
            ],
            capabilities: { ...defaultBillingCapabilities.pro },
            limits: {
                members: 1000,
                staff: 10,
                storage: 20,
                branches: 3,
                whatsapp: 2000,
                hello: 1,
            },
        },
    },
    coupons: [],
    addons: {
        extra_whatsapp_250: {
            key: 'extra_whatsapp_250',
            label: 'Extra 250 WhatsApp Messages',
            description: 'Adds 250 more outbound WhatsApp messages to your monthly quota.',
            price: 249,
            increment: 250,
            column: 'addon_extra_whatsapp',
            limit_key: 'whatsapp',
            requires_plans: [],
        },
        extra_staff_1: {
            key: 'extra_staff_1',
            label: 'Extra Staff User',
            description: 'Add 1 more staff login to your gym-wide plan capacity.',
            price: 149,
            increment: 1,
            column: 'addon_extra_staff',
            limit_key: 'staff',
            requires_plans: [],
        },
        extra_members_100: {
            key: 'extra_members_100',
            label: 'Extra 100 Members',
            description: 'Raises your gym-wide member capacity by 100.',
            price: 299,
            increment: 100,
            column: 'addon_extra_members',
            limit_key: 'members',
            requires_plans: [],
        },
        extra_branch_1: {
            key: 'extra_branch_1',
            label: 'Extra Branch',
            description: 'Add 1 more branch to your gym setup.',
            price: 599,
            increment: 1,
            column: 'addon_extra_branches',
            limit_key: 'branches',
            requires_plans: [],
        },
        extra_hello_1: {
            key: 'extra_hello_1',
            label: 'Extra Hello Number',
            description: 'Enable inbound Hello on 1 additional gym-wide WhatsApp number.',
            price: 699,
            increment: 1,
            column: 'addon_extra_hello',
            limit_key: 'hello',
            requires_plans: ['growth', 'pro'],
        },
    },
};

const toSqlJson = (value) => JSON.stringify(value).replace(/'/g, "''");
const featureFlagsSql = toSqlJson(defaultFeatureFlags);
const automationSettingsSql = toSqlJson(defaultPlatformAutomationSettings);
const supportProfileSql = toSqlJson(defaultSupportProfile);
const billingConfigSql = toSqlJson(defaultBillingConfig);

const BILLING_LIMIT_KEYS = ['members', 'staff', 'storage', 'branches', 'whatsapp', 'hello'];
const GYM_ADDON_COLUMNS = ['addon_extra_whatsapp', 'addon_extra_staff', 'addon_extra_members', 'addon_extra_branches', 'addon_extra_hello'];
const DEFAULT_BRANCH_ID = 'branch-1';

const readNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, allowNull = false } = {}) => {
    if (allowNull) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string' && !value.trim()) return null;
        if (String(value).trim().toLowerCase() === 'unlimited') return null;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeFeatureList = (value, fallback = []) => {
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/\r?\n/)
            : [];
    const normalized = source
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 24);
    return normalized.length > 0 ? normalized : [...fallback];
};

const arraysMatch = (left = [], right = []) => (
    left.length === right.length && left.every((value, index) => value === right[index])
);

const LEGACY_BILLING_PLAN_FEATURES = {
    test: [
        ['Full Feature Access', 'For Testing Only', 'Rs 1 Payment Test', 'Expires in 1 Day'],
        ['Full Feature Access', 'For Testing Only', '₹1 Payment Test', 'Expires in 1 Day'],
    ],
    basic: [
        ['Members & Attendance', 'Plans, Payments & Dues', 'Leads & Follow-up', 'Dashboard & Basic Insights', 'Fee & Renewal Reminders', '14-Day Free Trial', 'Email Support'],
        ['Up to 150 Active Members', '1 Branch', '1 Owner + 2 Staff Users', '500 WhatsApp Messages/mo', 'Members & Attendance', 'Plans, Payments & Dues', 'Leads & Follow-up', 'Dashboard & Basic Insights', 'Fee & Renewal Reminders', '14-Day Free Trial', 'Email Support'],
    ],
    growth: [
        ['WhatsApp Reply to Lead Capture', 'Custom WhatsApp Templates', 'Advanced Insights & Reports', 'Branch-wise Reporting', 'Class & Staff Operations', '14-Day Free Trial', 'Priority Support'],
        ['Up to 800 active members', 'Up to 2 branches', '1 owner + 10 staff users', 'Up to 2,000 WhatsApp messages per month', 'Hello inbound on up to 2 numbers', '10 GB cloud storage', 'WhatsApp reply-to-lead capture', 'Custom WhatsApp templates', 'Advanced insights, reports, and branch-wise reporting', 'Class and staff operations', '14-day free trial', 'Priority support'],
        ['Up to 800 Active Members', 'Up to 2 Branches', '1 Owner + 10 Staff Users', 'Up to 2,000 WhatsApp Messages/mo', 'Hello Inbound on 2 Numbers', 'WhatsApp Reply → Lead Capture', 'Custom WhatsApp Templates', 'Advanced Insights & Reports', 'Branch-wise Reporting', 'Class & Staff Operations', '14-Day Free Trial', 'Priority Support'],
        ['Up to 400 members / Branch', 'Multiple branches', '1 owner + 5 staff users / Branch', '1,000 WhatsApp messages per month / Branch', 'Hello inbound on 1 number / Branch', '10 GB cloud storage', 'WhatsApp reply-to-lead capture', 'Custom WhatsApp templates', 'Advanced insights, reports, and branch-wise reporting', 'Class and staff operations', '14-day free trial', 'Priority support'],
    ],
    pro: [
        ['Full Reply-to-Lead Workflow', 'Custom WhatsApp Templates', 'Advanced Insights & Performance', 'Staff & Payroll Operations', 'RFID-Ready Setup Support', '14-Day Free Trial', 'Fastest Support Response'],
        ['Up to 3,000 active members', 'Up to 3 branches', '1 owner + 30 staff users', 'Up to 6,000 WhatsApp messages per month', 'Hello inbound on up to 3 numbers', '20 GB cloud storage', 'Full reply-to-lead workflow', 'Custom WhatsApp templates', 'Advanced insights and performance analytics', 'Staff, payroll, and RFID-ready operations', '14-day free trial', 'Fastest support response'],
        ['Up to 3,000 Active Members', 'Up to 3 Branches', '1 Owner + 30 Staff Users', 'Up to 6,000 WhatsApp Messages/mo', 'Hello Inbound on 3 Numbers', 'Full Reply-to-Lead Workflow', 'Custom WhatsApp Templates', 'Advanced Insights & Performance', 'Staff & Payroll Operations', 'RFID-Ready Setup Support', '14-Day Free Trial', 'Fastest Support Response'],
        ['Up to 1,000 members / Branch', 'Multiple branches', '1 owner + 10 staff users / Branch', '2,000 WhatsApp messages per month / Branch', 'Hello inbound on 1 number / Branch', '20 GB cloud storage', 'Full reply-to-lead workflow', 'Custom WhatsApp templates', 'Advanced insights and performance analytics', 'Staff, payroll, and RFID-ready operations', '14-day free trial', 'Fastest support response'],
    ],
};

const normalizePlanFeatures = (planId, value, fallback = []) => {
    const normalized = normalizeFeatureList(value, fallback);
    const legacySets = LEGACY_BILLING_PLAN_FEATURES[planId] || [];
    if (legacySets.some((legacy) => arraysMatch(normalized, legacy))) {
        return [...fallback];
    }
    return normalized;
};

const normalizeRequiresPlans = (value, fallback = []) => {
    const source = Array.isArray(value) ? value : [];
    const allowed = new Set(BILLING_PLAN_ORDER);
    const normalized = source
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => allowed.has(item));
    return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
};

const normalizeCouponCode = (value, fallback = '') => {
    const normalized = String(value == null ? '' : value)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 32);
    return normalized || fallback;
};

const normalizeCouponCycles = (value, fallback = []) => {
    const source = Array.isArray(value) ? value : [];
    const allowed = new Set(BILLING_CYCLE_KEYS);
    const normalized = source
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => allowed.has(item));
    return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
};

const normalizeOptionalTimestamp = (value) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const timestamp = Date.parse(text);
    if (!Number.isFinite(timestamp)) return '';
    return new Date(timestamp).toISOString();
};

const normalizeBillingCoupon = (value, index = 0) => {
    const raw = value && typeof value === 'object' ? value : {};
    const fallbackCode = `SAVE${index + 1}`;
    const discountType = BILLING_COUPON_TYPES.includes(String(raw.discount_type || '').trim().toUpperCase())
        ? String(raw.discount_type).trim().toUpperCase()
        : 'PERCENT';

    return {
        code: normalizeCouponCode(raw.code, fallbackCode),
        label: String(raw.label == null ? '' : raw.label).trim().slice(0, 120),
        description: String(raw.description == null ? '' : raw.description).trim().slice(0, 240),
        active: raw.active === undefined ? true : Boolean(raw.active),
        discount_type: discountType,
        discount_value: readNumber(raw.discount_value, discountType === 'PERCENT' ? 10 : 100, {
            min: 1,
            max: discountType === 'PERCENT' ? 100 : 100000,
        }),
        minimum_amount: readNumber(raw.minimum_amount, 0, { min: 0, max: 100000 }),
        max_redemptions: readNumber(raw.max_redemptions, null, { min: 1, max: 100000, allowNull: true }),
        applies_to_plans: normalizeRequiresPlans(raw.applies_to_plans, []),
        applies_to_cycles: normalizeCouponCycles(raw.applies_to_cycles, []),
        valid_from: normalizeOptionalTimestamp(raw.valid_from),
        valid_until: normalizeOptionalTimestamp(raw.valid_until),
    };
};

const normalizePlanOrder = (value, fallback = BILLING_PLAN_ORDER, { includeTest = true } = {}) => {
    const source = Array.isArray(value) && value.length > 0 ? value : fallback;
    const selected = new Set(
        source
            .map((item) => String(item || '').trim().toLowerCase())
            .filter((item) => BILLING_PLAN_ORDER.includes(item))
    );

    BILLING_CORE_PLAN_IDS.forEach((planId) => selected.add(planId));
    if (!includeTest) {
        selected.delete('test');
    }

    return BILLING_PLAN_ORDER.filter((planId) => selected.has(planId));
};

const normalizePlanLimits = (limits, fallbackLimits = {}) => Object.fromEntries(
    BILLING_LIMIT_KEYS.map((limitKey) => {
        const fallbackValue = Object.prototype.hasOwnProperty.call(fallbackLimits, limitKey) ? fallbackLimits[limitKey] : null;
        const nextValue = limits && typeof limits === 'object' ? limits[limitKey] : undefined;
        return [
            limitKey,
            readNumber(nextValue, fallbackValue, {
                min: limitKey === 'hello' ? 0 : 1,
                max: limitKey === 'storage' ? 500 : 100000,
                allowNull: fallbackValue === null,
            }),
        ];
    })
);

const normalizePlanCapabilities = (capabilities, fallback = {}) => Object.fromEntries(
    BILLING_CAPABILITY_KEYS.map((capabilityKey) => [
        capabilityKey,
        Object.prototype.hasOwnProperty.call(capabilities || {}, capabilityKey)
            ? Boolean(capabilities[capabilityKey])
            : Boolean(fallback?.[capabilityKey]),
    ])
);

const normalizeBillingPlan = (planId, value) => {
    const defaults = defaultBillingConfig.plans[planId] || defaultBillingConfig.plans.basic;
    const raw = value && typeof value === 'object' ? value : {};
    return {
        id: planId,
        name: readText(raw.name) || defaults.name,
        monthly_price: readNumber(raw.monthly_price, defaults.monthly_price, { min: 0, max: 100000 }),
        annual_price: readNumber(raw.annual_price, defaults.annual_price, { min: 0, max: 100000 }),
        popular: raw.popular === undefined ? defaults.popular : Boolean(raw.popular),
        features: normalizePlanFeatures(planId, raw.features, defaults.features),
        capabilities: normalizePlanCapabilities(raw.capabilities, defaults.capabilities),
        limits: normalizePlanLimits(raw.limits, defaults.limits),
    };
};

const normalizeBillingAddon = (addonKey, value) => {
    const defaults = defaultBillingConfig.addons[addonKey];
    const raw = value && typeof value === 'object' ? value : {};
    return {
        key: addonKey,
        label: readText(raw.label) || defaults.label,
        description: readText(raw.description) || defaults.description,
        price: readNumber(raw.price, defaults.price, { min: 0, max: 100000 }),
        increment: readNumber(raw.increment, defaults.increment, { min: 1, max: 100000 }),
        column: defaults.column,
        limit_key: defaults.limit_key,
        requires_plans: normalizeRequiresPlans(raw.requires_plans, defaults.requires_plans),
    };
};

const normalizeBillingConfig = (value) => {
    const raw = value && typeof value === 'object' ? value : {};
    const seenCouponCodes = new Set();
    const coupons = (Array.isArray(raw.coupons) ? raw.coupons : [])
        .map((coupon, index) => normalizeBillingCoupon(coupon, index))
        .filter((coupon) => {
            if (!coupon.code || seenCouponCodes.has(coupon.code)) {
                return false;
            }
            seenCouponCodes.add(coupon.code);
            return true;
        })
        .slice(0, 50);

    return {
        plan_order: normalizePlanOrder(raw.plan_order, defaultBillingConfig.plan_order),
        addon_order: [...BILLING_ADDON_ORDER],
        plans: Object.fromEntries(BILLING_PLAN_ORDER.map((planId) => [planId, normalizeBillingPlan(planId, raw.plans?.[planId])])),
        coupons,
        addons: Object.fromEntries(BILLING_ADDON_ORDER.map((addonKey) => [addonKey, normalizeBillingAddon(addonKey, raw.addons?.[addonKey])])),
    };
};

const getVisibleBillingPlanOrder = (billingConfig, { includeTest = true } = {}) => {
    const normalizedConfig = normalizeBillingConfig(billingConfig);
    return normalizedConfig.plan_order.filter((planId) => includeTest || planId !== 'test');
};

const serializeBillingConfig = (value, { includeTest = true, includeAllPlans = false, includeCurrentPlan = null } = {}) => {
    const billingConfig = normalizeBillingConfig(value);
    const visiblePlanOrder = getVisibleBillingPlanOrder(billingConfig, { includeTest });
    const currentPlanId = normalizePlanId(includeCurrentPlan, 'basic');
    const serializedPlanIds = includeAllPlans
        ? BILLING_PLAN_ORDER
        : Array.from(new Set([
            ...visiblePlanOrder,
            currentPlanId,
        ].filter((planId) => BILLING_PLAN_ORDER.includes(planId))));
    return {
        plan_order: visiblePlanOrder,
        addon_order: [...billingConfig.addon_order],
        plans: Object.fromEntries(serializedPlanIds.map((planId) => [planId, billingConfig.plans[planId]])),
        coupons: billingConfig.coupons.map((coupon) => ({
            code: coupon.code,
            label: coupon.label,
            description: coupon.description,
            active: coupon.active,
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
            minimum_amount: coupon.minimum_amount,
            max_redemptions: coupon.max_redemptions,
            applies_to_plans: coupon.applies_to_plans,
            applies_to_cycles: coupon.applies_to_cycles,
            valid_from: coupon.valid_from,
            valid_until: coupon.valid_until,
        })),
        addons: Object.fromEntries(billingConfig.addon_order.map((addonKey) => {
            const addon = billingConfig.addons[addonKey];
            return [addonKey, {
                key: addon.key,
                label: addon.label,
                description: addon.description,
                price: addon.price,
                increment: addon.increment,
                limit_key: addon.limit_key,
                requires_plans: addon.requires_plans,
            }];
        })),
    };
};

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
                billing_config JSONB DEFAULT '${billingConfigSql}'::jsonb,
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
            ALTER TABLE platform_settings
            ADD COLUMN IF NOT EXISTS billing_config JSONB
            DEFAULT '${billingConfigSql}'::jsonb;
            INSERT INTO platform_settings (id)
            VALUES (1)
            ON CONFLICT (id) DO NOTHING;
            UPDATE platform_settings
            SET maintenance_mode = COALESCE(maintenance_mode, FALSE),
                maintenance_message = COALESCE(maintenance_message, ''),
                feature_flags = COALESCE(feature_flags, '${featureFlagsSql}'::jsonb),
                automation_settings = COALESCE(automation_settings, '${automationSettingsSql}'::jsonb),
                support_profile = COALESCE(support_profile, '${supportProfileSql}'::jsonb),
                billing_config = COALESCE(billing_config, '${billingConfigSql}'::jsonb),
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

const getBillingConfig = async (db = pool) => {
    await ensurePlatformSettingsBase();
    const result = await db.query(
        'SELECT billing_config FROM platform_settings WHERE id = 1 LIMIT 1'
    );
    return normalizeBillingConfig(result.rows[0]?.billing_config);
};

let ensureGymBillingAddonSchemaPromise;
const ensureGymBillingAddonSchema = async () => {
    if (!ensureGymBillingAddonSchemaPromise) {
        ensureGymBillingAddonSchemaPromise = pool.query(`
            ALTER TABLE gyms
            ADD COLUMN IF NOT EXISTS addon_extra_whatsapp INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS addon_extra_staff INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS addon_extra_members INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS addon_extra_branches INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS addon_extra_hello INTEGER DEFAULT 0;
        `).catch((err) => {
            ensureGymBillingAddonSchemaPromise = null;
            throw err;
        });
    }

    await ensureGymBillingAddonSchemaPromise;
};

const normalizePlanId = (value, fallback = 'basic') => {
    const normalized = readText(value).toLowerCase();
    return BILLING_PLAN_ORDER.includes(normalized) ? normalized : fallback;
};

const isBillingPlanVisible = (billingConfig, planId, { includeTest = true } = {}) => (
    getVisibleBillingPlanOrder(billingConfig, { includeTest }).includes(normalizePlanId(planId, 'basic'))
);

const getBillingPlan = (billingConfig, planId, fallback = 'basic') => {
    const normalizedConfig = normalizeBillingConfig(billingConfig);
    const normalizedPlanId = normalizePlanId(planId, fallback);
    return normalizedConfig.plans[normalizedPlanId] || normalizedConfig.plans[fallback] || normalizedConfig.plans.basic;
};

const getBillingPlanPrice = (billingConfig, planId, cycle = 'monthly') => {
    const plan = getBillingPlan(billingConfig, planId);
    return Number(cycle === 'annual' ? plan.annual_price : plan.monthly_price) || 0;
};

const hasBillingCapability = (billingConfig, planId, capabilityKey) => {
    if (!BILLING_CAPABILITY_KEYS.includes(readText(capabilityKey))) return false;
    const plan = getBillingPlan(billingConfig, planId);
    return Boolean(plan?.capabilities?.[capabilityKey]);
};

const resolveConfiguredBranchesCount = (gymData = {}) => {
    const parsed = Number.parseInt(gymData?.branches_count ?? gymData?.branches, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const resolveAllowedBranchesCount = (plan, gymData = {}) => {
    if (plan?.limits?.branches === null) return null;
    const rawAllowedBranches = Number(plan?.limits?.branches || 0) + (Number(gymData?.addon_extra_branches) || 0);
    return Math.max(1, rawAllowedBranches || 1);
};

const resolveActiveBranchMultiplier = (configuredBranches, allowedBranches) => {
    const normalizedConfiguredBranches = Math.max(1, Number(configuredBranches || 1));
    if (allowedBranches === null || allowedBranches === undefined) {
        return normalizedConfiguredBranches;
    }
    return Math.max(1, Math.min(normalizedConfiguredBranches, Number(allowedBranches) || 1));
};

const resolvePlanTotalLimit = (plan, limitKey, configuredBranches, allowedBranches) => {
    const baseValue = plan?.limits?.[limitKey];
    if (baseValue === null || baseValue === undefined) return null;

    if (BRANCH_SCALING_LIMIT_KEYS.has(limitKey)) {
        return Number(baseValue) * resolveActiveBranchMultiplier(configuredBranches, allowedBranches);
    }

    return Number(baseValue);
};

const computeEffectiveBillingLimits = (billingConfig, planId, gymData = {}) => {
    const plan = getBillingPlan(billingConfig, planId);
    const configuredBranches = resolveConfiguredBranchesCount(gymData);
    const allowedBranches = resolveAllowedBranchesCount(plan, gymData);
    const addonMap = {
        members: Number(gymData?.addon_extra_members || 0),
        staff: Number(gymData?.addon_extra_staff || 0),
        branches: Number(gymData?.addon_extra_branches || 0),
        whatsapp: Number(gymData?.addon_extra_whatsapp || 0),
        hello: Number(gymData?.addon_extra_hello || 0),
    };

    return BILLING_LIMIT_KEYS.reduce((accumulator, limitKey) => {
        if (limitKey === 'branches') {
            accumulator.branches = allowedBranches;
            return accumulator;
        }

        const baseTotal = resolvePlanTotalLimit(plan, limitKey, configuredBranches, allowedBranches);
        accumulator[limitKey] = baseTotal === null ? null : baseTotal + Number(addonMap[limitKey] || 0);
        return accumulator;
    }, {
        configured_branches: configuredBranches,
    });
};

const getBillingAddon = (billingConfig, addonKey) => {
    const normalizedConfig = normalizeBillingConfig(billingConfig);
    const normalizedKey = readText(addonKey);
    return normalizedConfig.addons[normalizedKey] || null;
};

const isAddonAllowedForPlan = (billingConfig, addonKey, planId) => {
    const addon = getBillingAddon(billingConfig, addonKey);
    if (!addon) return false;
    if (!Array.isArray(addon.requires_plans) || addon.requires_plans.length === 0) return true;
    return addon.requires_plans.includes(normalizePlanId(planId, 'basic'));
};

const getGymBillingSnapshot = async (db, gymId) => {
    await ensureGymBillingAddonSchema();
    const result = await db.query(
        `SELECT
            current_plan,
            COALESCE(branches_count, 1) AS branches_count,
            COALESCE(branch_directory, '[]'::jsonb) AS branch_directory,
            saas_billing_cycle,
            saas_status,
            saas_valid_until,
            COALESCE(addon_extra_whatsapp, 0) AS addon_extra_whatsapp,
            COALESCE(addon_extra_staff, 0) AS addon_extra_staff,
            COALESCE(addon_extra_members, 0) AS addon_extra_members,
            COALESCE(addon_extra_branches, 0) AS addon_extra_branches,
            COALESCE(addon_extra_hello, 0) AS addon_extra_hello
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId]
    );
    return result.rows[0] || null;
};

const getGymUsageSnapshot = async (db, gymId) => {
    const result = await db.query(
        `SELECT
            COALESCE((
                SELECT COUNT(*)::INTEGER
                FROM members m
                WHERE m.gym_id = $1
                  AND m.deleted_at IS NULL
            ), 0) AS members,
            COALESCE((
                SELECT COUNT(*)::INTEGER
                FROM users u
                WHERE u.gym_id = $1
                  AND COALESCE(UPPER(u.role), 'STAFF') <> 'OWNER'
            ), 0) AS staff,
            COALESCE((
                SELECT branches_count::INTEGER
                FROM gyms g
                WHERE g.id = $1
                LIMIT 1
            ), 1) AS branches`,
        [gymId]
    );
    return result.rows[0] || { members: 0, staff: 0, branches: 1 };
};

const getBranchUsageSnapshot = async (db, gymId, branchId) => {
    const normalizedBranchId = readText(branchId) || DEFAULT_BRANCH_ID;
    const result = await db.query(
        `SELECT
            COALESCE((
                SELECT COUNT(*)::INTEGER
                FROM members m
                WHERE m.gym_id = $1
                  AND m.deleted_at IS NULL
                  AND COALESCE(m.branch_id, $2) = $2
            ), 0) AS members,
            COALESCE((
                SELECT COUNT(*)::INTEGER
                FROM users u
                WHERE u.gym_id = $1
                  AND COALESCE(UPPER(u.role), 'STAFF') <> 'OWNER'
                  AND COALESCE(u.branch_id, $2) = $2
            ), 0) AS staff,
            $2::TEXT AS branch_id`,
        [gymId, normalizedBranchId]
    );

    return result.rows[0] || { members: 0, staff: 0, branch_id: normalizedBranchId };
};

const getGymBranchUsageBreakdown = async (db, gymId, branchDirectoryValue = null, configuredBranches = 1) => {
    const normalizedDirectory = Array.isArray(branchDirectoryValue)
        ? normalizeBranchDirectory(branchDirectoryValue, configuredBranches)
        : [];
    const branchMap = new Map(normalizedDirectory.map((branch) => [branch.id, branch]));

    const result = await db.query(
        `WITH member_counts AS (
            SELECT COALESCE(branch_id, $2) AS branch_id, COUNT(*)::INTEGER AS members
            FROM members
            WHERE gym_id = $1
              AND deleted_at IS NULL
            GROUP BY COALESCE(branch_id, $2)
        ),
        staff_counts AS (
            SELECT COALESCE(branch_id, $2) AS branch_id, COUNT(*)::INTEGER AS staff
            FROM users
            WHERE gym_id = $1
              AND COALESCE(UPPER(role), 'STAFF') <> 'OWNER'
            GROUP BY COALESCE(branch_id, $2)
        ),
        branch_ids AS (
            SELECT branch_id FROM member_counts
            UNION
            SELECT branch_id FROM staff_counts
        )
        SELECT
            branch_ids.branch_id,
            COALESCE(member_counts.members, 0) AS members,
            COALESCE(staff_counts.staff, 0) AS staff
        FROM branch_ids
        LEFT JOIN member_counts ON member_counts.branch_id = branch_ids.branch_id
        LEFT JOIN staff_counts ON staff_counts.branch_id = branch_ids.branch_id
        ORDER BY branch_ids.branch_id ASC`,
        [gymId, DEFAULT_BRANCH_ID]
    );

    const usageByBranchId = new Map(
        result.rows.map((row) => [String(row.branch_id || DEFAULT_BRANCH_ID), {
            branch_id: String(row.branch_id || DEFAULT_BRANCH_ID),
            branch_name: getBranchName(normalizedDirectory, row.branch_id || DEFAULT_BRANCH_ID) || String(row.branch_id || DEFAULT_BRANCH_ID),
            members: Number(row.members || 0),
            staff: Number(row.staff || 0),
        }])
    );

    const orderedBranchIds = normalizedDirectory.length > 0
        ? normalizedDirectory.map((branch) => branch.id)
        : Array.from(usageByBranchId.keys());

    const rows = orderedBranchIds.map((branchId) => {
        const branchUsage = usageByBranchId.get(branchId);
        return branchUsage || {
            branch_id: branchId,
            branch_name: getBranchName(normalizedDirectory, branchId) || branchId,
            members: 0,
            staff: 0,
        };
    });

    usageByBranchId.forEach((branchUsage, branchId) => {
        if (!orderedBranchIds.includes(branchId)) {
            rows.push(branchUsage);
        }
    });

    return rows;
};

module.exports = {
    BILLING_ADDON_ORDER,
    BILLING_CAPABILITY_KEYS,
    BILLING_CORE_PLAN_IDS,
    BILLING_PLAN_ORDER,
    computeEffectiveBillingLimits,
    defaultBillingConfig,
    ensureGymBillingAddonSchema,
    defaultSupportProfile,
    ensurePlatformSettingsBase,
    getBillingAddon,
    getBillingConfig,
    getBillingPlan,
    getBillingPlanPrice,
    getBranchUsageSnapshot,
    getGymBranchUsageBreakdown,
    getVisibleBillingPlanOrder,
    getGymBillingSnapshot,
    getGymUsageSnapshot,
    hasBillingCapability,
    isBillingPlanVisible,
    isAddonAllowedForPlan,
    normalizeBillingConfig,
    normalizePlanId,
    normalizeSupportProfile,
    serializeBillingConfig,
};