# DevLens — System Architecture
 
> This document covers what every component does, why it exists, how they connect, and what happens when things go wrong.

---

## Table of Contents

1. [What DevLens Does — In One Paragraph](#1-what-devlens-does--in-one-paragraph)
2. [The Big Picture — All Components at a Glance](#2-the-big-picture--all-components-at-a-glance)
3. [The Full Request Journey — Step by Step](#3-the-full-request-journey--step-by-step)
4. [The Role Model — Five Views, One App](#4-the-role-model--five-views-one-app)
5. [Component Deep Dives](#5-component-deep-dives)
   - [GitHub](#-github)
   - [GitHub OAuth + Onboarding](#-github-oauth--onboarding)
   - [Role Switcher](#-role-switcher)
   - [Webhook Receiver](#-webhook-receiver)
   - [Idempotency Store](#-idempotency-store)
   - [Job Queue](#-job-queue)
   - [Analyser Workers](#-analyser-workers)
   - [AI Service Layer](#-ai-service-layer)
   - [PostgreSQL](#-postgresql)
   - [REST + WebSocket API](#-rest--websocket-api)
   - [React Frontend](#-react-frontend)
6. [Why These Specific Technologies?](#6-why-these-specific-technologies)
7. [Failure Modes — What Goes Wrong and How We Handle It](#7-failure-modes--what-goes-wrong-and-how-we-handle-it)
8. [Security Controls](#8-security-controls)
9. [Observability — How We Know the System is Healthy](#9-observability--how-we-know-the-system-is-healthy)
10. [API Contract](#10-api-contract)
11. [Key Architecture Decisions](#11-key-architecture-decisions)
12. [Folder Structure](#12-folder-structure)

---

## 1. What DevLens Does — In One Paragraph

A developer pushes code to GitHub. Within **30 seconds**, their dashboard shows a security score, a performance score, a readability score, and a list of specific issues — with the exact file and line number for each one. No tool to open, no command to run, no refresh needed. It just appears. Each person on the team — developer, tech lead, QA engineer, DevOps, engineering lead — sees a view built specifically for their role. DevLens sits invisibly between GitHub and the team's dashboards, catching problems before they reach code review.

---

## 2. The Big Picture — All Components at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                        EXTERNAL                                  │
│                                                                  │
│   👤 Developer  ──git push──▶  🐙 GitHub                        │
└─────────────────────────────┬───────────────────────────────────┘
                               │ webhook (POST)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AUTH + ONBOARDING                              │
│                                                                  │
│   🔐 GitHub OAuth  ──▶  Onboarding (first login only)           │
│          │                   Pick role → JWT issued              │
│          │              🔄 Role Switcher (top nav, always)       │
└─────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        INGESTION                                 │
│                                                                  │
│   📥 Webhook Receiver  ──dedup check──▶  🗂️ Idempotency Store   │
│          │                                    (Redis)            │
│          │ enqueue job                                           │
│          ▼                                                        │
│   📋 Job Queue  (Redis + RQ)                                     │
└─────────────────────────────┬───────────────────────────────────┘
                               │ pull job
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PROCESSING                                │
│                                                                  │
│   ⚙️  Analyser Workers  ──analyse──▶  🤖 AI Service Layer       │
│          │                               (HuggingFace / Local)  │
│          │ save results                                          │
│          ▼                                                        │
└─────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA + DELIVERY                              │
│                                                                  │
│   🗄️  PostgreSQL  ◀──write──  Worker                            │
│          │                                                        │
│          │ query                                                  │
│          ▼                                                        │
│   🔌 REST + WebSocket API  ──push live──▶  💻 React Dashboard   │
│                                              (role-aware view)  │
└─────────────────────────────────────────────────────────────────┘
```

**Six layers, top to bottom:**

| Layer | What happens here |
|---|---|
| **External** | The developer pushes code. GitHub sends an event. |
| **Auth + Onboarding** | User authenticated via GitHub OAuth. Role set on first login. Switchable anytime. |
| **Ingestion** | Event received, validated, deduplicated, and queued. |
| **Processing** | Code fetched, analysed by AI, and scored. |
| **Data + Delivery** | Results saved to the database and pushed to the dashboard. |
| **Client** | Each user sees a dashboard view matched to their active role. |

---

## 3. The Full Request Journey — Step by Step

Everything that happens between `git push` and the developer seeing results. Total time: **under 30 seconds**.

---

### Step 1 — Developer pushes code `t = 0s`

```
👤 Developer
git push origin main
```

This is the **only deliberate action a developer ever takes**. Everything from here is automatic and silent.

---

### Step 2 — GitHub sends a webhook `t ≈ 1s`

```
🐙 GitHub
POST https://devlens.app/webhook/github
{
  "commit_sha": "a1b2c3d4",
  "repo": "acme/backend",
  "branch": "main",
  "changed_files": ["auth.py", "utils.js", "api.ts"]
}
```

GitHub detects the push and immediately sends a signed HTTP request to DevLens containing what changed and where.

> **What "signed" means:** GitHub attaches a secret code to every webhook using HMAC-SHA256. DevLens checks this before doing anything. If it doesn't match, the request is rejected immediately. This prevents anyone from sending fake events.

---

### Step 3 — Webhook Receiver validates and queues `t ≈ 1.2s`

```
📥 Webhook Receiver (FastAPI)

1. Check signature      → valid ✓
2. Check idempotency    → new commit ✓
3. Enqueue job          → job_abc123 created ✓
4. Return HTTP 200      → GitHub is happy ✓
```

Three checks in under 200ms. The receiver **must** respond fast — if GitHub doesn't get a quick response, it assumes failure and retries, which creates duplicate analysis jobs.

---

### Step 4 — Job sits in the queue `t ≈ 1.5s`

```
📋 Job Queue
[job_abc123: pending] ← new
[job_xyz789: processing]
[job_def456: pending]
```

The job waits safely. If 10 developers push at the same time, all 10 jobs queue up — **none are dropped**. The developer's dashboard immediately shows "Analysis started…"

---

### Step 5 — Worker picks up the job and analyses `t ≈ 2s – 25s`

```
⚙️ Analyser Worker

1. Fetch changed files from GitHub API
2. Send each file to AI service
3. Score across 5 dimensions:
   - Security      → 62
   - Performance   → 74
   - Readability   → 88
   - Complexity    → 91
   - Bug Risk      → 79
4. Generate issue list with file + line numbers
```

This is the longest step. **AI analysis consumes ~80% of the 30-second budget.**

---

### Step 6 — Results saved to database `t ≈ 25s – 27s`

```
🗄️ PostgreSQL

INSERT scores, issues, job metadata
UPDATE job status → complete
COMMIT transaction ✓
```

Everything saved in a single **transaction** — either all of it saves, or none of it does. No partial results ever stored.

---

### Step 7 — Live results pushed to dashboard `t ≈ 27s – 28s`

```
🔌 WebSocket

→ broadcast to org: devlens-org-xyz
{
  "event": "analysis.complete",
  "commit": "a1b2c3d4",
  "scores": { "security": 62, "performance": 74 ... },
  "issues": [ ... ]
}
```

The moment the database write succeeds, the worker broadcasts results to every connected dashboard in this organisation.

---

### Step 8 — Role-aware results rendered `t < 30s`

```
💻 React Dashboard

✓ Developer    → personal scores and issues
✓ Senior Dev   → PR queue with pre-screened findings
✓ QA Engineer  → risk manifest with high-risk files ranked
✓ DevOps       → pipeline gate status and security trends
✓ CSO          → org-wide aggregates and team trends

No refresh. No action required.
```

---

### Latency Budget

```
|-- GitHub (~1s) --|-- Validate (~0.2s) --|-- Queue (~0.3s) --|

|─────────────────── AI Analysis (~23s, ~80% of total) ────────────────────|

                                         |-- DB (~2s) --|-- WS + Render (~1s) --|
├──────────────────────────────────────────────────────────────────────────────┤
0s                                                                           30s
```

---

## 4. The Role Model — Five Views, One App

DevLens serves five distinct roles. Each person sees a dashboard built for what **they** actually need.

---

### The Five Roles

| Role | Default Dashboard View |
|---|---|
| **Developer** | Personal scores, issues found, fix suggestions, growth chart, streak |
| **Senior Dev / Tech Lead** | PR queue, pre-screened issues, team scores, review efficiency metrics |
| **QA Engineer** | Risk manifest per build, high-risk files ranked, suggested test focus areas |
| **DevOps / Cloud** | Pipeline gate status, security score trends, repos drifting below threshold |
| **CSO / Eng Lead** | Org-wide dashboard, team trends, most improved developer, weekly digest email |

---

### First Login — Onboarding Flow

On first login, before a user reaches the dashboard, they are shown the onboarding screen to pick their role. This happens **exactly once**.

```
GitHub OAuth
    → Check primary_role in DB
    → null (first login) → Onboarding screen → Pick role
    → primary_role saved → JWT issued → Dashboard

    → already set (returning user) → JWT issued → Dashboard
```

> **Why capture role at onboarding?**  
> Storing `primary_role` at login means every subsequent request is immediately role-aware without an extra database lookup. It's baked into the JWT.

---

### Role Switching

A dropdown in the top navigation bar — always visible — lets any user switch to any role view at any time during their session.

```
Top nav dropdown:
  ● Developer        ← currently active
  ○ Senior Dev
  ○ QA Engineer
  ○ DevOps / Cloud
  ○ CSO / Eng Lead
```

Selecting a different role calls `POST /auth/switch-role`, which issues a **new JWT** with the updated `active_role`. No page refresh — React updates the view immediately. The old JWT is invalidated server-side. On a new login session, `active_role` resets to `primary_role`.

---

### What Lives in the JWT

```json
{
  "user_id":      "usr_abc123",
  "org_id":       "org_xyz456",
  "github_id":    12345678,
  "primary_role": "senior",
  "active_role":  "developer",
  "exp":          1705312800
}
```

| Field | Meaning |
|---|---|
| `primary_role` | Set once at onboarding. Never changes unless the user explicitly updates it. |
| `active_role` | Updated on every role switch. Resets to `primary_role` on new login. |
| `org_id` | Injected into every database query — ensures all data is always org-scoped. |

---

## 5. Component Deep Dives

---

### 🐙 GitHub

| | |
|---|---|
| **Layer** | External |
| **Technology** | GitHub Webhooks + GitHub OAuth |

**What it does:**
Source of all events. Sends signed webhook payloads on every push and PR. Owns authentication via OAuth — no DevLens passwords exist independently.

**Why:**
Delegating identity and event sourcing to GitHub eliminates an entire auth system. If GitHub sends it, it happened.

**Tradeoff:**
Full dependency on GitHub availability. Acceptable — if GitHub is down, developers cannot push code, so no events are missed.

**Failure behaviour:**
GitHub down → queue stays empty → system idles safely → recovers automatically when GitHub returns.

---

### 🔐 GitHub OAuth + Onboarding

| | |
|---|---|
| **Layer** | Auth + Onboarding |
| **Technology** | FastAPI OAuth handler, JWT |

**What it does:**
After the GitHub OAuth callback, DevLens checks if the user has a `primary_role` set. If not — first login — they are redirected to onboarding to pick their role. Once set, never shown again. A JWT is issued containing `user_id`, `org_id`, `primary_role`, and `active_role`. `active_role` starts equal to `primary_role`.

**Why:**
Capturing `primary_role` at onboarding means every subsequent request is immediately role-aware without a database lookup. Storing `active_role` in the JWT means role switching issues a new token — no DB write needed for a session switch.

**Tradeoff:**
Role is self-declared — DevLens trusts what the user picks. Simpler to implement and more flexible for people who wear multiple hats.

**Failure behaviour:**
Onboarding abandoned → session ends → shown again on next login. JWT expiry → silent redirect to GitHub OAuth → new JWT issued with last known `primary_role`.

---

### 🔄 Role Switcher

| | |
|---|---|
| **Layer** | Auth + Onboarding |
| **Technology** | Top nav dropdown + `POST /auth/switch-role` |

**What it does:**
A dropdown always visible in the top navigation bar. Current `active_role` highlighted. Selecting a different role issues a new JWT with the updated `active_role`. No page refresh — React updates the view immediately. Session remembers last used role, resets to `primary_role` on new login.

**Why:**
A senior dev who pushes code needs the developer view for their own scores. A DevOps engineer who writes application code needs personal analysis. Rigid single-role systems break for people who wear multiple hats.

**Tradeoff:**
Role switching issues a new JWT — one extra API call per switch. Acceptable cost for the flexibility it provides.

**Failure behaviour:**
Switch fails → user stays on current role → error toast shown → can retry. Old JWT remains valid until new one issued — no broken auth state.

---

### 📥 Webhook Receiver

| | |
|---|---|
| **Layer** | Ingestion |
| **Technology** | FastAPI (single endpoint) |

**What it does:**
One endpoint. Receives GitHub event, validates HMAC-SHA256 signature, checks Redis idempotency store to reject duplicates, enqueues job, returns HTTP 200 in under 200ms.

**Why:**
Does one thing only — receive, validate, enqueue. Never blocks waiting for analysis. GitHub retries on slow responses, causing duplicate jobs.

**Tradeoff:**
If Redis is down, idempotency checks fail open — we accept the job and risk a duplicate analysis. A duplicate review beats a missed security scan.

**Failure behaviour:**
Signature invalid → `401`, job rejected. Redis down → fail open, log warning. Queue full → `503` with `Retry-After` header.

---

### 🗂️ Idempotency Store

| | |
|---|---|
| **Layer** | Ingestion |
| **Technology** | Redis (24-hour TTL per commit SHA) |

**What it does:**
Stores commit SHAs with a 24-hour TTL. Webhook receiver checks here before enqueuing. SHA exists → duplicate → silently dropped.

**Why:**
GitHub retries webhooks on timeout or 5xx. Without deduplication, a single push could create multiple analysis jobs.

**Tradeoff:**
Redis TTL means a SHA older than 24 hours could theoretically trigger re-analysis. In practice this never happens.

**Failure behaviour:**
Redis restart clears the store — brief duplicate risk. Secondary check: PostgreSQL queried for existing results before analysis runs.

---

### 📋 Job Queue

| | |
|---|---|
| **Layer** | Processing |
| **Technology** | Redis + RQ |
| **Retry policy** | 3 attempts — exponential backoff: 30s → 2min → 10min |

**What it does:**
Every push becomes a job with a unique ID, commit SHA, repo, and changed files. Jobs move through states: `pending → processing → complete → failed`. Jobs that exhaust all retries move to the **Dead Letter Queue (DLQ)**.

**Why:**
The queue guarantees no security issue is ever missed under concurrent load. 10–50 developers pushing simultaneously each get their own job — none dropped.

**Tradeoff:**
Redis is not durable by default. Mitigated by enabling AOF persistence — minor write overhead, crash-safe queue.

**Failure behaviour:**
Worker crashes → visibility timeout expires → job returns to queue → retried up to 3 times → DLQ → alert fires.

---

### ⚙️ Analyser Workers

| | |
|---|---|
| **Layer** | Processing |
| **Technology** | Python background processes |
| **Default pool** | 3 concurrent workers |

**What it does:**
Each worker pulls one job, fetches changed files from GitHub API, sends them through the AI service, scores across 5 dimensions, writes results to PostgreSQL, and broadcasts via WebSocket. Every operation is **idempotent** — safe to retry without creating duplicate data.

**Why:**
Stateless workers mean concurrent pushes are processed in parallel. Workers can be added, removed, or restarted without coordination.

**Tradeoff:**
N=3 balances throughput against HuggingFace free tier rate limits. Tunable config — increase N when moving off the free tier.

**Failure behaviour:**
Worker crashes → job returns to queue. AI call times out after 25s → retry with backoff. No silent failures — every failure logged with job ID.

---

### 🤖 AI Service Layer

| | |
|---|---|
| **Layer** | Processing |
| **Primary engine** | HuggingFace Inference API (25s timeout) |
| **Fallback engine** | Locally loaded model (lazy-loaded) |
| **Circuit breaker** | Trips after 3 consecutive failures — 5-minute cooldown |

**What it does:**
A single Python interface with two implementations behind it. The worker calls `analyser.analyse(file)` — it never knows or cares which engine runs. The circuit breaker automatically routes to the local model when HuggingFace is failing, then switches back after the cooldown.

```
Worker calls:  analyser.analyse(file)
                        │
                        ▼
              ┌─────────────────────┐
              │  Circuit Breaker    │
              │  Status: CLOSED     │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  HuggingFace API    │  ← primary
              │  (25s timeout)      │
              └──────────┬──────────┘
                         │ if 3 failures in a row
                         ▼
              ┌─────────────────────┐
              │  Local Model        │  ← fallback
              │  (loaded lazily)    │
              └─────────────────────┘
```

**Why:**
A security tool must always produce results — even degraded ones. When the fallback triggers, results are flagged `degraded: true`. A degraded scan beats no scan.

**Tradeoff:**
Local model quality is lower than HuggingFace. The `degraded` flag is surfaced visibly on the dashboard so users know to treat those results as indicative.

**Failure behaviour:**
HuggingFace timeout → retry once → circuit breaker increments → fallback triggers → local model runs → result flagged degraded. All transitions logged.

---

### 🗄️ PostgreSQL

| | |
|---|---|
| **Layer** | Data |
| **Technology** | PostgreSQL |
| **Key design** | Row-level tenant isolation — every row carries `org_id` |

**What it stores:**

| Table | Contents |
|---|---|
| `users` | `user_id`, `org_id`, `github_id`, `primary_role`, `created_at` |
| `organisations` | Org ID, GitHub org name, settings |
| `repos` | Repos connected to DevLens |
| `commits` | Every analysed commit with SHA and timestamp |
| `jobs` | Job status, timing, AI engine used, `degraded` flag |
| `scores` | Per-dimension scores per commit |
| `issues` | Individual issues with file, line, severity |
| `weekly_aggregates` | Pre-computed trend data for dashboards |

**Why PostgreSQL and not SQLite:**
SQLite locks the entire database file on every write. With multiple workers writing simultaneously, this causes failures under concurrent load. PostgreSQL handles concurrent writes natively.

**Tenant isolation:**
Every query includes `WHERE org_id = :current_org`. Enforced at the middleware level. A bug in isolation logic returns empty results — never another organisation's data. Fail closed by design.

**Failure behaviour:**
Write fails → worker retries 3 times. All fail → DLQ → manual intervention. Transactions used — no partial writes ever.

---

### 🔌 REST + WebSocket API

| | |
|---|---|
| **Layer** | Delivery |
| **Technology** | FastAPI |
| **Auth** | JWT middleware on every request — extracts `org_id` and `active_role` |

**What it does:**
JWT middleware runs before every single handler. It decodes the token, extracts `org_id` and `active_role`, and injects both into the request context. REST returns **role-filtered data** — a developer gets personal scores, a CSO gets org aggregates. WebSocket pushes live events scoped to the authenticated org.

**Why:**
Role-aware responses at the API layer mean the frontend never has to filter data itself — it receives exactly what the active role needs. Middleware enforcement means auth and role scoping cannot be forgotten on new endpoints.

**Tradeoff:**
WebSocket connections drop on server restart. Frontend implements exponential backoff reconnection. In-flight results fetched via REST on reconnect.

**Failure behaviour:**
JWT expired → `401`, redirect to GitHub OAuth. `active_role` missing → default to `primary_role`. WebSocket drops → reconnect with backoff → REST fills gap.

---

### 💻 React Frontend

| | |
|---|---|
| **Layer** | Client |
| **Technology** | React + Vite |
| **Deployment** | Vercel (independent from backend) |

**What it does:**
Five distinct dashboard views — one per role. Active view determined by `active_role` from the JWT. Role switcher in the top nav, always visible. On first login, onboarding screen shown before the dashboard.

**Why:**
Each role has fundamentally different information needs. Serving all five from one view produces a cluttered tool nobody wants to use. Deploying independently means frontend updates never require backend restarts.

**Tradeoff:**
Five views means five times the frontend surface area. Mitigated by sharing a common component library — score cards, issue rows, charts — across all views. Only layout and data queries differ per role.

**Failure behaviour:**
WebSocket drop → reconnect with backoff → REST fills gap. API unreachable → cached last-known state with stale warning. Token expired → silent GitHub OAuth redirect. Role switch fails → stays on current view with error toast.

---

## 6. Why These Specific Technologies?

| Decision | Why |
|---|---|
| **FastAPI (not Django/Flask)** | Native async handles concurrent webhook events efficiently. Auto-generates API docs. Built-in request validation. |
| **Redis + RQ (not Celery)** | RQ is simpler to run and debug at this scale. Celery adds complexity not justified until load demands it. |
| **PostgreSQL (not SQLite)** | Concurrent writes from multiple workers. SQLite locks on every write — fails immediately under concurrent load. |
| **HuggingFace + local fallback** | Free tier availability with a reliability safety net. A security tool must always produce results. |
| **React + Vite (not Next.js)** | Dashboard app — no SSR needed. Vite's build speed makes development faster. |
| **GitHub OAuth only** | Eliminates an entire auth system. GitHub already owns developer identity. Zero password management. |
| **WebSocket (not polling)** | Polling every few seconds burns server resources. WebSocket pushes results the instant they're ready. |
| **Self-declared roles (not GitHub teams)** | Simpler. More flexible for people who wear multiple hats. No dependency on org GitHub team configuration. |

---

## 7. Failure Modes — What Goes Wrong and How We Handle It

> **Design principle: No silent failures. Every failure has a defined response.**

---

### 🔴 High Impact

**Redis restarts**
- What happens: In-flight queue jobs may be lost. Idempotency store cleared.
- Response: Workers reconnect automatically. Brief duplicate analysis risk.
- Prevention: Redis AOF persistence enabled. Secondary dedup check in PostgreSQL.
- Recovery: Manual — check DLQ for lost jobs.

**PostgreSQL write fails**
- What happens: Analysis results cannot be saved.
- Response: Worker retries up to 3 times. All fail → DLQ → alert fires.
- Prevention: Connection pooling. Retry with backoff. Transactions — no partial writes.
- Recovery: Manual intervention via DLQ.

---

### 🟡 Medium Impact

**Worker crashes mid-analysis**
- What happens: Job stuck in `processing` state.
- Response: Visibility timeout expires (30s) → job returns to queue → retried up to 3 times.
- Prevention: Workers emit heartbeat every 10s. Job forcibly returned after 30s of silence.
- Idempotent: ✅

**Queue depth exceeds 20 jobs**
- What happens: System under more load than workers can handle.
- Response: Alert fires. New webhook responses include `503 Retry-After`. GitHub backs off and retries. No jobs lost.
- Prevention: Monitor queue depth. Scale workers horizontally on sustained load.

---

### 🟢 Low Impact

**HuggingFace rate limited (429)**
- Response: Circuit breaker trips to local model after 3 failures. Result flagged `degraded: true`. Yellow indicator shown.
- Idempotent: ✅

**AI call times out (25s)**
- Response: Job retried with exponential backoff (30s → 2min → 10min). 3rd failure → DLQ → alert.
- Idempotent: ✅

**WebSocket connection drops**
- Response: Frontend reconnects: 1s → 2s → 4s → 8s. Missed results fetched via REST on reconnect.
- Idempotent: ✅

**Role switch fails**
- Response: User stays on current role view. Error toast shown. Can retry immediately. Old JWT remains valid.
- Idempotent: ✅

**First login — onboarding abandoned**
- Response: Session ends without `primary_role` set. Next login redirects to onboarding again. No data lost.
- Prevention: Dashboard is unreachable without `primary_role` set.
- Idempotent: ✅

**Duplicate webhook from GitHub**
- Response: Commit SHA found in idempotency store → silently dropped. No job created.
- Impact: None.

---

## 8. Security Controls

> **A tool that finds security issues in other people's code must itself be a security exemplar.**

---

### Control 1 — Webhook Signature Validation
**Layer:** Ingestion  
Every inbound webhook validated with HMAC-SHA256. Invalid signature → `401`, logged with source IP, job never created. No exceptions.

---

### Control 2 — JWT Verified on Every Request
**Layer:** API Middleware  
Middleware decodes JWT, extracts `org_id` and `active_role`, injects both into request context before any handler runs. Physically impossible to forget auth on a new endpoint — the framework enforces it.

---

### Control 3 — Role-Scoped Data Responses
**Layer:** API  
`active_role` from the JWT determines what data the API returns. A developer cannot receive org-wide CSO data by accident or by manipulation.

---

### Control 4 — Row-Level Org Isolation
**Layer:** Database  
Every query includes `WHERE org_id = :current_org`. Org isolation bug → empty result, never another org's data. **Fail closed by design.**

---

### Control 5 — Secrets in Environment Variables
**Layer:** Configuration  
All secrets in env vars. Never logged, never in code, never in version control. `.env` in `.gitignore`. Production secrets via Render environment config.

---

### Control 6 — API Rate Limiting
**Layer:** Delivery  
- `100 requests/minute` per JWT identity (REST API)
- `10 webhook events/minute` per repo

Exceeded → `429 Too Many Requests` with `Retry-After` header.

---

### Control 7 — Input Validation at the Boundary
**Layer:** Processing  
All webhook payloads validated against expected schema on arrival. Unexpected fields stripped. Malformed payloads rejected before they reach the queue.

---

## 9. Observability — How We Know the System is Healthy

Five metrics. The first is what actually matters to the user.

| Metric | Target | Alert threshold | Why it matters |
|---|---|---|---|
| **End-to-end latency** | p95 < 30s | p95 > 28s | Directly measures the user promise. Everything else explains *why* this degrades. |
| **Queue depth** | < 20 jobs | > 20 jobs | Leading indicator — rises before latency does. |
| **Job processing time** | p50 < 15s, p95 < 28s | p95 > 28s | AI analysis time only. Isolates the slowest component. |
| **AI fallback rate** | < 5% | > 5% | % of jobs hitting local model. High rate = HuggingFace struggling. |
| **DLQ job count** | 0 | Any job | Any number above zero means a job failed all retries. Needs immediate attention. |

---

### Structured Log Format

Every job state transition emits a structured JSON log:

```json
{
  "timestamp":       "2024-01-15T10:23:45Z",
  "level":           "info",
  "event":           "job.completed",
  "job_id":          "job_abc123",
  "commit_sha":      "a1b2c3d4",
  "org_id":          "org_xyz",
  "repo":            "acme/backend",
  "files_analysed":  6,
  "queue_wait_ms":   1200,
  "analysis_ms":     11800,
  "db_write_ms":     340,
  "ws_broadcast_ms": 90,
  "end_to_end_ms":   13430,
  "ai_engine":       "huggingface",
  "degraded":        false
}
```

**Every field tells a story:**
- `queue_wait_ms` — how long the job waited for a worker
- `analysis_ms` — how long the AI took
- `end_to_end_ms` — the number that matters to the user
- `ai_engine` — which engine ran (`huggingface` or `local`)
- `degraded` — whether the result should be fully trusted

---

## 10. API Contract

> JWT middleware extracts `org_id` and `active_role` before every handler runs. All data is org-scoped. Role-filtered at the API layer — not the frontend. Pagination uses opaque cursors, not page numbers.

| Method | Endpoint | Auth | Description | Response |
|---|---|---|---|---|
| `GET` | `/auth/github` | None | Initiate GitHub OAuth flow. | `302 Redirect` |
| `GET` | `/auth/callback` | None | Handle OAuth callback. Check `primary_role`. If null → redirect to onboarding. Issue JWT with `org_id` + `active_role`. | `302 → Onboarding or Dashboard` |
| `POST` | `/auth/onboarding` | Temp token | Set `primary_role` on first login. Issues full JWT. Never called again. | `200 + JWT` |
| `POST` | `/auth/switch-role` | JWT | Update `active_role`. Issues new JWT. Old token invalidated. | `200 + new JWT` |
| `POST` | `/webhook/github` | HMAC signature | Receive GitHub push/PR events. Validate, dedup, enqueue. Returns immediately. | `202 Accepted` |
| `GET` | `/api/dashboard/:role` | JWT → `org_id` + `active_role` | Role-appropriate data. `developer` → personal scores. `senior` → PR queue. `qa` → risk manifest. `devops` → pipeline status. `cso` → org aggregates. | `200 role-scoped data` |
| `GET` | `/api/repos` | JWT → `org_id` | List repos connected to org. Paginated with opaque cursor. | `200 + cursor` |
| `GET` | `/api/commits/:sha/results` | JWT → `org_id` | Full analysis result — all files, all issues, AI engine used, `degraded` flag. | `200 full result` |
| `GET` | `/api/dashboard/org` | JWT → `org_id` · CSO only | Org-wide scores, trends, top issues, most improved developer. | `200 aggregates` |
| `WS` | `/ws/live` | JWT on handshake → `org_id` + `active_role` | Real-time job events. Org-scoped. Role-filtered. Reconnectable. | Stream of events |
| `GET` | `/api/health` | None | Queue depth, worker count, AI fallback rate, end-to-end p95 latency. | `200 metrics` |

---

## 11. Key Architecture Decisions

---

### Decision 1 — Why a queue?

**The problem:** 10–50 developers pushing simultaneously creates concurrent AI requests the service cannot handle. Most would fail. Some security issues would never be reported.

**The solution:** A job queue guarantees every push gets analysed regardless of concurrent load. Jobs wait safely — none dropped, none duplicated.

**The alternative considered:** Processing webhooks directly in the receiver. Rejected because it ties response speed (must be <200ms) to AI analysis time (up to 25s).

---

### Decision 2 — Why not SQLite?

**The problem:** Multiple workers writing simultaneously. SQLite locks the entire file on every write — concurrent writes block or fail.

**The solution:** PostgreSQL handles concurrent writes natively with row-level locking.

**The tradeoff:** PostgreSQL is heavier. On free tiers (Render), the free instance has a 1GB storage limit and sleeps after inactivity. Acceptable for portfolio scale.

---

### Decision 3 — Why a swappable AI layer?

**The problem:** HuggingFace's free tier has rate limits. If the primary AI service goes down, DevLens stops producing results — unacceptable for a security tool.

**The solution:** A single Python interface with two implementations. Circuit breaker automatically switches to local model on failure, switches back after recovery.

**The tradeoff:** Local model quality is lower. Results flagged `degraded: true` so users know to treat them as indicative.

---

### Decision 4 — Why GitHub OAuth only?

**The problem:** Building full authentication — registration, login, password reset, email verification, session management — is weeks of work and a significant attack surface.

**The solution:** GitHub already knows who every developer is. GitHub OAuth gives authentication, identity, and repo access for free.

**The tradeoff:** Users must have a GitHub account. For a developer tool, this is a non-constraint.

---

### Decision 5 — Why self-declared roles instead of GitHub teams?

**The problem:** GitHub team membership requires org admins to keep teams configured and up to date. People who wear multiple hats get locked into one view.

**The solution:** Users declare their own `primary_role` at onboarding and can switch `active_role` anytime. No dependency on GitHub team configuration.

**The tradeoff:** Role is self-declared. In practice, developers know their own role better than any automated system does.

---

## 12. Folder Structure

```
devlens/
├── backend/                    ← FastAPI application
│   ├── app/
│   │   ├── api/               ← REST endpoints
│   │   ├── auth/              ← OAuth, JWT, onboarding, role switching
│   │   ├── core/              ← Config, security, middleware
│   │   ├── models/            ← SQLAlchemy database models
│   │   ├── services/
│   │   │   ├── ai/            ← AI service layer (HuggingFace + local)
│   │   │   ├── queue/         ← RQ job definitions
│   │   │   └── github/        ← GitHub API client
│   │   ├── websocket/         ← WebSocket handlers
│   │   └── worker.py          ← Analyser worker process
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/                   ← React + Vite (submodule)
│   ├── src/
│   │   ├── components/        ← Shared: score cards, issue rows, charts
│   │   ├── views/             ← One view per role (developer, senior, qa, devops, cso)
│   │   ├── onboarding/        ← First-login role selection screen
│   │   └── hooks/             ← WebSocket + REST hooks, role context
│   └── package.json
│
├── docs/
│   ├── architecture.md        ← This file
│   └── architecture.jsx       ← Interactive version
│
├── .gitignore
├── README.md
└── LICENSE
```

---

*Last updated: 2026 · DevLens v4*