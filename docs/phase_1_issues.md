# DevLens — Phase 1: Issue-Driven Development

> **Phase goal:** A working code reviewer a solo developer can actually use.
> Push code → webhook fires → AI analyses → results appear on dashboard in under 30 seconds.
>
> **Completion signal:** A real GitHub repo is connected, a real push is made, real scores and issues with explanations appear on the dashboard via WebSocket — live, in under 30 seconds.

---

## How to use this file

Each issue below maps to one unit of work. Work through them in order — each one depends on the previous being complete. When an issue is done, check the box and commit with the standard message shown at the bottom of each issue.

Do not skip ahead. The order is deliberate — infrastructure before features, backend before frontend, data layer before API layer.

---

## Epic 1 — Project Infrastructure

> Get the project running locally with all tools connected before writing any feature code.

---

### Issue 1.1 — Backend dependencies and project config

**What:** Install all backend dependencies and configure the project settings layer.

**Why:** Every subsequent backend issue depends on these packages being available and config being loadable from environment variables.

**Tasks:**
- [ ] Add all Phase 1 backend dependencies via uv:
  ```
  uv add fastapi uvicorn sqlalchemy alembic psycopg2-binary
  uv add python-jose[cryptography] passlib httpx python-dotenv
  uv add redis rq pydantic-settings websockets
  ```
- [ ] Create `app/config.py` — load all env vars via `pydantic-settings` `BaseSettings`:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `GITHUB_WEBHOOK_SECRET`
  - `JWT_SECRET`
  - `JWT_EXPIRE_HOURS`
  - `HUGGINGFACE_API_TOKEN`
  - `APP_ENV` (development / production)
  - `FRONTEND_URL`
- [ ] Populate `.env` with placeholder values for all of the above
- [ ] Verify config loads without error: `uv run python -c "from app.config import settings; print(settings.APP_ENV)"`

**Commit message:**
```
feat(backend): add Phase 1 dependencies and pydantic settings config
```

---

### Issue 1.2 — Database setup and SQLAlchemy base

**What:** Connect to PostgreSQL, create the SQLAlchemy engine and session factory, and initialise Alembic.

**Why:** Every model, migration, and database operation depends on this foundation.

**Tasks:**
- [ ] Install and start PostgreSQL locally (or use a local Docker container)
- [ ] Create a `devlens` database
- [ ] Update `DATABASE_URL` in `.env` to point to the local database
- [ ] Create `app/database.py`:
  - SQLAlchemy `create_engine()` using `DATABASE_URL` from settings
  - `SessionLocal` session factory
  - `Base` declarative base class
  - `get_db()` dependency function for FastAPI route injection
- [ ] Initialise Alembic inside the `backend` folder:
  ```
  uv run alembic init migrations
  ```
- [ ] Configure `migrations/env.py`:
  - Import `Base` from `app.database`
  - Import all models (so Alembic detects them)
  - Set `target_metadata = Base.metadata`
  - Load `DATABASE_URL` from settings
- [ ] Verify connection: `uv run alembic current` should return without error

**Commit message:**
```
feat(backend): configure SQLAlchemy engine, session factory, and Alembic
```

---

### Issue 1.3 — Redis and RQ queue setup

**What:** Connect to Redis and initialise the RQ job queue.

**Why:** The webhook receiver enqueues jobs to Redis. The worker reads from Redis. Neither works without this.

**Tasks:**
- [ ] Install and start Redis locally
- [ ] Update `REDIS_URL` in `.env` (default: `redis://localhost:6379`)
- [ ] Create `app/worker/queue.py`:
  - Redis connection using `REDIS_URL` from settings
  - RQ `Queue` instance named `devlens`
  - `enqueue_job()` helper function — accepts job function and kwargs
- [ ] Verify Redis connection:
  ```
  uv run python -c "from app.worker.queue import redis_conn; print(redis_conn.ping())"
  ```
  Should print `True`

**Commit message:**
```
feat(backend): configure Redis connection and RQ job queue
```

---

### Issue 1.4 — FastAPI app initialisation and health endpoint

**What:** Create the FastAPI app entry point, register middleware and routers, and add the health endpoint.

**Why:** Without a running FastAPI app nothing can be tested. The health endpoint is the first thing that can be demoed.

**Tasks:**
- [ ] Create `app/main.py`:
  - FastAPI app instance with title `DevLens`
  - CORS middleware allowing `FRONTEND_URL` from settings
  - Router registration (routers will be added in later issues — register them here as they are created)
- [ ] Create `app/routes/health.py`:
  - `GET /api/health` — returns:
    ```json
    {
      "status": "ok",
      "queue_depth": 0,
      "ai_engine": "huggingface",
      "app_env": "development"
    }
    ```
  - No auth required
- [ ] Register health router in `main.py`
- [ ] Run the server and verify health endpoint responds:
  ```
  uv run uvicorn app.main:app --reload
  curl http://localhost:8000/api/health
  ```

**Commit message:**
```
feat(backend): initialise FastAPI app with CORS and health endpoint
```

---

## Epic 2 — Database Models and Migrations

> Define every table Phase 1 needs, create the migrations, and apply them.

---

### Issue 2.1 — SQLAlchemy models

**What:** Create all SQLAlchemy ORM models for Phase 1.

**Why:** Models define the shape of the database. Alembic reads them to generate migrations. Every service that touches the database uses these.

**Tasks:**
- [ ] Create `app/models/organisation.py` — `Organisation` model:
  - `id` UUID PK
  - `github_id` BIGINT UNIQUE
  - `name` VARCHAR(255)
  - `is_personal` BOOLEAN DEFAULT false
  - `created_at` TIMESTAMPTZ DEFAULT now()

- [ ] Create `app/models/user.py` — `User` model:
  - `id` UUID PK
  - `org_id` UUID FK → organisations
  - `github_id` BIGINT UNIQUE
  - `username` VARCHAR(255)
  - `email` VARCHAR(255) NULLABLE
  - `primary_role` VARCHAR(50) NULLABLE (null = not yet onboarded)
  - `avatar_url` TEXT NULLABLE
  - `created_at` TIMESTAMPTZ DEFAULT now()

- [ ] Create `app/models/repo.py` — `Repo` model:
  - `id` UUID PK
  - `org_id` UUID FK → organisations
  - `github_repo_id` BIGINT UNIQUE
  - `name` VARCHAR(255)
  - `full_name` VARCHAR(255)
  - `default_branch` VARCHAR(100) DEFAULT `main`
  - `webhook_id` BIGINT NULLABLE
  - `security_threshold` SMALLINT DEFAULT 70
  - `created_at` TIMESTAMPTZ DEFAULT now()

- [ ] Create `app/models/commit.py` — `Commit` model:
  - `id` UUID PK
  - `org_id` UUID FK → organisations
  - `repo_id` UUID FK → repos
  - `sha` VARCHAR(40) UNIQUE
  - `branch` VARCHAR(255)
  - `author_github_id` BIGINT NULLABLE
  - `message` TEXT
  - `files_changed` INTEGER DEFAULT 0
  - `pushed_at` TIMESTAMPTZ DEFAULT now()

- [ ] Create `app/models/job.py` — `Job` model:
  - `id` UUID PK
  - `org_id` UUID FK → organisations
  - `commit_id` UUID FK → commits
  - `status` VARCHAR(20) DEFAULT `pending` (pending / processing / complete / failed)
  - `retry_count` INTEGER DEFAULT 0
  - `ai_engine` VARCHAR(20) NULLABLE (huggingface / local)
  - `degraded` BOOLEAN DEFAULT false
  - `queue_wait_ms` INTEGER NULLABLE
  - `analysis_ms` INTEGER NULLABLE
  - `end_to_end_ms` INTEGER NULLABLE
  - `error_message` TEXT NULLABLE
  - `created_at` TIMESTAMPTZ DEFAULT now()
  - `completed_at` TIMESTAMPTZ NULLABLE

- [ ] Create `app/models/score.py` — `Score` model:
  - `id` UUID PK
  - `org_id` UUID FK → organisations
  - `commit_id` UUID FK → commits
  - `dimension` VARCHAR(20) (security / performance / readability / complexity / bug_risk)
  - `score` SMALLINT
  - `created_at` TIMESTAMPTZ DEFAULT now()

- [ ] Create `app/models/issue.py` — `Issue` model:
  - `id` UUID PK
  - `org_id` UUID FK → organisations
  - `commit_id` UUID FK → commits
  - `file_path` TEXT
  - `line_number` INTEGER NULLABLE
  - `dimension` VARCHAR(20)
  - `severity` VARCHAR(10) (critical / warning / info)
  - `title` VARCHAR(255)
  - `explanation` TEXT
  - `suggestion` TEXT
  - `created_at` TIMESTAMPTZ DEFAULT now()

- [ ] Import all models in `app/models/__init__.py`
- [ ] Import all models in `migrations/env.py` so Alembic detects them

**Commit message:**
```
feat(backend): add SQLAlchemy ORM models for all Phase 1 tables
```

---

### Issue 2.2 — Initial migration: create tables

**What:** Generate and apply the Alembic migration that creates all Phase 1 tables.

**Why:** Without applying the migration, the database has no tables and nothing works.

**Tasks:**
- [ ] Generate migration:
  ```
  uv run alembic revision --autogenerate -m "create_initial_tables"
  ```
- [ ] Review the generated file in `migrations/versions/` — confirm all 7 tables are present
- [ ] Apply migration:
  ```
  uv run alembic upgrade head
  ```
- [ ] Verify tables exist in PostgreSQL:
  ```
  psql devlens -c "\dt"
  ```
  Should list: organisations, users, repos, commits, jobs, scores, issues

**Commit message:**
```
feat(backend/migrations): create initial tables migration
```

---

### Issue 2.3 — Indexes migration

**What:** Generate and apply a dedicated Alembic migration that adds all indexes.

**Why:** Without indexes the system works under light load but breaks under team-level concurrency. Indexes are always in their own migration — never mixed with table creation.

**Tasks:**
- [ ] Generate blank migration:
  ```
  uv run alembic revision -m "add_indexes"
  ```
- [ ] Manually add all indexes to the `upgrade()` function:
  ```python
  op.create_index("idx_users_github_id", "users", ["github_id"])
  op.create_index("idx_repos_org", "repos", ["org_id"])
  op.create_index("idx_commits_org_repo", "commits", ["org_id", "repo_id"])
  op.create_index("idx_commits_org_pushed", "commits", ["org_id", "pushed_at"],
      postgresql_ops={"pushed_at": "DESC"})
  op.create_index("idx_commits_author", "commits", ["author_github_id"])
  op.create_index("idx_jobs_status", "jobs", ["status"])
  op.create_index("idx_jobs_commit", "jobs", ["commit_id"])
  op.create_index("idx_jobs_status_retry", "jobs", ["status", "retry_count"])
  op.create_index("idx_scores_commit", "scores", ["commit_id"])
  op.create_index("idx_scores_org_dimension", "scores", ["org_id", "dimension"])
  op.create_index("idx_issues_commit", "issues", ["commit_id"])
  op.create_index("idx_issues_org_severity", "issues", ["org_id", "severity"])
  op.create_index("idx_issues_org_dimension", "issues", ["org_id", "dimension"])
  ```
- [ ] Add corresponding `drop_index` calls to `downgrade()`
- [ ] Apply migration:
  ```
  uv run alembic upgrade head
  ```
- [ ] Verify: `uv run alembic current` should show head

**Commit message:**
```
feat(backend/migrations): add indexing strategy for all high-traffic query patterns
```

---

## Epic 3 — Authentication

> GitHub OAuth login, JWT issuance, onboarding screen, and middleware that enforces auth on every route.

---

### Issue 3.1 — Pydantic schemas for auth

**What:** Define the request and response shapes for all auth operations.

**Why:** Schemas are the contract between the API and its callers. Defining them before the routes means the routes have a clear shape to build towards.

**Tasks:**
- [ ] Create `app/schemas/auth.py`:
  - `GitHubCallbackQuery` — `code: str`, `state: str`
  - `OnboardingRequest` — `primary_role: str`
  - `JWTPayload` — `user_id: str`, `org_id: str`, `github_id: int`, `primary_role: str`, `active_role: str`, `exp: int`
  - `AuthResponse` — `access_token: str`, `token_type: str = "bearer"`
  - `UserResponse` — `id: str`, `username: str`, `avatar_url: str`, `primary_role: str`, `active_role: str`, `org_id: str`

**Commit message:**
```
feat(backend/schemas): add auth request and response schemas
```

---

### Issue 3.2 — Auth service

**What:** The business logic for GitHub OAuth exchange, user creation, JWT creation and validation.

**Why:** Services contain the logic. Routes call services. Keeping them separate means the logic is testable without spinning up HTTP.

**Tasks:**
- [ ] Create `app/services/auth_service.py`:
  - `exchange_github_code(code)` — POST to GitHub OAuth token endpoint, return access token
  - `get_github_user(access_token)` — GET github.com/api/user, return user profile dict
  - `get_or_create_user(db, github_user)` — upsert user + org in DB, return User model
  - `create_jwt(user)` — sign JWT with `JWT_SECRET`, include all payload fields, set expiry
  - `decode_jwt(token)` — verify and decode, raise `HTTPException(401)` on invalid
  - `is_onboarded(user)` — return True if `primary_role` is not null

**Commit message:**
```
feat(backend/services): add auth service — OAuth exchange, user upsert, JWT
```

---

### Issue 3.3 — Auth middleware

**What:** FastAPI middleware that decodes the JWT and injects `org_id` and `active_role` into every request before any handler runs.

**Why:** This is the enforcement layer. Every protected route gets `org_id` and `active_role` without having to decode the JWT itself. It is physically impossible to forget auth on a new endpoint when middleware handles it.

**Tasks:**
- [ ] Create `app/middleware/auth.py`:
  - `get_current_user(token, db)` — FastAPI dependency
  - Decodes JWT using `auth_service.decode_jwt()`
  - Looks up user in DB by `user_id` from JWT
  - Returns user object — injected into any route that declares it as a dependency
- [ ] Create `app/middleware/rate_limit.py`:
  - In-memory rate limiter — 100 requests per minute per JWT identity
  - Returns `HTTPException(429)` with `Retry-After` header on exceed

**Commit message:**
```
feat(backend/middleware): add JWT auth dependency and rate limiter
```

---

### Issue 3.4 — Auth routes

**What:** The three auth endpoints — GitHub OAuth initiation, OAuth callback, and onboarding.

**Why:** These are the entry points to the entire application. Nothing else works until a user can log in.

**Tasks:**
- [ ] Create `app/routes/auth.py`:
  - `GET /auth/github` — redirect to GitHub OAuth consent URL with `client_id` and `state`
  - `GET /auth/callback`:
    - Receive `code` and `state` from GitHub
    - Call `auth_service.exchange_github_code(code)`
    - Call `auth_service.get_github_user(access_token)`
    - Call `auth_service.get_or_create_user(db, github_user)`
    - If `user.primary_role` is null → redirect to `FRONTEND_URL/onboarding`
    - Else → issue JWT, redirect to `FRONTEND_URL/dashboard` with token
  - `POST /auth/onboarding` (protected):
    - Accepts `OnboardingRequest` — `primary_role`
    - Validates role is one of: developer, senior, qa, devops, cso
    - Sets `user.primary_role` in DB
    - Returns new `AuthResponse` with updated JWT
- [ ] Register auth router in `main.py`
- [ ] Test OAuth flow manually with a real GitHub account

**Commit message:**
```
feat(backend/routes): add GitHub OAuth, callback, and onboarding endpoints
```

---

## Epic 4 — Webhook Pipeline

> Receive GitHub events, validate them, deduplicate, and enqueue for analysis.

---

### Issue 4.1 — Webhook schemas and service

**What:** The Pydantic schema for the inbound GitHub webhook payload and the service that validates, deduplicates, and enqueues.

**Why:** The webhook receiver must validate the payload shape before touching any business logic. The service handles the logic so the route stays thin.

**Tasks:**
- [ ] Create `app/schemas/webhook.py`:
  - `GitHubPushPayload` — `ref: str`, `after: str` (commit SHA), `repository: dict`, `commits: list`, `pusher: dict`
  - Strip and ignore all unexpected fields

- [ ] Create `app/services/webhook_service.py`:
  - `validate_signature(payload_bytes, signature_header)`:
    - Compute HMAC-SHA256 of raw payload bytes using `GITHUB_WEBHOOK_SECRET`
    - Compare with `X-Hub-Signature-256` header using `hmac.compare_digest()`
    - Raise `HTTPException(401)` on mismatch
  - `is_duplicate(redis_conn, sha)`:
    - Check Redis for key `devlens:dedup:{sha}`
    - Return True if exists
  - `mark_processed(redis_conn, sha)`:
    - Set `devlens:dedup:{sha}` in Redis with 86400s TTL (24 hours)
  - `enqueue_analysis(db, redis_conn, payload)`:
    - Create `Commit` row in DB (status pending)
    - Create `Job` row in DB
    - Call `queue.enqueue_job(analyse_commit, job_id=job.id)`
    - Call `mark_processed(redis_conn, sha)`
    - Return job id

**Commit message:**
```
feat(backend/services): add webhook service — signature validation, dedup, enqueue
```

---

### Issue 4.2 — Webhook route

**What:** The `POST /webhook/github` endpoint — the entry point for all GitHub events.

**Why:** This is the trigger for everything. Without it, no analysis ever starts.

**Tasks:**
- [ ] Create `app/routes/webhook.py`:
  - `POST /webhook/github`:
    - Read raw request body as bytes (required for HMAC validation)
    - Call `webhook_service.validate_signature()` — 401 on failure
    - Parse body as `GitHubPushPayload`
    - Only process `push` events — return 200 silently for all others
    - Check `webhook_service.is_duplicate()` — return 200 silently if duplicate
    - Call `webhook_service.enqueue_analysis()`
    - Return `HTTP 202 Accepted` immediately
    - Total response time must be under 200ms
- [ ] Register webhook router in `main.py`
- [ ] Test with a real GitHub push — check that a job appears in Redis:
  ```
  redis-cli llen rq:queue:devlens
  ```

**Commit message:**
```
feat(backend/routes): add POST /webhook/github — validate, dedup, enqueue
```

---

## Epic 5 — AI Service Layer

> The swappable analysis engine — HuggingFace primary, local model fallback, circuit breaker.

---

### Issue 5.1 — Abstract AI interface

**What:** The base class that defines the contract every AI implementation must follow.

**Why:** The worker only ever calls this interface. Swapping between HuggingFace and local model requires no changes anywhere else in the system.

**Tasks:**
- [ ] Create `app/ai/base.py`:
  - `AnalysisResult` dataclass:
    - `scores: dict` — keys are dimension names, values are 0–100 integers
    - `issues: list[dict]` — each with `file_path`, `line_number`, `dimension`, `severity`, `title`, `explanation`, `suggestion`
    - `engine: str` — which engine produced this result
    - `degraded: bool` — True if local fallback ran
  - `BaseAnalyser` abstract class:
    - `analyse(files: list[dict]) -> AnalysisResult` — abstract method
    - `files` is a list of dicts: `{path: str, content: str, language: str}`

**Commit message:**
```
feat(backend/ai): add abstract analyser interface and AnalysisResult dataclass
```

---

### Issue 5.2 — HuggingFace analyser

**What:** The primary AI implementation that calls the HuggingFace inference API.

**Why:** This is the cloud AI engine that runs during normal operation.

**Tasks:**
- [ ] Create `app/ai/huggingface.py` — `HuggingFaceAnalyser(BaseAnalyser)`:
  - Uses `httpx` to call HuggingFace inference API
  - Model: `microsoft/codebert-base` for code analysis
  - 25 second timeout on every call
  - For each file: call API, parse response into scores and issues
  - Each issue must include a generated `explanation` and `suggestion` — use HuggingFace text generation for these
  - Return `AnalysisResult(engine="huggingface", degraded=False)`
  - Raise `httpx.TimeoutException` on timeout — caller handles this
  - API token from `settings.HUGGINGFACE_API_TOKEN`

**Commit message:**
```
feat(backend/ai): add HuggingFace analyser implementation
```

---

### Issue 5.3 — Local model analyser

**What:** The fallback AI implementation that runs a model locally — no API calls, no rate limits.

**Why:** When HuggingFace is down or rate limited, analysis must continue. The local model guarantees availability over quality.

**Tasks:**
- [ ] Create `app/ai/local.py` — `LocalAnalyser(BaseAnalyser)`:
  - Uses `transformers` library: `uv add transformers torch`
  - Model loaded lazily — only on first call, not on import
  - Same interface as `HuggingFaceAnalyser` — same input, same output shape
  - Results marked `degraded=True` always
  - Explanations and suggestions generated locally using the loaded model
  - Return `AnalysisResult(engine="local", degraded=True)`

**Commit message:**
```
feat(backend/ai): add local model analyser with lazy loading
```

---

### Issue 5.4 — Circuit breaker

**What:** Tracks HuggingFace failures and automatically routes to the local model after 3 consecutive failures.

**Why:** Without a circuit breaker, a degraded HuggingFace API causes every job to timeout for 25 seconds before failing. The circuit breaker trips fast and routes around the problem.

**Tasks:**
- [ ] Create `app/ai/circuit_breaker.py` — `CircuitBreaker`:
  - `failure_count: int` — resets to 0 on success
  - `tripped: bool` — True when failure_count >= 3
  - `tripped_at: datetime` — when it tripped
  - `COOLDOWN_SECONDS = 300` (5 minutes)
  - `record_failure()` — increment count, trip if >= 3
  - `record_success()` — reset count, untrip
  - `should_use_fallback()` — returns True if tripped AND cooldown not yet expired
  - `get_analyser()` — returns `HuggingFaceAnalyser` or `LocalAnalyser` based on state
- [ ] Singleton instance — imported and shared across all workers

**Commit message:**
```
feat(backend/ai): add circuit breaker — 3 failures trip to local, 5min cooldown
```

---

## Epic 6 — Worker

> The background process that picks jobs from the queue, runs analysis, saves results, and broadcasts via WebSocket.

---

### Issue 6.1 — Analysis service

**What:** The orchestration service that a worker job calls — fetch files, analyse, save results.

**Why:** The worker task function should be thin. All logic lives in the service so it is testable independently of RQ.

**Tasks:**
- [ ] Create `app/services/analysis_service.py`:
  - `fetch_changed_files(repo_full_name, commit_sha, github_token)`:
    - Call GitHub API to get list of changed files for the commit
    - Fetch file content for each changed file
    - Return list of `{path, content, language}` dicts
    - Language detected from file extension
  - `run_analysis(files)`:
    - Call `circuit_breaker.get_analyser().analyse(files)`
    - Return `AnalysisResult`
  - `save_results(db, job, commit, result)`:
    - Write one `Score` row per dimension (5 total)
    - Write one `Issue` row per flagged issue — including `explanation` and `suggestion`
    - Update `Job` row: status=complete, ai_engine, degraded, analysis_ms, end_to_end_ms
    - All writes in a single DB transaction — no partial results

**Commit message:**
```
feat(backend/services): add analysis service — fetch files, run AI, save results
```

---

### Issue 6.2 — Notification service

**What:** Broadcasts job events via WebSocket to all connected clients in the org.

**Why:** `analysis_service` calls `notification_service` after saving results — same pipeline domain. This is the correct cross-service call pattern.

**Tasks:**
- [ ] Create `app/services/notification_service.py`:
  - `connections: dict[str, list[WebSocket]]` — keyed by `org_id`
  - `register(org_id, websocket)` — add to connections dict
  - `unregister(org_id, websocket)` — remove from connections dict
  - `broadcast_job_started(org_id, job_id, commit_sha)` — send event to all org connections
  - `broadcast_job_complete(org_id, payload)`:
    - `payload` is the full result — scores, issues, job metadata
    - Sends to all connections in the org
    - Full payload means the frontend updates the cache directly — no REST refetch needed
  - Handle disconnected clients gracefully — remove from dict on send failure

**Commit message:**
```
feat(backend/services): add notification service — WebSocket broadcast with full payload
```

---

### Issue 6.3 — Worker task

**What:** The RQ task function that orchestrates the full analysis pipeline for one job.

**Why:** This is the function RQ calls. It must be idempotent — safe to retry. Every failure is logged with the job ID.

**Tasks:**
- [ ] Create `app/worker/tasks.py` — `analyse_commit(job_id: str)`:
  - Load job from DB by `job_id`
  - If job status is already `complete` — return immediately (idempotency)
  - Update job status to `processing`, record `queue_wait_ms`
  - Broadcast `job.started` via `notification_service`
  - Call `analysis_service.fetch_changed_files()`
  - Call `analysis_service.run_analysis()`
  - Call `analysis_service.save_results()`
  - Broadcast `job.complete` with full payload via `notification_service`
  - On any exception:
    - Increment `job.retry_count`
    - Set `job.error_message`
    - Set `job.status = "failed"` if `retry_count >= 3`
    - Log structured error with `job_id`, `error`, `retry_count`
    - Re-raise so RQ handles the retry with backoff

**Commit message:**
```
feat(backend/worker): add analyse_commit task — full pipeline, idempotent, structured logging
```

---

## Epic 7 — API Routes

> The REST endpoints and WebSocket connection the React frontend calls.

---

### Issue 7.1 — Dashboard and commit schemas

**What:** Pydantic response schemas for the developer dashboard and commit results.

**Tasks:**
- [ ] Create `app/schemas/dashboard.py`:
  - `ScoreResponse` — `dimension: str`, `score: int`
  - `IssueResponse` — all issue fields including `explanation` and `suggestion`
  - `DeveloperDashboardResponse`:
    - `latest_commit: dict` — sha, message, pushed_at
    - `scores: list[ScoreResponse]`
    - `issues: list[IssueResponse]`
    - `growth: list[dict]` — last 30 days of scores for growth chart
    - `streak: int` — consecutive clean commits
    - `job_status: str` — current job state
  - `CommitDetailResponse`:
    - `commit: dict`
    - `job: dict` — status, ai_engine, degraded, end_to_end_ms
    - `scores: list[ScoreResponse]`
    - `issues: list[IssueResponse]`

**Commit message:**
```
feat(backend/schemas): add developer dashboard and commit detail response schemas
```

---

### Issue 7.2 — Dashboard service

**What:** Queries the database and builds the role-aware dashboard response. Receives the resolved user as a parameter — never re-fetches from auth.

**Tasks:**
- [ ] Create `app/services/dashboard_service.py`:
  - `get_developer_dashboard(db, user)`:
    - Fetch latest commit for this user in their org
    - Fetch scores and issues for that commit
    - Fetch last 30 days of daily average scores for growth chart
    - Calculate streak — consecutive commits with no critical issues
    - Return `DeveloperDashboardResponse`
  - `get_commit_detail(db, user, sha)`:
    - Fetch commit by SHA scoped to `user.org_id`
    - Fetch job, scores, and issues
    - Return `CommitDetailResponse`

**Commit message:**
```
feat(backend/services): add dashboard service — developer view and commit detail
```

---

### Issue 7.3 — Dashboard and commit routes

**What:** The REST endpoints the React frontend calls to load dashboard data and commit results.

**Tasks:**
- [ ] Create `app/routes/dashboard.py`:
  - `GET /api/dashboard/developer` (protected):
    - Inject current user via auth middleware
    - Call `dashboard_service.get_developer_dashboard(db, user)`
    - Return `DeveloperDashboardResponse`
- [ ] Create `app/routes/repos.py`:
  - `GET /api/commits/:sha/results` (protected):
    - Call `dashboard_service.get_commit_detail(db, user, sha)`
    - Return `CommitDetailResponse`
  - `GET /api/repos` (protected):
    - List all repos connected to the user's org
    - Return list of repo summaries
- [ ] Register both routers in `main.py`

**Commit message:**
```
feat(backend/routes): add developer dashboard, commit detail, and repos endpoints
```

---

### Issue 7.4 — WebSocket route

**What:** The persistent WebSocket connection that pushes live analysis events to the dashboard.

**Why:** This is what makes results appear in real time without refreshing. The full payload is sent here so the frontend can update the React Query cache directly.

**Tasks:**
- [ ] Create `app/routes/websocket.py`:
  - `WS /ws/live`:
    - Accept JWT as `?token=` query parameter on handshake
    - Decode and validate JWT — close with code 4001 if invalid
    - Extract `org_id` from JWT
    - Register connection with `notification_service.register(org_id, websocket)`
    - Keep connection alive — send ping every 30 seconds
    - On disconnect — call `notification_service.unregister(org_id, websocket)`
- [ ] Register WebSocket router in `main.py`
- [ ] Test manually using a WebSocket client (e.g. `wscat -c "ws://localhost:8000/ws/live?token=..."`)

**Commit message:**
```
feat(backend/routes): add WebSocket /ws/live — auth on handshake, full payload broadcast
```

---

## Epic 8 — Frontend Foundation

> React app setup, auth flow, and the core hooks and context that every view depends on.

---

### Issue 8.1 — Frontend dependencies and project config

**What:** Install all frontend dependencies and configure the React Query client and environment.

**Tasks:**
- [ ] Install dependencies:
  ```
  npm install @tanstack/react-query axios react-router-dom recharts
  npm install -D tailwindcss @tailwindcss/vite
  ```
- [ ] Configure Tailwind in `vite.config.js`
- [ ] Create `src/queryClient.js`:
  - React Query client with:
    - `staleTime: 30000` (30 seconds)
    - `retry: 2`
    - `refetchOnWindowFocus: false`
- [ ] Update `src/main.jsx`:
  - Wrap app in `QueryClientProvider` with the query client
  - Wrap app in `BrowserRouter`
  - Wrap app in `AuthContext` provider
  - Wrap app in `WebSocketContext` provider
- [ ] Update `.env`:
  - `VITE_API_BASE_URL=http://localhost:8000`

**Commit message:**
```
feat(frontend): add React Query, Axios, React Router, Recharts, and Tailwind
```

---

### Issue 8.2 — Auth context and API client

**What:** The `AuthContext` that holds the JWT and user state across the app, and the Axios client that attaches the JWT to every request.

**Tasks:**
- [ ] Create `src/api/client.js`:
  - Axios instance with `baseURL` from `VITE_API_BASE_URL`
  - Request interceptor — attach `Authorization: Bearer <token>` from localStorage
  - Response interceptor — on 401 redirect to `/auth/github`

- [ ] Create `src/context/AuthContext.jsx`:
  - Store JWT in localStorage
  - Decode JWT on load — extract `user_id`, `org_id`, `primary_role`, `active_role`
  - Expose: `user`, `token`, `isAuthenticated`, `isOnboarded`, `login(token)`, `logout()`
  - `login(token)` — save to localStorage, decode, set state
  - `logout()` — clear localStorage, redirect to login

- [ ] Create `src/hooks/useAuth.js`:
  - Reads from `AuthContext`
  - Exposes: `user`, `isAuthenticated`, `isOnboarded`, `activeRole`, `primaryRole`

**Commit message:**
```
feat(frontend): add AuthContext, Axios client with JWT interceptor, useAuth hook
```

---

### Issue 8.3 — WebSocket context and hook

**What:** A single WebSocket connection shared across the entire app via context, with automatic reconnection and direct React Query cache updates.

**Why:** Without this, every component that needs live data would open its own WebSocket connection. One shared connection is correct.

**Tasks:**
- [ ] Create `src/context/WebSocketContext.jsx`:
  - Opens one WS connection to `/ws/live?token=<jwt>` on mount
  - Stores connection in context
  - Reconnection with exponential backoff: 1s → 2s → 4s → 8s
  - Exposes: `isConnected`, `lastEvent`

- [ ] Create `src/hooks/useWebSocket.js`:
  - Reads from `WebSocketContext`
  - On `job.complete` event:
    - Parse full payload from event
    - Call `queryClient.setQueryData(['dashboard', 'developer'], payload)` directly
    - No REST refetch — cache updated in memory immediately
  - On `job.started` event:
    - Update job status in cache to show live indicator

**Commit message:**
```
feat(frontend): add WebSocket context and hook with direct React Query cache update
```

---

### Issue 8.4 — App routing and auth guard

**What:** Route definitions and an auth guard that redirects unauthenticated users to login and un-onboarded users to onboarding.

**Tasks:**
- [ ] Create `src/App.jsx`:
  - Routes:
    - `/` → redirect to `/dashboard` if authenticated, else `/login`
    - `/login` → login page with GitHub OAuth button
    - `/auth/callback` → handles OAuth callback, saves token, redirects
    - `/onboarding` → onboarding page (protected — must be authenticated)
    - `/dashboard` → dashboard page (protected — must be onboarded)
    - `/commits/:sha` → commit detail page (protected)
  - Auth guard component — wraps protected routes:
    - Not authenticated → redirect to `/login`
    - Authenticated but not onboarded → redirect to `/onboarding`
    - Authenticated and onboarded → render children

**Commit message:**
```
feat(frontend): add app routing, auth guard, and OAuth callback handler
```

---

## Epic 9 — Frontend Pages and Components

> The actual UI — onboarding, dashboard, and commit detail.

---

### Issue 9.1 — Shared components

**What:** The component building blocks used across every view.

**Tasks:**
- [ ] `src/components/layout/TopNav.jsx`:
  - DevLens logo + name
  - User avatar (from JWT)
  - Logout button
  - Live indicator dot — pulsing when WebSocket connected and job processing

- [ ] `src/components/scores/ScoreRing.jsx`:
  - SVG animated ring — draws itself on mount
  - Props: `value` (0–100), `label`, `color`
  - Number animates from 0 to value on first render

- [ ] `src/components/scores/ScoreGrid.jsx`:
  - Renders 5 `ScoreRing` components in a row
  - Props: `scores` object keyed by dimension name

- [ ] `src/components/issues/IssueRow.jsx`:
  - Severity dot, title, file path and line number, timestamp
  - Props: `issue` object

- [ ] `src/components/issues/IssueExplanation.jsx`:
  - Expandable panel — click to reveal
  - Shows `explanation` in plain English
  - Shows `suggestion` as a code block
  - Props: `explanation`, `suggestion`

- [ ] `src/components/issues/IssueList.jsx`:
  - List of `IssueRow` + `IssueExplanation` pairs
  - Filter buttons — by severity (critical / warning / info)
  - Props: `issues` array

- [ ] `src/components/DegradedWarning.jsx`:
  - Yellow banner — "Analysis ran on local fallback model — results may vary"
  - Only shown when `job.degraded === true`

**Commit message:**
```
feat(frontend/components): add shared components — TopNav, ScoreRing, ScoreGrid, IssueList, DegradedWarning
```

---

### Issue 9.2 — Onboarding page

**What:** The first-login screen where the user picks their primary role.

**Tasks:**
- [ ] Create `src/pages/Onboarding.jsx`:
  - Five role cards — one per role
  - Each card has role name, one-line description of what they see
  - Click a card to select it — highlighted state
  - "Get started" button — disabled until a role is selected
  - On submit: POST `/auth/onboarding` with selected role
  - On success: save new JWT, redirect to `/dashboard`
  - Clean, welcoming design — first impression of DevLens

**Commit message:**
```
feat(frontend/pages): add onboarding page — role selection on first login
```

---

### Issue 9.3 — Developer dashboard hooks

**What:** The React Query hooks that fetch developer dashboard data.

**Tasks:**
- [ ] Create `src/hooks/useDashboard.js`:
  - `useDeveloperDashboard()`:
    - `useQuery(['dashboard', 'developer'], () => api.getDashboard('developer'))`
    - Returns `data`, `isLoading`, `isError`

- [ ] Create `src/api/dashboard.js`:
  - `getDashboard(role)` — GET `/api/dashboard/${role}`
  - `getOrgDashboard()` — GET `/api/dashboard/org`

- [ ] Create `src/hooks/useCommit.js`:
  - `useCommit(sha)` — `useQuery(['commit', sha], () => api.getCommit(sha))`

- [ ] Create `src/api/commits.js`:
  - `getCommit(sha)` — GET `/api/commits/${sha}/results`
  - `getRepos()` — GET `/api/repos`

**Commit message:**
```
feat(frontend/hooks): add useDashboard and useCommit React Query hooks
```

---

### Issue 9.4 — Developer dashboard view

**What:** The main dashboard the developer sees after every push.

**Tasks:**
- [ ] Create `src/views/DeveloperView.jsx`:
  - Fetch data via `useDeveloperDashboard()`
  - Loading state — skeleton placeholders
  - Error state — friendly message with retry
  - Empty state — "No pushes yet. Connect a repo and push some code."
  - Renders:
    - Latest commit info — branch, message, time ago
    - `ScoreGrid` — 5 animated rings with latest scores
    - `DegradedWarning` if `job.degraded`
    - `IssueList` — all issues filterable by severity
    - Growth chart — line chart of scores over last 30 days using Recharts
    - Streak badge — "8 consecutive clean commits"

- [ ] Create `src/pages/Dashboard.jsx`:
  - Reads `activeRole` from `useAuth()`
  - For Phase 1: renders `DeveloperView` regardless of role (other views added in Phase 2)

**Commit message:**
```
feat(frontend/views): add developer dashboard — scores, issues, growth chart, streak
```

---

### Issue 9.5 — Commit detail page

**What:** The full result page for a single commit — all files, all issues with explanations.

**Tasks:**
- [ ] Create `src/pages/CommitDetail.jsx`:
  - Fetch via `useCommit(sha)` — sha from URL params
  - Shows: commit SHA, branch, message, author, time
  - Job metadata — AI engine used, degraded flag, end-to-end latency
  - `ScoreGrid` for this commit
  - `IssueList` — all issues with expandable explanations and suggestions
  - Back button → dashboard

**Commit message:**
```
feat(frontend/pages): add commit detail page — full result with explanations
```

---

### Issue 9.6 — Growth chart component

**What:** The line chart showing a developer's score trend over the last 30 days.

**Tasks:**
- [ ] Create `src/components/charts/GrowthChart.jsx`:
  - Recharts `LineChart`
  - One line per dimension — togglable via legend
  - X axis — dates
  - Y axis — 0 to 100
  - Hover tooltip — shows exact score per dimension on a given day
  - Props: `data` array of `{date, security, performance, readability, complexity, bug_risk}`

**Commit message:**
```
feat(frontend/components): add GrowthChart — Recharts line chart for score trends
```

---

## Epic 10 — Integration and Demo Readiness

> Wire everything together, test the full flow end to end, and confirm the demo moment works.

---

### Issue 10.1 — Cloudflare Tunnel setup

**What:** Expose the local FastAPI server to GitHub webhooks via a stable public URL.

**Why:** GitHub webhooks require a publicly accessible URL. Cloudflare Tunnel provides this for free with no session timeout — unlike ngrok.

**Tasks:**
- [ ] Install `cloudflared`:
  - Mac: `brew install cloudflare/cloudflare/cloudflared`
  - Windows: download from cloudflare.com
- [ ] Start tunnel pointing to FastAPI:
  ```
  cloudflared tunnel --url http://localhost:8000
  ```
- [ ] Copy the generated `https://something.trycloudflare.com` URL
- [ ] Register this URL as the webhook endpoint on your test GitHub repo:
  - GitHub repo → Settings → Webhooks → Add webhook
  - Payload URL: `https://something.trycloudflare.com/webhook/github`
  - Content type: `application/json`
  - Secret: same value as `GITHUB_WEBHOOK_SECRET` in `.env`
  - Events: Just the push event

**Commit message:**
```
docs(infra): add Cloudflare Tunnel setup instructions to README
```

---

### Issue 10.2 — Start the RQ worker

**What:** Run the background worker process that pulls jobs from Redis and runs analysis.

**Tasks:**
- [ ] Start the worker in a separate terminal:
  ```
  uv run rq worker devlens
  ```
- [ ] Verify the worker is listening — should print:
  ```
  Worker devlens: started, version X.X.X
  Listening on devlens...
  ```
- [ ] Add worker start command to the project README

**Commit message:**
```
docs(worker): add RQ worker start instructions to README
```

---

### Issue 10.3 — End-to-end integration test

**What:** Manually test the complete Phase 1 flow from git push to dashboard result.

**Why:** Every piece has been tested individually. This confirms they work together as a system.

**Checklist — run through this in order:**
- [ ] FastAPI server running on port 8000
- [ ] Redis running locally
- [ ] RQ worker running and listening
- [ ] Cloudflare Tunnel running and webhook registered on GitHub
- [ ] React frontend running on port 5173

**The test:**
- [ ] Open the DevLens frontend in a browser
- [ ] Click "Login with GitHub" — complete OAuth flow
- [ ] Complete onboarding — select "Developer" role
- [ ] Land on the developer dashboard — should show empty state
- [ ] Open a separate terminal and push a commit with intentional issues to the connected repo:
  ```python
  # Commit this — SQL injection issue
  def get_user(user_id):
      query = f"SELECT * FROM users WHERE id = {user_id}"
      return db.execute(query)
  ```
- [ ] Watch the dashboard — within 2 seconds the live indicator should activate
- [ ] Within 30 seconds scores and issues should appear — no refresh
- [ ] Confirm the security issue is flagged with an explanation and suggestion
- [ ] Confirm `end_to_end_ms` in the job table is under 30000
- [ ] Click the commit row — confirm commit detail page shows full results
- [ ] Confirm `DegradedWarning` does NOT appear (HuggingFace ran successfully)

**Commit message:**
```
test(integration): phase 1 end-to-end flow verified
```

---

### Issue 10.4 — Update README

**What:** Document how to run DevLens Phase 1 from a fresh clone.

**Tasks:**
- [ ] Update root `README.md` with:
  - What DevLens is — one paragraph
  - Phase 1 scope — what is built
  - Prerequisites: Python 3.11+, Node 18+, PostgreSQL, Redis, uv, cloudflared
  - Backend setup:
    ```bash
    cd backend
    uv sync
    cp .env.example .env  # fill in values
    uv run alembic upgrade head
    uv run uvicorn app.main:app --reload
    # In a separate terminal:
    uv run rq worker devlens
    ```
  - Frontend setup:
    ```bash
    cd frontend
    npm install
    cp .env.example .env  # fill in values
    npm run dev
    ```
  - Webhook setup — Cloudflare Tunnel instructions
  - Submodule note:
    ```bash
    git submodule update --init --recursive
    ```

**Commit message:**
```
docs(readme): add Phase 1 setup and run instructions
```

---

## Phase 1 — Done when

- [ ] A real GitHub repo is connected
- [ ] A real push triggers a real webhook
- [ ] Real AI analysis runs — HuggingFace or local fallback
- [ ] Scores and issues appear on the dashboard in real time via WebSocket
- [ ] Every issue has an explanation and a suggested fix
- [ ] End-to-end latency is under 30 seconds
- [ ] The growth chart shows trend data after multiple pushes
- [ ] The commit detail page shows the full result for any commit

---

*Phase 2 begins after every item above is checked.*