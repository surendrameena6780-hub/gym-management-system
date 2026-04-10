import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = String(__ENV.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const AUTH_TOKEN = String(__ENV.AUTH_TOKEN || '').trim();
const THINK_TIME_MS = Number.parseInt(__ENV.THINK_TIME_MS || '150', 10) || 0;
const PROFILE_MODE = String(__ENV.PROFILE_MODE || 'heavy').trim().toLowerCase();
const SUMMARY_BASENAME = String(__ENV.SUMMARY_BASENAME || 'k6-owner-read').trim() || 'k6-owner-read';

if (!AUTH_TOKEN) {
  throw new Error('AUTH_TOKEN is required. Pass a valid owner token via the environment.');
}

const commonParams = {
  headers: {
    Accept: 'application/json',
    'x-auth-token': AUTH_TOKEN,
  },
  tags: {
    suite: 'owner-read-load',
  },
};

const buildHeavyScenarios = () => ({
  dashboard_boot: {
    executor: 'ramping-arrival-rate',
    exec: 'dashboardBoot',
    startRate: 5,
    timeUnit: '1s',
    preAllocatedVUs: 80,
    maxVUs: 250,
    stages: [
      { target: 20, duration: '1m' },
      { target: 45, duration: '2m' },
      { target: 75, duration: '2m' },
      { target: 75, duration: '2m' },
      { target: 0, duration: '1m' },
    ],
    tags: { scenario: 'dashboard_boot' },
  },
  members_page: {
    executor: 'ramping-arrival-rate',
    exec: 'membersPage',
    startRate: 3,
    timeUnit: '1s',
    preAllocatedVUs: 60,
    maxVUs: 220,
    stages: [
      { target: 10, duration: '1m' },
      { target: 25, duration: '2m' },
      { target: 45, duration: '2m' },
      { target: 45, duration: '2m' },
      { target: 0, duration: '1m' },
    ],
    tags: { scenario: 'members_page' },
  },
  health_probe: {
    executor: 'constant-arrival-rate',
    exec: 'healthProbe',
    rate: 15,
    timeUnit: '1s',
    duration: '8m',
    preAllocatedVUs: 20,
    maxVUs: 60,
    tags: { scenario: 'health_probe' },
  },
});

const buildBurstScenarios = () => ({
  dashboard_boot: {
    executor: 'constant-arrival-rate',
    exec: 'dashboardBoot',
    rate: 80,
    timeUnit: '1s',
    duration: '10s',
    preAllocatedVUs: 650,
    maxVUs: 900,
    tags: { scenario: 'dashboard_boot' },
  },
  members_page: {
    executor: 'constant-arrival-rate',
    exec: 'membersPage',
    rate: 40,
    timeUnit: '1s',
    duration: '10s',
    preAllocatedVUs: 350,
    maxVUs: 600,
    tags: { scenario: 'members_page' },
  },
  health_probe: {
    executor: 'constant-arrival-rate',
    exec: 'healthProbe',
    rate: 5,
    timeUnit: '1s',
    duration: '10s',
    preAllocatedVUs: 20,
    maxVUs: 40,
    tags: { scenario: 'health_probe' },
  },
});

const scenarios = PROFILE_MODE === 'burst' ? buildBurstScenarios() : buildHeavyScenarios();

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    checks: ['rate>0.99'],
    'http_req_duration{scenario:dashboard_boot}': ['p(95)<2200'],
    'http_req_duration{scenario:members_page}': ['p(95)<2500'],
  },
  scenarios,
};

const buildUrl = (path) => `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const assertJsonOk = (response, label) => {
  check(response, {
    [`${label} status is 200`]: (res) => res.status === 200,
    [`${label} content-type is json`]: (res) => String(res.headers['Content-Type'] || '').toLowerCase().includes('application/json'),
  });
};

const maybeThink = () => {
  if (THINK_TIME_MS > 0) {
    sleep(THINK_TIME_MS / 1000);
  }
};

export function setup() {
  const response = http.get(buildUrl('/healthz'), {
    tags: { name: 'healthz_setup', scenario: 'setup' },
  });

  check(response, {
    'setup healthz status is 200': (res) => res.status === 200,
  });

  const authMe = http.get(buildUrl('/api/auth/me'), {
    ...commonParams,
    tags: { name: 'auth_me_setup', scenario: 'setup' },
  });
  check(authMe, {
    'setup auth works': (res) => res.status === 200,
  });

  return {
    baseUrl: BASE_URL,
  };
}

export function dashboardBoot() {
  const authResponse = http.get(buildUrl('/api/auth/me'), {
    ...commonParams,
    tags: { name: 'auth_me', flow: 'dashboard_boot' },
  });
  assertJsonOk(authResponse, 'auth_me');

  maybeThink();

  const responses = http.batch([
    ['GET', buildUrl('/api/dashboard/stats'), null, { ...commonParams, tags: { name: 'dashboard_stats', flow: 'dashboard_boot' } }],
    ['GET', buildUrl('/api/dashboard/setup-status'), null, { ...commonParams, tags: { name: 'dashboard_setup_status', flow: 'dashboard_boot' } }],
    ['GET', buildUrl('/api/notifications'), null, { ...commonParams, tags: { name: 'notifications_list', flow: 'dashboard_boot' } }],
  ]);

  assertJsonOk(responses[0], 'dashboard_stats');
  assertJsonOk(responses[1], 'dashboard_setup_status');
  assertJsonOk(responses[2], 'notifications_list');
}

export function membersPage() {
  const authResponse = http.get(buildUrl('/api/auth/me'), {
    ...commonParams,
    tags: { name: 'auth_me', flow: 'members_page' },
  });
  assertJsonOk(authResponse, 'auth_me_members');

  maybeThink();

  const responses = http.batch([
    ['GET', buildUrl('/api/members?page=1&limit=30'), null, { ...commonParams, tags: { name: 'members_list', flow: 'members_page' } }],
    ['GET', buildUrl('/api/members/summary'), null, { ...commonParams, tags: { name: 'members_summary', flow: 'members_page' } }],
  ]);

  assertJsonOk(responses[0], 'members_list');
  assertJsonOk(responses[1], 'members_summary');
}

export function healthProbe() {
  const response = http.get(buildUrl('/healthz'), {
    tags: { name: 'healthz', flow: 'health_probe' },
  });

  check(response, {
    'healthz status is 200': (res) => res.status === 200,
  });
}

export function handleSummary(data) {
  const compact = {
    root_group: data.root_group,
    options: data.options,
    state: data.state,
    metrics: data.metrics,
  };

  return {
    [`reports/${SUMMARY_BASENAME}-summary.json`]: JSON.stringify(compact, null, 2),
    stdout: JSON.stringify({
      profile_mode: PROFILE_MODE,
      vus_max: data.metrics.vus_max?.values?.max || 0,
      iterations: data.metrics.iterations?.values?.count || 0,
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      http_req_failed_rate: data.metrics.http_req_failed?.values?.rate || 0,
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
    }, null, 2),
  };
}