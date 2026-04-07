const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');

const workspaceRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(workspaceRoot, '.env') });

const shouldRunRuntimeSmoke = process.argv.includes('--runtime');
const defaultBaseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const normalizedBaseUrl = defaultBaseUrl.replace(/\/+$/, '');

let localDbPool = null;

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

const createLocalSmokeAuth = async () => {
  const explicitToken = String(process.env.SMOKE_OWNER_TOKEN || '').trim();
  if (explicitToken) {
    return { token: explicitToken, source: 'env-token' };
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
  };
};

const runAuthenticatedSettingsSmoke = async () => {
  const auth = await createLocalSmokeAuth();
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
  const response = await fetch(`${normalizedBaseUrl}/healthz`);
  if (!response.ok) {
    throw new Error(`Health check returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status !== 'ok') {
    throw new Error(`Unexpected health status: ${payload.status}`);
  }

  await runAuthenticatedSettingsSmoke();

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
    if (localDbPool) {
      await localDbPool.end().catch(() => {});
    }
  }
})();