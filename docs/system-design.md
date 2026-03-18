# DevLens — System Design

> **Plain English, fully explained.**  
> This document covers the complete folder structure, database schema with indexes, component map, data flows, and every major technical decision made during design.

---

## Table of Contents

1. [What This Document Covers](#1-what-this-document-covers)
2. [Folder Structure — Backend (FastAPI)](#2-folder-structure--backend-fastapi)
3. [Folder Structure — Frontend (React + Vite)](#3-folder-structure--frontend-react--vite)
4. [Services Boundary Rule](#4-services-boundary-rule)
5. [Database Schema](#5-database-schema)
   - [organisations](#-organisations)
   - [users](#-users)
   - [repos](#-repos)
   - [commits](#-commits)
   - [jobs](#-jobs)
   - [scores](#-scores)
   - [issues](#-issues)
   - [weekly_aggregates](#-weekly_aggregates)
   - [Table Relationships](#table-relationships)
   - [Tenant Isolation](#tenant-isolation)
   - [Index Strategy](#index-strategy)
6. [Component Breakdown](#6-component-breakdown)
   - [Shared Components (All Views)](#shared-components-all-views)
   - [Developer View](#developer-view)
   - [Senior Dev View](#senior-dev-view)
   - [QA View](#qa-view)
   - [DevOps View](#devops-view)
   - [CSO View](#cso-view)
7. [Data Flows](#7-data-flows)
   - [Authentication Flow](#authentication-flow)
   - [Push → Analysis → Dashboard Update](#push--analysis--dashboard-update)
   - [WebSocket Cache Update (Upgraded)](#websocket-cache-update-upgraded)
   - [Role Switch Flow](#role-switch-flow)
8. [Tech Decisions](#8-tech-decisions)
9. [Migration Strategy](#9-migration-strategy)

---

## 1. What This Document Covers

The architecture document explains *what* DevLens does and *why* each component exists. This document explains *how* to actually build it — the exact files, the exact tables, the exact components, and the precise data flows between them.

Read this document when you are about to write code. Read the architecture document when you need to understand why a decision was made.

---

## 2. Folder Structure — Backend (FastAPI)

Every file is listed with its exact responsibility. Nothing is vague — you can open VS Code right now and start creating these files.

```
backend/
├── app/                               ← All application code lives here
│   ├── __init__.py                    ← Makes app a Python package
│   ├── main.py                        ← FastAPI app init, middleware, router registration
│   ├── config.py                      ← All env vars loaded via pydantic BaseSettings
│   ├── database.py                    ← SQLAlchemy engine, session factory, Base class
│   │
│   ├── models/                        ← SQLAlchemy ORM models — one file per table
│   │   ├── __init__.py
│   │   ├── user.py                    ← User, primary_role, active_role, org_id
│   │   ├── organisation.py            ← Org — GitHub org or personal account (is_personal flag)
│   │   ├── repo.py                    ← Repo connected to DevLens
│   │   ├── commit.py                  ← Every push received via webhook
│   │   ├── job.py                     ← Analysis job — state, retries, timestamps
│   │   ├── score.py                   ← 5 dimension scores per commit
│   │   └── issue.py                   ← Individual flagged issue — with explanation + suggestion
│   │
│   ├── schemas/                       ← Pydantic schemas — request/response shapes, separate from ORM models
│   │   ├── __init__.py
│   │   ├── auth.py                    ← OAuth callback, JWT payload, role switch request/response
│   │   ├── webhook.py                 ← Inbound GitHub event shape — validated at boundary
│   │   ├── commit.py                  ← Commit result response shape
│   │   ├── dashboard.py               ← Role-aware dashboard response shapes per role
│   │   ├── issue.py                   ← Issue shape — includes explanation + suggestion fields
│   │   └── websocket.py               ← Full WS event payload shapes — job.started, job.complete
│   │
│   ├── routes/                        ← FastAPI routers — one file per domain
│   │   ├── __init__.py
│   │   ├── auth.py                    ← GET /auth/github, /auth/callback, POST /auth/switch-role
│   │   ├── webhook.py                 ← POST /webhook/github
│   │   ├── dashboard.py               ← GET /api/dashboard/:role
│   │   ├── repos.py                   ← GET /api/repos, /api/commits/:sha/results
│   │   ├── health.py                  ← GET /api/health — queue depth, fallback rate, e2e latency
│   │   └── websocket.py               ← WS /ws/live — sends full payload, no REST refetch needed
│   │
│   ├── services/                      ← Business logic — domain-bounded calls allowed, cross-domain via params
│   │   ├── __init__.py
│   │   ├── auth_service.py            ← JWT creation, validation, role switching
│   │   ├── webhook_service.py         ← Signature validation, dedup check, job enqueue — never calls analysis_service directly
│   │   ├── analysis_service.py        ← Orchestrates: fetch files → AI → score → save → calls notification_service
│   │   ├── dashboard_service.py       ← Builds role-aware dashboard data. Receives resolved user as param
│   │   └── notification_service.py    ← WebSocket broadcast — sends full result payload so frontend updates cache directly
│   │
│   ├── ai/                            ← Swappable AI layer — same interface, two implementations
│   │   ├── __init__.py
│   │   ├── base.py                    ← Abstract interface — analyse(files) → AnalysisResult
│   │   ├── huggingface.py             ← HuggingFace inference API — primary implementation
│   │   ├── local.py                   ← Local model — lazy loaded on first fallback trigger
│   │   └── circuit_breaker.py         ← 3 failures → trip → local fallback → 5min cooldown → reset
│   │
│   ├── worker/                        ← RQ background workers — stateless, idempotent
│   │   ├── __init__.py
│   │   ├── tasks.py                   ← analyse_commit() — the job function RQ calls
│   │   └── queue.py                   ← Redis connection, queue init, enqueue helper
│   │
│   └── middleware/                    ← Runs before every handler — auth and rate limiting enforced here
│       ├── __init__.py
│       ├── auth.py                    ← JWT decode → extracts org_id + active_role → injects into request
│       └── rate_limit.py              ← 100 req/min per identity — 429 on exceed
│
├── migrations/                        ← Alembic — one migration file per schema change
│   └── versions/
│       ├── 001_create_tables.py       ← Initial table creation
│       └── 002_add_indexes.py         ← All indexes in a dedicated migration — never mixed with table creation
│
├── tests/                             ← Pytest test suite
├── pyproject.toml                     ← uv dependencies
└── .env                               ← Secrets — never committed
```

---

## 3. Folder Structure — Frontend (React + Vite)

```
frontend/
├── src/
│   ├── main.jsx                       ← App entry — React Query provider, router, WebSocketContext
│   ├── App.jsx                        ← Route definitions, auth guard, role-based redirect
│   ├── queryClient.js                 ← React Query client config — cache time, retry, stale time
│   │
│   ├── pages/                         ← One page per route
│   │   ├── Onboarding.jsx             ← First login — pick primary role, POST /auth/onboarding
│   │   ├── Dashboard.jsx              ← Role router — renders correct view based on active_role from JWT
│   │   ├── CommitDetail.jsx           ← Full result for one commit — all files, all issues with explanations
│   │   └── OrgDashboard.jsx           ← CSO view — org-wide trends and weekly aggregates
│   │
│   ├── views/                         ← Five role-specific dashboard views
│   │   ├── DeveloperView.jsx          ← Personal scores, issues, growth chart, streak
│   │   ├── SeniorDevView.jsx          ← PR queue, team scores, review efficiency
│   │   ├── QAView.jsx                 ← Risk manifest, high-risk files, test focus areas
│   │   ├── DevOpsView.jsx             ← Pipeline gate status, security score trends
│   │   └── CSOView.jsx                ← Org-wide dashboard, most improved, weekly digest
│   │
│   ├── components/                    ← Shared components across all views
│   │   ├── layout/
│   │   │   ├── TopNav.jsx             ← Role switcher dropdown, user avatar, org name, live indicator
│   │   │   └── Sidebar.jsx            ← Nav links scoped to active_role
│   │   ├── scores/
│   │   │   ├── ScoreRing.jsx          ← Animated SVG ring — one dimension. Props: value, label, color
│   │   │   └── ScoreGrid.jsx          ← 5 ScoreRings in a row. Props: scores object
│   │   ├── issues/
│   │   │   ├── IssueRow.jsx           ← Single issue — severity, file, line, title
│   │   │   ├── IssueExplanation.jsx   ← Expandable — plain-English why it matters + suggested fix
│   │   │   └── IssueList.jsx          ← Filterable list of issues — by severity and dimension
│   │   └── charts/
│   │       ├── GrowthChart.jsx        ← Line chart — personal score trend. Recharts.
│   │       ├── RiskChart.jsx          ← Bar chart — file risk distribution. Recharts.
│   │       └── TeamScoreChart.jsx     ← Team scores over time. Senior Dev + CSO.
│   │
│   ├── hooks/                         ← Custom React hooks
│   │   ├── useAuth.js                 ← JWT decode, active_role, primary_role, logout
│   │   ├── useDashboard.js            ← React Query — fetch role-aware dashboard data
│   │   ├── useCommit.js               ← React Query — fetch single commit result
│   │   ├── useWebSocket.js            ← WS connection, reconnect backoff, direct cache update on job.complete
│   │   └── useRoleSwitch.js           ← POST /auth/switch-role, update JWT in AuthContext, refetch dashboard
│   │
│   ├── context/                       ← React context — global app state
│   │   ├── AuthContext.jsx            ← JWT, user, org, primary_role, active_role — source of truth
│   │   └── WebSocketContext.jsx       ← Single WS connection shared across all components
│   │
│   └── api/                           ← API client functions — called by React Query hooks
│       ├── client.js                  ← Axios instance — base URL, JWT header injection, 401 redirect handler
│       ├── auth.js                    ← switchRole(), getMe()
│       ├── dashboard.js               ← getDashboard(role), getOrgDashboard()
│       └── commits.js                 ← getCommit(sha), getRepos()
│
├── .env                               ← VITE_API_BASE_URL — never committed
└── package.json
```

---

## 4. Services Boundary Rule

This is one of the most important rules in the backend. Getting this wrong creates hidden dependencies, broken backpressure, and services that are impossible to test in isolation.

**The rule:** Services can call each other within the same domain boundary. Cross-domain data is always passed as parameters from the route handler — never fetched inside a service.

### ✅ Allowed

```
analysis_service  →  notification_service
```
Both are part of the same analysis pipeline domain. After saving results, `analysis_service` calls `notification_service` to broadcast. This is correct — removing the call would break the pipeline's core operation.

```
Route handler resolves user via middleware
    → passes user object as param to dashboard_service
```
The user is already resolved by the JWT middleware. The route handler passes it down as a parameter. `dashboard_service` never needs to call `auth_service`.

### ❌ Forbidden

```
webhook_service  →  analysis_service  (directly)
```
This bypasses the queue entirely and breaks backpressure. Ten simultaneous pushes would create ten simultaneous AI calls. The queue exists precisely to prevent this. `webhook_service` must always use `queue.py` to enqueue — never call `analysis_service` directly.

```
dashboard_service  →  auth_service  (to fetch user)
```
The user is already resolved by middleware and available in the request context. Fetching it again inside a service creates a hidden dependency, adds a database round trip, and makes the service impossible to test without mocking auth. Pass it as a parameter.

**The test:** If removing a service-to-service call would break the domain's core operation, it belongs. If it could be replaced by passing a parameter from the route handler, it should be.

---

## 5. Database Schema

Eight tables. Every row in every table carries `org_id` — this is the tenant isolation key that ensures one organisation can never read another's data.

---

### 🟣 organisations

> GitHub org or personal account — `org_id` is the root tenant key across every table

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | Internal org identifier |
| `github_id` | `BIGINT UNIQUE` | GitHub org or user numeric ID |
| `name` | `VARCHAR(255)` | GitHub org/username |
| `is_personal` | `BOOLEAN` | True = personal account treated as org of one |
| `created_at` | `TIMESTAMPTZ` | |

**Indexes:** Primary key only — organisations table is small and rarely queried by anything other than PK.

**Design note:** `is_personal = true` means a solo developer's GitHub account is treated as an org of one. No schema changes are needed to support individual users — they just get their own org row.

---

### 🔵 users

> Every DevLens user — linked to one org or their own personal org

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | |
| `org_id` | `UUID FK → organisations` | Tenant key — all queries scoped here |
| `github_id` | `BIGINT UNIQUE` | GitHub user numeric ID |
| `username` | `VARCHAR(255)` | GitHub username |
| `email` | `VARCHAR(255)` | |
| `primary_role` | `ENUM(role)` | Set once at onboarding — never auto-changed |
| `avatar_url` | `TEXT` | GitHub avatar URL |
| `created_at` | `TIMESTAMPTZ` | |

**Indexes:**
- `(github_id)` — Auth middleware resolves user by `github_id` on every single request. Without this index, every authenticated request does a full table scan.

---

### 🟢 repos

> Repos connected to DevLens — webhook registered on each

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | |
| `org_id` | `UUID FK → organisations` | Tenant scope |
| `github_repo_id` | `BIGINT UNIQUE` | GitHub repo numeric ID |
| `name` | `VARCHAR(255)` | Repo name |
| `full_name` | `VARCHAR(255)` | `owner/repo` format |
| `default_branch` | `VARCHAR(100)` | |
| `webhook_id` | `BIGINT` | GitHub webhook ID for this repo |
| `security_threshold` | `SMALLINT DEFAULT 70` | CI gate blocks commits below this score |
| `created_at` | `TIMESTAMPTZ` | |

**Indexes:**
- `(org_id)` — Org dashboard lists all repos for the organisation. Always filtered by `org_id`.

**Design note:** `security_threshold` lives on the repo so DevOps can configure different thresholds per repo — a payments service might require 85, a docs repo might allow 60.

---

### 🟡 commits

> Every push received — one row per commit SHA per repo

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | |
| `org_id` | `UUID FK → organisations` | Tenant scope |
| `repo_id` | `UUID FK → repos` | |
| `sha` | `VARCHAR(40) UNIQUE` | Git commit SHA — used for idempotency |
| `branch` | `VARCHAR(255)` | |
| `author_github_id` | `BIGINT FK → users` | Who pushed |
| `message` | `TEXT` | Commit message |
| `files_changed` | `INTEGER` | |
| `pushed_at` | `TIMESTAMPTZ` | When GitHub sent the webhook |

**Indexes:**
- `(org_id, repo_id)` — Dashboard fetches commits filtered by org + repo constantly. This is one of the most frequent queries in the entire system.
- `(org_id, pushed_at DESC)` — Activity feed queries latest commits across the org ordered by time.
- `(author_github_id)` — Developer view fetches their own commits. Without this, every developer dashboard load scans the entire commits table.

---

### 🔴 jobs

> Analysis job per commit — tracks full lifecycle through the queue

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | Also used as RQ job ID |
| `org_id` | `UUID FK → organisations` | Tenant scope |
| `commit_id` | `UUID FK → commits` | |
| `status` | `ENUM(pending,processing,complete,failed)` | |
| `retry_count` | `INTEGER DEFAULT 0` | Max 3 before DLQ |
| `ai_engine` | `ENUM(huggingface,local)` | Which engine ran |
| `degraded` | `BOOLEAN DEFAULT false` | True if local fallback ran |
| `queue_wait_ms` | `INTEGER` | Time in queue before worker picked up |
| `analysis_ms` | `INTEGER` | AI analysis duration only |
| `end_to_end_ms` | `INTEGER` | Push → complete. **The key product metric.** |
| `error_message` | `TEXT NULLABLE` | Populated on failure — logged for debugging |
| `created_at` | `TIMESTAMPTZ` | |
| `completed_at` | `TIMESTAMPTZ NULLABLE` | |

**Indexes:**
- `(status)` — Workers poll for pending jobs constantly. Without this index, every worker poll does a full table scan of potentially thousands of rows.
- `(commit_id)` — Result page fetches job status for a given commit.
- `(status, retry_count)` — DLQ query finds failed jobs with `retry_count >= 3`. Compound index serves this exact pattern.

**Design note:** `end_to_end_ms` is the single most important column in the entire database from a product perspective. It measures the user promise — under 30 seconds from push to visible result. Every observability alert is ultimately derived from this field.

---

### 🟣 scores

> Five dimension scores per commit — one row per dimension per commit

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | |
| `org_id` | `UUID FK → organisations` | Tenant scope |
| `commit_id` | `UUID FK → commits` | |
| `dimension` | `ENUM(security,performance,readability,complexity,bug_risk)` | |
| `score` | `SMALLINT (0–100)` | |
| `created_at` | `TIMESTAMPTZ` | |

**Indexes:**
- `(commit_id)` — Every commit result page fetches all 5 scores simultaneously. This is the single most frequently hit query on this table. Without this index, a result page load scans the entire scores table.
- `(org_id, dimension)` — CSO dashboard aggregates scores per dimension across the org for trend data.

**Design note:** Five rows per commit rather than five columns on the commits table. This makes it trivial to add new dimensions in the future without a schema migration — just add a new enum value.

---

### 🟠 issues

> Every flagged issue — explanation and suggestion make this the learning engine

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | |
| `org_id` | `UUID FK → organisations` | Tenant scope |
| `commit_id` | `UUID FK → commits` | |
| `file_path` | `TEXT` | Relative path to the file |
| `line_number` | `INTEGER NULLABLE` | |
| `dimension` | `ENUM(security,...)` | Which dimension flagged this |
| `severity` | `ENUM(critical,warning,info)` | |
| `title` | `VARCHAR(255)` | Short issue title shown in the list |
| `explanation` | `TEXT` | Plain-English why this matters — the learning content |
| `suggestion` | `TEXT` | Concrete fix or refactored code example |
| `created_at` | `TIMESTAMPTZ` | |

**Indexes:**
- `(commit_id)` — Commit detail page loads all issues for one commit. The most frequent query on this table by far.
- `(org_id, severity)` — Senior Dev and CSO views filter issues by severity across the org.
- `(org_id, dimension)` — Top recurring issues query groups by dimension across the org — used for the "most common issues this week" card.

**Design note:** `explanation` and `suggestion` are the columns that deliver DevLens's core value proposition. A raw issue like "SQL injection risk on line 42" is not useful on its own. The `explanation` field tells the developer *why* this is dangerous. The `suggestion` field shows them *exactly* how to fix it. These two fields are what turn DevLens from a linter into a learning tool.

---

### 🔵 weekly_aggregates

> Pre-computed weekly org stats — CSO dashboard stays instant without heavy live queries

| Column | Type | Note |
|---|---|---|
| `id` | `UUID PK` | |
| `org_id` | `UUID FK → organisations` | |
| `week_start` | `DATE` | Monday of the week |
| `avg_security` | `NUMERIC(5,2)` | |
| `avg_performance` | `NUMERIC(5,2)` | |
| `avg_readability` | `NUMERIC(5,2)` | |
| `avg_complexity` | `NUMERIC(5,2)` | |
| `avg_bug_risk` | `NUMERIC(5,2)` | |
| `total_commits` | `INTEGER` | |
| `total_issues` | `INTEGER` | |
| `most_improved_user_id` | `UUID FK → users` | Developer with biggest score improvement this week |

**Indexes:**
- `(org_id, week_start DESC)` — CSO trend chart always queries by org ordered by most recent week. This compound index makes the CSO dashboard instant regardless of how many weeks of history exist.

---

### Table Relationships

```
organisations
    │
    ├── users (org_id)
    │
    └── repos (org_id)
         │
         └── commits (repo_id, org_id)
              │
              └── jobs (commit_id, org_id)
              │
              └── scores (commit_id, org_id)
              │
              └── issues (commit_id, org_id)

organisations
    │
    └── weekly_aggregates (org_id)
              │
              └── most_improved_user_id → users
```

---

### Tenant Isolation

Every single table carries `org_id`. This is enforced at the middleware layer — JWT middleware extracts `org_id` and injects it into the request context before any handler runs. Every database query includes `WHERE org_id = :current_org`.

**What this means in practice:**
- A bug in isolation logic returns empty results — never another organisation's data.
- It is physically impossible to fetch another org's data through the API — the filter is in the middleware, not the handler.
- Fail closed by design.

---

### Index Strategy

All indexes live in `migrations/versions/002_add_indexes.py` — **never mixed with table creation**.

**Why separate migrations:**
- Indexes can be dropped and recreated independently without touching the schema.
- Migration history is readable — you can see exactly when the indexing strategy changed and why.
- `001` creates tables. `002` creates indexes. Any future index change gets its own numbered migration with a descriptive name.

**The critical indexes — do not skip these:**

| Index | Why it's critical |
|---|---|
| `users(github_id)` | Runs on every authenticated request |
| `jobs(status)` | Workers poll this constantly — full scan without it |
| `scores(commit_id)` | Every result page fires this query simultaneously with issues |
| `issues(commit_id)` | Same — most frequent query on this table |
| `commits(org_id, repo_id)` | Every dashboard load hits this |
| `weekly_aggregates(org_id, week_start DESC)` | CSO dashboard — instant with, slow without |

---

## 6. Component Breakdown

Every React component across all six view contexts. Shared components are built once and used everywhere. Role-specific components are in their own view files.

---

### Shared Components (All Views)

| Component | What it does |
|---|---|
| `TopNav` | Role switcher dropdown, org name, user avatar, logout button, live indicator dot |
| `Sidebar` | Navigation links — content changes based on `active_role` |
| `ScoreRing` | Animated SVG ring for one dimension. Props: `value`, `label`, `color` |
| `ScoreGrid` | Renders 5 `ScoreRing` components in a row. Props: `scores` object |
| `IssueRow` | Single issue — severity dot, title, `file:line`, timestamp |
| `IssueExplanation` | Expandable panel — plain-English why it matters + suggested fix + code example |
| `LiveIndicator` | Pulsing dot — WebSocket connected and analysis running |
| `DegradedWarning` | Yellow banner — shown when AI ran on local fallback model, results marked as indicative |

---

### Developer View

Root component: `DeveloperView.jsx` — fetches via `useDashboard('developer')`. Cache updated directly from WebSocket payload.

| Component | What it does |
|---|---|
| `PersonalScoreCard` | This push's 5 scores + delta vs personal average |
| `IssueList` | All issues from latest commit — filterable by severity and dimension |
| `GrowthChart` | Line chart — score trend over last 30 days. Recharts. |
| `StreakBadge` | Consecutive clean commits — gamification for motivation |

---

### Senior Dev View

Root component: `SeniorDevView.jsx` — fetches PR queue and team scores.

| Component | What it does |
|---|---|
| `PRQueueCard` | Open PRs with DevLens scores — safe-to-review indicator per PR |
| `TeamScoreGrid` | All team members' latest scores — sortable by dimension |
| `ReviewEfficiencyCard` | Avg review time saved per PR since DevLens connected |
| `TopIssuesCard` | Most recurring issue types across the team this week |

---

### QA View

Root component: `QAView.jsx` — fetches risk manifest for latest build.

| Component | What it does |
|---|---|
| `RiskManifest` | All changed files ranked by risk score, high to low |
| `RiskChart` | Bar chart — file risk distribution across the build. Recharts. |
| `TestFocusCard` | Suggested test focus areas based on flagged issues |
| `BuildSummaryCard` | Total files changed, high-risk count, overall build risk score |

---

### DevOps View

Root component: `DevOpsView.jsx` — fetches pipeline gate status and security trends.

| Component | What it does |
|---|---|
| `GateStatusCard` | Per-repo CI gate — passing or blocked, current threshold score |
| `SecurityTrendChart` | Security score over time per repo — spot drifting repos early |
| `AlertConfigCard` | Configure score thresholds per repo — saved to backend |
| `BlockedCommitsList` | Recent commits blocked by gate — links directly to the issues that caused the block |

---

### CSO View

Root component: `CSOView.jsx` — fetches org-wide weekly aggregates.

| Component | What it does |
|---|---|
| `OrgScoreCard` | This week's org average across all 5 dimensions + trend vs last week |
| `TeamTrendChart` | Weekly org score trend — Recharts area chart |
| `MostImprovedCard` | Developer with biggest score improvement this week |
| `ReposAtRiskCard` | Repos with scores below threshold — needs attention callout |
| `WeeklyDigestPreview` | Preview of auto-generated weekly email digest |

---

## 7. Data Flows

Four complete flows — every step numbered, every decision explained.

---

### Authentication Flow

```
User clicks Login
    │
    ▼
GET /auth/github  →  redirect to GitHub OAuth consent screen
    │
    │  GitHub redirects back with code param
    ▼
GET /auth/callback
    │
    ├── Exchange code for GitHub access token (GitHub API)
    ├── Fetch user profile: id, username, email, avatar
    ├── Query users table by github_id
    │
    ├── Existing user?
    │       └── Issue JWT immediately → Dashboard
    │
    └── New user?
            │
            ▼
        Redirect to /onboarding
            │
            ▼
        User picks primary_role from 5 options
            │
            ▼
        POST /auth/onboarding
            │
            ├── Create user row with primary_role
            ├── Create org row if needed (is_personal = true for solo devs)
            └── Issue JWT: { user_id, org_id, primary_role, active_role }
                    │
                    ▼
                JWT stored in AuthContext
                Every Axios request attaches JWT as Authorization header via interceptor
                JWT middleware on every handler decodes token, injects org_id + active_role
```

**Key detail:** No handler ever runs without a verified `org_id` and `active_role`. The middleware enforces this — it is physically impossible to forget auth on a new endpoint because the framework injects it before any handler code runs.

---

### Push → Analysis → Dashboard Update

```
Developer: git push origin main
    │
    │  t ≈ 1s
    ▼
GitHub: POST /webhook/github
    │
    ▼
Webhook Receiver
    ├── Validate HMAC-SHA256 signature
    │       └── Invalid → 401, job never created, source IP logged
    ├── Check Redis idempotency store for commit SHA
    │       └── Duplicate → silently dropped, no job created
    ├── Create commit row in PostgreSQL
    ├── Create job row (status: pending)
    └── Enqueue job to Redis queue → return HTTP 202 immediately
    │
    │  t ≈ 1.5s — WebSocket broadcasts 'job.started' to org
    ▼
RQ Worker picks job
    ├── Mark job status: processing
    ├── Fetch changed files from GitHub API
    ├── Send files to AI service
    │       ├── HuggingFace primary (25s timeout)
    │       └── Local fallback if circuit breaker tripped
    │
    │  t ≈ 2s – 25s (AI analysis consumes ~80% of budget)
    │
    ├── Write scores + issues to PostgreSQL in one transaction
    ├── Update job status: complete, record end_to_end_ms
    └── notification_service broadcasts full result via WebSocket
    │
    │  t ≈ 27s – 28s
    ▼
useWebSocket hook receives job.complete event with FULL payload
    │
    ├── queryClient.setQueryData(commitKey, payload)  ← direct cache update
    └── Dashboard re-renders immediately — no REST refetch, no extra network call
    │
    │  t < 30s
    ▼
Results visible on role-appropriate view
```

---

### WebSocket Cache Update (Upgraded)

This is the most important architectural improvement from v1 to v2.

**The old approach (v1):**
```
WS event arrives (just a notification)
    → Invalidate React Query cache
    → Trigger REST refetch to /api/commits/:sha/results
    → Wait for HTTP response
    → Render results
```

Problem: The results were already sitting in server memory after the worker finished. The REST refetch was an unnecessary extra network round trip.

**The new approach (v2):**
```
WS event arrives (carries FULL result payload — scores, issues, job metadata)
    → useWebSocket hook calls queryClient.setQueryData(commitKey, payload)
    → React Query cache updated directly in memory
    → Dashboard re-renders immediately
    → Zero additional network calls
```

**Why this matters:**
- Removes one full HTTP request from the critical path of every analysis result
- Reduces end-to-end latency by the time of one REST round trip (~200ms–500ms depending on connection)
- Simpler mental model: data flows in one direction (WS → cache → UI), not two (WS → invalidate → REST → cache → UI)

**Fallback behaviour:**
- WS connection is down when results arrive → user manually refreshes → REST serves latest data from DB
- WS reconnect after drop → fetch latest via REST once to fill any gap → resume direct cache updates

---

### Role Switch Flow

```
User clicks different role in TopNav dropdown
    │
    ▼
useRoleSwitch hook
    │
    ▼
POST /auth/switch-role  { new_role: "qa" }
    │
    ├── Backend validates current JWT
    ├── Issues new JWT with updated active_role
    └── Old JWT invalidated server-side
    │
    ▼
AuthContext updated with new JWT
    │
    ├── active_role changes across the entire app
    ▼
Dashboard.jsx detects active_role change
    │
    └── Renders matching view component (QAView in this example)
    │
    ▼
useDashboard fires with new role
    │
    └── React Query fetches role-appropriate data from /api/dashboard/qa
    │
    ▼
QA view renders with risk manifest, ranked files, test focus
No page refresh. No visible loading state on fast connections.

On next fresh login session → active_role resets to primary_role
```

---

## 8. Tech Decisions

Every major tool choice with the reason it was made and the tradeoff it carries.

---

### WebSocket sends full payload — cache updated directly

**Why:**
The original approach invalidated the React Query cache on WS event, which triggered a REST refetch. This added one full network round trip after results were already sitting in memory on the server. Sending the full payload in the WS event and calling `queryClient.setQueryData()` directly eliminates that round trip entirely.

**Tradeoff:**
WS payload is larger — it carries full scores, issues, and metadata instead of just a notification token. Acceptable: the payload is the same data the REST endpoint would have returned, just delivered differently. If the WS connection is down, the user falls back to REST on manual refresh — no data is ever lost.

---

### Services boundary rule — domain-bounded calls only

**Why:**
`analysis_service` calls `notification_service` after saving results — both are part of the same analysis pipeline domain. This is clean. What is not allowed: `webhook_service` calling `analysis_service` directly (bypasses the queue, breaks backpressure), or `dashboard_service` fetching the user from `auth_service` (user already resolved by middleware — pass it as a parameter).

**Tradeoff:**
Requires discipline to enforce. The rule: if removing a service call would break the domain's core operation, it belongs. If it could be replaced by passing a parameter from the route handler, it should be. Cross-domain data is always passed as parameters — never fetched inside a service.

---

### Indexes in a dedicated Alembic migration

**Why:**
Indexes are never mixed with table creation migrations. Keeping them separate means they can be dropped and recreated independently without touching the schema, and the migration history is readable — you can see exactly when the indexing strategy changed and why. `001` creates tables. `002` creates indexes. Any future index change gets its own numbered migration.

**Tradeoff:**
Two migration files instead of one for initial setup. Worth it for maintainability. The most operationally dangerous index to skip is `jobs(status)` — every worker poll becomes a full table scan without it.

---

### SQLAlchemy ORM + raw SQL for complex aggregates

**Why:**
ORM handles all standard CRUD — users, repos, jobs, individual scores, issues. For the CSO dashboard aggregates (averages across hundreds of commits, grouped by week and dimension), SQLAlchemy's `text()` drops to raw SQL. This gives readability for simple operations and full control for complex analytical queries.

**Tradeoff:**
Two styles of database access in the same codebase. Mitigated by keeping all raw SQL inside `dashboard_service` only — every other service uses ORM exclusively. Any developer reading the code knows exactly where to look for raw SQL.

---

### React Query over Redux for server state

**Why:**
95% of DevLens frontend state is server state — data fetched from the API or pushed via WebSocket. React Query handles caching, background refetch, stale time, loading states, and error states automatically. Redux would require manually wiring all of this for no real benefit.

**Tradeoff:**
React Query does not manage client-only UI state — modal open/closed, role switcher open/closed, sidebar collapsed. `useState` handles those. Keeping the two concerns completely separate makes both easier to reason about. The `queryClient.js` file centralises all React Query configuration — cache time, retry count, stale time — so it can be tuned in one place.

---

### UUID primary keys across all tables

**Why:**
UUIDs are safe to expose in URLs and API responses — they reveal nothing about table size or insertion order. Integer IDs like `/commits/1`, `/commits/2` tell an attacker exactly how many commits exist and allow trivial enumeration attacks.

**Tradeoff:**
UUIDs are 16 bytes vs 4 bytes for integers and are slightly slower to index. At DevLens scale — a team of 10–50 developers — this difference is completely irrelevant. The security benefit outweighs the marginal performance cost at any scale that a portfolio project would reach.

---

### weekly_aggregates pre-computed table

**Why:**
The CSO dashboard queries aggregate data across the entire org — potentially hundreds of commits and thousands of issues per week. Running `GROUP BY + AVG` live on every page load would be slow and expensive, growing worse as the org accumulates history. A background job computes the week's aggregates every Sunday night and stores one row per org. The CSO dashboard is always instant.

**Tradeoff:**
CSO trend data is up to one week stale. Acceptable for strategic oversight — the CSO is looking at direction and patterns, not individual commits. Current week data is still fetched live from the `scores` and `commits` tables.

---

### Pydantic schemas separate from ORM models

**Why:**
Pydantic validates all incoming data at the boundary — malformed requests are rejected before touching the database. Keeping response schemas separate from ORM models means the API contract is explicit and documented. What goes in and what comes out are deliberately different shapes.

**Tradeoff:**
More files to maintain — a `schemas/` directory alongside `models/`. Worth it: mixing ORM models with API response shapes is one of the most common sources of accidental data leakage — returning internal fields you didn't mean to expose. With separate schemas, what the API returns is always intentional.

---

## 9. Migration Strategy

Migrations are managed with Alembic. Every schema change is versioned, reversible, and tracked in git.

```
migrations/
└── versions/
    ├── 001_create_tables.py    ← All table definitions
    ├── 002_add_indexes.py      ← All indexes — separate from table creation
    └── NNN_description.py      ← Every future change gets its own file
```

**Running migrations:**

```bash
# Apply all pending migrations
uv run alembic upgrade head

# Roll back one migration
uv run alembic downgrade -1

# See current migration state
uv run alembic current

# Generate a new migration after model changes
uv run alembic revision --autogenerate -m "add_security_threshold_to_repos"
```

**Rules:**
- Never edit an existing migration file — create a new one
- Always generate migrations with `--autogenerate` then review the output before committing
- Migration file names must be descriptive — `003_add_security_threshold_to_repos.py` not `003_changes.py`
- Run `alembic upgrade head` in CI before running tests — tests always run against the current schema

---

*Last updated: 2024 · DevLens System Design v2*