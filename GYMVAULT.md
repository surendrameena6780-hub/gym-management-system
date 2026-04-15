# 💪 GymVault — The Complete Story

> *"We didn't just build software. We built the operating system for gyms."*

---

## Table of Contents

1. [The Story — How GymVault Was Born](#the-story)
2. [What is GymVault?](#what-is-gymvault)
3. [Tech Stack & Architecture](#tech-stack--architecture)
4. [Infrastructure & Deployment](#infrastructure--deployment)
5. [The Pages — Every Screen Explained](#the-pages)
6. [Features — Everything GymVault Can Do](#features)
7. [Integrations — Third-Party Services](#integrations)
8. [Database — The Data Layer](#database)
9. [Security — How We Keep Data Safe](#security)
10. [AI Models & Tools Used to Build GymVault](#ai-models--tools)
11. [Costs & Expenses](#costs--expenses)
12. [How to Use GymVault](#how-to-use-gymvault)
13. [How to Maintain GymVault](#how-to-maintain-gymvault)
14. [How to Scale GymVault](#how-to-scale-gymvault)
15. [How to Sell GymVault](#how-to-sell-gymvault)
16. [Project Stats & Numbers](#project-stats--numbers)
17. [Final Words](#final-words)

---

<a id="the-story"></a>
## 1. The Story — How GymVault Was Born

Picture this: it's 4 AM on an April night in 2026. The room is dark except for the glow of VS Code. Coffee cups everywhere. Eyes burning. But the code is flowing. This is how GymVault was built — not in some fancy office with a team of 50, but with one developer, one AI, and an absolute refusal to ship anything less than production-grade.

GymVault started as a simple idea: *"Why does every gym owner in India still use a register book or some janky Excel sheet?"* Seriously, bhai — we're living in 2026 and gym owners are still writing member names in notebooks. WhatsApp groups have become their "CRM." Payment reminders? *"Bhai tera payment due hai"* — manual message, one by one. Attendance? Vibes-based. *"Haan woh aata hai roz"*.

So we decided to fix it. Not with some basic CRUD app, but with a full-blown SaaS platform that could manage everything from member check-ins to payroll, from WhatsApp reminders to RFID gates, from Razorpay payment links to franchise analytics. The whole gym, in one app. In your pocket. On your phone. As a PWA.

The journey took **3+ months** of intense development — late nights, early mornings, debugging sessions that lasted till sunrise. There were moments when a single CSS bug on iPhone Safari made us question our life choices, moments when Razorpay's webhook decided to ghost us, and moments when that one PostgreSQL migration ran perfectly on the first try and we felt like absolute legends.

We used **Claude** (Anthropic's AI) as our pair-programming partner throughout the entire build — from the very first `npm init` to the final production deploy. Claude Sonnet 3.5, Claude Sonnet 3.7, Claude Sonnet 4, and finally **Claude Opus 4** — we upgraded models as they became available, and each version made the code better, faster, and more reliable. GitHub Copilot powered by these models was our constant companion, understanding the entire codebase context, suggesting architecture decisions, writing complex SQL migrations, debugging iOS PWA viewport issues at 3 AM, and helping us think through edge cases we'd never have caught alone.

This wasn't just coding. This was a collaboration between human creativity and AI capability — and the result is something we're genuinely proud of.

---

<a id="what-is-gymvault"></a>
## 2. What is GymVault?

**GymVault** is a complete, production-ready gym management SaaS platform. It's what happens when you say *"I want to build the Zoho of gyms"* and actually follow through.

### In Simple Terms:
- A **gym owner** signs up → sets up their gym → adds members → tracks payments → monitors attendance → grows their business.
- A **staff member** logs in → sees their dashboard → manages their assigned tasks (check-ins, classes, payments).
- A **member** opens a link → sees their profile → pays dues online → books classes → checks their attendance streak.

### Core Value Proposition:
| Who | Problem | GymVault Solution |
|-----|---------|-------------------|
| Gym Owner | Managing 500+ members manually | Complete digital member management |
| Gym Owner | Collecting payments is awkward | Razorpay payment links sent via WhatsApp |
| Gym Owner | No idea who's coming or not | Real-time attendance with RFID/QR support |
| Gym Owner | Staff management is chaotic | Role-based access with payroll automation |
| Gym Owner | Growing to multiple branches | Multi-branch with franchise analytics |
| Staff | Don't know what to do today | Dashboard with action items and priorities |
| Member | Can't track their own attendance | Self-service portal with streaks |

---

<a id="tech-stack--architecture"></a>
## 3. Tech Stack & Architecture

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 20.18.0 | Runtime — the engine that runs everything |
| **Express.js** | 5.2.1 | Web framework — handles all HTTP routing |
| **PostgreSQL** | 15+ | Database — stores all gym, member, and payment data |
| **PM2** | 5.4.3 | Process manager — clustering, auto-restart, zero-downtime |
| **Redis** | (via ioredis 5.10.1) | Optional caching layer — speeds up dashboards |

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 19.x | UI library — the heart of every screen |
| **Vite** | 7.3.1 | Build tool — blazing fast HMR and production builds |
| **Tailwind CSS** | 4.x | Styling — utility-first CSS for rapid UI development |
| **Lucide React** | Icons | Beautiful, consistent icon set throughout the app |
| **Recharts** | Charts | Revenue graphs, attendance heatmaps, analytics |
| **Axios** | HTTP | API communication with interceptors |

### Third-Party Services
| Service | Purpose |
|---------|---------|
| **Razorpay** | Payment gateway — orders, collection links, partner payouts |
| **MSG91** | WhatsApp & SMS — OTP delivery, member reminders, broadcasts |
| **Google OAuth 2.0** | Social login for gym owners |
| **Apple Sign-In** | iOS social login |
| **Nodemailer** | Transactional emails — OTPs, receipts, password resets |
| **Web Push (VAPID)** | Real-time browser/PWA push notifications |
| **Twilio** | Fallback SMS provider (available but MSG91 preferred) |

### Architecture Overview
```
┌─────────────────────────────────────────────────────────┐
│                    VERCEL (Frontend)                     │
│           React + Vite PWA → gymvault.app               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  App.jsx (Shell)                                │    │
│  │  ├── LoginPage / SignupPage                     │    │
│  │  ├── DashboardPage (Owner) / StaffDashboard     │    │
│  │  ├── MembersPage                                │    │
│  │  ├── LeadsPage                                  │    │
│  │  ├── PlansPage                                  │    │
│  │  ├── PaymentsPage (Finance, POS, Payroll)       │    │
│  │  ├── AttendancePage                             │    │
│  │  ├── ClassesPage                                │    │
│  │  ├── InsightsPage                               │    │
│  │  ├── SettingsPage (Account, Integrations, etc)  │    │
│  │  ├── HelpSupportPage                            │    │
│  │  ├── MemberSelfServiceHub (Member Portal)       │    │
│  │  └── SuperAdminDashboard (HQ)                   │    │
│  └─────────────────────────────────────────────────┘    │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS API calls
                        ▼
┌─────────────────────────────────────────────────────────┐
│                RENDER (Backend API)                      │
│          Express.js + PM2 Cluster Mode                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │  server.js (Entry)                              │    │
│  │  ├── middleware/ (auth, RBAC, SaaS, guards)     │    │
│  │  ├── routes/ (17 route modules, 180+ endpoints) │    │
│  │  ├── utils/ (17 utility modules)                │    │
│  │  ├── jobs/ (5 scheduled background jobs)        │    │
│  │  └── config/ (DB connection, migrations)        │    │
│  └─────────────────────────────────────────────────┘    │
└───────────────────────┬─────────────────────────────────┘
                        │ SQL queries
                        ▼
┌─────────────────────────────────────────────────────────┐
│              SUPABASE (PostgreSQL Database)              │
│           40+ tables, auto-migrations on boot           │
│           Connection pooling, row-level tenancy          │
└─────────────────────────────────────────────────────────┘
```

### How It All Connects
1. **User opens the app** → Vercel serves the React PWA
2. **Frontend makes API calls** → Axios hits the Express backend on Render
3. **Backend processes the request** → Validates auth (JWT), checks permissions (RBAC), queries PostgreSQL (Supabase)
4. **Data flows back** → JSON response → React updates the UI
5. **Background jobs run** → PM2 worker 0 handles expiry checks, notifications, backups, payroll
6. **External services fire** → Razorpay webhooks, MSG91 delivery reports, WhatsApp status updates

---

<a id="infrastructure--deployment"></a>
## 4. Infrastructure & Deployment

### Where Everything Lives

| Component | Platform | URL Pattern |
|-----------|----------|-------------|
| **Frontend** | Vercel | `gymvault.vercel.app` (or custom domain) |
| **Backend API** | Render | `gym-management-system-XXXX.onrender.com` |
| **Database** | Supabase | PostgreSQL managed instance |
| **Redis Cache** | Optional (Render/Upstash) | For production at scale |

### Vercel (Frontend)
- **Auto-deploys** on every git push to `main`
- **vercel.json** handles SPA routing (all paths → `index.html`)
- **Edge network** — CDN-cached static assets globally
- **Zero config** — Vite builds, Vercel serves

### Render (Backend)
- **Web Service** running Node.js 20.18.0
- **PM2 cluster mode** with configurable instance count
- **Auto-restart** on crash with memory limits
- **Health checks** on `/api/auth/config` endpoint
- **Environment variables** managed via Render dashboard
- **Build command**: `npm install`
- **Start command**: `npm run start:render`

### Supabase (Database)
- **Managed PostgreSQL** — no server admin needed
- **Connection pooling** — handles concurrent connections efficiently
- **Auto-migrations** — `config/db.js` runs migrations on every boot
- **40+ tables** created idempotently (safe to re-run)
- **Backups** — Supabase handles automated daily backups + our custom hourly backup job

### The Deploy Flow
```
Developer pushes code to GitHub
        │
        ├── Vercel detects push → builds frontend → deploys to edge
        │
        └── Render detects push → installs deps → restarts PM2 → runs migrations
                                                        │
                                                 DB migrations run
                                                 Background jobs start
                                                 App is live ✅
```

**Yep, it's that simple.** Push to GitHub and both frontend + backend auto-deploy. No CI/CD pipelines to maintain. No Docker containers to manage. No Kubernetes clusters to babysit. Just `git push` and chill.

---

<a id="the-pages"></a>
## 5. The Pages — Every Screen Explained

GymVault has **15+ distinct pages**, each designed for a specific workflow. Here's what every page does, in detail.

### 📊 Dashboard Page (`DashboardPage.jsx`)
The command center. When an owner opens GymVault, this is what they see.

**What it shows:**
- **Stats Overview** — Total members, active members, revenue today, pending dues (animated counters)
- **Need Attention Panel** — Smart action items prioritized by urgency:
  - 🔴 P0 (Critical): Members with expired plans, high pending dues
  - 🟡 P1 (Important): Upcoming renewals, inactive members
  - 🟢 P2 (Nice to do): Collection reviews, attendance trends
- **Setup Wizard** — For new accounts, guides through:
  1. Complete your business profile
  2. Create your first membership plan
  3. Add your first member
  4. Set up WhatsApp/SMS messaging
- **Quick Actions** — One-tap access to common tasks
- **Revenue Charts** — Last 7/30 days revenue trend

**Smart behavior:**
- Auto-refreshes when you come back from other pages
- Setup actions disappear as you complete them
- Filler actions only show when you have meaningful data (no fake "review collections" when you have zero collections)
- Works in background (keep-alive) and syncs on resume

### 👥 Members Page (`MembersPage.jsx`)
The biggest, most feature-rich page. This is where gym owners spend most of their time.

**What it does:**
- **Member List** — Paginated, searchable, filterable (All / Active / Inactive / Expired / Frozen / Unpaid)
- **Add Member** — Full form with name, phone, email, emergency contact, profile photo (auto-compressed to 2MB)
- **Member Details** — Tap any member to see:
  - Profile info, membership status, plan details
  - Payment history with Razorpay links
  - Attendance history and streaks
  - Notes & documents
- **Activate Membership** — Choose plan → pay (Cash/UPI QR/Razorpay link) → member is active
- **Freeze/Unfreeze** — Pause membership with reason and end date
- **Renewal Flow** — One-tap renewal with payment collection
- **Bulk Operations** — Multi-select for batch actions
- **Branch Scope** — See members from specific branch or all branches
- **CSV Export** — Download member data for offline use
- **Summary Stats** — Total, active, inactive, expiring soon, expired, unpaid, frozen

### 🎯 Leads Page (`LeadsPage.jsx`)
A complete CRM for tracking potential members before they join.

**Pipeline stages:** NEW → CONTACTED → TRIAL_BOOKED → NEGOTIATION → WON → LOST

**What it does:**
- **Add Lead** — Name, phone, email, source (walk-in, referral, social, Google, etc.)
- **Pipeline View** — See all leads organized by status with count badges
- **Follow-ups** — Schedule next follow-up date, add notes
- **Convert to Member** — One click to move a WON lead to the Members page
- **Lost Reasons** — Track why leads didn't convert (price, distance, competitor, etc.)
- **Branch Assignment** — Assign leads to specific branches

### 📋 Plans Page (`PlansPage.jsx`)
Create and manage membership offerings.

**What it does:**
- **Create Plan** — Name, duration (days/months), price, description, features list
- **Discount Management** — Set discount percentage with validity period
- **Plan Features** — Add feature bullets that members see
- **Advanced Rules** — Access policies (time-based), guest passes, freeze allowance
- **Plan Analytics** — See how many members are on each plan
- **Archive Plans** — Soft-delete plans (existing members stay on them)

### 💰 Payments Page (`PaymentsPage.jsx`)
The finance hub. This page alone has 4 sub-sections.

**Payment Ledger:**
- All payments with filters (All, Paid, Pending, Overdue, Failed)
- Search by member name
- Record manual payments (Cash, Card, UPI, Bank Transfer)
- Create Razorpay collection links for dues
- Payment history per member

**Finance Overview:**
- Revenue breakdown by period (daily, weekly, monthly)
- Income vs expenses chart
- Pending dues total
- Collection success rate

**Expenses:**
- Track gym operational costs (rent, equipment, utilities, misc)
- Categorized with date and notes
- Monthly expense summary

**Payroll:**
- Staff salary management
- Auto-pay configuration (monthly, on specific pay day)
- Payout via UPI/bank transfer flow
- Commission tracking
- Approval workflow: PENDING → APPROVED → PAID/REJECTED
- Staff payout destination management (bank account, UPI ID)

**Point of Sale (POS):**
- Product inventory (protein powder, shakers, gym wear, etc.)
- Stock tracking with low-stock alerts
- Sale recording with line items
- Sale voiding

### ✅ Attendance Page (`AttendancePage.jsx`)
Multiple ways to track who's coming to the gym.

**Check-in Methods:**
1. **Staff Desk** — Receptionist searches member name and taps check-in
2. **QR Code (Gym)** — Display QR at entrance, members scan with their phone
3. **QR Code (Member)** — Each member has a unique QR, staff scans it
4. **Self Check-in** — Member checks in from their phone (location optional)
5. **RFID** — Hardware RFID readers at the gate (coming soon / ready)

**Analytics:**
- Today's check-ins with live feed
- Attendance heatmap (which hours are busiest)
- Peak hours analysis
- Inactive member identification (hasn't come in X days)
- Attendance leaderboard (top attendees)
- Monthly attendance summary

**Access Policies:**
- Define time-based access rules per plan
- Enforce "Basic plan = morning only" type restrictions

### 📅 Classes Page (`ClassesPage.jsx`)
Group class scheduling and management.

**What it does:**
- **Create Class Types** — Yoga, CrossFit, Zumba, Spinning, etc.
- **Schedule Sessions** — Date, time, trainer, capacity, branch
- **Recurring Sessions** — Auto-repeat weekly/daily
- **Bookings** — Members book spots, trainer sees roster
- **Check-in** — Mark attendance for each class session
- **Capacity Management** — Max spots per session, waitlist potential

### 📈 Insights Page (`InsightsPage.jsx`)
Analytics dashboard for data-driven decisions.

**What it shows:**
- **Revenue Trends** — Monthly revenue chart with MoM comparison
- **Member Growth** — New vs churned members over time
- **Plan Popularity** — Which plans sell the most
- **Attendance Patterns** — When members come (day of week, time of day)
- **Churn Analysis** — Why members leave
- **Franchise Insights** — Cross-branch comparison (Growth/Pro plans)
- **Financial Summary** — Income, expenses, net profit

### ⚙️ Settings Page (`SettingsPage.jsx`)
The configuration powerhouse. The biggest file in the codebase (187KB built).

**Tabs:**
1. **Account & Business** — Owner profile, gym name, address, logo, timezone, currency
2. **Staff Management** — Create staff accounts with roles (Manager, Receptionist, Trainer, Accountant, Worker, Cleaner), assign permissions, set branches
3. **Integrations** — WhatsApp (MSG91), SMS, Email (SMTP), Razorpay keys, Google OAuth
4. **Platform** — Branch management (add/edit/delete branches), API keys, webhooks, CSV member import
5. **Billing & Subscription** — SaaS plan management, add-ons, payment history, plan upgrade/downgrade
6. **WhatsApp Templates** — Custom message templates with variable substitution for automated reminders
7. **Preferences** — Timezone, currency (INR, USD, etc.), interface preferences (dark mode, compact mode)

### 🆘 Help & Support Page (`HelpSupportPage.jsx`)
In-app support resources.

**What it shows:**
- Contact information (support email, phone)
- Business hours
- Common FAQs
- Platform guides

### 🔒 Login Page (`LoginPage.jsx`)
Owner and staff authentication.

**Supports:**
- Email + password login
- Email OTP login (passwordless)
- SMS OTP login (via MSG91)
- Google OAuth (one-click sign in)
- Apple Sign-In (iOS)
- "Remember me" via secure HTTP-only cookies

### 📝 Signup Page (`SignupPage.jsx`)
New gym owner onboarding.

**Flow:**
1. Enter gym name, owner name, email
2. Verify email with OTP (or skip with Google sign-in)
3. Set password
4. Account created → redirected to Dashboard with setup wizard

### 📱 Member Self-Service Hub (`MemberSelfServiceHub.jsx`)
The member portal — members access this on their phone.

**What members can do:**
- View their profile and membership status
- See payment history and outstanding dues
- Pay dues online (Razorpay)
- Book group classes
- View attendance streaks
- Renew membership

### 👨‍💼 Staff Dashboard (`StaffDashboard.jsx`)
Simplified dashboard for non-owner staff.

**Shows:**
- Tasks relevant to their role
- Quick check-in for reception staff
- Class schedule for trainers
- Today's summary stats

### 🏢 SuperAdmin Dashboard (`SuperAdminDashboard.jsx`)
The platform-level admin panel (for GymVault operators).

**What it does:**
- View all gyms on the platform
- Manage billing plans and add-ons
- Monitor system health
- Configure global platform settings
- Onboard new gyms manually

### 📡 RFID Setup Page (`RfidSetupPage.jsx`)
Hardware integration for RFID-based attendance.

**What it does:**
- Register RFID reader devices
- Pair RFID cards/tags to members
- Monitor RFID events in real-time
- Rotate device secrets for security

---

<a id="features"></a>
## 6. Features — Everything GymVault Can Do

### Member Management
- ✅ Add, edit, archive members
- ✅ Profile photos with auto-compression
- ✅ Emergency contacts
- ✅ Document storage (ID proofs, insurance, medical certs)
- ✅ Member notes (staff can leave notes on any member)
- ✅ Waivers (liability forms)
- ✅ Family group linking
- ✅ Onboarding workflow tracking
- ✅ Membership status lifecycle: ACTIVE → EXPIRED → FROZEN → CANCELLED
- ✅ Membership transfer between members
- ✅ CSV bulk import

### Attendance & Access
- ✅ 5 check-in methods (Staff, QR gym, QR member, Self, RFID)
- ✅ Attendance heatmaps
- ✅ Peak hour analysis
- ✅ Inactive member alerts
- ✅ Leaderboard (gamification)
- ✅ Time-based access policies per plan
- ✅ Live attendance feed

### Payments & Finance
- ✅ Manual payment recording (Cash, Card, UPI, Bank Transfer)
- ✅ Razorpay payment link generation
- ✅ UPI QR code for desk collection
- ✅ Payment status tracking
- ✅ Due collection via WhatsApp link
- ✅ Expense tracking by category
- ✅ Payroll with auto-pay
- ✅ POS (Point of Sale) with stock management
- ✅ Financial overview with charts
- ✅ CSV export of all financial data

### Class Management
- ✅ Class type creation (Yoga, CrossFit, etc.)
- ✅ Recurring session scheduling
- ✅ Trainer assignment
- ✅ Member booking and check-in
- ✅ Capacity management

### Lead CRM
- ✅ Pipeline stages (NEW → WON/LOST)
- ✅ Follow-up scheduling
- ✅ Source tracking (Walk-in, Referral, Social, Google)
- ✅ One-click conversion to member
- ✅ Lost reason tracking

### Communication & Automation
- ✅ WhatsApp broadcasts (renewal, dues, campaigns)
- ✅ SMS reminders
- ✅ Email notifications (password reset, receipts)
- ✅ Push notifications (browser + PWA)
- ✅ Automated engagement nudges (3 time slots: morning, afternoon, evening)
- ✅ Custom WhatsApp templates with variable substitution
- ✅ Delivery tracking and read receipts

### Multi-Branch
- ✅ Add up to 25 branches per gym
- ✅ Branch-scoped data (members, payments, attendance per branch)
- ✅ Branch selector in header (owner sees all, staff see theirs)
- ✅ Cross-branch analytics on higher plans
- ✅ Real-time branch switching without refresh

### Staff & Access Control
- ✅ 7 staff roles: Owner, Manager, Reception, Trainer, Worker, Cleaner, Accountant
- ✅ Granular permission system (members:read, payments:write, etc.)
- ✅ Role-specific dashboards
- ✅ Role-specific mobile navigation
- ✅ Staff payroll management

### Progressive Web App (PWA)
- ✅ Installable on iPhone, Android, Desktop
- ✅ Works offline (service worker caching)
- ✅ Push notifications via VAPID
- ✅ iOS safe-area handling (notch, home indicator)
- ✅ App-like feel with no browser chrome
- ✅ Splash screen on launch

### Platform & API
- ✅ API key generation (for third-party integrations)
- ✅ Webhook subscriptions (event-driven notifications)
- ✅ Data export (Members, Payments, Attendance, Leads, Expenses → CSV)
- ✅ Bulk member import via CSV
- ✅ Audit logging (who did what, when)

### SaaS Billing (Built-in)
- ✅ Plan tiers: Basic, Growth, Pro
- ✅ Add-on purchasing (extra members, branches, WhatsApp credits)
- ✅ Subscription management
- ✅ Grace period handling
- ✅ Suspension overlay on expiry
- ✅ Razorpay-powered owner billing

---

<a id="integrations"></a>
## 7. Integrations — Third-Party Services

### Razorpay (Payment Gateway)
**Used for two completely separate things:**
1. **SaaS Billing** — Gym owner pays for their GymVault subscription
2. **Member Collections** — Gym owner collects fees from members via payment links

The member collection flow is clever — it uses Razorpay's **Route/Partner** mode so payments go through the platform and automatically transfer to the gym's connected Razorpay account. No manual settlements.

**Endpoints involved:** `routes/payments.js`, `routes/memberships.js`, `routes/member.js`, `routes/billing.js`

### MSG91 (WhatsApp & SMS)
The primary messaging backbone.

**Used for:**
- OTP delivery (signup, login, password reset)
- Member renewal reminders via WhatsApp
- Due collection links via WhatsApp
- Broadcast campaigns to member segments
- Delivery status tracking via webhooks

**Configuration:** `utils/msg91.js`, `utils/whatsappDelivery.js`

### Google OAuth 2.0
Gym owners can sign up and log in with Google. No password needed.

**Flow:** Owner clicks "Sign in with Google" → redirected to Google → comes back with token → account created/linked.

**Configuration:** `routes/auth.js` (OAuth redirect and callback handlers)

### Apple Sign-In
iOS users can authenticate with Apple ID. Token verification happens server-side.

### Nodemailer (SMTP Email)
Transactional emails for:
- Password reset OTPs
- Email-based login OTPs
- Payment receipts
- Welcome emails

**Configuration:** `utils/email.js` — supports any SMTP provider (Gmail, SendGrid, AWS SES, etc.)

### Web Push (VAPID)
Real-time push notifications to:
- Owner devices (new check-in, new payment, expiry alerts)
- Staff devices (task alerts, class reminders)
- Member devices (payment due, class booked)

Uses the **Web Push protocol** with VAPID keys — no Firebase dependency.

**Configuration:** `routes/push.js`

### Redis (Optional Cache)
Used for:
- Dashboard stats caching (15-second TTL)
- Auth session caching (60-second TTL)
- Insight report caching (30-second TTL)
- Cross-worker state sharing in cluster mode

Falls back gracefully to in-memory if Redis is not configured.

**Configuration:** `utils/cache.js`

---

<a id="database"></a>
## 8. Database — The Data Layer

### PostgreSQL on Supabase
GymVault uses **PostgreSQL** hosted on **Supabase**. The schema is managed entirely through code — `config/db.js` runs idempotent migrations on every server boot. No external migration tool needed.

### 40+ Tables
The database has grown organically over 3 months to include:

**Core:**
| Table | Purpose |
|-------|---------|
| `gyms` | Gym tenant (top-level entity, hard-delete protected) |
| `users` | Owners and staff accounts |
| `members` | Gym members with profiles |
| `plans` | Membership plan definitions |
| `memberships` | Member-to-plan subscription records |

**Operations:**
| Table | Purpose |
|-------|---------|
| `attendance` | Check-in events |
| `class_types` | Group class definitions |
| `class_sessions` | Scheduled class instances |
| `class_bookings` | Member class reservations |
| `access_policies` | Time-based access rules |
| `leads` | CRM pipeline leads |
| `member_documents` | Uploaded ID proofs |
| `member_notes` | Staff notes on members |
| `member_waivers` | Liability waivers |

**Finance:**
| Table | Purpose |
|-------|---------|
| `payments` | Payment ledger |
| `payment_collections` | Razorpay payment link tracking |
| `expenses` | Operational cost records |
| `payroll_entries` | Staff salary records |
| `payroll_auto_config` | Auto-pay setup per staff |
| `payroll_payout_settings` | Gym-wide payout defaults |
| `payroll_staff_destinations` | Staff bank/UPI details (encrypted) |
| `pos_products` | Merchandise inventory |
| `pos_sales` | Sale transactions |
| `pos_sale_items` | Sale line items |

**Communication:**
| Table | Purpose |
|-------|---------|
| `notifications` | In-app notification records |
| `broadcast_logs` | WhatsApp/SMS campaign audit |
| `notification_automation_log` | Scheduled nudge tracking |
| `member_notification_automation_log` | Per-member automation log |

**Auth & Security:**
| Table | Purpose |
|-------|---------|
| `password_reset_otps` | Password recovery tokens |
| `user_login_otps` | Login OTP codes |
| `api_keys` | Third-party API credentials |
| `webhooks` | Event webhook subscriptions |

**Platform:**
| Table | Purpose |
|-------|---------|
| `platform_settings` | Global feature flags |
| `schema_migrations` | Migration version tracking |
| `operational_archives` | Archived old records |
| `audit_log` | Who-did-what audit trail |

### Key Design Decisions
- **Tenant isolation** via `gym_id` on every table — one database serves all gyms
- **Soft deletes** (`deleted_at` timestamp) — data is never truly lost
- **Hard-delete prevention** on `gyms` table via PostgreSQL triggers
- **Parameterized queries** everywhere — zero SQL injection risk
- **TIMESTAMPTZ** for all timestamps — timezone-aware from day one
- **Encrypted sensitive data** — Razorpay secrets, bank details stored encrypted (`utils/secretCrypto.js`)

---

<a id="security"></a>
## 9. Security — How We Keep Data Safe

Security wasn't an afterthought. It was built into every layer from day one.

### Authentication
- **JWT tokens** with strong secret validation (rejects weak secrets like "secret" or "password")
- **HTTP-only secure cookies** — tokens are never accessible via JavaScript
- **OTP-based login** — email or SMS, with expiry and attempt limits
- **Google/Apple OAuth** — delegate auth to trusted providers
- **Session invalidation** on staff deactivation

### Authorization (RBAC)
```
OWNER       → Full access to everything
MANAGER     → Members, Payments, Leads, Attendance, Classes, Insights
RECEPTION   → Members, Payments, Leads, Attendance
TRAINER     → Attendance, Classes, Members (read)
ACCOUNTANT  → Payments, Members (read)
WORKER      → Limited dashboard access
CLEANER     → Limited dashboard access
```

Each API endpoint checks: `rbac('permission:scope')` — no permission, no access.

### Network Security
- **Helmet** — sets security headers (XSS protection, clickjacking prevention, MIME sniffing block)
- **CORS** — strict origin whitelist (only your frontend domain)
- **Rate limiting** — 5 login attempts per 15 minutes, API-wide rate limits
- **Superadmin IP allowlist** — only whitelisted IPs can access HQ panel

### Data Security
- **bcryptjs** — passwords hashed with salt (never stored in plaintext)
- **AES encryption** — Razorpay keys, bank account numbers encrypted at rest
- **Request payload guards** — size limits prevent DoS via oversized payloads
- **Input validation** — email format, phone length, integer bounds checked on every write

### Audit Trail
- Every significant action is logged: who did it, what they did, when, from which IP
- Client-side errors are reported to the backend for monitoring
- Runtime telemetry captures unexpected exceptions

---

<a id="ai-models--tools"></a>
## 10. AI Models & Tools Used to Build GymVault

This is probably the most unique part of the GymVault story. The entire application was built as a **human-AI collaboration** using GitHub Copilot powered by multiple AI models.

### AI Models Used

| Model | Provider | Period | What It Helped Build |
|-------|----------|--------|---------------------|
| **Claude Sonnet 3.5** | Anthropic | Early phase | Initial project structure, database schema design, basic CRUD routes |
| **GPT-5.4 | GPT | Best model to ever exist- used the most | Complex feature development — attendance system, payment flows, class scheduling |
| **Claude Sonnet 4** | Anthropic | Late phase | Advanced integrations — Razorpay partner mode, MSG91 WhatsApp, multi-branch architecture |
| **Claude Opus 4** | Anthropic | Final phase (current) | Production hardening — iOS PWA fixes, global state sync, branch runtime, performance optimization |

### Development Tools

| Tool | Purpose |
|------|---------|
| **VS Code** | Primary IDE — where all the magic happened |
| **GitHub Copilot** | AI pair programmer — code suggestions, refactoring, debugging |
| **Git + GitHub** | Version control — every change tracked |
| **Postman** | API testing during development |
| **Chrome DevTools** | Frontend debugging, network inspection |
| **Safari Web Inspector** | iOS PWA debugging (the painful part 😅) |
| **pgAdmin / Supabase Dashboard** | Database exploration and query testing |
| **k6** | Load testing (we ran burst tests, heavy load tests, read-optimized tests) |

### How AI Helped

The AI wasn't just writing boilerplate. It was:
- **Architecting** — designing the database schema, choosing between Razorpay Routes vs direct checkout, planning the multi-branch state management
- **Debugging** — finding that one CSS rule that broke iOS standalone mode at 3 AM
- **Optimizing** — rewriting dashboard queries from N+1 to batched, adding request coalescing for keep-alive pages
- **Testing** — writing smoke tests, load test scripts, validation probes
- **Reviewing** — catching security issues (SQL injection potential, missing auth checks, weak secrets)

### Total Model Count: **4 AI models** across the Anthropic Claude family

We estimate **thousands of AI interactions** over 3+ months — from simple "write a useEffect" to complex multi-file architectural refactors.

---

<a id="costs--expenses"></a>
## 11. Costs & Expenses

### Monthly Running Costs (Production)

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| **Vercel** | Free (Hobby) | $7 for a domain annual |
| **Render** | Free / Starter | $7 |
| **Supabase** | Free tier | $25 |
| **GitHub** | Free | $10 for copilot |
| **MSG91** | Pay-per-use | Variable (₹0.15–₹0.50 per WhatsApp/SMS) |
| **Razorpay** | 2% per transaction | Variable |
| 

**Total minimum monthly cost: $50
**Realistic production upgrade cost: $100

### Development Costs

| Item | Cost |
|------|------|
| **GitHub Copilot** subscription | ~$10–$19/month × 3 months = ~$30–$57 |
| **Developer time** | 3+ months, often till 4 AM 😴 |
| **Coffee** | Immeasurable ☕ |
| **Sleep sacrifice** | Priceless 🌙 |

### Potential Revenue (SaaS Model)
If you sell GymVault as a SaaS:

| Plan | Suggested Price | Revenue at 100 gyms |
|------|----------------|---------------------|
| Basic (1 branch, 100 members) | ₹999/month | ₹99,900/month |
| Growth (3 branches, 500 members) | ₹2,499/month | ₹2,49,900/month |
| Pro (10 branches, unlimited) | ₹4,999/month | ₹4,99,900/month |

**Break-even: 1-2 gym subscriptions cover all hosting costs.** Everything after that is profit.

---

<a id="how-to-use-gymvault"></a>
## 12. How to Use GymVault

### For a New Gym Owner

**Step 1: Sign Up**
1. Go to the app URL
2. Click "Create Account"
3. Enter gym name, your name, email
4. Verify email with OTP
5. Set a password
6. You're in! 🎉

**Step 2: Complete Setup (Dashboard guides you)**
1. **Business Profile** — Add gym name, address, phone/email/website
2. **Create a Plan** — e.g., "Monthly Basic — ₹1,500 — 30 days"
3. **Add Your First Member** — Name, phone, assign a plan
4. **Set Up Messaging** — Connect MSG91 for WhatsApp/SMS reminders

**Step 3: Daily Operations**
- **Morning:** Check Dashboard for action items
- **Throughout the day:** Mark attendance as members walk in
- **When needed:** Record payments, send collection reminders
- **Weekly:** Review Insights for trends
- **Monthly:** Process payroll, check renewals pipeline

### For Staff
1. Owner creates a staff account in Settings → Staff Management
2. Staff logs in with their email + password (or OTP)
3. Staff sees their role-specific dashboard
4. Staff can only access pages their permissions allow

### For Members
1. Gym gives member the self-service portal link
2. Member logs in with their phone number + OTP
3. Member can view their profile, pay dues, book classes, see attendance

---

<a id="how-to-maintain-gymvault"></a>
## 13. How to Maintain GymVault

### Day-to-Day
GymVault is designed to be mostly self-maintaining:
- **Database backups** run automatically every hour
- **Expiry checks** run daily — memberships auto-expire
- **Notification automation** runs hourly — reminders go out without manual intervention
- **PM2** auto-restarts the server if it crashes
- **Vercel** handles frontend CDN and SSL certificates

### What to Monitor
1. **Render Dashboard** — Check server health, memory usage, response times
2. **Supabase Dashboard** — Database size, query performance, connection count
3. **SuperAdmin Panel** (`/hq-admin`) — Platform-wide gym health
4. **Error Reports** — Client errors are logged to `/api/support/client-errors`

### When Things Go Wrong
- **Server won't start** → Check Render logs, verify environment variables
- **Database connection fails** → Check Supabase status, verify DB credentials
- **Payments failing** → Check Razorpay dashboard, verify API keys
- **Messages not sending** → Check MSG91 credits, verify template status
- **Push notifications broken** → Regenerate VAPID keys, check subscription status

### Updating Dependencies
```bash
# Backend
npm audit
npm update

# Frontend
cd frontend
npm audit
npm update
npm run build  # Always test the build!
```

### Database Maintenance
- Supabase handles vacuuming and optimization automatically
- The `retentionMaintenance` job archives old records (attendance > 2 years, RFID events > 6 months)
- Schema migrations are idempotent — re-running server boot is always safe

---

<a id="how-to-scale-gymvault"></a>
## 14. How to Scale GymVault

### Stage 1: 1-50 Gyms (Current Setup)
- Render free/starter tier
- Supabase free tier
- Single PM2 instance
- No Redis needed
- **Cost: $0-$7/month**

### Stage 2: 50-500 Gyms
- Upgrade Render to Standard ($25/month)
- Upgrade Supabase to Pro ($25/month)
- Add Redis (Upstash or Render, $5/month)
- PM2 cluster mode with 2-4 workers
- **Cost: ~$55/month**

### Stage 3: 500-5000 Gyms
- Render with auto-scaling or move to AWS/GCP
- Supabase Pro with read replicas
- Dedicated Redis instance
- PM2 cluster with `max` workers
- CDN for static assets (already handled by Vercel)
- Consider read replica for analytics queries
- **Cost: ~$200-500/month**

### Stage 4: 5000+ Gyms
- Multi-region deployment
- Database partitioning by gym_id
- Dedicated message queue (BullMQ + Redis)
- Separate services for notifications and analytics
- Rate limiting per tenant
- **Cost: Depends on scale, but revenue should be >>$100K/month by now**

### Scaling Checklist
- [x] Tenant isolation (gym_id on every table) ✅
- [x] Connection pooling (pg Pool) ✅
- [x] Response caching (Redis) ✅
- [x] Cluster mode (PM2) ✅
- [x] CDN for frontend (Vercel Edge) ✅
- [x] Background job isolation (worker 0 only) ✅
- [x] Idempotent migrations (safe for rolling deploys) ✅
- [ ] Read replicas (add when needed)
- [ ] Horizontal API scaling (add more Render instances)
- [ ] Database sharding (at extreme scale)

---

<a id="how-to-sell-gymvault"></a>
## 15. How to Sell GymVault

### Target Market
- **Small-medium gyms** in India (primary market)
- **Fitness studios** (yoga, CrossFit, martial arts)
- **Sports academies** (swimming, badminton, cricket)
- **Personal trainers** with 50+ clients

### Pricing Strategy
| Tier | Target | Price | Key Differentiator |
|------|--------|-------|-------------------|
| **Basic** | Single gym, <100 members | ₹999/month | Everything you need to go digital |
| **Growth** | Multi-branch, <500 members | ₹2,499/month | Branch management + advanced analytics |
| **Pro** | Franchise, unlimited | ₹4,999/month | White-label + API access + priority support |

### Sales Pitch (30 Seconds)
> *"Aapka gym abhi register mein chal raha hai ya WhatsApp group mein? GymVault se sab kuch ek app mein — member tracking, payment collection via UPI/Razorpay, automatic WhatsApp reminders, attendance, classes, staff management. Phone pe install karo, 5 minute mein setup karo, aur gym ko professional banao. Monthly ₹999 se start."*

### Sales Channels
1. **Direct outreach** — Visit local gyms, demo on their phone
2. **Social media** — Instagram reels showing the app in action
3. **Google Ads** — Target "gym management software India"
4. **Referral program** — Existing gym owners refer others for discount
5. **Gym equipment suppliers** — Partner with equipment dealers who visit gyms

### What Makes GymVault Different
- **WhatsApp-native** — Members get reminders on WhatsApp, not some app they'll never download
- **UPI/Razorpay built-in** — Collect payments digitally without any extra setup
- **PWA** — Installs like an app, works offline, no App Store needed
- **Multi-branch from day one** — Grow without switching platforms
- **Hindi-English ready** — Built for the Indian market

---

<a id="project-stats--numbers"></a>
## 16. Project Stats & Numbers

### Codebase

| Metric | Count |
|--------|-------|
| **Backend route files** | 17 |
| **API endpoints** | 180+ |
| **Frontend pages** | 15+ |
| **Frontend components** | 25+ |
| **Backend utilities** | 17 |
| **Frontend utilities** | 14 |
| **Middleware modules** | 4 |
| **Background jobs** | 5 |
| **Database tables** | 40+ |
| **Third-party integrations** | 7 (Razorpay, MSG91, Google, Apple, SMTP, Web Push, Redis) |

### Build Output
| Chunk | Size (gzipped) |
|-------|----------------|
| **Total frontend** | ~530KB gzipped |
| **Largest page** (SettingsPage) | 39.8KB gzipped |
| **Core bundle** | 110.5KB gzipped |
| **Chart library** | 97.8KB gzipped |

### Development Timeline
| Phase | Duration | Focus |
|-------|----------|-------|
| **Foundation** | Month 1 | Auth, members, plans, payments, basic dashboard |
| **Operations** | Month 2 | Attendance, classes, leads, insights, finance, payroll |
| **Production** | Month 3 | Multi-branch, PWA, integrations, SaaS billing, polish, load testing |
| **Hardening** | Month 3+ | iOS fixes, global state sync, branch runtime, performance |

### Git Stats
- **Hundreds of commits** over 3+ months
- **Two humans' worth of code** written by one developer + AI
- **Multiple 4 AM sessions** (including the one right now 😄)

---

<a id="final-words"></a>
## 17. Final Words

GymVault isn't just a gym management app. It's proof that one developer with the right AI tools can build something that would traditionally require a team of 5-10 engineers and 6+ months.

The tech is solid. The architecture is clean. The database is well-designed. The security is production-grade. The UI is polished. The features are comprehensive. And it's running live on modern infrastructure that costs less than a pizza per month.

Was it hard? **Haan bhai, bahut hard tha.** There were nights when a single Safari viewport bug took 6 hours to fix. There were moments when the Razorpay partner integration made us question whether we should just tell gym owners to use Google Pay. There were times when the database schema needed a complete rethink at 2 AM because we realized the multi-branch isolation wasn't going to work the way we planned.

But we pushed through. Every bug was a lesson. Every 4 AM session was a trade: sleep for shipping. And every time we saw a feature work perfectly — a member check-in flowing through QR → API → database → push notification → dashboard update → in real time — it felt worth it.

**GymVault is ready.** Ready for production. Ready for gym owners. Ready to grow. Ready to scale. Ready to change how gyms in India operate.

The journey was beautiful. The code tells the story. And this report? This report is our way of saying — *"Hum ne banaya. Hum ne ship kiya. Ab gym owners ki baari hai."* 💪

---

*Built with ❤️, ☕, and way too many late nights.*
*Powered by Node.js, React, PostgreSQL, and Claude (Anthropic).*
*Deployed on Vercel + Render + Supabase.*

**© 2026 GymVault. All rights reserved.**
