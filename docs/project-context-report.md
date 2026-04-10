# GymVault — Full Project Context Report
> This document is the authoritative handoff for any new AI chat session. It covers the app, the architecture, every major feature built, every significant bug fixed, established working rules, and the exact way we collaborate.

---

## 1. What the App Is

**GymVault** is a full-stack SaaS gym management application built for Indian gym owners. It is a Progressive Web App (PWA) installable on mobile and desktop.

**Live deployment:** Frontend `https://gymvault.tech` (Vercel) + Backend `https://gym-management-system-4nfu.onrender.com` (Render).  
**Database:** PostgreSQL hosted on Supabase.  
**Repo location:** `c:\Users\Surender Meena\Desktop\gym-management-system`

---

## 2. Technology Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 20.18.0 (pinned via `.node-version` and `package.json engines`) |
| Framework | Express 5 |
| Database | PostgreSQL via `pg` pool (Supabase hosted) |
| Process Manager | PM2 / `pm2-runtime` on production Render |
| Cache | Redis-compatible cache with in-memory fallback (`utils/cache.js`) |
| Auth | JWT (`jsonwebtoken`), bcrypt, Google OAuth, Apple Sign-In |
| Payments | Razorpay SDK (member collection + SaaS billing) |
| Messaging | MSG91 WhatsApp API |
| Push Notifications | Web Push (`web-push`) |
| Scheduled Jobs | Custom cron-like intervals registered in `server.js` |
| File uploads | Multer, inline storage in DB column (`profile_pic TEXT`) |
| Security | Helmet, CORS, express-rate-limit, RBAC middleware |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 19 |
| Build | Vite 7 |
| Styling | Tailwind CSS 4 with custom `desktop:` breakpoint at 1100px |
| Charts | Recharts (via `SafeResponsiveContainer`) |
| QR codes | `qrcode.react` |
| HTTP | Axios + `apiFetch` utility (never raw `fetch`) |
| Icons | `lucide-react` |
| PWA | Service worker in `frontend/public/sw.js`, manifest, maskable icons |
| Lazy loading | `lazyWithRecovery` in `frontend/src/utils/lazyWithRecovery.js` |

---

## 3. Workspace Structure

```
ecosystem.config.js        — PM2 runtime config, Render-safe process sizing
server.js                  — app entry, route registration, cron jobs
config/
  db.js                    — pool, always-run boot migrations
  init.sql                 — base schema (runs on local/dev only unless RUN_DB_INIT_ON_BOOT=true)
routes/                    — all Express routers
  auth.js, members.js, payments.js, memberships.js, plans.js,
  attendance.js, classes.js, leads.js, finance.js, settings.js,
  insights.js, dashboard.js, users.js, notifications.js,
  push.js, billing.js, exports.js, superadmin.js, support.js
middleware/
  authMiddleware.js        — JWT verify + live DB user/gym check
  memberAuthMiddleware.js  — member portal JWT
  rbac.js                  — requireOwner, requirePermission
  saasMiddleware.js        — SaaS status enforcement
jobs/
  expiryCheck.js           — daily membership expiry sweep
  notificationAutomation.js— owner/staff engagement nudges (3 slots/day)
  payrollAutoPay.js        — monthly payroll entry auto-generation
utils/
  cache.js                 — Redis/in-memory cache utility for auth + heavy read routes
  gymTime.js               — timezone-aware date helpers
  fieldValidation.js       — reusable semantic validation (ensureTrimmedString, ensureEmail, etc.)
  secretCrypto.js          — encrypt/decrypt Razorpay secrets
  profileUploads.js        — inline profile image storage
  runtimeTelemetry.js      — server event logging to system_runtime_events table
  apiFetch.js (frontend)   — origin/token-aware fetch wrapper
  lazyWithRecovery.js      — lazy chunk loader with hard-reload fallback
  clientErrorReporter.js   — sends frontend JS errors to /api/support/client-errors
scripts/
  smoke-production.js      — checks live frontend/backend deployment
  test-backend.js          — smoke test suite (self-starts server, mints owner token)
  dev-all.js               — starts backend + frontend together
  seed-bot-members.js      — seeds 50 demo members for testing
frontend/src/
  App.jsx                  — app shell, auth, routing, page keep-alive
  SettingsPage.jsx         — owner settings hub (tabs: account, staff, billing, integrations, etc.)
  DashboardPage.jsx + dashboard/ — owner dashboard
  StaffDashboard.jsx       — staff-role dashboard
  MembersPage.jsx, PaymentsPage.jsx, AttendancePage.jsx,
  ClassesPage.jsx, LeadsPage.jsx, PlansPage.jsx,
  InsightsPage.jsx, RfidSetupPage.jsx, HelpSupportPage.jsx
  SuperAdminDashboard.jsx, SuperAdminLogin.jsx
  LoginPage.jsx, SignupPage.jsx
  MemberSelfServiceHub.jsx — member portal (PWA, separate auth)
```

---

## 4. Architecture Patterns

### Page Keep-Alive
All pages in `App.jsx` are mounted once and toggled visible via `getPageVisibility()` which returns a CSS class (`hidden` / `gv-page-fade` / `''`). The `visitedPages` Set tracks which pages have ever been opened. This prevents re-mounting on every nav click and preserves scroll position.

### Auth & Permissions
- Owner users have `role = 'OWNER'` and full access.
- Staff users have `role = 'STAFF'` with a `staff_role` (MANAGER, RECEPTION, TRAINER, etc.) and explicit `permissions[]` array.
- `PAGE_PERMISSIONS` in `App.jsx` gates entire pages; `owner:only` pages (Settings, RFID Setup) never mount for staff.
- `authMiddleware.js` validates JWTs and revalidates user/gym active state against DB-backed session data using a short cache, so revoked or inactive accounts still get rejected quickly without hitting Postgres on every single request.

### SaaS Billing
- Live owner-facing catalog is driven by `platform_settings.billing_config.plan_order`.
- Current live plans are Basic, Growth, and Pro. Test Drive is an optional hidden QA plan that superadmin can remove from the live catalog.
- If Test Drive is removed from the live catalog, existing gyms can still retain `current_plan='test'` until they upgrade or expire, but owner-facing billing cards must not re-add Test Drive into the visible plan list.
- Gym `saas_status` can be `FREE_TRIAL`, `ACTIVE`, `GRACE_PERIOD`, or `EXPIRED`.
- Expired gyms are blocked by `saasMiddleware` but can always reach the Settings billing tab.
- SaaS payments go through Razorpay checkout using **platform** keys (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in `.env`).
- POS is a plan-gated capability and is currently available only on Growth and Pro.

### Member Payment Collection
Two separate Razorpay contexts exist:
1. **SaaS billing** — platform keys, owner pays GymVault.
2. **Member fee collection** — gym's own keys (manual mode: gym's key/secret stored encrypted; partner mode: Razorpay Route with `X-Razorpay-Account` header).
- Also supports direct UPI QR from `gyms.member_upi_id`.
- Payment links auto-send to member phone via Razorpay-native SMS delivery.

### Database Transactions
Any multi-step write must use a dedicated `client = await pool.connect()` with explicit `BEGIN/COMMIT/ROLLBACK`. Never use `pool.query('BEGIN')` — pooled queries can hop connections.

### Schema Migration Strategy
- `config/db.js` contains **always-run** boot migrations (safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- `config/init.sql` runs on local/dev boots or when `RUN_DB_INIT_ON_BOOT=true`.
- Any new column needed on a live environment must also be in `config/db.js` always-run block.

### Branch / Multi-Location
- Gyms can have up to 25 branches stored as JSON in `gyms.branch_directory`.
- Branch scope is resolved per request via `resolveBranchReadScope` / `resolveBranchWriteScope` helpers.
- Owner sees all; staff sees their assigned branch only.

### Global vs Gym-Scoped Changes
- If a user asks for a change to apply "globally," verify all three layers: platform settings, schema defaults, and existing-gym backfills.
- This codebase has duplicated schema/default helpers in more than one route file. A setting changed only in `routes/settings.js` may still behave differently elsewhere if `routes/memberships.js` or another route carries its own helper.
- Owner-facing billing views must respect the live billing catalog order from platform settings. If hidden current-plan metadata is needed, include it without making the hidden plan selectable again.
- Optional media should fail soft. Missing profile uploads must return a placeholder response instead of a `404`, otherwise every page that renders the avatar will spam the browser console even if the UI hides the broken image.

### Production Runtime & Read Scaling
- Production Render starts with `npm run start:render`, which uses `pm2-runtime ecosystem.config.js`.
- `ecosystem.config.js` auto-detects Render and uses a low-memory-safe single worker on the current 512 MB plan instead of aggressive cluster defaults.
- Larger Render plans can later scale with `PM2_INSTANCES`, `NODE_HEAP_MB`, and `PM2_MAX_MEMORY_MB`, but that should only happen after Redis is provisioned and headroom is available.
- `utils/cache.js` uses Redis when `REDIS_URL` exists and falls back to process-local memory when it does not.
- Current cached paths include auth session validation plus the heaviest read endpoints: dashboard stats, insights overview, finance overview, classes summary, attendance overview, and attendance summary.
- Background jobs are cluster-safe: only PM2 instance `0` should run recurring jobs when multiple workers are enabled later.
- `https://gymvault.tech` is the real app URL. `https://gym-management-system-4nfu.onrender.com` is backend/API only; `/healthz` is the primary backend validation endpoint.

---

## 5. All Major Features Built / Confirmed Working

### Core Gym Operations
| Feature | Key Files |
|---|---|
| Owner auth (email/password, Google OAuth, Apple Sign-In) | `routes/auth.js`, `LoginPage.jsx` |
| Staff auth + role-based nav | `middleware/rbac.js`, `App.jsx` |
| Member management (CRUD, bulk select, search, filters) | `routes/members.js`, `MembersPage.jsx` |
| Plan management | `routes/plans.js`, `PlansPage.jsx` |
| Membership activation with online collection | `routes/memberships.js` |
| Attendance (staff desk + member self check-in with geo) | `routes/attendance.js`, `AttendancePage.jsx` |
| RFID scaffolding (reader registry, key rotation, event log, simulator) | `routes/attendance.js`, `RfidSetupPage.jsx`, `scripts/rfid-bridge-simulator.js` |
| Classes scheduling + roster + check-in | `routes/classes.js`, `ClassesPage.jsx` |
| Leads CRM | `routes/leads.js`, `LeadsPage.jsx` |

### Payments & Finance
| Feature | Key Files |
|---|---|
| Payments list + due collection | `routes/payments.js`, `PaymentsPage.jsx` |
| Razorpay payment links (UPI QR fallback) | `routes/payments.js`, `routes/memberships.js`, `routes/member.js` |
| MSG91 WhatsApp payment link delivery | `utils/msg91.js` |
| Due reconciliation + finance overview | `routes/finance.js` |
| POS (point of sale products + sales) | `routes/finance.js` |
| Staff payroll manual entry | `routes/finance.js`, `PaymentsPage.jsx` |
| **Staff payroll auto-pay config** | `jobs/payrollAutoPay.js`, `routes/finance.js`, `PaymentsPage.jsx` |
| SaaS subscription billing via Razorpay | `routes/billing.js`, `SettingsPage.jsx` |

### Notifications & Messaging
| Feature | Key Files |
|---|---|
| In-app bell notifications | `routes/notifications.js` |
| Web push notifications (PWA) | `routes/push.js`, `frontend/public/sw.js` |
| WhatsApp bulk campaigns | `routes/notifications.js`, Settings Integrations tab |
| MSG91 WhatsApp template management + sync | `utils/msg91.js`, `routes/settings.js` |
| WhatsApp delivery tracking + webhook | `utils/whatsappDelivery.js`, `routes/settings.js` |
| Engagement automation nudges (3 slots/day) | `jobs/notificationAutomation.js` |
| Member expiry sweep | `jobs/expiryCheck.js` |

### Owner Settings Hub
Fully tabbed settings page for owners:
- **Account & Business** — profile, gym info, logo
- **Staff & Roles** — add/edit/delete staff, reset passwords, branch assign, anti-autofill handling on add form
- **Billing & Subscriptions** — plan upgrades via Razorpay, invoice generation
- **Integrations** — Razorpay (manual/partner), WhatsApp MSG91, UPI, campaign templates
- **Data & Backup** — CSV export, member CSV import
- **System Preferences** — currency, timezone
- **Interface Preferences** — dark mode only
- **Automation** — currently a coming-soon section
- **Report Settings** — currently a coming-soon section
- **Danger Zone** — account deletion

Additional current behavior:
- Bulk messaging defaults ON globally unless explicitly disabled.
- Member online collection defaults ON globally unless explicitly disabled.
- Default member collection connect mode is `PARTNER` (Route-style flow), not `MANUAL`.
- Peak analysis defaults to `7D` in dashboard analytics flows.

### Superadmin Panel
- Separate login (`/superadmin`)
- View all gyms, users, runtime telemetry
- System settings: notification automation controls, SaaS config, support profile
- Suspend/activate gyms

### Member Self-Service Portal
- Separate PWA-style member login
- View membership status, attendance history
- Self check-in with GPS
- Pay dues / renew membership via Razorpay or UPI QR
- Class bookings

### Analytics & Insights
- Dashboard with KPIs, revenue charts, expiring members, proactive recommendations
- Insights page with revenue trends, attendance analytics, retention metrics — all server-side aggregated
- Staff dashboard with compact view of relevant metrics

### Developer / Ops Tooling
- `npm run smoke:backend` — full authenticated backend smoke test suite
- `npm run smoke:production` — live frontend/backend production validation
- `npm run dev:all` — starts backend + frontend together
- `npm run seed:bot-members` / `npm run clean:bot-members` — demo data
- `scripts/rfid-bridge-simulator.js` — RFID hardware simulator
- `scripts/k6-full-load-test.js` — comprehensive 8-scenario backend load test
- Runtime telemetry stored in `system_runtime_events` table, viewable in superadmin

---

## 6. Major Bugs Fixed (Chronological)

### Batch 1 (Earlier sessions)
- Attendance refresh bug (stale state after check-in)
- Members page search/email overflow on mobile
- Dashboard blank page on return from another page
- Check-in speed (debounce + optimistic UI)
- Profile icon auto-opening issue
- Logo cut off on mobile nav

### Razorpay Payment Flow Fix
**Problem:** "Failed to verify Razorpay collection status" toast firing repeatedly right after link sent; payment links not appearing in Razorpay dashboard; all payment modes broken.

**Root cause:** 
1. Frontend was polling stale/expired/terminal payment links indefinitely.
2. Backend was not handling missing/cancelled links gracefully and threw instead of returning a safe state.
3. Server `.env` contains **test-mode** Razorpay keys (`rzp_test_...`). Partner-mode live payment links created with test keys do not appear in the live merchant dashboard.

**Fix applied (commit `29eb3a5`):**
- Added `TERMINAL_RAZORPAY_LINK_STATUSES` constants; poll only stops/continues based on link reusability.
- Backend safe-fetch helpers: `fetchCollectionPaymentLinkSafely`, `serializeCollectionPaymentLink`, `resolveCollectionRazorpayConfig`.
- All three collection paths (`routes/payments.js`, `routes/memberships.js`, `routes/member.js`) now return `NOT_FOUND` instead of throwing on stale links.
- Frontend (`useDashboardPageController.js`, `MemberSelfServiceHub.jsx`, `DashboardPageModals.jsx`) syncs latest link state before polling, stops on terminal states, warns when link environment is TEST.

### Settings Page Blank
**Problem:** Settings page appeared blank / wouldn't open.  
**Status:** Resolved without code change — confirmed to be a transient navigation/cache state, not a persistent bug. The `defaultTab='menu'` sentinel in `App.jsx` is intentional for mobile phone navigation (shows tab list first). On desktop (`md:` and above) content is always visible.

### Payroll Auto-Pay Feature (commit `50efbaa`)
Full-stack feature added:
- `payroll_auto_config` table in DB
- `GET/PUT /api/finance/payroll/auto-config` endpoints
- `jobs/payrollAutoPay.js` cron (runs every 6 hours, generates monthly entries on pay day)
- Frontend auto-pay setup modal + active config pills in PaymentsPage

### Permanent Route Member Collection Rule (commits `44f35f2`, `8ad7808`)
**Production finding:** partner-mode member collection must stay on the platform-owned Razorpay Payment Link plus Route transfer flow.

**Permanent rule:**
- Keep member payment links on the platform merchant and send funds to the connected gym owner account through Route order transfers.
- Do **not** switch partner-mode member collection back to direct connected-account Payment Links using `X-Razorpay-Account`.
- That direct connected-account link path regressed in production, stopped behaving like the working Apr 4 setup, and broke new member link storage/checkout.
- SaaS billing is separate and continues to use the platform Razorpay checkout flow.

### Payroll-Only Payout Rule
**Permanent rule:** payroll payout setup and staff payout destinations must live only inside the Payroll tab.

- Keep gym-owner payroll preferences and staff payout destinations on the payroll page. Do not move payroll payout setup into Settings.
- Payroll online payout uses a payroll-only UPI intent / QR flow launched from the Payroll tab, then the owner explicitly confirms the salary payout back in the app.
- Staff bank details stay on the payroll page as a separate fallback for manual bank transfer records.
- After the owner saves payroll-wide payout setup once, keep that editor hidden until they explicitly choose to edit it again; let the staff destination section take the full row by default.
- Removing a staff payout destination must delete the saved destination record and clear stored destination labels from payroll history for that staff member.
- Payroll payout must remain separate from member collection Route flows and separate from GymVault billing Razorpay checkout.
- Do not reuse member payment helpers, connected accounts, or billing credentials for salary payouts.
- For manual bank transfer fallback, keep requiring a transfer reference before marking payroll as paid.

### Branch Scope + Billing Catalog + Phase 4 Sweep (commits `63acf22`, `0ded2e7`, `e98b424`, `b2644bb`, `df374a8`)
This chat covered a large multi-step cleanup and feature pass beyond the older fixes above.

**Key outcomes:**
- Branch-aware operations were pushed through the owner app so data and actions follow the active branch instead of leaking across the gym.
- Superadmin billing catalog editing was extended so Test Drive can be removed from the live catalog.
- The dashboard Need Attention panel was kept populated instead of collapsing into obvious empty space.
- A full Phase 4 cleanup pass was completed across settings, analytics defaults, staff management, and POS gating.

**Important implementation details from this batch:**
- `b2644bb` introduced the per-branch system with owner branch switchers, branch-aware dashboard/leads behavior, and per-branch billing copy.
- `df374a8` completed the main Phase 4 request set:
  - added fallback action rows to keep the dashboard action panel filled,
  - removed the Security page,
  - reduced Interface Preferences to dark mode only,
  - changed Staff & Roles from activate/deactivate to delete,
  - added anti-autofill protection to the staff add form,
  - forced peak analysis defaults to `7D`,
  - enabled bulk messaging by default,
  - enabled member online collection by default,
  - changed default member collection connect mode to `PARTNER`,
  - enforced POS access on Growth and Pro only in both frontend and backend.
- The global-default fix was not just UI-level. It required schema-default and backfill changes in both `routes/settings.js` and `routes/memberships.js`, plus member-facing fallback alignment in `routes/member.js`.

### Hidden Test Plan Rendering on Existing Test Gyms
**Problem:** superadmin could remove Test Drive from the live billing catalog, but an owner account still on Test Drive continued to see it in Settings.

**Root cause:** the owner settings billing screen was prepending the gym's current hidden plan back into the visible billing carousel, which effectively bypassed the live catalog removal.

**Fix:**
- `serializeBillingConfig()` now supports including current-plan metadata without re-adding hidden plans to `plan_order`.
- `routes/settings.js` now sends the live visible order plus hidden current-plan metadata only when needed.
- `frontend/src/SettingsPage.jsx` no longer reinserts a hidden current plan into the visible plan cards.

**Rule going forward:** removing a plan in superadmin should hide it globally from owner-facing upgrade choices. Existing gyms may retain that plan internally as current billing state, but the hidden plan must not become selectable again because of frontend convenience logic.

### Missing Profile Image Console Errors
**Problem:** several pages were logging repeated `GET /uploads/profiles/... 404` errors in DevTools.

**Root cause:** old or deleted profile image filenames remained in the database. Frontend `onError` handlers hid the broken image visually, but the browser had already logged the failed network request.

**Fix:**
- `server.js` now serves a placeholder SVG for missing profile uploads under `/uploads/profiles/*` when the requested extension is a valid profile-image type.
- This keeps the response as a valid image `200` instead of a `404`, so optional missing avatars stop polluting the console across Payments, Dashboard, Members, Insights, Classes, and member-facing views.

**Rule going forward:** if optional media is referenced from many pages, fix missing-file behavior at the server boundary instead of relying only on per-component `img onError` handlers.

### Final Follow-Up in This Chat (commit `2c3949a`)
This was the last completed code batch in the conversation.

**What it finalized:**
- fixed the hidden Test Drive visibility bug globally for owner Settings billing cards,
- fixed the repeated avatar/profile image console errors by serving a placeholder image response,
- refreshed the project handoff report so the next chat inherits the real current repo state instead of an older partial summary.

**Important nuance captured here:**
- hidden current-plan metadata can exist in API payloads without making the plan visible/selectable again,
- browser DevTools can still show the PWA install-banner informational line from `beforeinstallprompt`; that is not the same class of problem as app-originated `404`/runtime errors.

---

## 7. Working Rules & Conventions

### How We Collaborate
1. **No design/layout changes unless explicitly asked.** Fix logic, don't redesign UI.
2. **Commit and push automatically** after completing any feature or fix — no need to ask for confirmation.
3. **For Razorpay/payment work**: prefer Razorpay-native messaging delivery; do not add Twilio unless explicitly requested.
4. **Implementation discipline**: don't add features beyond what was asked, don't add docstrings to unchanged code, don't add error handling for scenarios that can't happen.
5. **For Route member collections**: always keep the platform Payment Link + Route transfer flow. Never switch partner-mode member collections back to direct connected-account Payment Links unless explicitly re-validated in production.
6. **If the user says a change should apply globally**, audit platform settings, schema defaults, and existing-row backfills. Do not stop at one route or one gym.
7. **If a plan is hidden in superadmin**, owner-facing pages must obey `billing_config.plan_order`. Hidden current-plan metadata is allowed, hidden plan cards are not.
8. **Optional media must not create browser console errors.** Missing avatar/profile assets should resolve to a fallback response, not a hard `404`.
9. **When removing a setting from UI**, also neutralize its persisted/runtime effect so old saved values cannot keep changing behavior behind the scenes.
10. **When updating the handoff report**, re-read the latest git log and the current report first; do not rely on memory of earlier batches.

### Validation Before Every Commit
```bash
npm --prefix frontend run build          # must pass with no errors
node --check server.js                   # syntax-check app entry when touched
node --check routes/[changed].js         # syntax-check changed backend files
node --check utils/[changed].js          # syntax-check changed shared backend utilities
```

### Security Rules We Follow
- All multi-step DB writes use dedicated pool client + BEGIN/COMMIT/ROLLBACK.
- Auth middleware revalidates DB-backed user/gym state through a short-lived cache, which preserves near-immediate invalidation without forcing a Postgres lookup on every request.
- All inputs go through `utils/fieldValidation.js` helpers at route boundaries.
- Rate limiting on all public routes; tighter limits on push subscribe.
- Exports capped by `EXPORT_ROW_LIMIT` and `EXPORTS_HOUR_LIMIT`.
- Encrypted Razorpay secrets via `utils/secretCrypto.js`.
- Never use raw `fetch()` in frontend — always `apiFetch` or axios with `x-auth-token`.
- Gym hard deletes blocked at DB level via trigger.

### Critical Environment Facts
- **`.env` Razorpay server keys are TEST-MODE** (`RAZORPAY_KEY_ID=rzp_test_...`). This means:
  - SaaS billing Razorpay checkout is in test mode.
  - If no live gym-level keys are saved in Settings, member collection links will be test-mode links.
  - Test-mode links do not appear in the Razorpay live merchant dashboard.
- Node version pinned to **20.18.0** (Render was defaulting to 22 and crashing).
- Production Render must keep using `npm run start:render` on the current 512 MB plan.
- Current Render-safe environment sizing for the live backend is conservative: `DB_POOL_MAX=25`, `DB_POOL_MIN=5`, single PM2 worker, reduced heap.
- The current Supabase pooled connection settings on Render are working; do not casually swap pooler mode/host/port on a live deploy without a specific reason.
- `REDIS_URL` is still the next important infra addition before enabling multi-worker scaling or expecting more burst tolerance.
- `RUN_DB_INIT_ON_BOOT=true` is required for `init.sql` to run on production; otherwise only `db.js` always-run migrations execute.

### Tailwind Breakpoints
| Breakpoint | Width |
|---|---|
| `sm:` | 640px |
| `md:` | 768px |
| `lg:` | 1024px |
| `desktop:` (custom) | 1100px |
| `xl:` | 1280px |

The app sidebar is visible only at `desktop:` (1100px+). Below that, mobile bottom nav + "More" menu is used.

### Frontend Patterns
- **Never** use `window.location` for internal navigation — always use `navigateTo()` or `handleSidebarNav()` from `App.jsx`.
- **Never** use raw `fetch()` — use `apiFetch` or `axios` with token header.
- Page containers use CSS `hidden` / `gv-page-fade` visibility, not unmounting.
- Charts must use `SafeResponsiveContainer` to avoid zero-size mount errors.
- Service worker only caches stable icon assets; JS chunks are always fetched fresh (`no-store`).
- Lazy-loaded pages use `lazyWithRecovery` which does a one-time hard reload on chunk load failure.

---

## 8. Recent Commits (Most Recent First)

| Commit | Description |
|---|---|
| `3488844` | Update production readiness with April 10 deployment status |
| `4f5ed9c` | Make Render PM2 config safe for 512 MB instances |
| `17f86e1` | Add Render PM2 runtime start script |
| `a4078bb` | Production capacity upgrade: PM2, Redis-compatible caching, pool tuning |
| `f51c82f` | Comprehensive k6 load test (34K requests, 265 VUs, 10 min) |
| `a9d92cf` | Security hardening and load test infrastructure |
| `2c9d5e7` | Refresh project context handoff report |
| `2c3949a` | Fix hidden test plan visibility and avatar fallbacks |
| `df374a8` | Complete phase 4 settings and POS updates |
| `b2644bb` | Add per-branch system with owner branch switcher and data isolation |
| `e98b424` | Support deleting Test Drive from the live billing catalog |
| `0ded2e7` | Keep dashboard attention panel populated |
| `6889145` | Improve leads list readability |

---

## 9. Known Constraints & Future Work

| Area | Status |
|---|---|
| True auto check-in (RFID/BLE) | Scaffolded — hardware wiring pending |
| WhatsApp templates | Must be MSG91-approved before live sending works |
| Razorpay partner mode | Needs live server keys; test keys create invisible links |
| Hidden Test Drive plan | Existing gyms may still retain `current_plan='test'`, but owner-facing upgrade cards must follow live `plan_order` and hide Test Drive if superadmin removed it |
| Profile uploads | Old DB filenames may point to deleted files; `/uploads/profiles/*` now falls back to a placeholder image and should never be reverted to raw `404` behavior |
| PWA install-banner warning | Chrome may log a `beforeinstallprompt` banner/information line when the app stores the install event for the custom Add to Screen flow; do not confuse this browser message with an app request failure |
| Dark mode | Defaults ON; Interface Preferences now only exposes dark mode |
| Automation tab in Settings | Marked "coming soon" in UI |
| Report Settings tab in Settings | Marked "coming soon" in UI |
| Multi-branch isolation | Branch scope helpers in place; UI for branch switching exists for owners |
| Current Render backend plan | 512 MB plan is launch-usable but has limited burst headroom; do not assume it is the final scaling shape |
| Redis on production | Cache currently works with in-memory fallback, but shared Redis is still recommended before broader scale-up |
| Heavy stress tests on production | Do not run large k6 stress tests against the tiny live production box |
| Frontend vs backend URLs | `gymvault.tech` is the app UI; `onrender.com` is API/health only |
| `RUN_DB_INIT_ON_BOOT` on Render | Must be `true` for new schema additions to apply on deploy |

---

## 10. How to Continue Working

When starting a new session, tell the AI:
- This report is the full project context.
- The working rules in Section 7 apply always.
- Commit automatically after completing any fix or feature.
- Do not change design/layout unless explicitly asked.
- Run `npm --prefix frontend run build` before every commit.
- If touching backend routes or shared backend utilities, run `node --check` on the changed files.
- After any production deploy, run `npm run smoke:production` and verify `/healthz` on the live backend.
- Treat `https://gymvault.tech` as the app URL and the Render URL as backend/API only.
- On the current 512 MB Render plan, keep the conservative runtime path (`npm run start:render`, `DB_POOL_MAX=25`, `DB_POOL_MIN=5`) unless the infra plan changes.
- Add `REDIS_URL` before enabling multi-worker scaling or expecting comfortable burst tolerance.
- If a user says something should apply globally, inspect both platform settings and every duplicated schema/default helper before assuming the fix is complete.

For urgent issues, always check:
1. `system_runtime_events` table for server-side errors.
2. Browser DevTools console for client-side errors (also sent to `/api/support/client-errors`).
3. Razorpay dashboard mode mismatch (test vs live keys).
4. `config/db.js` always-run migrations for any new schema needed on live.
5. `platform_settings.billing_config.plan_order` if a plan appears or disappears incorrectly in owner-facing billing.
6. `/uploads/profiles/*` network responses if profile-image console errors reappear; the expected behavior is a real image or the placeholder SVG, never a hard `404`.
7. Separate true app errors from the Chrome PWA install-banner info line before assuming a console issue still needs code changes.
8. Render metrics: memory, CPU, restart count, and response time.
9. Supabase observability: database connections and shared pooler client connections.
10. Live backend `/healthz` plus `npm run smoke:production` after deploys.

---

## 11. Full Handoff From This Chat

This section is the detailed continuation record for the next AI session. It summarizes what was investigated, what was changed, why the decisions were made, and the collaboration rules that were reinforced during this chat.

### A. Starting Point for This Chat
- The repo already had the broader gym-management stack described above.
- Earlier work in this same chat had already started improving dashboard behavior, billing catalog control, and branch support.
- Before the final follow-up, the most recent completed commits in this chat were:
  - `63acf22` for a mixed stability/UX batch,
  - `0ded2e7` for dashboard attention-panel backfill,
  - `e98b424` for Test Drive deletion support in the billing catalog,
  - `b2644bb` for the per-branch system,
  - `df374a8` for the main Phase 4 settings/POS/defaults sweep.
- The final follow-up commit in this chat was `2c3949a`.

### B. Major Themes of This Chat
- Make branch behavior real across the app instead of superficial.
- Make superadmin billing-catalog changes actually propagate to owner-facing pages.
- Make requested defaults truly app-wide instead of only affecting one gym or only new rows.
- Remove noisy browser-console errors caused by stale optional media.
- Keep commits flowing automatically after a completed batch.

### C. Branch / Multi-Location Work Completed Earlier in This Chat
- A per-branch system was implemented so owners can switch operational scope instead of seeing one blended gym-wide view everywhere.
- Branch-aware behavior was carried into dashboard, leads, and billing-related owner flows.
- Branch-specific billing copy and owner switchers were added so the active scope is obvious.
- The core rule established here is: owner can see all branches, staff stays locked to assigned branch, and read/write scope must go through the branch helpers rather than page-local filtering.

### D. Billing Catalog / Test Drive Work Completed Earlier in This Chat
- Superadmin billing catalog editing was improved.
- Test Drive became removable from the live catalog.
- The rule established from that work: Basic, Growth, and Pro are the stable live plans; Test Drive is optional QA catalog state controlled from superadmin.

### E. Phase 4 Batch Completed in This Chat (`df374a8`)
The following user-requested items were completed as one coordinated batch:

1. Dashboard action spacing
- The dashboard Need Attention / action section had visible empty space compared with the Desk Pulse panel.
- Fallback operational recommendation rows were added so the section stays visually filled instead of collapsing after only a few rows.

2. Staff add-form autofill cleanup
- Browser autofill was putting email/password values into the Staff & Roles add form by default.
- Anti-autofill trap inputs and explicit autocomplete handling were added so the form opens blank.

3. Delete staff instead of activate/deactivate
- Frontend action changed from activate/deactivate to delete.
- Backend owner-only delete endpoint was added in `routes/users.js`.
- Delete rejects invalid IDs, blocks deleting the owner account, and returns a conflict if protected foreign-key references still exist.

4. Global defaults instead of one-gym behavior
- Bulk messaging default was made globally ON.
- Member online collection default was made globally ON.
- Member collection connect mode default was switched to `PARTNER` globally.
- These were implemented as schema-default and existing-row backfill changes, not just UI defaults.
- Duplicate helpers in both `routes/settings.js` and `routes/memberships.js` were updated so the behavior is actually consistent app-wide.

5. Settings cleanup
- Security tab/page was removed from owner Settings.
- Reduce Motion and Compact Layout were removed from Interface Preferences.
- Runtime normalization now forces those removed interface settings off, so old saved values cannot keep affecting the app.
- Dark mode remains the only interface toggle.

6. Peak-analysis default
- Peak analysis default range was changed from `today` to `7D` in both Insights and Attendance.

7. POS plan gating
- POS access is now limited to Growth and Pro only.
- Backend gating was added in `routes/finance.js`.
- Frontend gating was added in `frontend/src/PaymentsPage.jsx`.
- Auth payloads were updated to expose `saas_plan` on the current user so frontend gating has the right plan state immediately.

### F. Final Follow-Up Completed in This Chat (`2c3949a`)
This follow-up addressed the remaining issues after `df374a8` and closed the chat with the final report refresh:

1. Hidden Test Drive still appearing on a gym currently on Test Drive
- Root cause: the owner settings billing page was prepending the current hidden plan back into the visible card list.
- Fix: owner-facing billing now respects the live `plan_order` globally, while the settings API can still include current-plan metadata when the current plan is hidden.
- Result: a gym still on Test Drive can keep its billing state internally, but Test Drive no longer appears as a visible upgrade/renewal card after superadmin removes it from the live catalog.

2. Browser console errors from missing profile-image files
- Root cause: old DB rows referenced profile filenames that no longer exist under `/uploads/profiles`.
- Frontend `img onError` handlers hid the broken image visually but could not stop network `404` errors from appearing in DevTools.
- Fix: the server now returns a placeholder SVG for missing valid profile-image requests under `/uploads/profiles/*`.
- Result: profile-image failures degrade cleanly without polluting the console across the app.

3. Handoff/report accuracy
- The authoritative report was refreshed again after the final commit so the next chat sees the actual latest commit history, the final hidden-plan/avatar fixes, and the working rules reinforced during this conversation.

### G. Validation Done During This Chat
- Frontend production build was run repeatedly with `npm --prefix frontend run build` and passed after the major batches.
- Backend syntax checks were run with `node --check` on touched files such as `server.js`, `routes/settings.js`, `routes/memberships.js`, `routes/member.js`, `routes/users.js`, `routes/finance.js`, `routes/auth.js`, and `utils/platformSettings.js`.
- A serializer sanity check confirmed the intended behavior for hidden Test Drive:
  - visible `plan_order` excludes `test`,
  - serialized `plans` can still include `test` metadata when the current gym is on that plan.
- The final follow-up commit was created and pushed after those validations.

### H. Collaboration Style Reinforced in This Chat
- The user expects completed fixes, not partial analysis.
- Commits and pushes should happen automatically after a finished batch.
- Layout changes should be avoided unless specifically requested.
- When the user says something must apply globally, the fix must be audited for platform scope, schema defaults, existing-gym backfills, and duplicate helper logic.
- Console noise matters. Optional broken media should be fixed at the source, not treated as acceptable because the UI visually falls back.
- The handoff report itself is part of the deliverable when a long multi-step chat is ending; it should be updated from the repo state, not left stale.

### I. Recurring Errors / Pitfalls Future Chats Must Remember
- **Hidden-plan reappearance bug:** do not reinsert hidden current plans into owner-facing billing card order.
- **Duplicated default helpers:** check both `routes/settings.js` and `routes/memberships.js` for member-payment-related defaults.
- **Profile-image 404 spam:** missing uploads must never return hard `404`s to the frontend when the asset is optional.
- **PWA install-banner DevTools line:** Chrome may show the `beforeinstallprompt` informational warning when the custom install flow stores the event; do not misclassify that as a failed app request.
- **Razorpay test-vs-live mismatch:** invisible payment links in dashboard issues often come from test-mode server keys.
- **Owner-facing billing visibility bugs:** inspect `platform_settings.billing_config`, then `/api/settings`, then `SettingsPage.jsx` visible plan ordering logic.

---

## 12. April 10, 2026 Deployment, Load Test, and Upgrade Triggers

This section captures everything completed on April 10, 2026 so a new chat can pick up from the exact current production state.

### What Was Done Today

1. Ran a comprehensive backend load test locally with k6 across 8 scenarios and 45+ endpoints.
2. Confirmed the backend survived a 10-minute run at 34K+ requests and 265 VUs without crashing, which showed the main issue was capacity headroom and DB pressure rather than a single fatal code bug.
3. Added a Redis-compatible cache utility with in-memory fallback in `utils/cache.js`.
4. Cached auth session validation to cut repeated Postgres lookups on authenticated traffic.
5. Cached the heaviest read endpoints: dashboard stats, insights overview, finance overview, classes summary, attendance overview, and attendance summary.
6. Added PM2 ecosystem support in `ecosystem.config.js`.
7. Added Render-safe startup support with `npm run start:render` using `pm2-runtime`.
8. Made background jobs safe for future multi-worker operation by limiting timer execution to the intended PM2 instance.
9. Fixed a production deployment failure caused by over-aggressive PM2 defaults on a 512 MB Render plan by switching Render to a safe single-worker low-heap configuration.
10. Deployed the backend successfully to Render and confirmed the backend `/healthz` endpoint returns `status=ok` and `database=reachable`.
11. Confirmed `https://gymvault.tech` correctly rewrites `/api/*` calls to the Render backend.
12. Ran the live production smoke suite successfully: 8 passed, 0 warnings, 0 failures.
13. Manually verified that pages were opening and no page-level breakage was reported after deploy.
14. Updated the readiness and handoff documentation so future chats inherit the real current state.

### Current Live Launch Posture

- Backend URL: `https://gym-management-system-4nfu.onrender.com`
- Frontend URL: `https://gymvault.tech`
- Current backend plan: Render 512 MB instance
- Current runtime mode: PM2-managed single worker in `fork` mode
- Current live guidance: suitable for a controlled launch with roughly 20-25 gyms of 500-600 members each under normal day-to-day usage
- Important limitation: current deployment should not be described as unlimited or spike-proof; it still has limited burst headroom until Redis is provisioned and/or the Render plan is increased

### Safety Checks To Keep In Mind

#### Green: Safe To Keep Current Plan
- Render memory usually stays below `75%`
- Render CPU usually stays below `70%`
- No restart events appear in Render
- App pages feel normal, especially Dashboard, Finance, Insights, Members, and Attendance
- Backend `/healthz` remains healthy
- `npm run smoke:production` passes
- Supabase connection graphs stay stable without long sustained spikes

#### Yellow: Watch Closely / Plan Upgrade Soon
- Render memory often stays above `85%`
- Render CPU often stays above `85%`
- Response times start feeling slow on heavy pages
- Dashboard or insights starts taking noticeably longer to load
- Supabase database connections stay high for long periods during ordinary usage
- Users report intermittent slowness even though the app still works

#### Red: Upgrade Immediately
- Render shows out-of-memory events or restarts
- Backend `/healthz` fails or becomes intermittent
- Requests start timing out or users see broken/blank pages
- Render logs show repeated pool/connection errors, unhandled exceptions, or startup failures
- Supabase connection behavior becomes unstable during normal traffic

### What To Check Every Time After Deploying

1. Open `https://gym-management-system-4nfu.onrender.com/healthz`
2. Run:

```bash
npm run smoke:production
```

3. Open `https://gymvault.tech`
4. Click Dashboard, Members, Attendance, Payments, Finance, and Insights
5. Keep Render logs open while clicking through those pages
6. Review Render metrics: memory, CPU, response time, restart count
7. Review Supabase observability: database connections and pooler client connections

### When To Upgrade The Render Plan

Upgrade the backend plan if any one of these becomes normal:

1. Memory pressure is consistently high
2. Restarts happen more than once
3. Heavy pages feel slow during normal business hours
4. More owner/staff users are actively using the system at the same time than the current box can comfortably absorb
5. You want real burst headroom instead of just “it works”

### What To Do Before Multi-Worker Scaling

1. Add `REDIS_URL`
2. Recheck Render memory headroom on the upgraded plan
3. Revisit `DB_POOL_MAX`, `DB_POOL_MIN`, `PM2_INSTANCES`, and `NODE_HEAP_MB`
4. Only then consider more than one worker on Render

### Permanent Deployment Reminders

1. `gymvault.tech` is the real app. Do not treat the Render root URL as the user-facing app UI.
2. Keep using `npm run start:render` on the current production setup.
3. Do not run the large k6 stress suite on the tiny live production box.
4. If any secret or password is exposed in screenshots/chat/logs, rotate it immediately.
5. If a future deploy changes infra behavior, verify both Render logs and Supabase observability before assuming the code is at fault.
