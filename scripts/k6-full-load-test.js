/**
 * GymVault — Comprehensive Full Load Test
 *
 * Simulates 20 gym owners each with 500-1000 members
 * hitting EVERY page, flow, and feature in the app simultaneously.
 *
 * Env vars:
 *   BASE_URL       – API base (default http://localhost:5000)
 *   AUTH_TOKEN      – Valid owner JWT
 *   THINK_TIME_MS   – Pause between steps (default 50)
 *
 * Run:
 *   k6 run scripts/k6-full-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/* ─── ENV ────────────────────────────────────────────────────── */

const BASE_URL = String(__ENV.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const AUTH_TOKEN = String(__ENV.AUTH_TOKEN || '').trim();
const THINK_TIME_MS = Number.parseInt(__ENV.THINK_TIME_MS || '50', 10) || 0;

if (!AUTH_TOKEN) {
  throw new Error('AUTH_TOKEN is required.');
}

/* ─── Custom Metrics ─────────────────────────────────────────── */

const errorCount = new Counter('custom_errors');
const scenarioDuration = new Trend('scenario_duration');

/* ─── Helpers ────────────────────────────────────────────────── */

const params = {
  headers: {
    Accept: 'application/json',
    'x-auth-token': AUTH_TOKEN,
  },
};

const jsonParams = {
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-auth-token': AUTH_TOKEN,
  },
};

const url = (path) => `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

function expectOk(res, label) {
  const ok = check(res, {
    [`${label} → 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
  if (!ok) {
    errorCount.add(1, { endpoint: label, status: String(res.status) });
  }
}

function expectOkOrEmpty(res, label) {
  const ok = check(res, {
    [`${label} → 2xx/404`]: (r) => r.status >= 200 && r.status < 300 || r.status === 404,
  });
  if (!ok) {
    errorCount.add(1, { endpoint: label, status: String(res.status) });
  }
}

const think = () => { if (THINK_TIME_MS > 0) sleep(THINK_TIME_MS / 1000); };

/* ─── Scenarios ──────────────────────────────────────────────── */

/*
  Target: 150,000+ total requests over ~10 minutes.
  265 max VUs, 8 concurrent scenarios. Each VU iteration fires 5-8 HTTP requests.
  Rates tuned for single Node.js process hitting remote PostgreSQL.

  Scenario breakdown:
  - dashboard_flow:    ramp 2→14 req/s, maxVUs: 70
  - members_flow:      ramp 1→9 req/s,  maxVUs: 50
  - plans_payments:    ramp 1→5 req/s,  maxVUs: 35
  - classes_attendance: ramp 1→4 req/s,  maxVUs: 30
  - insights_finance:  ramp 1→4 req/s,  maxVUs: 25
  - leads_support:     ramp 1→3 req/s,  maxVUs: 20
  - settings_exports:  ramp 1→3 req/s,  maxVUs: 20
  - health_baseline:   constant 7 req/s, maxVUs: 15
  Peak: ~49 iter/s × 5-8 reqs = ~250-400 HTTP req/s
*/

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],

  thresholds: {
    http_req_failed:   ['rate<0.02'],          // <2% failure
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],  // p95 < 3s, p99 < 5s
    checks:            ['rate>0.97'],          // >97% checks pass
    custom_errors:     ['count<500'],          // < 500 app errors

    'http_req_duration{scenario:dashboard_flow}':     ['p(95)<2500'],
    'http_req_duration{scenario:members_flow}':       ['p(95)<3000'],
    'http_req_duration{scenario:plans_payments}':     ['p(95)<3000'],
    'http_req_duration{scenario:classes_attendance}': ['p(95)<3000'],
    'http_req_duration{scenario:insights_finance}':   ['p(95)<4000'],
    'http_req_duration{scenario:leads_support}':      ['p(95)<3000'],
    'http_req_duration{scenario:settings_exports}':   ['p(95)<4000'],
  },

  scenarios: {
    /* — 1. Dashboard flow — owner opens dashboard */
    dashboard_flow: {
      executor: 'ramping-arrival-rate',
      exec: 'dashboardFlow',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 70,
      stages: [
        { target: 5,  duration: '1m' },
        { target: 10, duration: '2m' },
        { target: 14, duration: '3m' },
        { target: 14, duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'dashboard_flow' },
    },

    /* — 2. Members flow — list, search, view member */
    members_flow: {
      executor: 'ramping-arrival-rate',
      exec: 'membersFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 15,
      maxVUs: 50,
      stages: [
        { target: 4,  duration: '1m' },
        { target: 7,  duration: '2m' },
        { target: 9,  duration: '3m' },
        { target: 9,  duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'members_flow' },
    },

    /* — 3. Plans + Payments page */
    plans_payments: {
      executor: 'ramping-arrival-rate',
      exec: 'plansPaymentsFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 35,
      stages: [
        { target: 2,  duration: '1m' },
        { target: 4,  duration: '2m' },
        { target: 5,  duration: '3m' },
        { target: 5,  duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'plans_payments' },
    },

    /* — 4. Classes + Attendance */
    classes_attendance: {
      executor: 'ramping-arrival-rate',
      exec: 'classesAttendanceFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      stages: [
        { target: 2,  duration: '1m' },
        { target: 3,  duration: '2m' },
        { target: 4,  duration: '3m' },
        { target: 4,  duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'classes_attendance' },
    },

    /* — 5. Insights + Finance */
    insights_finance: {
      executor: 'ramping-arrival-rate',
      exec: 'insightsFinanceFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 8,
      maxVUs: 25,
      stages: [
        { target: 1,  duration: '1m' },
        { target: 3,  duration: '2m' },
        { target: 4,  duration: '3m' },
        { target: 4,  duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'insights_finance' },
    },

    /* — 6. Leads + Support */
    leads_support: {
      executor: 'ramping-arrival-rate',
      exec: 'leadsSupportFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      stages: [
        { target: 1,  duration: '1m' },
        { target: 2,  duration: '2m' },
        { target: 3,  duration: '3m' },
        { target: 3,  duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'leads_support' },
    },

    /* — 7. Settings + Exports */
    settings_exports: {
      executor: 'ramping-arrival-rate',
      exec: 'settingsExportsFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      stages: [
        { target: 1,  duration: '1m' },
        { target: 2,  duration: '2m' },
        { target: 3,  duration: '3m' },
        { target: 3,  duration: '3m' },
        { target: 0,  duration: '1m' },
      ],
      tags: { scenario: 'settings_exports' },
    },

    /* — 8. Health baseline — always running */
    health_baseline: {
      executor: 'constant-arrival-rate',
      exec: 'healthProbe',
      rate: 7,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 5,
      maxVUs: 15,
      tags: { scenario: 'health_baseline' },
    },
  },
};

/* ─── Setup (runs once) ──────────────────────────────────────── */

export function setup() {
  const hz = http.get(url('/healthz'), { tags: { name: 'setup_healthz' } });
  check(hz, { 'setup: healthz OK': (r) => r.status === 200 });

  const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'setup_auth' } });
  check(me, { 'setup: auth OK': (r) => r.status === 200 });

  return { ok: true };
}

/* ─── 1. Dashboard Flow ──────────────────────────────────────── */

export function dashboardFlow() {
  group('Dashboard Boot', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    const batch = http.batch([
      ['GET', url('/api/dashboard/stats'), null,        { ...params, tags: { name: 'dashboard_stats' } }],
      ['GET', url('/api/dashboard/setup-status'), null,  { ...params, tags: { name: 'dashboard_setup' } }],
      ['GET', url('/api/notifications?page=1&limit=20'), null, { ...params, tags: { name: 'notifications_list' } }],
    ]);
    expectOk(batch[0], 'dashboard_stats');
    expectOk(batch[1], 'dashboard_setup');
    expectOk(batch[2], 'notifications_list');
    think();

    // Simulate checking memberships summary (widget)
    const mSummary = http.get(url('/api/members/summary'), { ...params, tags: { name: 'members_summary_widget' } });
    expectOk(mSummary, 'members_summary_widget');

    // Simulate fetching billing subscription (sidebar badge)
    const billing = http.get(url('/api/billing/current-subscription'), { ...params, tags: { name: 'billing_sub' } });
    expectOkOrEmpty(billing, 'billing_sub');
  });
}

/* ─── 2. Members Flow ────────────────────────────────────────── */

export function membersFlow() {
  group('Members Page', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    // Load members list + summary in parallel
    const batch = http.batch([
      ['GET', url('/api/members?page=1&limit=30&paginate=true'), null, { ...params, tags: { name: 'members_list' } }],
      ['GET', url('/api/members/summary'), null, { ...params, tags: { name: 'members_summary' } }],
    ]);
    expectOk(batch[0], 'members_list');
    expectOk(batch[1], 'members_summary');
    think();

    // Simulate search
    const search = http.get(url('/api/members?page=1&limit=30&search=test&paginate=true'), { ...params, tags: { name: 'members_search' } });
    expectOk(search, 'members_search');
    think();

    // Simulate page 2
    const page2 = http.get(url('/api/members?page=2&limit=30&paginate=true'), { ...params, tags: { name: 'members_page2' } });
    expectOk(page2, 'members_page2');
  });
}

/* ─── 3. Plans + Payments Flow ───────────────────────────────── */

export function plansPaymentsFlow() {
  group('Plans Page', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    const plans = http.get(url('/api/plans'), { ...params, tags: { name: 'plans_list' } });
    expectOk(plans, 'plans_list');
    think();
  });

  group('Payments Page', () => {
    const batch = http.batch([
      ['GET', url('/api/payments?page=1&limit=30'), null, { ...params, tags: { name: 'payments_list' } }],
      ['GET', url('/api/memberships/status'), null, { ...params, tags: { name: 'memberships_status' } }],
    ]);
    expectOk(batch[0], 'payments_list');
    expectOk(batch[1], 'memberships_status');
    think();

    // Pending summary
    const pending = http.post(url('/api/payments/pending-summary'), '{}', { ...jsonParams, tags: { name: 'payments_pending' } });
    expectOkOrEmpty(pending, 'payments_pending');
  });
}

/* ─── 4. Classes + Attendance Flow ───────────────────────────── */

export function classesAttendanceFlow() {
  group('Classes Page', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    const batch = http.batch([
      ['GET', url('/api/classes/summary'), null,  { ...params, tags: { name: 'classes_summary' } }],
      ['GET', url('/api/classes/types'), null,    { ...params, tags: { name: 'classes_types' } }],
      ['GET', url('/api/classes/schedule'), null,  { ...params, tags: { name: 'classes_schedule' } }],
    ]);
    expectOk(batch[0], 'classes_summary');
    expectOk(batch[1], 'classes_types');
    expectOk(batch[2], 'classes_schedule');
    think();
  });

  group('Attendance Page', () => {
    const batch = http.batch([
      ['GET', url('/api/attendance/today'), null, { ...params, tags: { name: 'attendance_today' } }],
      ['GET', url('/api/attendance/search'), null, { ...params, tags: { name: 'attendance_search' } }],
    ]);
    expectOk(batch[0], 'attendance_today');
    expectOk(batch[1], 'attendance_search');
  });
}

/* ─── 5. Insights + Finance Flow ─────────────────────────────── */

export function insightsFinanceFlow() {
  group('Insights Page', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    const batch = http.batch([
      ['GET', url('/api/insights/overview?range=6M'), null, { ...params, tags: { name: 'insights_overview' } }],
      ['GET', url('/api/insights/overview?range=3M'), null, { ...params, tags: { name: 'insights_overview_3m' } }],
      ['GET', url('/api/insights/overview?range=1Y'), null, { ...params, tags: { name: 'insights_overview_1y' } }],
    ]);
    expectOk(batch[0], 'insights_overview');
    expectOk(batch[1], 'insights_overview_3m');
    expectOk(batch[2], 'insights_overview_1y');
    think();
  });

  group('Finance Page', () => {
    const batch = http.batch([
      ['GET', url('/api/finance/overview'), null, { ...params, tags: { name: 'finance_overview' } }],
      ['GET', url('/api/finance/expenses'), null, { ...params, tags: { name: 'finance_expenses' } }],
      ['GET', url('/api/finance/payroll/staff-destinations'), null, { ...params, tags: { name: 'finance_payroll_staff' } }],
      ['GET', url('/api/finance/payroll'), null,  { ...params, tags: { name: 'finance_payroll' } }],
    ]);
    expectOk(batch[0], 'finance_overview');
    expectOk(batch[1], 'finance_expenses');
    expectOk(batch[2], 'finance_payroll_staff');
    expectOk(batch[3], 'finance_payroll');
  });
}

/* ─── 6. Leads + Support Flow ────────────────────────────────── */

export function leadsSupportFlow() {
  group('Leads Page', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    const batch = http.batch([
      ['GET', url('/api/leads/summary'), null, { ...params, tags: { name: 'leads_summary' } }],
      ['GET', url('/api/leads?page=1'), null,  { ...params, tags: { name: 'leads_list' } }],
    ]);
    expectOk(batch[0], 'leads_summary');
    expectOk(batch[1], 'leads_list');
    think();
  });

  group('Support Page', () => {
    const batch = http.batch([
      ['GET', url('/api/support/overview'), null,         { ...params, tags: { name: 'support_overview' } }],
      ['GET', url('/api/support/tickets?page=1'), null,   { ...params, tags: { name: 'support_tickets' } }],
    ]);
    expectOk(batch[0], 'support_overview');
    expectOk(batch[1], 'support_tickets');
    think();

    // Chatbot hit
    const chat = http.post(url('/api/support/chatbot'), JSON.stringify({ message: 'How to add a member?' }), {
      ...jsonParams,
      tags: { name: 'support_chatbot' },
    });
    expectOkOrEmpty(chat, 'support_chatbot');
  });
}

/* ─── 7. Settings + Exports Flow ─────────────────────────────── */

export function settingsExportsFlow() {
  group('Settings Page', () => {
    const me = http.get(url('/api/auth/me'), { ...params, tags: { name: 'auth_me' } });
    expectOk(me, 'auth_me');
    think();

    const batch = http.batch([
      ['GET', url('/api/settings/'), null,                 { ...params, tags: { name: 'settings_gym' } }],
      ['GET', url('/api/settings/branches'), null,         { ...params, tags: { name: 'settings_branches' } }],
      ['GET', url('/api/settings/platform'), null,         { ...params, tags: { name: 'settings_platform' } }],
      ['GET', url('/api/push/vapid-public-key'), null,     { ...params, tags: { name: 'push_vapid' } }],
    ]);
    expectOk(batch[0], 'settings_gym');
    expectOk(batch[1], 'settings_branches');
    expectOkOrEmpty(batch[2], 'settings_platform');
    expectOkOrEmpty(batch[3], 'push_vapid');
    think();
  });

  group('Exports Page', () => {
    // Simulate loading saved reports
    const saved = http.get(url('/api/exports/saved-reports'), { ...params, tags: { name: 'exports_saved' } });
    expectOkOrEmpty(saved, 'exports_saved');
    think();

    // Simulate CSV exports (these are heavier queries)
    const batch = http.batch([
      ['GET', url('/api/exports/members?limit=100'), null,    { ...params, tags: { name: 'export_members' } }],
      ['GET', url('/api/exports/payments?limit=100'), null,   { ...params, tags: { name: 'export_payments' } }],
    ]);
    expectOkOrEmpty(batch[0], 'export_members');
    expectOkOrEmpty(batch[1], 'export_payments');
  });
}

/* ─── 8. Health Baseline ─────────────────────────────────────── */

export function healthProbe() {
  const res = http.get(url('/healthz'), { tags: { name: 'healthz' } });
  check(res, { 'healthz → 200': (r) => r.status === 200 });
}

/* ─── Summary ────────────────────────────────────────────────── */

export function handleSummary(data) {
  const m = data.metrics;
  const v = (metric, stat) => {
    if (!metric) return 0;
    if (metric.values && metric.values[stat] !== undefined) return metric.values[stat];
    if (metric[stat] !== undefined) return metric[stat];
    return 0;
  };

  const compact = {
    root_group: data.root_group,
    options: data.options,
    state: data.state,
    metrics: m,
  };

  const stdout = {
    test: 'GymVault Full Comprehensive Load Test',
    duration: '10 minutes',
    total_http_requests: v(m.http_reqs, 'count'),
    vus_max: v(m.vus_max, 'max'),
    iterations_total: v(m.iterations, 'count'),
    failure_rate_pct: (v(m.http_req_failed, 'rate') * 100).toFixed(2),
    checks_pass_pct: (v(m.checks, 'rate') * 100).toFixed(2),
    custom_errors: v(m.custom_errors, 'count'),
    latency: {
      avg_ms: v(m.http_req_duration, 'avg').toFixed(1),
      p90_ms: v(m.http_req_duration, 'p(90)').toFixed(1),
      p95_ms: v(m.http_req_duration, 'p(95)').toFixed(1),
      p99_ms: v(m.http_req_duration, 'p(99)').toFixed(1),
      max_ms: v(m.http_req_duration, 'max').toFixed(1),
    },
    thresholds: Object.entries(data.options?.thresholds || {}).reduce((acc, [k]) => {
      const metric = m[k];
      acc[k] = metric?.thresholds ? Object.values(metric.thresholds).every(t => t.ok) ? 'PASS' : 'FAIL' : 'N/A';
      return acc;
    }, {}),
  };

  return {
    'reports/k6-full-load-summary.json': JSON.stringify(compact, null, 2),
    stdout: JSON.stringify(stdout, null, 2),
  };
}
