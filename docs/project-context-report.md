# GymVault — Full Project Context Report
> This document is the authoritative handoff for any new AI chat session. It covers the app, the architecture, every major feature built, every significant bug fixed, established working rules, and the exact way we collaborate.

---

## 1. What the App Is

**GymVault** is a full-stack SaaS gym management application built for Indian gym owners. It is a Progressive Web App (PWA) installable on mobile and desktop.

**Live deployment:** Render (backend) + Vercel (frontend).  
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
  gymTime.js               — timezone-aware date helpers
  fieldValidation.js       — reusable semantic validation (ensureTrimmedString, ensureEmail, etc.)
  secretCrypto.js          — encrypt/decrypt Razorpay secrets
  profileUploads.js        — inline profile image storage
  runtimeTelemetry.js      — server event logging to system_runtime_events table
  apiFetch.js (frontend)   — origin/token-aware fetch wrapper
  lazyWithRecovery.js      — lazy chunk loader with hard-reload fallback
  clientErrorReporter.js   — sends frontend JS errors to /api/support/client-errors
scripts/
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
- `authMiddleware.js` re-queries the DB on every request to reject revoked/inactive accounts even on valid JWTs.

### SaaS Billing
- Plans: Test Drive (₹1), Basic (₹999/mo), Pro Vault (₹1999/mo), Elite (₹3999/mo).
- Gym `saas_status` can be `FREE_TRIAL`, `ACTIVE`, `GRACE_PERIOD`, or `EXPIRED`.
- Expired gyms are blocked by `saasMiddleware` but can always reach the Settings billing tab.
- SaaS payments go through Razorpay checkout using **platform** keys (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in `.env`).

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
- **Staff & Roles** — add/edit/deactivate staff, reset passwords, branch assign
- **Billing & Subscriptions** — plan upgrades via Razorpay, invoice generation
- **Integrations** — Razorpay (manual/partner), WhatsApp MSG91, UPI, campaign templates
- **Data & Backup** — CSV export, member CSV import
- **Security** — password change, 2FA placeholder
- **System Preferences** — currency, timezone
- **Interface Preferences** — dark mode, compact mode, reduced motion
- **Platform** — branches, API keys, webhooks, WhatsApp delivery logs
- **Danger Zone** — account deletion

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
- `npm run dev:all` — starts backend + frontend together
- `npm run seed:bot-members` / `npm run clean:bot-members` — demo data
- `scripts/rfid-bridge-simulator.js` — RFID hardware simulator
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

---

## 7. Working Rules & Conventions

### How We Collaborate
1. **No design/layout changes unless explicitly asked.** Fix logic, don't redesign UI.
2. **Commit and push automatically** after completing any feature or fix — no need to ask for confirmation.
3. **For Razorpay/payment work**: prefer Razorpay-native messaging delivery; do not add Twilio unless explicitly requested.
4. **Implementation discipline**: don't add features beyond what was asked, don't add docstrings to unchanged code, don't add error handling for scenarios that can't happen.
5. **For Route member collections**: always keep the platform Payment Link + Route transfer flow. Never switch partner-mode member collections back to direct connected-account Payment Links unless explicitly re-validated in production.

### Validation Before Every Commit
```bash
npm --prefix frontend run build          # must pass with no errors
node -e "require('./routes/[changed].js')"  # catch module-load errors
```

### Security Rules We Follow
- All multi-step DB writes use dedicated pool client + BEGIN/COMMIT/ROLLBACK.
- Auth middleware re-checks DB on every request (invalidates stale JWTs immediately).
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
| `8ad7808` | Document permanent Route transfer partner flow |
| `44f35f2` | Restore Route transfer flow for partner payment links |
| `29eb3a5` | Fix Razorpay link verification and stale-link handling |
| `50efbaa` | Fix 10 UX issues + payroll auto-pay feature |
| `39b9fb7` | Implement branch scoped operations across key workflows |
| `c35d88a` | Complete branch payroll flows and member mobile fixes |
| `fb404ac` | Close deep-scan security and live test gaps |
| `27a5a1c` | Improve settings smoke coverage and accessibility |
| `fa3e812` | Harden frontend runtime guardrails |
| `2492595` | Add superadmin telemetry and paginate heavy views |
| `81f9d89` | Fix cross-device stale chunk crashes |
| `fddef0d` | Persist mobile auth sessions across restarts |

---

## 9. Known Constraints & Future Work

| Area | Status |
|---|---|
| True auto check-in (RFID/BLE) | Scaffolded — hardware wiring pending |
| WhatsApp templates | Must be MSG91-approved before live sending works |
| Razorpay partner mode | Needs live server keys; test keys create invisible links |
| Dark mode | Defaults ON; uses Tailwind class-based dark; full dark coverage is partial |
| Automation tab in Settings | Marked "coming soon" in UI |
| Report Settings tab in Settings | Marked "coming soon" in UI |
| Multi-branch isolation | Branch scope helpers in place; UI for branch switching exists for owners |
| `RUN_DB_INIT_ON_BOOT` on Render | Must be `true` for new schema additions to apply on deploy |

---

## 10. How to Continue Working

When starting a new session, tell the AI:
- This report is the full project context.
- The working rules in Section 7 apply always.
- Commit automatically after completing any fix or feature.
- Do not change design/layout unless explicitly asked.
- Run `npm --prefix frontend run build` before every commit.
- If touching backend routes, run a require-check on changed files.

For urgent issues, always check:
1. `system_runtime_events` table for server-side errors.
2. Browser DevTools console for client-side errors (also sent to `/api/support/client-errors`).
3. Razorpay dashboard mode mismatch (test vs live keys).
4. `config/db.js` always-run migrations for any new schema needed on live.
