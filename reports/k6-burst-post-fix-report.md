# k6 Owner Read Load Report

Generated: 2026-04-10T08:43:35.864Z

## Overview

- Iterations: 1,251
- HTTP requests: 4,455 total, 444.24/s
- Request failure rate: 0.00%
- Checks passed: 100.00%
- Max VUs used: 1,020
- Global latency: avg 97.71 ms, p95 491.31 ms, p99 692.36 ms, max 996.33 ms

## Thresholds

- PASS http_req_failed :: rate<0.03
- PASS http_req_duration :: p(95)<2000
- PASS http_req_duration :: p(99)<4000
- PASS http_req_duration{scenario:dashboard_boot} :: p(95)<2200
- PASS http_req_duration{scenario:members_page} :: p(95)<2500
- PASS checks :: rate>0.99

## Scenario Latency

- scenario:dashboard_boot: avg 93.88 ms, p95 471.34 ms, p99 621.2 ms, max 996.33 ms
- scenario:members_page: avg 110.13 ms, p95 587.44 ms, p99 714.34 ms, max 841.29 ms

