const DEFAULT_FRONTEND_URL = 'https://gymvault.tech';
const DEFAULT_BACKEND_URL = 'https://gym-management-system-4nfu.onrender.com';

const normalizeBaseUrl = (value, fallback) => String(value || fallback || '').trim().replace(/\/+$/, '');

const frontendBaseUrl = normalizeBaseUrl(process.env.SMOKE_FRONTEND_URL, DEFAULT_FRONTEND_URL);
const backendBaseUrl = normalizeBaseUrl(process.env.SMOKE_BACKEND_URL, DEFAULT_BACKEND_URL);
const frontendOrigin = new URL(frontendBaseUrl).origin;

const warnings = [];
const results = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pushResult = (status, label, detail) => {
  results.push({ status, label, detail });
  const prefix = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${prefix} ${label}: ${detail}`);
};

const readBody = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const headerIncludes = (response, headerName, expectedFragment) => {
  const value = String(response.headers.get(headerName) || '').toLowerCase();
  return value.includes(String(expectedFragment || '').toLowerCase());
};

const fetchWithRetry = async (url, options = {}, attempts = 3) => {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(400 * attempt);
      }
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
};

const requestJson = async (url, options = {}) => {
  const response = await fetchWithRetry(url, options);
  const body = await readBody(response);
  return { response, body };
};

const runCheck = async (label, check) => {
  try {
    const detail = await check();
    pushResult('pass', label, detail);
  } catch (error) {
    pushResult('fail', label, error.message || 'Unknown failure');
  }
};

const runWarningCheck = async (label, check) => {
  try {
    const detail = await check();
    pushResult('pass', label, detail);
  } catch (error) {
    warnings.push({ label, detail: error.message || 'Unknown warning' });
    pushResult('warn', label, error.message || 'Unknown warning');
  }
};

const checkBackendHealth = async () => {
  const { response, body } = await requestJson(`${backendBaseUrl}/healthz`);
  assert(response.ok, `expected 200, got ${response.status}`);
  assert(body && body.status === 'ok', 'backend health did not report status=ok');
  assert(body.database === 'reachable', 'backend health did not report database=reachable');
  return `${response.status} ${body.service}`;
};

const checkFrontendRewriteHealth = async () => {
  const { response, body } = await requestJson(`${frontendBaseUrl}/api/auth/config`);
  assert(response.ok, `expected 200, got ${response.status}`);
  assert(body && typeof body.google_auth_enabled === 'boolean', 'frontend rewrite auth config did not return expected shape');
  return `${response.status} via frontend rewrite`;
};

const checkFrontendShellHeaders = async () => {
  const response = await fetchWithRetry(`${frontendBaseUrl}/`);
  assert(response.ok, `expected 200, got ${response.status}`);
  assert(headerIncludes(response, 'cache-control', 'no-store'), 'frontend shell is missing no-store cache policy');
  return String(response.headers.get('cache-control') || '');
};

const checkManifestHeaders = async () => {
  const response = await fetchWithRetry(`${frontendBaseUrl}/manifest.webmanifest`);
  assert(response.ok, `expected 200, got ${response.status}`);
  assert(headerIncludes(response, 'content-type', 'application/manifest+json'), 'manifest content-type is incorrect');
  return String(response.headers.get('content-type') || '');
};

const checkServiceWorker = async () => {
  const response = await fetchWithRetry(`${frontendBaseUrl}/sw.js`);
  assert(response.ok, `expected 200, got ${response.status}`);
  assert(headerIncludes(response, 'cache-control', 'must-revalidate'), 'service worker cache policy is incorrect');

  const text = String(await response.text() || '');
  const precacheMatch = text.match(/const PRECACHE_URLS = \[(?<body>[\s\S]*?)\];/);
  assert(precacheMatch?.groups?.body, 'could not inspect service worker precache list');
  const precacheBody = precacheMatch.groups.body;

  assert(!precacheBody.includes('/index.html'), 'service worker precache must not include index.html');
  assert(!precacheBody.includes('/assets/'), 'service worker precache must not include hashed asset bundles');

  return String(response.headers.get('cache-control') || '');
};

const checkInvalidLogin = async (baseUrl, label) => {
  const { response, body } = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: frontendOrigin,
    },
    body: JSON.stringify({
      email: 'nonexistent@gymvault.tech',
      password: 'DefinitelyWrong123!',
    }),
  });

  assert(response.status === 400, `${label} expected 400, got ${response.status}`);
  assert(body && body.message === 'Invalid email or password.', `${label} returned unexpected body`);
  return `${response.status} Invalid email or password.`;
};

const checkDirectBackendCorsHeaders = async () => {
  const response = await fetchWithRetry(`${backendBaseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      origin: frontendOrigin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });

  assert(response.ok, `expected 200, got ${response.status}`);

  const allowOrigin = String(response.headers.get('access-control-allow-origin') || '');
  const allowCredentials = String(response.headers.get('access-control-allow-credentials') || '');

  assert(allowOrigin === frontendOrigin, `expected access-control-allow-origin=${frontendOrigin || '(empty)'}, got ${allowOrigin || '(empty)'}`);
  assert(allowCredentials.toLowerCase() === 'true', 'direct backend preflight is missing access-control-allow-credentials=true');

  return `${allowOrigin} credentials=${allowCredentials}`;
};

const main = async () => {
  console.log(`Frontend base: ${frontendBaseUrl}`);
  console.log(`Backend base: ${backendBaseUrl}`);

  await runCheck('Backend health', checkBackendHealth);
  await runCheck('Frontend rewrite health', checkFrontendRewriteHealth);
  await runCheck('Frontend shell headers', checkFrontendShellHeaders);
  await runCheck('Manifest headers', checkManifestHeaders);
  await runCheck('Service worker policy', checkServiceWorker);
  await runCheck('Frontend invalid login', () => checkInvalidLogin(frontendBaseUrl, 'frontend invalid login'));
  await runCheck('Backend invalid login', () => checkInvalidLogin(backendBaseUrl, 'backend invalid login'));
  await runWarningCheck('Direct backend CORS headers', checkDirectBackendCorsHeaders);

  const failures = results.filter((entry) => entry.status === 'fail');

  console.log(`\nSummary: ${results.filter((entry) => entry.status === 'pass').length} passed, ${warnings.length} warnings, ${failures.length} failed.`);

  if (warnings.length > 0) {
    console.log('Warnings indicate non-blocking deployment hygiene issues that should be reviewed.');
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`FATAL ${error.message || error}`);
  process.exitCode = 1;
});