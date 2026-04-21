export const BILLING_PLAN_ORDER = ['test', 'basic', 'growth', 'pro'];
export const BILLING_CORE_PLAN_IDS = ['basic', 'growth', 'pro'];
export const BILLING_ADDON_ORDER = ['extra_whatsapp_250', 'extra_staff_1', 'extra_members_100', 'extra_branch_1'];
export const BILLING_CAPABILITY_KEYS = ['custom_templates'];
export const BILLING_CYCLE_KEYS = ['monthly', 'semiannual', 'annual'];
const BILLING_COUPON_TYPES = ['PERCENT', 'AMOUNT'];
const BRANCH_SCALING_LIMIT_KEYS = new Set();

const BILLING_LIMIT_KEYS = ['members', 'staff', 'storage', 'branches', 'whatsapp', 'hello'];
export const BILLING_CYCLE_DAYS = { monthly: 30, semiannual: 183, annual: 365 };
const BILLING_CYCLE_PRICE_FIELDS = { monthly: 'monthly_price', semiannual: 'semiannual_price', annual: 'annual_price' };
const BILLING_CYCLE_META = {
  monthly: {
    label: 'Monthly',
    planLabel: 'Monthly Plan',
    shortUnit: 'mo',
    subscriptionLabel: 'Monthly Software Subscription',
  },
  semiannual: {
    label: '6 Months',
    planLabel: '6-Month Plan',
    shortUnit: '6 mo',
    subscriptionLabel: '6-Month Software Subscription',
  },
  annual: {
    label: 'Annual',
    planLabel: 'Annual Plan',
    shortUnit: 'yr',
    subscriptionLabel: 'Annual Software Subscription',
  },
};
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
      semiannual_price: 1,
      annual_price: 1,
      popular: false,
      features: [
        'Unlimited members, staff users, branches, and outbound WhatsApp for testing',
        'Hello inbound available on 1 connected number during the test window',
        '2 GB cloud storage for QA data and trial media',
        'All billing, automation, and integration flows unlocked for QA',
        '₹1 live payment test checkout',
        'Expires automatically in 1 day',
      ],
      capabilities: { custom_templates: true },
      limits: { members: null, staff: null, storage: 2, branches: null, whatsapp: null, hello: 1 },
    },
    basic: {
      id: 'basic',
      name: 'Basic',
      monthly_price: 1,
      semiannual_price: 5,
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
      capabilities: { custom_templates: false },
      limits: { members: 150, staff: 2, storage: 5, branches: 1, whatsapp: 500, hello: 0 },
    },
    growth: {
      id: 'growth',
      name: 'Growth',
      monthly_price: 2,
      semiannual_price: 10,
      annual_price: 20,
      popular: true,
      features: [
        'Up to 800 members total',
        'Up to 2 branches',
        '1 owner + 10 staff users total',
        'Up to 2,000 WhatsApp messages per month',
        'Hello inbound on 1 connected number',
        '10 GB cloud storage',
        'WhatsApp reply-to-lead capture',
        'Custom WhatsApp templates',
        'Advanced insights, reports, and branch-wise reporting',
        'Class and staff operations',
        '14-day free trial',
        'Priority support',
      ],
      capabilities: { custom_templates: true },
      limits: { members: 800, staff: 10, storage: 10, branches: 2, whatsapp: 2000, hello: 1 },
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      monthly_price: 3,
      semiannual_price: 15,
      annual_price: 30,
      popular: false,
      features: [
        'Up to 3,000 members total',
        'Up to 3 branches',
        '1 owner + 30 staff users total',
        'Up to 6,000 WhatsApp messages per month',
        'Hello inbound on 1 connected number',
        '20 GB cloud storage',
        'Full reply-to-lead workflow',
        'Custom WhatsApp templates',
        'Advanced insights and performance analytics',
        'Staff, payroll, and RFID-ready operations',
        '14-day free trial',
        'Fastest support response',
      ],
      capabilities: { custom_templates: true },
      limits: { members: 3000, staff: 30, storage: 20, branches: 3, whatsapp: 6000, hello: 1 },
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
      limit_key: 'whatsapp',
      requires_plans: [],
    },
    extra_staff_1: {
      key: 'extra_staff_1',
      label: 'Extra Staff User',
      description: 'Add 1 more staff login to your gym-wide plan capacity.',
      price: 149,
      increment: 1,
      limit_key: 'staff',
      requires_plans: [],
    },
    extra_members_100: {
      key: 'extra_members_100',
      label: 'Extra 100 Members',
      description: 'Raises your gym-wide member capacity by 100.',
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

const formatLimitFeatureValue = (value) => Number(value || 0).toLocaleString('en-IN');

const buildHelloFeatureText = (helloLimit, { testMode = false } = {}) => {
  if (helloLimit === null || helloLimit === undefined) {
    return testMode
      ? 'Hello inbound available on connected numbers during the test window'
      : 'Hello inbound included on this plan';
  }

  const normalizedHello = Number(helloLimit || 0);
  if (normalizedHello <= 0) {
    return 'Hello inbound not included on this plan';
  }
  if (normalizedHello === 1) {
    return testMode
      ? 'Hello inbound available on 1 connected number during the test window'
      : 'Hello inbound on 1 connected number';
  }
  return `Hello inbound on ${formatLimitFeatureValue(normalizedHello)} connected numbers`;
};

const buildPlanCapacityFeatures = (planId, limits = {}) => {
  if (planId === 'test') {
    return [
      'Unlimited members, staff users, branches, and outbound WhatsApp for testing',
      buildHelloFeatureText(limits.hello, { testMode: true }),
      `${formatLimitFeatureValue(limits.storage || 2)} GB cloud storage for QA data and trial media`,
    ];
  }

  const memberLimit = limits.members;
  const branchLimit = limits.branches;
  const staffLimit = Number(limits.staff || 0);
  const whatsappLimit = limits.whatsapp;
  const storageLimit = Number(limits.storage || 0);

  const memberLine = memberLimit === null || memberLimit === undefined
    ? 'Unlimited members'
    : planId === 'basic'
      ? `Up to ${formatLimitFeatureValue(memberLimit)} members`
      : `Up to ${formatLimitFeatureValue(memberLimit)} members total`;
  const branchLine = branchLimit === null || branchLimit === undefined
    ? 'Unlimited branches'
    : Number(branchLimit) === 1
      ? '1 branch included'
      : planId === 'basic'
        ? `${formatLimitFeatureValue(branchLimit)} branches included`
        : `Up to ${formatLimitFeatureValue(branchLimit)} branches`;
  const staffLine = `${planId === 'basic' ? '1 owner' : '1 owner'} + ${formatLimitFeatureValue(staffLimit)} staff user${staffLimit === 1 ? '' : 's'}${planId === 'basic' ? '' : ' total'}`;
  const whatsappLine = whatsappLimit === null || whatsappLimit === undefined
    ? 'Unlimited WhatsApp messages per month'
    : `${formatLimitFeatureValue(whatsappLimit)} WhatsApp messages per month`;
  const storageLine = `${formatLimitFeatureValue(storageLimit)} GB cloud storage`;

  return [
    memberLine,
    branchLine,
    staffLine,
    whatsappLine,
    buildHelloFeatureText(limits.hello),
    storageLine,
  ];
};

const PLAN_CAPACITY_FEATURE_PATTERNS = [
  /^unlimited members, staff users, branches, and outbound whatsapp/i,
  /^(up to\s+)?[\d,]+.*members?\b/i,
  /^(up to\s+)?[\d,]+.*branches?\b/i,
  /^\d+\s+branches?\s+included\b/i,
  /^1 owner\s*\+\s*[\d,]+.*staff users?\b/i,
  /whatsapp messages? per month/i,
  /hello inbound/i,
  /^[\d,]+(?:\.\d+)?\s*gb\b.*cloud storage/i,
];

const isPlanCapacityFeature = (feature) => PLAN_CAPACITY_FEATURE_PATTERNS.some((pattern) => pattern.test(String(feature || '').trim()));

const mergeUniqueFeatures = (...featureLists) => {
  const seen = new Set();
  const output = [];
  for (const featureList of featureLists) {
    for (const feature of featureList || []) {
      const normalized = String(feature || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
};

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

const normalizePlanFeatures = (planId, value, fallback = [], limits = {}) => {
  const normalized = normalizeFeatureList(value, fallback);
  const legacySets = LEGACY_BILLING_PLAN_FEATURES[planId] || [];
  const source = legacySets.some((legacy) => arraysMatch(normalized, legacy))
    ? normalizeFeatureList(fallback, fallback)
    : normalized;
  const fallbackNonCapacity = normalizeFeatureList(fallback, fallback).filter((feature) => !isPlanCapacityFeature(feature));
  const sourceNonCapacity = source.filter((feature) => !isPlanCapacityFeature(feature));
  return mergeUniqueFeatures(
    buildPlanCapacityFeatures(planId, limits),
    sourceNonCapacity.length > 0 ? sourceNonCapacity : fallbackNonCapacity
  );
};

const normalizeRequiresPlans = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set(BILLING_PLAN_ORDER);
  const normalized = source.map((item) => String(item || '').trim().toLowerCase()).filter((item) => allowed.has(item));
  return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
};

const normalizeCouponCode = (value, fallback = '') => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
  return normalized || fallback;
};

const normalizeCouponCycles = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set(BILLING_CYCLE_KEYS);
  const normalized = source.map((item) => String(item || '').trim().toLowerCase()).filter((item) => allowed.has(item));
  return Array.from(new Set(normalized.length > 0 ? normalized : fallback));
};

const normalizeOptionalTimestamp = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toISOString();
};

const normalizeBillingCoupon = (value, index = 0) => {
  const raw = value && typeof value === 'object' ? value : {};
  const discountType = BILLING_COUPON_TYPES.includes(String(raw.discount_type || '').trim().toUpperCase())
    ? String(raw.discount_type).trim().toUpperCase()
    : 'PERCENT';

  return {
    code: normalizeCouponCode(raw.code, `SAVE${index + 1}`),
    label: readText(raw.label).slice(0, 120),
    description: readText(raw.description).slice(0, 240),
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
  const normalizedLimits = normalizePlanLimits(raw.limits, fallback.limits);
  return {
    id: planId,
    name: readText(raw.name, fallback.name),
    monthly_price: readNumber(raw.monthly_price, fallback.monthly_price, { min: 0, max: 100000 }),
    semiannual_price: readNumber(raw.semiannual_price, fallback.semiannual_price, { min: 0, max: 100000 }),
    annual_price: readNumber(raw.annual_price, fallback.annual_price, { min: 0, max: 100000 }),
    popular: raw.popular === undefined ? fallback.popular : Boolean(raw.popular),
    features: normalizePlanFeatures(planId, raw.features, fallback.features, normalizedLimits),
    capabilities: normalizePlanCapabilities(raw.capabilities, fallback.capabilities),
    limits: normalizedLimits,
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
  const seenCouponCodes = new Set();
  const coupons = (Array.isArray(raw.coupons) ? raw.coupons : [])
    .map((coupon, index) => normalizeBillingCoupon(coupon, index))
    .filter((coupon) => {
      if (!coupon.code || seenCouponCodes.has(coupon.code)) return false;
      seenCouponCodes.add(coupon.code);
      return true;
    })
    .slice(0, 50);
  return {
    plan_order: visiblePlanOrder,
    addon_order: [...BILLING_ADDON_ORDER],
    plans: Object.fromEntries(normalizedPlanIds.map((planId) => [planId, normalizePlan(planId, raw.plans?.[planId])])),
    coupons,
    addons: Object.fromEntries(BILLING_ADDON_ORDER.map((addonKey) => [addonKey, normalizeAddon(addonKey, raw.addons?.[addonKey])])),
  };
};

export const normalizePlanId = (value, fallback = 'basic') => {
  const normalized = String(value || fallback).trim().toLowerCase();
  return BILLING_PLAN_ORDER.includes(normalized) ? normalized : fallback;
};

export const normalizeCycle = (value) => {
  const normalized = String(value || 'monthly').trim().toLowerCase();
  return BILLING_CYCLE_KEYS.includes(normalized) ? normalized : 'monthly';
};

export const getBillingCycleMeta = (cycle) => BILLING_CYCLE_META[normalizeCycle(cycle)] || BILLING_CYCLE_META.monthly;

export const getBillingCycleLabel = (cycle) => getBillingCycleMeta(cycle).label;

export const getBillingCyclePlanLabel = (cycle) => getBillingCycleMeta(cycle).planLabel;

export const getBillingCycleShortUnit = (cycle) => getBillingCycleMeta(cycle).shortUnit;

export const getBillingCycleSubscriptionLabel = (cycle) => getBillingCycleMeta(cycle).subscriptionLabel;

export const getBillingCycleDays = (cycle, { planId } = {}) => {
  if (normalizePlanId(planId, 'basic') === 'test') return 1;
  return BILLING_CYCLE_DAYS[normalizeCycle(cycle)] || 30;
};

export const getPlanCyclePriceInr = (plan, cycle) => {
  const priceField = BILLING_CYCLE_PRICE_FIELDS[normalizeCycle(cycle)] || BILLING_CYCLE_PRICE_FIELDS.monthly;
  return Number(plan?.[priceField] || 0) || 0;
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
  return getPlanCyclePriceInr(resolvedPlan, cycle);
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
  const renewalDays = getBillingCycleDays(resolvedTargetCycle, { planId: resolvedTargetPlan });
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

  const currentCycleDays = getBillingCycleDays(resolvedCurrentCycle, { planId: resolvedCurrentPlan });
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
      configured_branches: overrideLimits.configured_branches ?? null,
      whatsapp: overrideLimits.whatsapp ?? null,
      hello: overrideLimits.hello ?? null,
    };
  }

  const catalog = normalizeBillingCatalog(billingCatalog);
  const plan = catalog.plans[normalizePlanId(planId)] || catalog.plans.basic;
  const configuredBranches = Math.max(1, Number.parseInt(gymData?.branches_count ?? gymData?.branches ?? 1, 10) || 1);
  const allowedBranches = plan.limits?.branches === null || plan.limits?.branches === undefined
    ? null
    : Number(plan.limits.branches) + Number(gymData?.addon_extra_branches || 0);
  const activeBranchMultiplier = allowedBranches === null || allowedBranches === undefined
    ? configuredBranches
    : Math.max(1, Math.min(configuredBranches, Number(allowedBranches) || 1));
  const addonMap = {
    members: Number(gymData?.addon_extra_members || 0),
    staff: Number(gymData?.addon_extra_staff || 0),
    branches: Number(gymData?.addon_extra_branches || 0),
    whatsapp: Number(gymData?.addon_extra_whatsapp || 0),
    hello: 0,
  };

  const resolvePlanTotalLimit = (limitKey) => {
    const baseValue = plan.limits?.[limitKey] ?? null;
    if (baseValue === null || baseValue === undefined) return null;
    if (BRANCH_SCALING_LIMIT_KEYS.has(limitKey)) {
      return Number(baseValue) * activeBranchMultiplier;
    }
    return Number(baseValue);
  };

  return BILLING_LIMIT_KEYS.reduce((accumulator, limitKey) => {
    if (limitKey === 'branches') {
      accumulator.branches = allowedBranches;
      return accumulator;
    }

    const baseTotal = resolvePlanTotalLimit(limitKey);
    accumulator[limitKey] = baseTotal === null ? null : baseTotal + Number(addonMap[limitKey] || 0);

    return accumulator;
  }, {
    configured_branches: configuredBranches,
  });
};

export const isAddonAllowedForPlan = (billingCatalog, addonKey, planId) => {
  const catalog = normalizeBillingCatalog(billingCatalog);
  const addon = catalog.addons[String(addonKey || '').trim()];
  if (!addon) return false;
  if (!Array.isArray(addon.requires_plans) || addon.requires_plans.length === 0) return true;
  return addon.requires_plans.includes(normalizePlanId(planId, 'basic'));
};