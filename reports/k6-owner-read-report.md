# k6 Owner Read Load Report

Generated: 2026-04-10T11:44:22.215Z

## Overview

- Iterations: 43,739
- HTTP requests: 1,39,916 total, 291.48/s
- Request failure rate: 94.85%
- Checks passed: 51.32%
- Max VUs used: 160
- Global latency: avg 1.67 ms, p95 4.25 ms, p99 6.55 ms, max 24.06 ms

## Thresholds

- PASS http_req_duration :: p(99)<4000
- PASS http_req_duration :: p(95)<2000
- PASS http_req_duration{scenario:members_page} :: p(95)<2500
- PASS http_req_duration{scenario:dashboard_boot} :: p(95)<2200
- FAIL http_req_failed :: rate<0.03
- FAIL checks :: rate>0.99

## Check Outcomes

- auth_me status is 200: passes 0, fails 23,099
- dashboard_stats status is 200: passes 0, fails 23,099
- dashboard_setup_status status is 200: passes 0, fails 23,099
- notifications_list status is 200: passes 0, fails 23,099
- auth_me_members status is 200: passes 0, fails 13,439
- members_list status is 200: passes 0, fails 13,439
- members_summary status is 200: passes 0, fails 13,439
- setup auth works: passes 0, fails 1

## Scenario Latency

- scenario:dashboard_boot: avg 1.71 ms, p95 4.32 ms, p99 6.45 ms, max 24.06 ms
- scenario:members_page: avg 1.46 ms, p95 3.78 ms, p99 6.15 ms, max 17 ms

