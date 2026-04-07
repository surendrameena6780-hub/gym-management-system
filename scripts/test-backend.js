const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');

const workspaceRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(workspaceRoot, '.env') });

const shouldRunRuntimeSmoke = process.argv.includes('--runtime');
const defaultBaseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const normalizedBaseUrl = defaultBaseUrl.replace(/\/+$/, '');

let localDbPool = null;
let managedServerProcess = null;
let managedServerOutput = '';

const MAX_SERVER_OUTPUT_CHARS = 6000;
const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_STARTUP_TIMEOUT_MS = 90000;

const isLocalSmokeBaseUrl = (value) => {
  try {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
};

const getLocalDbPool = () => {
  if (!localDbPool) {
    ({ pool: localDbPool } = require(path.join(workspaceRoot, 'config', 'db')));
  }

  return localDbPool;
};

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
};

const getSmokeMessage = (payload, fallback = 'Unexpected response') => (
  payload?.message
  || payload?.error
  || payload?.preview_notice
  || payload?.raw
  || fallback
);

const appendManagedServerOutput = (chunk) => {
  if (!chunk) return;

  managedServerOutput = `${managedServerOutput}${String(chunk)}`;
  if (managedServerOutput.length > MAX_SERVER_OUTPUT_CHARS) {
    managedServerOutput = managedServerOutput.slice(-MAX_SERVER_OUTPUT_CHARS);
  }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchHealth = async () => fetch(`${normalizedBaseUrl}/healthz`);

const waitForHealthyRuntime = async (timeoutMs = HEALTH_STARTUP_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (managedServerProcess && managedServerProcess.exitCode !== null) {
      break;
    }

    try {
      const response = await fetchHealth();
      if (response.ok) {
        return response;
      }
    } catch (_error) {
      // Keep polling until timeout or child exit.
    }

    await delay(HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(`Local smoke server did not become healthy. Recent output:\n${managedServerOutput || 'No server output captured.'}`);
};

const ensureRuntimeServer = async () => {
  try {
    return await fetchHealth();
  } catch (error) {
    if (!isLocalSmokeBaseUrl(normalizedBaseUrl)) {
      throw error;
    }

    managedServerProcess = spawn(process.execPath, [path.join(workspaceRoot, 'server.js')], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managedServerOutput = '';
    managedServerProcess.stdout.on('data', appendManagedServerOutput);
    managedServerProcess.stderr.on('data', appendManagedServerOutput);

    return waitForHealthyRuntime();
  }
};

const stopManagedServer = async () => {
  if (!managedServerProcess) return;

  const processToStop = managedServerProcess;
  managedServerProcess = null;

  if (processToStop.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const finalize = () => resolve();
    processToStop.once('exit', finalize);
    processToStop.kill();
    setTimeout(finalize, 5000);
  });
};

const fetchJson = async (pathname, options = {}) => {
  const headers = {
    accept: 'application/json',
    ...(options.headers || {}),
  };

  const hasBody = options.body !== undefined;
  if (hasBody && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${normalizedBaseUrl}${pathname}`, {
    ...options,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const payload = await readJsonResponse(response);
  return { response, payload };
};

const assertOk = (response, payload, context) => {
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${getSmokeMessage(payload, response.statusText)}`);
  }
};

const assertStatus = (response, payload, expectedStatus, context) => {
  if (response.status !== expectedStatus) {
    throw new Error(`${context} failed (${response.status}): ${getSmokeMessage(payload, response.statusText)}`);
  }
};

const assertMessageMatches = (payload, matcher, context) => {
  if (!matcher.test(String(getSmokeMessage(payload, '')))) {
    throw new Error(`${context} returned an unexpected message: ${getSmokeMessage(payload, 'Unknown response')}`);
  }
};

const createLocalSmokeAuth = async () => {
  const explicitToken = String(process.env.SMOKE_OWNER_TOKEN || '').trim();
  if (explicitToken) {
    const decoded = jwt.decode(explicitToken) || {};
    const decodedUser = decoded.user || decoded || {};
    return {
      token: explicitToken,
      source: 'env-token',
      email: String(process.env.SMOKE_OWNER_EMAIL || '').trim().toLowerCase(),
      gymId: Number(decodedUser.gym_id || 0) || null,
      userId: Number(decodedUser.id || 0) || null,
    };
  }

  if (!isLocalSmokeBaseUrl(normalizedBaseUrl)) {
    console.log('Authenticated settings smoke skipped: provide SMOKE_OWNER_TOKEN for non-local runtimes.');
    return null;
  }

  if (!process.env.JWT_SECRET) {
    throw new Error('Authenticated settings smoke requires JWT_SECRET.');
  }

  const explicitEmail = String(process.env.SMOKE_OWNER_EMAIL || '').trim().toLowerCase();
  const dbPool = getLocalDbPool();
  const query = explicitEmail
    ? `SELECT u.id, u.gym_id, u.email, UPPER(COALESCE(u.role, 'OWNER')) AS role,
              COALESCE(u.staff_role, 'OWNER') AS staff_role, COALESCE(u.is_active, TRUE) AS is_active
       FROM users u
       JOIN gyms g ON g.id = u.gym_id
       WHERE LOWER(COALESCE(u.email, '')) = LOWER($1)
         AND UPPER(COALESCE(u.role, 'OWNER')) = 'OWNER'
         AND COALESCE(u.is_active, TRUE) = TRUE
         AND COALESCE(g.is_active, TRUE) = TRUE
         AND COALESCE(g.gym_access_status, 'ACTIVE') = 'ACTIVE'
         AND (g.saas_valid_until IS NULL OR g.saas_valid_until >= NOW() - INTERVAL '3 days')
       ORDER BY u.id ASC
       LIMIT 1`
    : `SELECT u.id, u.gym_id, u.email, UPPER(COALESCE(u.role, 'OWNER')) AS role,
              COALESCE(u.staff_role, 'OWNER') AS staff_role, COALESCE(u.is_active, TRUE) AS is_active
       FROM users u
       JOIN gyms g ON g.id = u.gym_id
       WHERE UPPER(COALESCE(u.role, 'OWNER')) = 'OWNER'
         AND COALESCE(u.is_active, TRUE) = TRUE
         AND COALESCE(g.is_active, TRUE) = TRUE
         AND COALESCE(g.gym_access_status, 'ACTIVE') = 'ACTIVE'
         AND (g.saas_valid_until IS NULL OR g.saas_valid_until >= NOW() - INTERVAL '3 days')
         AND COALESCE(u.email, '') <> ''
       ORDER BY u.id ASC
       LIMIT 1`;
  const params = explicitEmail ? [explicitEmail] : [];
  const result = await dbPool.query(query, params);
  const user = result.rows[0];

  if (!user) {
    console.log(explicitEmail
      ? `Authenticated settings smoke skipped: no active owner found for ${explicitEmail}.`
      : 'Authenticated settings smoke skipped: no active owner account was found in the local database.');
    return null;
  }

  const token = jwt.sign(
    {
      user: {
        id: user.id,
        gym_id: user.gym_id,
        role: user.role,
        staff_role: user.staff_role,
        permissions: ['*'],
        is_active: user.is_active !== false,
      },
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  return {
    token,
    email: user.email,
    source: 'local-db',
    gymId: Number(user.gym_id || 0) || null,
    userId: Number(user.id || 0) || null,
  };
};

const loadLocalSmokeFixtures = async (auth) => {
  if (!isLocalSmokeBaseUrl(normalizedBaseUrl)) {
    console.log('Authenticated payment/membership smoke skipped: local DB fixtures are only available for localhost runtimes.');
    return null;
  }

  if (!auth?.gymId) {
    console.log('Authenticated payment/membership smoke skipped: could not resolve a gym id from the owner token.');
    return null;
  }

  const dbPool = getLocalDbPool();
  const [memberResult, planResult, pendingPaymentResult] = await Promise.all([
    dbPool.query(
      `SELECT id
       FROM members
       WHERE gym_id = $1 AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT 1`,
      [auth.gymId]
    ),
    dbPool.query(
      `SELECT id
       FROM plans
       WHERE gym_id = $1 AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT 1`,
      [auth.gymId]
    ),
    dbPool.query(
      `SELECT id
       FROM payments
       WHERE gym_id = $1
         AND deleted_at IS NULL
         AND status = 'Pending'
         AND COALESCE(amount_due, 0) > 0
       ORDER BY payment_date DESC, id DESC
       LIMIT 1`,
      [auth.gymId]
    ),
  ]);

  const memberId = Number(memberResult.rows[0]?.id || 0) || null;
  const planId = Number(planResult.rows[0]?.id || 0) || null;

  if (!memberId || !planId) {
    console.log('Authenticated payment/membership smoke skipped: the selected gym needs at least one member and one plan.');
    return null;
  }

  return {
    memberId,
    planId,
    pendingPaymentId: Number(pendingPaymentResult.rows[0]?.id || 0) || null,
  };
};

const runAuthenticatedSettingsSmoke = async (auth) => {
  if (!auth) return;

  const headers = { 'x-auth-token': auth.token };
  const integrationsFetch = await fetchJson('/api/settings/integrations', { headers });
  assertOk(integrationsFetch.response, integrationsFetch.payload, 'Fetch integrations settings');

  const integrationState = integrationsFetch.payload || {};
  if (!integrationState.member_payments || !Array.isArray(integrationState.templates)) {
    throw new Error('Integrations payload is missing member_payments or templates.');
  }

  const paymentSave = await fetchJson('/api/settings/integrations', {
    method: 'PUT',
    headers,
    body: {
      save_scope: 'payments',
      member_payments: {
        enabled: Boolean(integrationState.member_payments?.enabled),
        connect_mode: String(integrationState.member_payments?.connect_mode || 'MANUAL').toUpperCase(),
        razorpay_key_id: String(integrationState.member_payments?.razorpay_key_id || '').trim(),
        razorpay_key_secret: '',
        upi_id: String(integrationState.member_payments?.upi_id || '').trim(),
      },
    },
  });
  assertOk(paymentSave.response, paymentSave.payload, 'Save payment integrations scope');

  if (!/payment integrations saved successfully/i.test(String(paymentSave.payload?.message || ''))) {
    throw new Error('Payment scope save did not return the expected success message.');
  }

  const invalidScopeSave = await fetchJson('/api/settings/integrations', {
    method: 'PUT',
    headers,
    body: { save_scope: 'invalid' },
  });
  if (invalidScopeSave.response.status !== 400) {
    throw new Error(`Invalid settings scope should fail with 400, received ${invalidScopeSave.response.status}.`);
  }

  console.log(`Authenticated settings smoke passed using ${auth.email || auth.source}.`);
};

const runAuthenticatedPaymentMembershipSmoke = async (auth) => {
  if (!auth) return;

  const fixtures = await loadLocalSmokeFixtures(auth);
  if (!fixtures) return;

  const headers = { 'x-auth-token': auth.token };
  const yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);

  const invalidPaymentRecord = await fetchJson('/api/payments/record', {
    method: 'POST',
    headers,
    body: {
      user_id: fixtures.memberId,
      plan_id: fixtures.planId,
      amount_paid: 1500,
      total_amount: 1000,
      payment_mode: 'Cash',
    },
  });
  assertStatus(invalidPaymentRecord.response, invalidPaymentRecord.payload, 400, 'Reject overpaid payment record');
  assertMessageMatches(invalidPaymentRecord.payload, /amount_paid cannot be greater than total_amount/i, 'Reject overpaid payment record');

  const invalidFreeze = await fetchJson('/api/memberships/freeze', {
    method: 'POST',
    headers,
    body: {
      member_id: fixtures.memberId,
      freeze_end_date: yesterday,
    },
  });
  assertStatus(invalidFreeze.response, invalidFreeze.payload, 400, 'Reject past membership freeze date');
  assertMessageMatches(invalidFreeze.payload, /freeze_end_date/i, 'Reject past membership freeze date');

  const invalidExtend = await fetchJson('/api/memberships/extend', {
    method: 'POST',
    headers,
    body: {
      member_id: fixtures.memberId,
      days: 0,
    },
  });
  assertStatus(invalidExtend.response, invalidExtend.payload, 400, 'Reject invalid membership extension days');
  assertMessageMatches(invalidExtend.payload, /days/i, 'Reject invalid membership extension days');

  if (fixtures.pendingPaymentId) {
    const invalidDueAmount = await fetchJson(`/api/payments/${fixtures.pendingPaymentId}/due/create-order`, {
      method: 'POST',
      headers,
      body: { amount: 0 },
    });
    assertStatus(invalidDueAmount.response, invalidDueAmount.payload, 400, 'Reject invalid due collection amount');
    assertMessageMatches(invalidDueAmount.payload, /valid collection amount/i, 'Reject invalid due collection amount');
  } else {
    console.log('Authenticated due collection smoke skipped: no pending payment was available for the selected gym.');
  }

  console.log(`Authenticated payment and membership smoke passed using ${auth.email || auth.source}.`);
};

const collectJsFiles = (dirPath) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return collectJsFiles(fullPath);
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      return [fullPath];
    }

    return [];
  });
};

const syntaxTargets = [
  path.join(workspaceRoot, 'server.js'),
  ...collectJsFiles(path.join(workspaceRoot, 'config')),
  ...collectJsFiles(path.join(workspaceRoot, 'jobs')),
  ...collectJsFiles(path.join(workspaceRoot, 'middleware')),
  ...collectJsFiles(path.join(workspaceRoot, 'routes')),
  ...collectJsFiles(path.join(workspaceRoot, 'scripts')).filter((filePath) => !filePath.endsWith('test-backend.js')),
  ...collectJsFiles(path.join(workspaceRoot, 'utils')),
];

const uniqueTargets = Array.from(new Set(syntaxTargets));

let syntaxFailures = 0;
for (const target of uniqueTargets) {
  const result = spawnSync(process.execPath, ['--check', target], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    syntaxFailures += 1;
    process.stderr.write(result.stderr || `Syntax check failed for ${target}\n`);
  }
}

if (syntaxFailures > 0) {
  console.error(`Backend syntax checks failed in ${syntaxFailures} file(s).`);
  process.exit(1);
}

const runRuntimeSmoke = async () => {
  const response = await ensureRuntimeServer();
  if (!response.ok) {
    throw new Error(`Health check returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status !== 'ok') {
    throw new Error(`Unexpected health status: ${payload.status}`);
  }

  const auth = await createLocalSmokeAuth();
  await runAuthenticatedSettingsSmoke(auth);
  await runAuthenticatedPaymentMembershipSmoke(auth);

  console.log(`Runtime smoke passed against ${defaultBaseUrl}`);
};

(async () => {
  if (!shouldRunRuntimeSmoke) {
    console.log(`Backend syntax checks passed for ${uniqueTargets.length} files.`);
    return;
  }

  try {
    await runRuntimeSmoke();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  } finally {
    await stopManagedServer().catch(() => {});
    if (localDbPool) {
      await localDbPool.end().catch(() => {});
    }
  }
})();