const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const summaryPath = path.resolve(repoRoot, process.argv[2] || 'reports/k6-owner-read-summary.json');
const exportPath = path.resolve(repoRoot, process.argv[3] || 'reports/k6-owner-read-summary-export.json');
const outputPath = path.resolve(repoRoot, process.argv[4] || 'reports/k6-owner-read-report.md');

const readJson = (filePath) => {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const summaryData = readJson(summaryPath);
const exportData = readJson(exportPath);
const data = summaryData || exportData;

if (!data) {
    console.error('No k6 summary file found.');
    process.exit(1);
}

const metrics = data.metrics || {};

const toArray = (value) => Array.isArray(value)
    ? value
    : value && typeof value === 'object'
        ? Object.values(value)
        : [];

const getMetric = (key) => metrics[key] || null;
const getValues = (key) => {
    const m = getMetric(key);
    if (!m) return null;
    // k6 v1.x puts values directly on the metric; older versions use .values wrapper
    return m.values || m;
};
const formatInt = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString('en-IN') : 'n/a';
const formatNumber = (value) => Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'n/a';
const formatMs = (value) => Number.isFinite(value) ? `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ms` : 'n/a';
const formatPercent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';

const sanitizeLabel = (key) => key
    .replace(/^http_req_duration\{/, '')
    .replace(/^http_req_failed\{/, '')
    .replace(/\}$/, '')
    .replace(/,/g, ', ');

const collectMetricRows = (prefix, includeText) => Object.keys(metrics)
    .filter((key) => key.startsWith(prefix) && key.includes(includeText))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({ key, metric: metrics[key], values: metrics[key].values || metrics[key] }));

const overview = {
    iterations: getValues('iterations'),
    httpReqs: getValues('http_reqs'),
    httpReqDuration: getValues('http_req_duration'),
    httpReqFailed: getValues('http_req_failed'),
    checks: getValues('checks'),
    vusMax: getValues('vus_max'),
};

// Normalize rate/value: k6 v1.x uses .value, older uses .rate
const getRate = (obj) => obj?.rate ?? obj?.value;

const evaluateThreshold = (metricKey, thresholdExpr, metrics) => {
    const metric = metrics[metricKey];
    if (!metric) return false;
    const v = metric.values || metric;

    // Parse expressions like "rate<0.03", "p(95)<2000", "rate>0.99"
    const match = thresholdExpr.match(/^(\S+?)\s*([<>]=?)\s*([\d.]+)$/);
    if (!match) return false;

    const [, field, op, rawTarget] = match;
    const target = parseFloat(rawTarget);
    let actual = v[field];
    // k6 v1.x uses .value instead of .rate for rate metrics
    if (!Number.isFinite(actual) && field === 'rate') actual = v.value;
    if (!Number.isFinite(actual)) return false;

    switch (op) {
        case '<': return actual < target;
        case '<=': return actual <= target;
        case '>': return actual > target;
        case '>=': return actual >= target;
        default: return false;
    }
};

const thresholdRows = Object.entries(metrics)
    .flatMap(([key, metric]) => Object.entries(metric.thresholds || {}).map(([thresholdName, threshold]) => {
        const okFromExport = typeof threshold === 'object' ? threshold.ok : threshold;
        const computedOk = evaluateThreshold(key, thresholdName, metrics);
        return {
            key,
            thresholdName,
            ok: computedOk || Boolean(okFromExport),
        };
    }));

const collectChecks = (group, rows = []) => {
    if (!group || typeof group !== 'object') {
        return rows;
    }

    for (const check of toArray(group.checks)) {
        rows.push(check);
    }

    for (const childGroup of toArray(group.groups)) {
        collectChecks(childGroup, rows);
    }

    return rows;
};

const scenarioLatencyRows = collectMetricRows('http_req_duration{', 'scenario:');
const endpointLatencyRows = collectMetricRows('http_req_duration{', 'name:');
const scenarioFailureRows = collectMetricRows('http_req_failed{', 'scenario:');
const endpointFailureRows = collectMetricRows('http_req_failed{', 'name:');
const checkRows = collectChecks(data.root_group)
    .filter((check) => (check.fails || 0) > 0 || (check.passes || 0) === 0)
    .sort((left, right) => (right.fails || 0) - (left.fails || 0));

const lines = [];

lines.push('# k6 Owner Read Load Report');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push('## Overview');
lines.push('');
lines.push(`- Iterations: ${formatInt(overview.iterations?.count)}`);
lines.push(`- HTTP requests: ${formatInt(overview.httpReqs?.count)} total, ${formatNumber(overview.httpReqs?.rate)}/s`);
lines.push(`- Request failure rate: ${formatPercent(getRate(overview.httpReqFailed))}`);
lines.push(`- Checks passed: ${formatPercent(getRate(overview.checks))}`);
lines.push(`- Max VUs used: ${formatInt(overview.vusMax?.max ?? overview.vusMax?.value)}`);
lines.push(`- Global latency: avg ${formatMs(overview.httpReqDuration?.avg)}, p95 ${formatMs(overview.httpReqDuration?.['p(95)'])}, p99 ${formatMs(overview.httpReqDuration?.['p(99)'])}, max ${formatMs(overview.httpReqDuration?.max)}`);
lines.push('');

if (thresholdRows.length > 0) {
    lines.push('## Thresholds');
    lines.push('');
    for (const row of thresholdRows) {
        lines.push(`- ${row.ok ? 'PASS' : 'FAIL'} ${row.key} :: ${row.thresholdName}`);
    }
    lines.push('');
}

if (checkRows.length > 0) {
    lines.push('## Check Outcomes');
    lines.push('');
    for (const row of checkRows) {
        lines.push(`- ${row.name}: passes ${formatInt(row.passes)}, fails ${formatInt(row.fails)}`);
    }
    lines.push('');
}

if (scenarioLatencyRows.length > 0) {
    lines.push('## Scenario Latency');
    lines.push('');
    for (const row of scenarioLatencyRows) {
        lines.push(`- ${sanitizeLabel(row.key)}: avg ${formatMs(row.values.avg)}, p95 ${formatMs(row.values['p(95)'])}, p99 ${formatMs(row.values['p(99)'])}, max ${formatMs(row.values.max)}`);
    }
    lines.push('');
}

if (endpointLatencyRows.length > 0) {
    lines.push('## Endpoint Latency');
    lines.push('');
    for (const row of endpointLatencyRows) {
        lines.push(`- ${sanitizeLabel(row.key)}: avg ${formatMs(row.values.avg)}, p95 ${formatMs(row.values['p(95)'])}, p99 ${formatMs(row.values['p(99)'])}, max ${formatMs(row.values.max)}`);
    }
    lines.push('');
}

if (scenarioFailureRows.length > 0) {
    lines.push('## Scenario Failures');
    lines.push('');
    for (const row of scenarioFailureRows) {
        lines.push(`- ${sanitizeLabel(row.key)}: ${formatPercent(getRate(row.values))}`);
    }
    lines.push('');
}

if (endpointFailureRows.length > 0) {
    lines.push('## Endpoint Failures');
    lines.push('');
    for (const row of endpointFailureRows) {
        lines.push(`- ${sanitizeLabel(row.key)}: ${formatPercent(getRate(row.values))}`);
    }
    lines.push('');
}

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(outputPath);