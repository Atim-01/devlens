# DevLens — Build Plan

> **Five phases. Five shippable products.**  
> Each phase ends with a complete, useable, demonstrable app.

---

## Table of Contents

1. [How to Read This Document](#1-how-to-read-this-document)
2. [Timeline Overview](#2-timeline-overview)
3. [Phase 1 — The Foundation](#3-phase-1--the-foundation)
4. [Phase 2 — The Team Layer](#4-phase-2--the-team-layer)
5. [Phase 3 — The Safety Net](#5-phase-3--the-safety-net)
6. [Phase 4 — The Command Centre](#6-phase-4--the-command-centre)
7. [Phase 5 — Production Ready](#7-phase-5--production-ready)

---

## 1. How to Read This Document

Each phase answers four questions:

- **What gets built** — the exact scope of this phase
- **Why this order** — why this phase comes before the next one
- **Standalone value** — what a user can do with DevLens after this phase alone
- **Demo moment** — the specific thing to show at the end of this phase to prove it works

Every phase has a backend build list and a frontend build list. These are the exact task lists — not summaries, not vague goals. 

---

## 2. Timeline Overview

```
Phase 1 — The Foundation      ████████████████████████████████████  2–3 weeks
Phase 2 — The Team Layer      ████████████████████████             2 weeks
Phase 3 — The Safety Net      ████████████████                     1–2 weeks
Phase 4 — The Command Centre  ████████████████                     1–2 weeks
Phase 5 — Production Ready    ████████                             1 week
                              ├────────────────────────────────────┤
                              0                              7–10 weeks total
```

**Why Phase 1 is the longest:** It establishes every foundational pattern — the database schema, the queue, the AI service layer, the WebSocket architecture, the JWT middleware — that every subsequent phase inherits. Phases 3, 4, and 5 are fast because all the hard infrastructure is already done.

---

## 3. Phase 1 — The Foundation

> **"A working code reviewer that can actually be used"**  
> Duration: 2–3 weeks · Build this first

---

### What Gets Built

A developer pushes code to GitHub. DevLens receives the webhook, analyses the changed files using HuggingFace, scores them across 5 dimensions, and shows the results on a clean dashboard. One role — developer. One flow — push to result.

### Why This Order

This is the core value of DevLens proven end to end. Every other phase builds on top of this. If this works, the product works. The queue, the AI layer, the WebSocket architecture, the JWT middleware — all of it is established here. Every future phase just adds routes, views, and queries on top of a system that is already running.

### Standalone Value

A solo developer can connect their GitHub repo, push code, and immediately see AI-powered scores and issues with explanations on their personal dashboard. That is a complete, useful product on its own.

---

### Backend Build List

- FastAPI project setup with `uv`
- PostgreSQL + SQLAlchemy + Alembic — `organisations`, `users`, `repos`, `commits`, `jobs`, `scores`, `issues` tables
- All indexes from the schema (`002_add_indexes.py` migration)
- GitHub OAuth — login, JWT issued, onboarding screen
- `POST /webhook/github` — validate HMAC-SHA256 signature, dedup via Redis, enqueue
- Redis + RQ job queue — 3 retries, exponential backoff (30s → 2min → 10min), Dead Letter Queue
- HuggingFace AI service — CodeBERT analysis across 5 dimensions
- Local model fallback — circuit breaker (3 failures → trip → 5min cooldown), `degraded` flag
- Worker — fetch changed files from GitHub API, run AI analysis, save scores + issues with explanations
- `GET /api/dashboard/developer` — personal scores, issues, growth data
- `GET /api/commits/:sha/results` — full commit result with all files and issues
- `WS /ws/live` — full payload broadcast so frontend can update React Query cache directly
- `GET /api/health` — queue depth, AI fallback rate, end-to-end latency

### Frontend Build List

- React + Vite project setup
- GitHub OAuth login flow
- Onboarding screen — pick `primary_role` from 5 options
- Developer dashboard — `ScoreGrid`, `IssueList`, `GrowthChart`
- `IssueExplanation` — expandable why it matters + suggested fix
- `LiveIndicator` — pulsing dot showing WebSocket connected and analysis running
- `CommitDetail` page — full result per commit
- `DegradedWarning` banner — shown when AI ran on local fallback model
- `useWebSocket` hook — direct React Query cache update via `queryClient.setQueryData()` on `job.complete` event
- `useAuth`, `useDashboard`, `useCommit` hooks

---

### Demo Moment

Connect a real GitHub repo. Push actual code with intentional issues — a SQL injection risk, an O(n²) loop, a missing error boundary. Show the dashboard lighting up in real time with scores and explanations. Point to the `IssueExplanation` expanding to show exactly why the issue matters and how to fix it. Show the `GrowthChart` as a preview of what the developer will see after a week of pushing.

---

## 4. Phase 2 — The Team Layer

> **"DevLens becomes useful for the whole engineering team"**  
> Duration: 2 weeks · Build second

---

### What Gets Built

Add the Senior Dev view and QA view. Add role switching. The senior dev sees a PR queue with pre-screened DevLens scores. QA sees a risk manifest per build with files ranked by risk. The developer view gains a streak badge and team context.

### Why This Order

Phase 1 serves one person. Phase 2 makes DevLens genuinely useful for a team. The role switching infrastructure unlocks every subsequent role view. Building it here means Phases 3 and 4 are just adding new views to a system that already handles role awareness correctly.

### Standalone Value

A small engineering team can use DevLens end to end — developers push code, senior devs review pre-screened PRs, QA gets a risk manifest. Three roles, one product, a real team workflow.

---

### Backend Build List

- `POST /auth/switch-role` — validate current JWT, issue new JWT with updated `active_role`, invalidate old token
- `GET /api/dashboard/senior` — PR queue from GitHub API enriched with DevLens scores, team scores, review efficiency metrics
- `GET /api/dashboard/qa` — risk manifest with files ranked by risk score, high-risk file count, build summary
- `GET /api/repos` — list connected repos with latest scores
- Team scores aggregation query — all team members' latest scores per dimension
- PR data fetched from GitHub API and enriched with DevLens scores

### Frontend Build List

- Role switcher in `TopNav` — dropdown always visible, instant view change on selection
- `SeniorDevView` — `PRQueueCard`, `TeamScoreGrid`, `ReviewEfficiencyCard`, `TopIssuesCard`
- `QAView` — `RiskManifest`, `RiskChart`, `TestFocusCard`, `BuildSummaryCard`
- `useRoleSwitch` hook — calls `POST /auth/switch-role`, updates `AuthContext` with new JWT, refetches dashboard
- `StreakBadge` on developer view — consecutive clean commits
- `Sidebar` navigation updates per `active_role`

---

### Demo Moment

Show a senior dev opening a PR and seeing DevLens scores already attached — before any human has reviewed it. Switch to the QA view in the same session and show the risk manifest for the same build, with files ranked by risk score. Switch back to the developer view. Same session, no logout, no page refresh — just the role dropdown in the top nav.

---

## 5. Phase 3 — The Safety Net

> **"DevLens stops bad code before it reaches production"**  
> Duration: 1–2 weeks · Build third

---

### What Gets Built

Add the DevOps view and the CI pipeline gate. The gate blocks merges when security scores fall below the configured threshold per repo. DevOps gets a dashboard showing gate status per repo, security score trends over time, and a list of recent blocked commits.

### Why This Order

This is the phase that makes DevLens non-optional for a team. Once the gate is live, the team cannot ignore it — it is in the path of every merge. It also makes the security-first promise of DevLens tangible. The `security_threshold` column already exists on the `repos` table from Phase 1. This phase just adds the gate logic and the DevOps view on top.

### Standalone Value

DevOps can configure score thresholds per repo, see which repos are drifting below threshold, and know that no critical security issue can reach production without being flagged first.

---

### Backend Build List

- `GET /api/dashboard/devops` — gate status per repo, security score trends, blocked commits list
- `PUT /api/repos/:id/threshold` — update `security_threshold` on a repo
- `GET /api/repos/:id/gate-status` — current security score vs threshold, returns `pass` or `block` with issues
- CI gate endpoint — given a commit SHA, returns pass/fail decision that CI systems can call
- Blocked commits tracking — record gate decision on the `jobs` table

### Frontend Build List

- `DevOpsView` — `GateStatusCard`, `SecurityTrendChart`, `AlertConfigCard`, `BlockedCommitsList`
- Threshold config UI — slider per repo, value saved to backend on change
- Gate status badge — green pass or red block, blocked state links directly to the issues that caused the block

---

### Demo Moment

Push code with a deliberate security issue that scores below the configured threshold. Show the CI gate blocking the merge — the pipeline fails with a link to the exact issue. Fix the issue and push again. Gate passes. Open the DevOps dashboard and show the blocked commit, the recovery push, and the security score trend line moving back above threshold.

---

## 6. Phase 4 — The Command Centre

> **"Leadership gets visibility across the entire organisation"**  
> Duration: 1–2 weeks · Build fourth

---

### What Gets Built

Add the CSO view with org-wide score trends, most improved developer of the week, repos at risk, and a weekly digest email preview. Add the `weekly_aggregates` background job that pre-computes org stats every Sunday night — keeping the CSO dashboard instant regardless of org size.

### Why This Order

This phase completes the five-role promise of DevLens and adds the strategic layer that makes leadership care about code quality as a trend rather than just individual issues. The `weekly_aggregates` table already exists in the schema from Phase 1. This phase adds the background job that populates it and the CSO view that reads from it.

### Standalone Value

An engineering lead can open DevLens on Monday morning and immediately see whether the team's code quality improved or declined last week, which repos need attention, and which developer deserves recognition — all without asking anyone or waiting for a report.

---

### Backend Build List

- `GET /api/dashboard/cso` — org aggregates, team trends, most improved developer, repos at risk
- `GET /api/dashboard/org` — full org-wide view
- `weekly_aggregates` background job — runs every Sunday night, pre-computes one row per org from `scores` and `commits` data
- Most improved developer calculation — score delta across the week per user
- Repos at risk query — repos with average security score below threshold in the last 7 days
- Weekly digest email — plain text summary generated from `weekly_aggregates` and sent automatically

### Frontend Build List

- `CSOView` — `OrgScoreCard`, `TeamTrendChart`, `MostImprovedCard`, `ReposAtRiskCard`, `WeeklyDigestPreview`
- `OrgDashboard` page — full org view for CSO
- Recharts area chart — weekly org score trend with all 5 dimensions
- Most improved callout card showing developer name and score delta
- Weekly digest preview panel showing what the email will contain

---

### Demo Moment

Open the CSO view showing several weeks of trend data. Point to a repo whose security score has been improving week-on-week and one that is drifting below threshold. Show the most improved developer callout. Show the weekly digest preview — exactly what gets emailed to the engineering lead every Monday. The entire org's quality picture in one view, in under 30 seconds.

---

## 7. Phase 5 — Production Ready

> **"DevLens is ready for real teams to depend on"**  
> Duration: 1 week · Build last

---

### What Gets Built

Deployment to free cloud tiers, observability wired to the dashboard, polished error states, loading skeletons, empty states for first-time users, and final performance tuning. The product goes from "works on my machine" to "live at a real URL."

### Why This Order

A product that only works locally is not a product. This phase is about confidence — yours and your users'. All five roles, all five views, the CI gate, the WebSocket, and the org dashboard need to work reliably under real network conditions before you can demonstrate the full DevLens story to anyone.

### Standalone Value

DevLens is live at a real URL, connected to real GitHub repos, serving real teams, with observable metrics and a health dashboard. A complete, deployable, demonstrable product.

---

### Backend Build List

- Deploy FastAPI backend to Render free tier
- Deploy PostgreSQL to Render free tier
- Deploy Redis to Render free tier
- Configure Cloudflare Tunnel (or Render's public URL) for GitHub webhook ingress
- Structured logging to stdout — all job state transitions with `end_to_end_ms`
- Health endpoint fully wired — queue depth, worker count, AI fallback rate, p95 end-to-end latency
- Environment config for production vs development (`config.py` via `pydantic BaseSettings`)
- Rate limiting verified in production

### Frontend Build List

- Deploy React frontend to Vercel free tier
- Loading skeletons for all five dashboard views — shown while React Query fetches
- Empty states — first-time user who has connected a repo but not yet pushed
- Error boundaries — graceful degradation when API is unreachable
- Stale data warning banner when WebSocket is disconnected and data may be out of date
- Health metrics panel in the DevOps view — wired to `GET /api/health`
- Final performance audit — bundle size, lazy loading for role-specific views, Lighthouse score

---

### Demo Moment

The full DevLens story told in one session. A developer pushes code to a real GitHub repo. Within 30 seconds the developer dashboard shows live scores and issues. Switch to the senior dev view — the PR is already pre-screened. Switch to QA — the risk manifest is ready. The DevOps gate shows the repo passing. The CSO view shows the org trend. All of it live, at a real URL, with a real GitHub repo. This is the demo that ships.

---

## Appendix — What Each Phase Unlocks

| After phase | Who can use DevLens | What they can do |
|---|---|---|
| **Phase 1** | Solo developer | Push code → see scores, issues, and explanations in real time |
| **Phase 2** | Engineering team | Developer, Senior Dev, and QA each have a role-appropriate view. Role switching works. |
| **Phase 3** | DevOps + whole team | CI gate blocks bad code. DevOps monitors security trends. No critical issue reaches production unflagged. |
| **Phase 4** | Full organisation | Engineering lead has org-wide visibility. Weekly digest. Most improved developer recognised. |
| **Phase 5** | Real users on the internet | DevLens is live, observable, and dependable. The full product story can be told. |

---

*Last updated: 2026 · DevLens Build Plan v1*