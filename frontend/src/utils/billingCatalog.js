export const BILLING_PLAN_ORDER = ['test', 'basic', 'growth', 'pro'];
export const BILLING_CORE_PLAN_IDS = ['basic', 'growth', 'pro'];
export const BILLING_ADDON_ORDER = ['extra_whatsapp_250', 'extra_staff_1', 'extra_members_100', 'extra_branch_1', 'extra_hello_1'];
export const BILLING_CAPABILITY_KEYS = ['custom_templates'];

const BILLING_LIMIT_KEYS = ['members', 'staff', 'storage', 'branches', 'whatsapp', 'hello'];
const BILLING_CYCLE_DAYS = { monthly: 30, annual: 365 };
const BILLING_DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_BILLING_CREDIT_STATUSES = new Set(['ACTIVE']);
const MIN_CHECKOUT_PAISE = 100;

export const defaultBillingCatalog = {
  plan_order: [...BILLING_PLAN_ORDER],
  addon_order: [...BILLING_ADDON_ORDER],
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
        '₹1 live payment test checkout',
        'Expires automatically in 1 day',
      ],
      capabilities: { custom_templates: true },
      limits: { members: null, staff: null, storage: 2, branches: null, whatsapp: null, hello: null },
    },
    basic: {
      id: 'basic',
      name: 'Basic',
      monthly_price: 1,
      annual_price: 10,
      popular: false,
      features: [
        'Up to 150 active members',
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
      capabilities: { custom_templates: false },
      limits: { members: 150, staff: 2, storage: 5, branches: 1, whatsapp: 500, hello: 0 },
    },
    growth: {
      id: 'growth',
      name: 'Growth',
      monthly_price: 2,
      annual_price: 20,
      popular: true,
      features: [
        'Up to 400 active members / Branch',
        'Multiple branches',
        '1 owner + 5 staff users / Branch',
        '1,000 WhatsApp messages per month / Branch',
        'Hello inbound on 1 number / Branch',
        '10 GB cloud storage',
        'WhatsApp reply-to-lead capture',
        'Custom WhatsApp templates',
        'Advanced insights, reports, and branch-wise reporting',
        'Class and staff operations',
        '14-day free trial',
        'Priority support',
      ],
      capabilities: { custom_templates: true },
      limits: { members: 400, staff: 5, storage: 10, branches: 2, whatsapp: 1000, hello: 1 },
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      monthly_price: 3,
      annual_price: 30,
      popular: false,
      features: [
        'Up to 1,000 active members / Branch',
        'Multiple branches',
        '1 owner + 10 staff users / Branch',
        '2,000 WhatsApp messages per month / Branch',
        'Hello inbound on 1 number / Branch',
        '20 GB cloud storage',
        'Full reply-to-lead workflow',
        'Custom WhatsApp templates',
        'Advanced insights and performance analytics',
        'Staff, payroll, and RFID-ready operations',
        '14-day free trial',
        'Fastest support response',
      ],
      capabilities: { custom_templates: true },
      limits: { members: 1000, staff: 10, storage: 20, branches: 3, whatsapp: 2000, hello: 1 },
    },
  },
  addons: {
    extra_whatsapp_250: {
      key: 'extra_whatsapp_250',
      label: 'Extra 250 WhatsApp Messages',
      description: 'Adds 250 more outbound WhatsApp messages to your monthly quota.',
      price: 249,
      increment: 250,
      limit_key: 'whatsapp',
      requires_plans: [],
    },
    extra_staff_1: {
      key: 'extra_staff_1',
      label: 'Extra Staff User',
      description: 'Add 1 more staff login to your current plan.',
      price: 149,
      increment: 1,
      limit_key: 'staff',
      requires_plans: [],
    },
    extra_members_100: {
      key: 'extra_members_100',
      label: 'Extra 100 Active Members',
      description: 'Raises your active member cap by 100.',
      price: 299,
      increment: 100,
      limit_key: 'members',
      requires_plans: [],
    },
    extra_branch_1: {
      key: 'extra_branch_1',
      label: 'Extra Branch',
      description: 'Add 1 more branch to your gym setup.',
      price: 599,
      increment: 1,
      limit_key: 'branches',
      requires_plans: [],
    },
    extra_hello_1: {
      key: 'extra_hello_1',
      label: 'Extra Hello Number',
      description: 'Enable inbound Hello on 1 additional WhatsApp number.',
      price: 699,
      increment: 1,
      limit_key: 'hello',
      requires_plans: ['growth', 'pro'],
    },
  },
};

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

const readText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const normalizeFeatureList = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
  const normalized = source.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 24);
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
  ],
  growth: [
    ['WhatsApp Reply to Lead Capture', 'Custom WhatsApp Templates', 'Advanced Insights & Reports', 'Branch-wise Reporting', 'Class & Staff Operations', '14-Day Free Trial', 'Priority Support'],
    ['Up to 400 active members', 'Up to 2 branches', '1 owner + 5 staff users', '1,000 WhatsApp messages per month', 'Hello inbound on 1 number', '10 GB cloud storage', 'WhatsApp reply-to-lead capture', 'Custom WhatsApp templates', 'Advanced insights, reports, and branch-wise reporting', 'Class and staff operations', '14-day free trial', 'Priority support'],
  ],
  pro: [
    ['Full Reply-to-Lead Workflow', 'Custom WhatsApp Templates', 'Advanced Insights & Performance', 'Staff & Payroll Operations', 'RFID-Ready Setup Support', '14-Day Free Trial', 'Fastest Support Response'],
    ['Up to 1,000 active members', 'Up to 3 branches', '1 owner + 10 staff users', '2,000 WhatsApp messages per month', 'Hello inbound on 1 number', '20 GB cloud storage', 'Full reply-to-lead workflow', 'Custom WhatsApp templates', 'Advanced insights and performance analytics', 'Staff, payroll, and RFID-ready operations', '14-day free trial', 'Fastest support response'],
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
  const normalized = source.map((item) => String(item || '').trim().toLowerCase()).filter((item) => allowed.has(item));
  return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
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

const normalizePlanLimits = (value, fallback = {}) => Object.fromEntries(
  BILLING_LIMIT_KEYS.map((limitKey) => {
    const fallbackValue = Object.prototype.hasOwnProperty.call(fallback, limitKey) ? fallback[limitKey] : null;
    const nextValue = value && typeof value === 'object' ? value[limitKey] : undefined;
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

const normalizePlanCapabilities = (value, fallback = {}) => Object.fromEntries(
  BILLING_CAPABILITY_KEYS.map((capabilityKey) => [
    capabilityKey,
    Object.prototype.hasOwnProperty.call(value || {}, capabilityKey)
      ? Boolean(value[capabilityKey])
      : Boolean(fallback?.[capabilityKey]),
  ])
);

const normalizePlan = (planId, value) => {
  const fallback = defaultBillingCatalog.plans[planId] || defaultBillingCatalog.plans.basic;
  const raw = value && typeof value === 'object' ? value : {};
  return {
    id: planId,
    name: readText(raw.name, fallback.name),
    monthly_price: readNumber(raw.monthly_price, fallback.monthly_price, { min: 0, max: 100000 }),
    annual_price: readNumber(raw.annual_price, fallback.annual_price, { min: 0, max: 100000 }),
    popular: raw.popular === undefined ? fallback.popular : Boolean(raw.popular),
    features: normalizePlanFeatures(planId, raw.features, fallback.features),
    capabilities: normalizePlanCapabilities(raw.capabilities, fallback.capabilities),
    limits: normalizePlanLimits(raw.limits, fallback.limits),
  };
};

const normalizeAddon = (addonKey, value) => {
  const fallback = defaultBillingCatalog.addons[addonKey];
  const raw = value && typeof value === 'object' ? value : {};
  return {
    key: addonKey,
    label: readText(raw.label, fallback.label),
    description: readText(raw.description, fallback.description),
    price: readNumber(raw.price, fallback.price, { min: 0, max: 100000 }),
    increment: readNumber(raw.increment, fallback.increment, { min: 1, max: 100000 }),
    limit_key: readText(raw.limit_key, fallback.limit_key),
    requires_plans: normalizeRequiresPlans(raw.requires_plans, fallback.requires_plans),
  };
};

export const normalizeBillingCatalog = (value, { includeTest = true } = {}) => {
  const raw = value && typeof value === 'object' ? value : {};
  const visiblePlanOrder = normalizePlanOrder(raw.plan_order, defaultBillingCatalog.plan_order, { includeTest });
  const rawPlanKeys = new Set(
    Object.keys(raw.plans || {})
      .map((planId) => String(planId || '').trim().toLowerCase())
      .filter((planId) => BILLING_PLAN_ORDER.includes(planId))
  );
  const normalizedPlanIds = BILLING_PLAN_ORDER.filter((planId) => visiblePlanOrder.includes(planId) || rawPlanKeys.has(planId));
  return {
    plan_order: visiblePlanOrder,
    addon_order: [...BILLING_ADDON_ORDER],
    plans: Object.fromEntries(normalizedPlanIds.map((planId) => [planId, normalizePlan(planId, raw.plans?.[planId])])),
    addons: Object.fromEntries(BILLING_ADDON_ORDER.map((addonKey) => [addonKey, normalizeAddon(addonKey, raw.addons?.[addonKey])])),
  };
};

export const normalizePlanId = (value, fallback = 'basic') => {
  const normalized = String(value || fallback).trim().toLowerCase();
  return BILLING_PLAN_ORDER.includes(normalized) ? normalized : fallback;
};

export const normalizeCycle = (value) => {
  const normalized = String(value || 'monthly').trim().toLowerCase();
  return normalized === 'annual' ? 'annual' : 'monthly';
};

export const formatCurrencyInr = (amount) => `₹${new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: Number.isInteger(Number(amount) || 0) ? 0 : 2,
  maximumFractionDigits: 2,
}).format(Number(amount) || 0)}`;

export const formatLimitValue = (value, unit = '') => {
  if (value === null || value === undefined) return 'Unlimited';
  return `${Number(value)}${unit}`;
};

export const getPlanChargeInr = (billingCatalog, planId, cycle) => {
  const catalog = normalizeBillingCatalog(billingCatalog);
  const resolvedPlan = catalog.plans[normalizePlanId(planId)] || catalog.plans.basic;
  return Number(normalizeCycle(cycle) === 'annual' ? resolvedPlan.annual_price : resolvedPlan.monthly_price) || 0;
};

export const hasBillingCapability = (billingCatalog, planId, capabilityKey) => {
  const key = String(capabilityKey || '').trim();
  if (!BILLING_CAPABILITY_KEYS.includes(key)) return false;
  const catalog = normalizeBillingCatalog(billingCatalog);
  const resolvedPlan = catalog.plans[normalizePlanId(planId)] || catalog.plans.basic;
  return Boolean(resolvedPlan?.capabilities?.[key]);
};

const clampBillingValue = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizePayablePaise = (value) => {
  const normalized = Math.max(0, Math.round(Number(value) || 0));
  if (normalized > 0 && normalized < MIN_CHECKOUT_PAISE) return MIN_CHECKOUT_PAISE;
  return normalized;
};

export const formatPaiseAmount = (value) => {
  const amount = (Number(value) || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const getBillingQuotePreview = ({
  billingCatalog,
  currentPlan,
  currentCycle,
  currentStatus,
  currentValidUntil,
  targetPlan,
  targetCycle,
}) => {
  const resolvedTargetPlan = normalizePlanId(targetPlan, 'basic');
  const resolvedTargetCycle = normalizeCycle(targetCycle);
  const resolvedCurrentPlan = normalizePlanId(currentPlan, 'basic');
  const resolvedCurrentCycle = normalizeCycle(currentCycle);
  const fullPricePaise = Math.round(getPlanChargeInr(billingCatalog, resolvedTargetPlan, resolvedTargetCycle) * 100);
  const currentPricePaise = Math.round(getPlanChargeInr(billingCatalog, resolvedCurrentPlan, resolvedCurrentCycle) * 100);
  const renewalDays = resolvedTargetPlan === 'test' ? 1 : BILLING_CYCLE_DAYS[resolvedTargetCycle] || 30;
  const preview = {
    kind: 'fresh_purchase',
    fullPricePaise,
    payablePaise: fullPricePaise,
    creditPaise: 0,
    preserveCurrentExpiry: false,
    renewalDays,
    remainingRatio: 0,
    error: null,
  };

  const expiryMs = Date.parse(currentValidUntil || '');
  const hasActiveCredit = Boolean(
    currentPricePaise > 0
      && ACTIVE_BILLING_CREDIT_STATUSES.has(String(currentStatus || '').trim().toUpperCase())
      && Number.isFinite(expiryMs)
      && expiryMs > Date.now()
  );

  if (!hasActiveCredit) {
    if (resolvedCurrentPlan === resolvedTargetPlan && resolvedCurrentCycle === resolvedTargetCycle) {
      return { ...preview, kind: 'renewal' };
    }
    return preview;
  }

  const currentCycleDays = resolvedCurrentPlan === 'test' ? 1 : BILLING_CYCLE_DAYS[resolvedCurrentCycle] || 30;
  const remainingRatio = clampBillingValue((expiryMs - Date.now()) / (currentCycleDays * BILLING_DAY_MS), 0, 1);
  const currentRemainingCreditPaise = Math.floor(currentPricePaise * remainingRatio);

  if (resolvedCurrentPlan === resolvedTargetPlan && resolvedCurrentCycle === resolvedTargetCycle) {
    return { ...preview, kind: 'renewal', remainingRatio };
  }

  if (resolvedCurrentCycle === resolvedTargetCycle) {
    if (fullPricePaise <= currentPricePaise) {
      return {
        ...preview,
        kind: 'downgrade_requires_renewal',
        payablePaise: 0,
        creditPaise: currentRemainingCreditPaise,
        remainingRatio,
        error: 'Lower-value plan changes should happen at renewal.',
      };
    }

    return {
      ...preview,
      kind: 'prorated_upgrade',
      payablePaise: normalizePayablePaise(Math.ceil(fullPricePaise * remainingRatio) - currentRemainingCreditPaise),
      creditPaise: currentRemainingCreditPaise,
      preserveCurrentExpiry: true,
      remainingRatio,
    };
  }

  if (fullPricePaise <= currentRemainingCreditPaise) {
    return {
      ...preview,
      kind: 'downgrade_requires_renewal',
      payablePaise: 0,
      creditPaise: currentRemainingCreditPaise,
      remainingRatio,
      error: 'This lower-value switch should be scheduled at renewal.',
    };
  }

  return {
    ...preview,
    kind: 'cycle_switch_with_credit',
    payablePaise: normalizePayablePaise(fullPricePaise - currentRemainingCreditPaise),
    creditPaise: currentRemainingCreditPaise,
    remainingRatio,
  };
};

export const computeEffectiveLimits = (billingCatalog, planId, gymData = {}, overrideLimits = null) => {
  if (overrideLimits && typeof overrideLimits === 'object') {
    return {
      members: overrideLimits.members ?? null,
      staff: overrideLimits.staff ?? null,
      storage: overrideLimits.storage ?? null,
      branches: overrideLimits.branches ?? null,
      whatsapp: overrideLimits.whatsapp ?? null,
      hello: overrideLimits.hello ?? null,
    };
  }

  const catalog = normalizeBillingCatalog(billingCatalog);
  const plan = catalog.plans[normalizePlanId(planId)] || catalog.plans.basic;
  const addonMap = {
    members: Number(gymData?.addon_extra_members || 0),
    staff: Number(gymData?.addon_extra_staff || 0),
    branches: Number(gymData?.addon_extra_branches || 0),
    whatsapp: Number(gymData?.addon_extra_whatsapp || 0),
    hello: Number(gymData?.addon_extra_hello || 0),
  };

  return Object.fromEntries(BILLING_LIMIT_KEYS.map((limitKey) => {
    const baseValue = plan.limits?.[limitKey] ?? null;
    if (baseValue === null || baseValue === undefined) return [limitKey, null];
    return [limitKey, Number(baseValue) + Number(addonMap[limitKey] || 0)];
  }));
};

export const isAddonAllowedForPlan = (billingCatalog, addonKey, planId) => {
  const catalog = normalizeBillingCatalog(billingCatalog);
  const addon = catalog.addons[String(addonKey || '').trim()];
  if (!addon) return false;
  if (!Array.isArray(addon.requires_plans) || addon.requires_plans.length === 0) return true;
  return addon.requires_plans.includes(normalizePlanId(planId, 'basic'));
};