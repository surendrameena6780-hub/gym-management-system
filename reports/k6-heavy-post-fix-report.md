# k6 Owner Read Load Report

Generated: 2026-04-10T08:43:43.117Z

## Overview

- Iterations: 43,739
- HTTP requests: 1,39,916 total, 291.48/s
- Request failure rate: 90.85%
- Checks passed: 53.37%
- Max VUs used: 160
- Global latency: avg 1.36 ms, p95 3.52 ms, p99 8.28 ms, max 101.53 ms

## Thresholds

- PASS checks :: rate>0.99
- PASS http_req_duration :: p(95)<2000
- PASS http_req_duration :: p(99)<4000
- PASS http_req_failed :: rate<0.03
- PASS http_req_duration{scenario:members_page} :: p(95)<2500
- PASS http_req_duration{scenario:dashboard_boot} :: p(95)<2200

## Check Outcomes

- dashboard_setup_status status is 200: passes 973, fails 22,126
- notifications_list status is 200: passes 973, fails 22,126
- auth_me status is 200: passes 974, fails 22,125
- dashboard_stats status is 200: passes 974, fails 22,125
- auth_me_members status is 200: passes 567, fails 12,872
- members_list status is 200: passes 567, fails 12,872
- members_summary status is 200: passes 567, fails 12,872

## Scenario Latency

- scenario:dashboard_boot: avg 1.37 ms, p95 3.62 ms, p99 7.58 ms, max 75.12 ms
- scenario:members_page: avg 1.29 ms, p95 3.18 ms, p99 10.73 ms, max 101.53 ms

