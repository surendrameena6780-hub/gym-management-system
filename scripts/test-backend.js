const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const shouldRunRuntimeSmoke = process.argv.includes('--runtime');
const defaultBaseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:5000';

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
  const response = await fetch(`${defaultBaseUrl.replace(/\/+$/, '')}/healthz`);
  if (!response.ok) {
    throw new Error(`Health check returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status !== 'ok') {
    throw new Error(`Unexpected health status: ${payload.status}`);
  }

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
  }
})();