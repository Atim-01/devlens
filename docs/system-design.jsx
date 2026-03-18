import { useState } from "react";

const tabs = ["Folder Structure", "Database Schema", "Component Breakdown", "Data Flow", "Tech Decisions"];

const backendTree = [
  { path: "backend/", type: "dir", depth: 0, note: "FastAPI application root" },
  { path: "app/", type: "dir", depth: 1, note: "All application code lives here" },
  { path: "__init__.py", type: "file", depth: 2, note: "Makes app a Python package" },
  { path: "main.py", type: "file", depth: 2, note: "FastAPI app init, middleware, router registration" },
  { path: "config.py", type: "file", depth: 2, note: "All env vars loaded via pydantic BaseSettings" },
  { path: "database.py", type: "file", depth: 2, note: "SQLAlchemy engine, session factory, Base class" },
  { path: "models/", type: "dir", depth: 2, note: "SQLAlchemy ORM models — one file per table" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "user.py", type: "file", depth: 3, note: "User, primary_role, active_role, org_id" },
  { path: "organisation.py", type: "file", depth: 3, note: "Org — GitHub org or personal account (is_personal flag)" },
  { path: "repo.py", type: "file", depth: 3, note: "Repo connected to DevLens" },
  { path: "commit.py", type: "file", depth: 3, note: "Every push received via webhook" },
  { path: "job.py", type: "file", depth: 3, note: "Analysis job — state, retries, timestamps" },
  { path: "score.py", type: "file", depth: 3, note: "5 dimension scores per commit" },
  { path: "issue.py", type: "file", depth: 3, note: "Individual flagged issue — with explanation + suggestion" },
  { path: "schemas/", type: "dir", depth: 2, note: "Pydantic schemas — request/response shapes, separate from ORM models" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "auth.py", type: "file", depth: 3, note: "OAuth callback, JWT payload, role switch request/response" },
  { path: "webhook.py", type: "file", depth: 3, note: "Inbound GitHub event shape — validated at boundary" },
  { path: "commit.py", type: "file", depth: 3, note: "Commit result response shape" },
  { path: "dashboard.py", type: "file", depth: 3, note: "Role-aware dashboard response shapes per role" },
  { path: "issue.py", type: "file", depth: 3, note: "Issue shape — includes explanation + suggestion fields" },
  { path: "websocket.py", type: "file", depth: 3, note: "Full WS event payload shapes — job.started, job.complete" },
  { path: "routes/", type: "dir", depth: 2, note: "FastAPI routers — one file per domain" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "auth.py", type: "file", depth: 3, note: "GET /auth/github, /auth/callback, POST /auth/switch-role" },
  { path: "webhook.py", type: "file", depth: 3, note: "POST /webhook/github" },
  { path: "dashboard.py", type: "file", depth: 3, note: "GET /api/dashboard/:role" },
  { path: "repos.py", type: "file", depth: 3, note: "GET /api/repos, /api/commits/:sha/results" },
  { path: "health.py", type: "file", depth: 3, note: "GET /api/health — queue depth, fallback rate, e2e latency" },
  { path: "websocket.py", type: "file", depth: 3, note: "WS /ws/live — sends full payload, no REST refetch needed" },
  { path: "services/", type: "dir", depth: 2, note: "Business logic — domain-bounded calls allowed, cross-domain via params" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "auth_service.py", type: "file", depth: 3, note: "JWT creation, validation, role switching" },
  { path: "webhook_service.py", type: "file", depth: 3, note: "Signature validation, dedup check, job enqueue — never calls analysis_service directly, uses queue" },
  { path: "analysis_service.py", type: "file", depth: 3, note: "Orchestrates: fetch files → AI → score → save → calls notification_service (same domain)" },
  { path: "dashboard_service.py", type: "file", depth: 3, note: "Builds role-aware dashboard data. Receives resolved user as param — never re-fetches from auth" },
  { path: "notification_service.py", type: "file", depth: 3, note: "WebSocket broadcast — sends full result payload so frontend updates cache directly" },
  { path: "ai/", type: "dir", depth: 2, note: "Swappable AI layer — same interface, two implementations" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "base.py", type: "file", depth: 3, note: "Abstract interface — analyse(files) → AnalysisResult" },
  { path: "huggingface.py", type: "file", depth: 3, note: "HuggingFace inference API — primary implementation" },
  { path: "local.py", type: "file", depth: 3, note: "Local model — lazy loaded on first fallback trigger" },
  { path: "circuit_breaker.py", type: "file", depth: 3, note: "3 failures → trip → local fallback → 5min cooldown → reset" },
  { path: "worker/", type: "dir", depth: 2, note: "RQ background workers — stateless, idempotent" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "tasks.py", type: "file", depth: 3, note: "analyse_commit() — the job function RQ calls" },
  { path: "queue.py", type: "file", depth: 3, note: "Redis connection, queue init, enqueue helper" },
  { path: "middleware/", type: "dir", depth: 2, note: "Runs before every handler — auth and rate limiting enforced here" },
  { path: "__init__.py", type: "file", depth: 3, note: "" },
  { path: "auth.py", type: "file", depth: 3, note: "JWT decode → extracts org_id + active_role → injects into request" },
  { path: "rate_limit.py", type: "file", depth: 3, note: "100 req/min per identity — 429 on exceed" },
  { path: "migrations/", type: "dir", depth: 1, note: "Alembic — one migration file per schema change" },
  { path: "versions/", type: "dir", depth: 2, note: "" },
  { path: "001_create_tables.py", type: "file", depth: 3, note: "Initial table creation" },
  { path: "002_add_indexes.py", type: "file", depth: 3, note: "All indexes in a dedicated migration — never mixed with table creation" },
  { path: "tests/", type: "dir", depth: 1, note: "Pytest test suite" },
  { path: "pyproject.toml", type: "file", depth: 1, note: "uv dependencies" },
  { path: ".env", type: "file", depth: 1, note: "Secrets — never committed" },
];

const frontendTree = [
  { path: "frontend/", type: "dir", depth: 0, note: "React Vite application root" },
  { path: "src/", type: "dir", depth: 1, note: "" },
  { path: "main.jsx", type: "file", depth: 2, note: "App entry — React Query provider, router, WebSocketContext" },
  { path: "App.jsx", type: "file", depth: 2, note: "Route definitions, auth guard, role-based redirect" },
  { path: "queryClient.js", type: "file", depth: 2, note: "React Query client config — cache time, retry, stale time" },
  { path: "pages/", type: "dir", depth: 2, note: "One page per route" },
  { path: "Onboarding.jsx", type: "file", depth: 3, note: "First login — pick primary role, POST /auth/onboarding" },
  { path: "Dashboard.jsx", type: "file", depth: 3, note: "Role router — renders correct view based on active_role from JWT" },
  { path: "CommitDetail.jsx", type: "file", depth: 3, note: "Full result for one commit — all files, all issues with explanations" },
  { path: "OrgDashboard.jsx", type: "file", depth: 3, note: "CSO view — org-wide trends and weekly aggregates" },
  { path: "views/", type: "dir", depth: 2, note: "Five role-specific dashboard views" },
  { path: "DeveloperView.jsx", type: "file", depth: 3, note: "Personal scores, issues, growth chart, streak" },
  { path: "SeniorDevView.jsx", type: "file", depth: 3, note: "PR queue, team scores, review efficiency" },
  { path: "QAView.jsx", type: "file", depth: 3, note: "Risk manifest, high-risk files, test focus areas" },
  { path: "DevOpsView.jsx", type: "file", depth: 3, note: "Pipeline gate status, security score trends" },
  { path: "CSOView.jsx", type: "file", depth: 3, note: "Org-wide dashboard, most improved, weekly digest" },
  { path: "components/", type: "dir", depth: 2, note: "Shared components across all views" },
  { path: "layout/", type: "dir", depth: 3, note: "" },
  { path: "TopNav.jsx", type: "file", depth: 4, note: "Role switcher dropdown, user avatar, org name, live indicator" },
  { path: "Sidebar.jsx", type: "file", depth: 4, note: "Nav links scoped to active_role" },
  { path: "scores/", type: "dir", depth: 3, note: "" },
  { path: "ScoreRing.jsx", type: "file", depth: 4, note: "Animated SVG ring — one dimension. Props: value, label, color" },
  { path: "ScoreGrid.jsx", type: "file", depth: 4, note: "5 ScoreRings in a row. Props: scores object" },
  { path: "issues/", type: "dir", depth: 3, note: "" },
  { path: "IssueRow.jsx", type: "file", depth: 4, note: "Single issue — severity, file, line, title" },
  { path: "IssueExplanation.jsx", type: "file", depth: 4, note: "Expandable — plain-English why it matters + suggested fix" },
  { path: "IssueList.jsx", type: "file", depth: 4, note: "Filterable list of issues — by severity and dimension" },
  { path: "charts/", type: "dir", depth: 3, note: "" },
  { path: "GrowthChart.jsx", type: "file", depth: 4, note: "Line chart — personal score trend. Recharts." },
  { path: "RiskChart.jsx", type: "file", depth: 4, note: "Bar chart — file risk distribution. Recharts." },
  { path: "TeamScoreChart.jsx", type: "file", depth: 4, note: "Team scores over time. Senior Dev + CSO." },
  { path: "hooks/", type: "dir", depth: 2, note: "Custom React hooks" },
  { path: "useAuth.js", type: "file", depth: 3, note: "JWT decode, active_role, primary_role, logout" },
  { path: "useDashboard.js", type: "file", depth: 3, note: "React Query — fetch role-aware dashboard data" },
  { path: "useCommit.js", type: "file", depth: 3, note: "React Query — fetch single commit result" },
  { path: "useWebSocket.js", type: "file", depth: 3, note: "WS connection, reconnect backoff, direct cache update on job.complete — no REST refetch" },
  { path: "useRoleSwitch.js", type: "file", depth: 3, note: "POST /auth/switch-role, update JWT in AuthContext, refetch dashboard" },
  { path: "context/", type: "dir", depth: 2, note: "React context — global app state" },
  { path: "AuthContext.jsx", type: "file", depth: 3, note: "JWT, user, org, primary_role, active_role — source of truth" },
  { path: "WebSocketContext.jsx", type: "file", depth: 3, note: "Single WS connection shared across all components — avoids duplicate connections" },
  { path: "api/", type: "dir", depth: 2, note: "API client functions — called by React Query hooks" },
  { path: "client.js", type: "file", depth: 3, note: "Axios instance — base URL, JWT header injection, 401 redirect handler" },
  { path: "auth.js", type: "file", depth: 3, note: "switchRole(), getMe()" },
  { path: "dashboard.js", type: "file", depth: 3, note: "getDashboard(role), getOrgDashboard()" },
  { path: "commits.js", type: "file", depth: 3, note: "getCommit(sha), getRepos()" },
  { path: ".env", type: "file", depth: 1, note: "VITE_API_BASE_URL — never committed" },
];

const tables = [
  {
    name: "organisations", color: "#6366f1",
    note: "GitHub org or personal account — org_id is the root tenant key across every table",
    columns: [
      { name: "id", type: "UUID PK", note: "Internal org identifier" },
      { name: "github_id", type: "BIGINT UNIQUE", note: "GitHub org or user numeric ID" },
      { name: "name", type: "VARCHAR(255)", note: "GitHub org/username" },
      { name: "is_personal", type: "BOOLEAN", note: "True = personal account treated as org of one" },
      { name: "created_at", type: "TIMESTAMPTZ", note: "" },
    ],
    indexes: []
  },
  {
    name: "users", color: "#0891b2",
    note: "Every DevLens user — linked to one org or their own personal org",
    columns: [
      { name: "id", type: "UUID PK", note: "" },
      { name: "org_id", type: "UUID FK → organisations", note: "Tenant key — all queries scoped here" },
      { name: "github_id", type: "BIGINT UNIQUE", note: "GitHub user numeric ID" },
      { name: "username", type: "VARCHAR(255)", note: "GitHub username" },
      { name: "email", type: "VARCHAR(255)", note: "" },
      { name: "primary_role", type: "ENUM(role)", note: "Set once at onboarding — never auto-changed" },
      { name: "avatar_url", type: "TEXT", note: "GitHub avatar URL" },
      { name: "created_at", type: "TIMESTAMPTZ", note: "" },
    ],
    indexes: [
      { cols: "github_id", reason: "Auth middleware resolves user by github_id on every request" },
    ]
  },
  {
    name: "repos", color: "#059669",
    note: "Repos connected to DevLens — webhook registered on each",
    columns: [
      { name: "id", type: "UUID PK", note: "" },
      { name: "org_id", type: "UUID FK → organisations", note: "Tenant scope" },
      { name: "github_repo_id", type: "BIGINT UNIQUE", note: "GitHub repo numeric ID" },
      { name: "name", type: "VARCHAR(255)", note: "Repo name" },
      { name: "full_name", type: "VARCHAR(255)", note: "owner/repo format" },
      { name: "default_branch", type: "VARCHAR(100)", note: "" },
      { name: "webhook_id", type: "BIGINT", note: "GitHub webhook ID for this repo" },
      { name: "security_threshold", type: "SMALLINT DEFAULT 70", note: "CI gate blocks below this score" },
      { name: "created_at", type: "TIMESTAMPTZ", note: "" },
    ],
    indexes: [
      { cols: "org_id", reason: "Org dashboard lists all repos — always filtered by org_id" },
    ]
  },
  {
    name: "commits", color: "#d97706",
    note: "Every push received — one row per commit SHA per repo",
    columns: [
      { name: "id", type: "UUID PK", note: "" },
      { name: "org_id", type: "UUID FK → organisations", note: "Tenant scope" },
      { name: "repo_id", type: "UUID FK → repos", note: "" },
      { name: "sha", type: "VARCHAR(40) UNIQUE", note: "Git commit SHA — used for idempotency" },
      { name: "branch", type: "VARCHAR(255)", note: "" },
      { name: "author_github_id", type: "BIGINT FK → users", note: "Who pushed" },
      { name: "message", type: "TEXT", note: "Commit message" },
      { name: "files_changed", type: "INTEGER", note: "" },
      { name: "pushed_at", type: "TIMESTAMPTZ", note: "When GitHub sent the webhook" },
    ],
    indexes: [
      { cols: "org_id, repo_id", reason: "Dashboard fetches commits filtered by org + repo constantly" },
      { cols: "org_id, pushed_at DESC", reason: "Activity feed — latest commits across the org ordered by time" },
      { cols: "author_github_id", reason: "Developer view fetches their own commits" },
    ]
  },
  {
    name: "jobs", color: "#dc2626",
    note: "Analysis job per commit — tracks full lifecycle through the queue",
    columns: [
      { name: "id", type: "UUID PK", note: "Also used as RQ job ID" },
      { name: "org_id", type: "UUID FK → organisations", note: "Tenant scope" },
      { name: "commit_id", type: "UUID FK → commits", note: "" },
      { name: "status", type: "ENUM(pending,processing,complete,failed)", note: "" },
      { name: "retry_count", type: "INTEGER DEFAULT 0", note: "Max 3 before DLQ" },
      { name: "ai_engine", type: "ENUM(huggingface,local)", note: "Which engine ran" },
      { name: "degraded", type: "BOOLEAN DEFAULT false", note: "True if local fallback ran" },
      { name: "queue_wait_ms", type: "INTEGER", note: "Time in queue before worker picked up" },
      { name: "analysis_ms", type: "INTEGER", note: "AI analysis duration only" },
      { name: "end_to_end_ms", type: "INTEGER", note: "Push → complete. The key product metric." },
      { name: "error_message", type: "TEXT NULLABLE", note: "Populated on failure — logged for debugging" },
      { name: "created_at", type: "TIMESTAMPTZ", note: "" },
      { name: "completed_at", type: "TIMESTAMPTZ NULLABLE", note: "" },
    ],
    indexes: [
      { cols: "status", reason: "Worker polls pending jobs constantly — full scan without this index" },
      { cols: "commit_id", reason: "Result page fetches job status for a given commit" },
      { cols: "status, retry_count", reason: "DLQ query — find failed jobs with retry_count >= 3" },
    ]
  },
  {
    name: "scores", color: "#7c3aed",
    note: "Five dimension scores per commit — one row per dimension per commit",
    columns: [
      { name: "id", type: "UUID PK", note: "" },
      { name: "org_id", type: "UUID FK → organisations", note: "Tenant scope" },
      { name: "commit_id", type: "UUID FK → commits", note: "" },
      { name: "dimension", type: "ENUM(security,performance,readability,complexity,bug_risk)", note: "" },
      { name: "score", type: "SMALLINT (0–100)", note: "" },
      { name: "created_at", type: "TIMESTAMPTZ", note: "" },
    ],
    indexes: [
      { cols: "commit_id", reason: "Every commit result page fetches all 5 scores — this is the most frequent query" },
      { cols: "org_id, dimension", reason: "CSO dashboard aggregates scores per dimension across the org" },
    ]
  },
  {
    name: "issues", color: "#b45309",
    note: "Every flagged issue — explanation and suggestion make this the learning engine",
    columns: [
      { name: "id", type: "UUID PK", note: "" },
      { name: "org_id", type: "UUID FK → organisations", note: "Tenant scope" },
      { name: "commit_id", type: "UUID FK → commits", note: "" },
      { name: "file_path", type: "TEXT", note: "Relative path to the file" },
      { name: "line_number", type: "INTEGER NULLABLE", note: "" },
      { name: "dimension", type: "ENUM(security,...)", note: "Which dimension flagged this" },
      { name: "severity", type: "ENUM(critical,warning,info)", note: "" },
      { name: "title", type: "VARCHAR(255)", note: "Short issue title shown in the list" },
      { name: "explanation", type: "TEXT", note: "Plain-English why this matters — the learning content" },
      { name: "suggestion", type: "TEXT", note: "Concrete fix or refactored code example" },
      { name: "created_at", type: "TIMESTAMPTZ", note: "" },
    ],
    indexes: [
      { cols: "commit_id", reason: "Commit detail page loads all issues for one commit — most frequent query on this table" },
      { cols: "org_id, severity", reason: "Senior Dev and CSO views filter issues by severity across the org" },
      { cols: "org_id, dimension", reason: "Top recurring issues query — groups by dimension across org" },
    ]
  },
  {
    name: "weekly_aggregates", color: "#0369a1",
    note: "Pre-computed weekly org stats — CSO dashboard stays instant without heavy live queries",
    columns: [
      { name: "id", type: "UUID PK", note: "" },
      { name: "org_id", type: "UUID FK → organisations", note: "" },
      { name: "week_start", type: "DATE", note: "Monday of the week" },
      { name: "avg_security", type: "NUMERIC(5,2)", note: "" },
      { name: "avg_performance", type: "NUMERIC(5,2)", note: "" },
      { name: "avg_readability", type: "NUMERIC(5,2)", note: "" },
      { name: "avg_complexity", type: "NUMERIC(5,2)", note: "" },
      { name: "avg_bug_risk", type: "NUMERIC(5,2)", note: "" },
      { name: "total_commits", type: "INTEGER", note: "" },
      { name: "total_issues", type: "INTEGER", note: "" },
      { name: "most_improved_user_id", type: "UUID FK → users", note: "" },
    ],
    indexes: [
      { cols: "org_id, week_start DESC", reason: "CSO trend chart always queries by org ordered by most recent week — this index makes it instant" },
    ]
  },
];

const componentBreakdown = [
  {
    view: "All views (shared)", color: "#6b7280",
    components: [
      { name: "TopNav", desc: "Role switcher dropdown, org name, user avatar, logout, live indicator dot" },
      { name: "Sidebar", desc: "Nav links — changes content based on active_role" },
      { name: "ScoreRing", desc: "Animated SVG ring — one dimension. Props: value, label, color" },
      { name: "ScoreGrid", desc: "5 ScoreRings in a row. Props: scores object" },
      { name: "IssueRow", desc: "One issue — severity dot, title, file:line, timestamp" },
      { name: "IssueExplanation", desc: "Expandable — plain-English why it matters + suggested fix + code example" },
      { name: "LiveIndicator", desc: "Pulsing dot — WebSocket connected and analysis running" },
      { name: "DegradedWarning", desc: "Yellow banner — shown when AI ran on local fallback model" },
    ]
  },
  {
    view: "Developer view", color: "#6366f1",
    components: [
      { name: "DeveloperView", desc: "Root — fetches via useDashboard('developer'). Cache updated directly from WS payload." },
      { name: "PersonalScoreCard", desc: "This push's 5 scores + delta vs personal average" },
      { name: "IssueList", desc: "All issues from latest commit — filterable by severity and dimension" },
      { name: "GrowthChart", desc: "Line chart — score trend over last 30 days. Recharts." },
      { name: "StreakBadge", desc: "Consecutive clean commits — gamification for motivation" },
    ]
  },
  {
    view: "Senior Dev view", color: "#d97706",
    components: [
      { name: "SeniorDevView", desc: "Root — fetches PR queue and team scores" },
      { name: "PRQueueCard", desc: "Open PRs with DevLens scores — safe-to-review indicator per PR" },
      { name: "TeamScoreGrid", desc: "All team members' latest scores — sortable by dimension" },
      { name: "ReviewEfficiencyCard", desc: "Avg review time saved per PR since DevLens connected" },
      { name: "TopIssuesCard", desc: "Most recurring issue types across the team this week" },
    ]
  },
  {
    view: "QA view", color: "#dc2626",
    components: [
      { name: "QAView", desc: "Root — fetches risk manifest for latest build" },
      { name: "RiskManifest", desc: "All changed files ranked by risk score high to low" },
      { name: "RiskChart", desc: "Bar chart — file risk distribution across the build. Recharts." },
      { name: "TestFocusCard", desc: "Suggested test focus areas based on flagged issues" },
      { name: "BuildSummaryCard", desc: "Total files changed, high-risk count, overall build risk score" },
    ]
  },
  {
    view: "DevOps view", color: "#059669",
    components: [
      { name: "DevOpsView", desc: "Root — fetches pipeline gate status and security trends" },
      { name: "GateStatusCard", desc: "Per-repo CI gate — passing or blocked, current threshold" },
      { name: "SecurityTrendChart", desc: "Security score over time per repo — spot drifting repos" },
      { name: "AlertConfigCard", desc: "Configure score thresholds per repo — saved to backend" },
      { name: "BlockedCommitsList", desc: "Recent commits blocked by gate — links directly to issues" },
    ]
  },
  {
    view: "CSO view", color: "#7c3aed",
    components: [
      { name: "CSOView", desc: "Root — fetches org-wide weekly aggregates" },
      { name: "OrgScoreCard", desc: "This week's org average across all 5 dimensions + trend vs last week" },
      { name: "TeamTrendChart", desc: "Weekly org score trend — Recharts area chart" },
      { name: "MostImprovedCard", desc: "Developer with biggest score improvement this week" },
      { name: "ReposAtRiskCard", desc: "Repos with scores below threshold — needs attention callout" },
      { name: "WeeklyDigestPreview", desc: "Preview of auto-generated weekly email digest" },
    ]
  },
];

const dataFlows = [
  {
    title: "Authentication flow", color: "#0891b2",
    steps: [
      "User clicks Login → GET /auth/github → redirect to GitHub OAuth consent screen",
      "GitHub redirects back → GET /auth/callback with code param",
      "Backend exchanges code for GitHub access token via GitHub API",
      "Backend fetches user profile (id, username, email, avatar) from GitHub API",
      "Check users table by github_id — existing user? Skip to JWT issue",
      "New user → redirect to /onboarding — user picks primary_role from 5 options",
      "POST /auth/onboarding → backend creates user row with primary_role, creates org row if needed",
      "JWT issued: { user_id, org_id, primary_role, active_role } — stored in AuthContext",
      "Every Axios request attaches JWT as Authorization header via interceptor",
      "JWT middleware on every handler decodes token, injects org_id + active_role — no handler runs without both",
    ]
  },
  {
    title: "Push → analysis → dashboard update", color: "#7c3aed",
    steps: [
      "git push → GitHub sends POST /webhook/github within ~1 second",
      "Webhook receiver validates HMAC-SHA256 signature — invalid → 401, job never created",
      "Check Redis idempotency store for commit SHA — duplicate → silently dropped",
      "Create commit row in PostgreSQL, create job row (status: pending)",
      "Enqueue job to Redis queue → return HTTP 202 to GitHub immediately",
      "Worker picks job → marks status: processing → fetches changed files from GitHub API",
      "AI service analyses files — HuggingFace primary, local fallback if circuit breaker tripped",
      "Worker writes scores + issues to PostgreSQL in one transaction (status: complete)",
      "end_to_end_ms recorded — the key product metric",
      "notification_service broadcasts full result payload via WebSocket to all org connections",
      "useWebSocket hook receives job.complete event with full payload",
      "React Query cache updated DIRECTLY from WS payload — no REST refetch, no extra API call",
      "Dashboard re-renders immediately with new data — lowest possible latency",
    ]
  },
  {
    title: "WebSocket cache update (upgraded)", color: "#059669",
    steps: [
      "OLD approach: WS event arrives → invalidate React Query cache → trigger REST refetch → render",
      "NEW approach: WS event carries full result payload — scores, issues, job metadata",
      "useWebSocket hook calls queryClient.setQueryData(commitKey, payload) directly",
      "React Query cache updated in memory — no network round trip",
      "Dashboard re-renders from updated cache — latency reduced by one full REST call",
      "Fallback: if WS connection is down when results arrive, user manually refreshes → REST serves latest data from DB",
      "On WS reconnect after drop → fetch latest via REST once to fill any gap → resume direct cache updates",
    ]
  },
  {
    title: "Role switch flow", color: "#6366f1",
    steps: [
      "User clicks different role in TopNav dropdown",
      "useRoleSwitch hook calls POST /auth/switch-role with new role",
      "Backend validates current JWT, issues new JWT with updated active_role",
      "AuthContext updated with new JWT — active_role changes across the app",
      "Dashboard.jsx detects active_role change → renders the matching view component",
      "useDashboard fires with new role — React Query fetches role-appropriate data",
      "New view renders with correct data — no page refresh, no visible loading state on fast connections",
      "active_role resets to primary_role on next fresh login session",
    ]
  },
];

const techDecisions = [
  {
    decision: "WebSocket sends full payload — cache updated directly",
    reason: "The original approach invalidated the React Query cache on WS event, which triggered a REST refetch. This added one full network round trip after results were already sitting in memory on the server. Sending the full payload in the WS event and calling queryClient.setQueryData() directly eliminates that round trip entirely.",
    tradeoff: "WS payload is larger — it carries full scores, issues, and metadata instead of just a notification. Acceptable: the payload is the same data the REST endpoint would have returned, just delivered differently. If the WS connection is down, the user falls back to REST on manual refresh — no data is ever lost."
  },
  {
    decision: "Services call each other within domain boundaries only",
    reason: "analysis_service calls notification_service after saving results — both are part of the same analysis pipeline domain. This is correct and clean. What is NOT allowed: webhook_service calling analysis_service directly (bypasses the queue, breaks backpressure), or dashboard_service fetching the user from auth_service (the user is already resolved by middleware — pass it as a param).",
    tradeoff: "Requires discipline to enforce. The rule: if removing one service call would break the domain's core operation, it belongs. If it could be replaced by passing a parameter, it should be. Cross-domain data is always passed as parameters from the route handler down — never fetched inside a service."
  },
  {
    decision: "Indexes in a dedicated Alembic migration",
    reason: "Indexes are never mixed with table creation migrations. Keeping them separate means they can be dropped and recreated independently without touching the schema, and the migration history is readable — you can see exactly when indexing strategy changed and why.",
    tradeoff: "Two migration files instead of one for the initial setup. Worth it for maintainability. The rule: 001 creates tables, 002 creates indexes. Any future index change gets its own numbered migration with a descriptive name."
  },
  {
    decision: "SQLAlchemy ORM + raw SQL for complex aggregates",
    reason: "ORM handles the standard CRUD — users, repos, jobs, individual scores. For the CSO dashboard aggregates (averages across hundreds of commits, grouped by week), SQLAlchemy's text() drops to raw SQL. This gives readability for simple operations and full control for complex analytical queries.",
    tradeoff: "Two styles of database access in the same codebase. Mitigated by keeping all raw SQL inside dashboard_service only — every other service uses ORM exclusively. Any developer reading the code knows where to find raw SQL."
  },
  {
    decision: "React Query over Redux for server state",
    reason: "95% of DevLens frontend state is server state — data fetched from the API or pushed via WebSocket. React Query handles caching, background refetch, stale time, and loading states automatically. Redux would require manually wiring all of this for no real benefit.",
    tradeoff: "React Query does not manage client-only UI state — modal open/closed, role switcher active, sidebar collapsed. useState handles those. Keeping the two concerns completely separate makes both easier to reason about."
  },
  {
    decision: "UUID primary keys across all tables",
    reason: "UUIDs are safe to expose in URLs and API responses — they reveal nothing about table size or insertion order. Integer IDs like /commits/1 tell an attacker exactly how many commits exist and allow enumeration attacks.",
    tradeoff: "UUIDs are 16 bytes vs 4 for integers and slightly slower to index. At DevLens scale — a team of 10–50 developers — this difference is completely irrelevant. The security benefit outweighs the marginal performance cost."
  },
  {
    decision: "weekly_aggregates pre-computed table",
    reason: "The CSO dashboard queries aggregate data across the entire org — potentially hundreds of commits and thousands of issues per week. Running GROUP BY + AVG live on every page load would be slow and expensive. A background job computes the week's aggregates every Sunday night and stores one row per org.",
    tradeoff: "CSO trend data is up to one week stale. Acceptable for strategic oversight — the CSO is looking at direction and patterns, not individual commits. Current week data is still fetched live from scores + commits tables."
  },
];

export default function SystemDesignV2() {
  const [activeTab, setActiveTab] = useState("Folder Structure");
  const [activeTree, setActiveTree] = useState("backend");
  const [selectedTable, setSelectedTable] = useState("issues");
  const [selectedFlow, setSelectedFlow] = useState(0);
  const [hoveredFile, setHoveredFile] = useState(null);
  const [showIndexes, setShowIndexes] = useState(true);

  const tree = activeTree === "backend" ? backendTree : frontendTree;
  const table = tables.find(t => t.name === selectedTable);

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f8f8f7", minHeight: "100vh", padding: "24px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 920, margin: "0 auto" }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>System Design · v2</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#111", margin: "0 0 4px", letterSpacing: "-0.03em" }}>DevLens — How to Build It</h1>
          <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Indexed schema · Direct WS cache update · Domain-bounded services · Full component map</p>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: "7px 16px", borderRadius: 8, border: activeTab === t ? "none" : "1px solid #e8e8e6", cursor: "pointer", fontSize: 13, fontWeight: 500, background: activeTab === t ? "#111" : "#fff", color: activeTab === t ? "#fff" : "#888", transition: "all 0.15s" }}>{t}</button>
          ))}
        </div>

        {/* FOLDER STRUCTURE */}
        {activeTab === "Folder Structure" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["backend", "frontend"].map(s => (
                <button key={s} onClick={() => setActiveTree(s)} style={{ padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, background: activeTree === s ? "#111" : "#fff", color: activeTree === s ? "#fff" : "#888", border: activeTree === s ? "none" : "1px solid #e8e8e6" }}>
                  {s === "backend" ? "Backend (FastAPI)" : "Frontend (React)"}
                </button>
              ))}
            </div>
            <div style={{ background: "#1e1b4b", borderRadius: 14, padding: "20px 24px" }}>
              {tree.map((item, i) => (
                <div key={i} onMouseEnter={() => setHoveredFile(i)} onMouseLeave={() => setHoveredFile(null)} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0" }}>
                  <div style={{ paddingLeft: item.depth * 18, display: "flex", alignItems: "center", gap: 6, minWidth: 300, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: item.type === "dir" ? "#a78bfa" : "#93c5fd", fontFamily: "'DM Mono', monospace" }}>{item.type === "dir" ? "📁" : "  "}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: item.type === "dir" ? "#c4b5fd" : "#93c5fd", fontWeight: item.type === "dir" ? 600 : 400 }}>{item.path}</span>
                  </div>
                  {item.note && <span style={{ fontSize: 11, color: hoveredFile === i ? "#e2e8f0" : "#4f46e5", fontStyle: "italic", paddingTop: 1, transition: "color 0.15s", flexShrink: 0 }}>← {item.note}</span>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, background: "#fff", border: "1px solid #ebebea", borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Services boundary rule</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.8 }}>
                Services can call each other <strong style={{ color: "#111" }}>within the same domain boundary</strong>. Cross-domain data is passed as parameters from the route handler — never fetched inside a service.<br /><br />
                ✅ <code style={{ background: "#f0fdf4", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>analysis_service</code> → <code style={{ background: "#f0fdf4", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>notification_service</code> — same pipeline domain<br />
                ✅ Route resolves user via middleware → passes user object as param to <code style={{ background: "#f0fdf4", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>dashboard_service</code><br />
                ❌ <code style={{ background: "#fef2f2", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>webhook_service</code> → <code style={{ background: "#fef2f2", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>analysis_service</code> directly — bypasses queue, breaks backpressure<br />
                ❌ <code style={{ background: "#fef2f2", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>dashboard_service</code> fetching user from <code style={{ background: "#fef2f2", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>auth_service</code> — user already resolved, pass as param
              </div>
            </div>
          </div>
        )}

        {/* DATABASE SCHEMA */}
        {activeTab === "Database Schema" && (
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {tables.map(t => (
                <button key={t.name} onClick={() => setSelectedTable(t.name)} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500, fontFamily: "'DM Mono', monospace", background: selectedTable === t.name ? t.color : "#fff", color: selectedTable === t.name ? "#fff" : "#666", border: selectedTable === t.name ? "none" : "1px solid #e8e8e6" }}>{t.name}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
              <button onClick={() => setShowIndexes(!showIndexes)} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500, background: showIndexes ? "#059669" : "#fff", color: showIndexes ? "#fff" : "#666", border: showIndexes ? "none" : "1px solid #e8e8e6" }}>
                {showIndexes ? "Indexes visible" : "Show indexes"}
              </button>
              <span style={{ fontSize: 12, color: "#aaa" }}>Toggle to see why each index exists</span>
            </div>
            {table && (
              <div style={{ background: "#fff", border: `2px solid ${table.color}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ background: table.color, padding: "14px 20px" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace" }}>{table.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 3 }}>{table.note}</div>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8f8f7" }}>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>Column</th>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>Type</th>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((col, i) => (
                      <tr key={col.name} style={{ borderTop: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                        <td style={{ padding: "10px 16px", fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600, color: "#111" }}>{col.name}</td>
                        <td style={{ padding: "10px 16px", fontFamily: "'DM Mono', monospace", fontSize: 12, color: table.color }}>{col.type}</td>
                        <td style={{ padding: "10px 16px", fontSize: 12, color: "#888" }}>{col.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {showIndexes && table.indexes.length > 0 && (
                  <div style={{ borderTop: "1px solid #f0f0ee", padding: "14px 16px", background: "#f8f8f7" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Indexes on this table</div>
                    {table.indexes.map((idx, i) => (
                      <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
                        <code style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, background: "#fff", border: "1px solid #e8e8e6", padding: "3px 10px", borderRadius: 6, color: "#059669", whiteSpace: "nowrap", flexShrink: 0 }}>({idx.cols})</code>
                        <span style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{idx.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                {showIndexes && table.indexes.length === 0 && (
                  <div style={{ borderTop: "1px solid #f0f0ee", padding: "12px 16px", background: "#f8f8f7", fontSize: 12, color: "#aaa" }}>
                    No additional indexes — primary key index is sufficient for this table's query patterns.
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 12, background: "#fff", border: "1px solid #ebebea", borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Key relationships + tenant isolation</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.9 }}>
                organisations → users → commits → jobs → scores + issues<br />
                Every table carries <code style={{ fontFamily: "'DM Mono', monospace", color: "#6366f1", fontSize: 12 }}>org_id</code> — row-level tenant isolation on every query.<br />
                <code style={{ fontFamily: "'DM Mono', monospace", color: "#6366f1", fontSize: 12 }}>is_personal = true</code> means a solo developer's GitHub account is treated as an org of one — no schema changes needed.
              </div>
            </div>
          </div>
        )}

        {/* COMPONENT BREAKDOWN */}
        {activeTab === "Component Breakdown" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {componentBreakdown.map(view => (
              <div key={view.view} style={{ background: "#fff", border: "1px solid #ebebea", borderLeft: `3px solid ${view.color}`, borderRadius: 10, padding: "16px 20px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: view.color, flexShrink: 0 }} />
                  {view.view}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 8 }}>
                  {view.components.map(c => (
                    <div key={c.name} style={{ background: "#f8f8f7", borderRadius: 8, padding: "10px 14px" }}>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 600, color: view.color, marginBottom: 4 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{c.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* DATA FLOW */}
        {activeTab === "Data Flow" && (
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {dataFlows.map((f, i) => (
                <button key={f.title} onClick={() => setSelectedFlow(i)} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500, background: selectedFlow === i ? f.color : "#fff", color: selectedFlow === i ? "#fff" : "#666", border: selectedFlow === i ? "none" : "1px solid #e8e8e6" }}>{f.title}</button>
              ))}
            </div>
            {selectedFlow === 2 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#166534", marginBottom: 14 }}>
                Upgraded from v1 — WebSocket now sends full payload. React Query cache updated directly. One less network round trip per analysis result.
              </div>
            )}
            <div style={{ background: "#fff", border: `2px solid ${dataFlows[selectedFlow].color}`, borderRadius: 14, padding: "24px 28px" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 20 }}>{dataFlows[selectedFlow].title}</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {dataFlows[selectedFlow].steps.map((step, i, arr) => (
                  <div key={i} style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 32, flexShrink: 0 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: dataFlows[selectedFlow].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{i + 1}</div>
                      {i < arr.length - 1 && <div style={{ width: 2, flex: 1, background: "#f0f0ee", minHeight: 16 }} />}
                    </div>
                    <div style={{ padding: "2px 0 20px", fontSize: 13, color: step.startsWith("OLD") ? "#aaa" : step.startsWith("NEW") ? "#059669" : "#444", lineHeight: 1.7, fontWeight: step.startsWith("NEW") ? 500 : 400 }}>{step}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TECH DECISIONS */}
        {activeTab === "Tech Decisions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {techDecisions.map((d, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #ebebea", borderRadius: 12, padding: "18px 22px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 12 }}>{d.decision}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Why</div>
                    <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7 }}>{d.reason}</div>
                  </div>
                  <div style={{ background: "#fffbeb", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Tradeoff</div>
                    <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7 }}>{d.tradeoff}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
