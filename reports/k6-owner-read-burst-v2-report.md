# k6 Owner Read Load Report

Generated: 2026-04-10T07:59:37.623Z

## Overview

- Iterations: 1,252
- HTTP requests: 4,459 total, 403.67/s
- Request failure rate: 0.00%
- Checks passed: 100.00%
- Max VUs used: 1,020
- Global latency: avg 470.63 ms, p95 883.98 ms, p99 1,109.57 ms, max 1,306.25 ms

## Thresholds

- PASS http_req_failed :: rate<0.03
- PASS http_req_duration{scenario:members_page} :: p(95)<2500
- PASS checks :: rate>0.99
- PASS http_req_duration :: p(95)<2000
- PASS http_req_duration :: p(99)<4000
- PASS http_req_duration{scenario:dashboard_boot} :: p(95)<2200

## Scenario Latency

- scenario:dashboard_boot: avg 452.64 ms, p95 840.5 ms, p99 1,024.02 ms, max 1,095.64 ms
- scenario:members_page: avg 531.79 ms, p95 1,044.85 ms, p99 1,258.14 ms, max 1,306.25 ms

