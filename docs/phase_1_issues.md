# DevLens — Phase 1: Issue-Driven Development

> **Phase goal:** A working code reviewer a solo developer can actually use.
> Push code → webhook fires → AI analyses → results appear on dashboard in under 30 seconds.
>
> **Completion signal:** A real GitHub repo is connected, a real push is made, real scores and issues with explanations appear on the dashboard via WebSocket — live, in under 30 seconds.

---

## How to use this file

Each issue below maps to one unit of work. Work through them in order — each one depends on the previous being complete. When an issue is done, check the box and commit with the standard message shown at the bottom of each issue.

Do not skip ahead. The order is deliberate — infrastructure before features, backend before frontend, data layer before API layer.

**Branch naming convention:** Each issue includes a `Branch` field. Create that branch from `main` before starting the issue, work on it, then open a PR back into `main` when done. The pattern is:

- `feat/` — new feature or capability
- `chore/` — tooling, configuration, maintenance
- `test/` — testing and verification work
- `docs/` — documentation only

Example workflow per issue:
```
git checkout main
git pull
git checkout -b feat/backend-dependencies-and-config
# do the work
git add .
git commit -m "feat(backend): add Phase 1 dependencies and pydantic settings config"
git push origin feat/backend-dependencies-and-config
# open PR → merge into main → delete branch
```

**Code quality standard:** Every issue follows this pattern before committing:
1. Run `uv run ruff format .` — auto-formats all files
2. Run `uv run ruff check .` — fixes lint errors (add `--fix` for auto-fixable ones)
3. Run `uv run pytest -v` — full test suite must pass
4. Only then commit and push

---

## Pre-Epic — Code Quality Tooling

> One-time setup that every subsequent issue inherits.

---

### Issue 0.1 — Linting, formatting, and test suite setup

**Branch:** `chore/backend-code-quality-tooling`

**Status:** ✅ Complete

**What:** Install and configure ruff for linting and formatting, pytest for testing.

**Tools installed:**
```
uv add --dev ruff pytest pytest-asyncio httpx
```

**pyproject.toml additions:**
```toml
[tool.ruff]
line-length = 88
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP"]
ignore = ["E501"]

[tool.ruff.lint.per-file-ignores]
"migrations/*" = ["E501", "F401"]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Folder structure created:**
```
tests/
├── __init__.py
├── conftest.py
├── unit/
│   └── __init__.py
└── integration/
    └── __init__.py
```

**Commit message:**
```
chore(backend): add ruff linting, formatting, and pytest test suite
```

---

## Epic 1 — Project Infrastructure

> Get the project running locally with all tools connected before writing any feature code.

---

### Issue 1.1 — Backend dependencies and project config

**Branch:** `feat/backend-dependencies-and-config`

**Status:** ✅ Complete

**What:** Install all backend dependencies and configure the project settings layer.

**Why:** Every subsequent backend issue depends on these packages being available and config being loadable from environment variables.

**Key decision — pydantic-settings over python-dotenv directly:**
We use `pydantic-settings` `BaseSettings` to load environment variables. This gives us type validation on startup — if a required variable is missing or the wrong type, the app fails immediately with a clear error message rather than crashing silently mid-request. We also use `model_config = SettingsConfigDict(env_file=".env")` — the Pydantic V2 pattern — rather than the deprecated inner `Config` class.

**Dependencies installed:**
```
uv add fastapi uvicorn sqlalchemy alembic psycopg2-binary
uv add "python-jose[cryptography]" passlib httpx python-dotenv
uv add redis celery pydantic-settings websockets hiredis
uv add python-multipart
```

Note: `hiredis` added as a performance upgrade — C-based Redis parser significantly faster than the pure Python default.

Note: `rq` was initially planned but replaced with `celery` due to Windows incompatibility. RQ uses Unix `fork` which does not exist on Windows. Celery supports Windows via `worker_pool="solo"`.

**`app/config.py` structure:**
```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"
    GITHUB_CLIENT_ID: str
    GITHUB_CLIENT_SECRET: str
    GITHUB_WEBHOOK_SECRET: str
    JWT_SECRET: str
    JWT_EXPIRE_HOURS: int = 8
    HUGGINGFACE_API_TOKEN: str
    APP_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:5173"

    @property
    def GITHUB_REDIRECT_URI(self) -> str:
        return f"{self.FRONTEND_URL}/auth/callback"

settings = Settings()
```

**`.env` keys required:**
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/devlens
REDIS_URL=redis://localhost:6379
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_WEBHOOK_SECRET=your_webhook_secret
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRE_HOURS=8
HUGGINGFACE_API_TOKEN=your_huggingface_token
APP_ENV=development
FRONTEND_URL=http://localhost:5173
```

**Tests:** `tests/unit/test_config.py` — 2 tests

**Commit message:**
```
feat(backend): add Phase 1 dependencies and pydantic settings config
```

---

### Issue 1.2 — Database setup and SQLAlchemy base

**Branch:** `feat/backend-database-sqlalchemy-alembic`

**Status:** ✅ Complete

**What:** Connect to PostgreSQL, create the SQLAlchemy engine and session factory, and initialise Alembic.

**Why:** Every model, migration, and database operation depends on this foundation.

**Key decision — pool_pre_ping and connection pooling:**
`pool_pre_ping=True` means SQLAlchemy tests the connection before using it — if the database restarted, it reconnects automatically. `pool_size=10` and `max_overflow=20` allows up to 30 simultaneous connections — enough for multiple workers running concurrently.

**Key decision — alembic.ini URL left empty:**
We leave `sqlalchemy.url` empty in `alembic.ini` and load it from settings in `env.py` instead. This prevents the database URL from living in two places and getting out of sync between environments.

**`app/database.py` structure:**
```python
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**migrations/env.py key lines:**
```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401 — registers all models with Base.metadata
from app.config import settings
from app.database import Base

config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
target_metadata = Base.metadata
```

**Tests:** `tests/unit/test_database.py` — 4 tests

**Commit message:**
```
feat(backend): configure SQLAlchemy engine, session factory, and Alembic
```

---

### Issue 1.3 — Redis and Celery queue setup

**Branch:** `feat/backend-redis-rq-queue`

**Status:** ✅ Complete

**What:** Connect to Redis and initialise the Celery task queue.

**Why:** The webhook receiver enqueues jobs. The worker reads from the queue. Neither works without this.

**Key decision — Celery over RQ:**
RQ was the original plan but does not support Windows because it relies on Unix `fork` for its worker process model. Celery is the industry standard Python task queue with full Windows support via `worker_pool="solo"` for development. In production on Linux, `worker_pool` changes to `prefork` for true concurrency — no other changes needed.

**Key decision — task_acks_late and task_reject_on_worker_lost:**
`task_acks_late=True` means a job is only marked done after the worker successfully completes it — if the worker crashes mid-job the task returns to the queue. `task_reject_on_worker_lost=True` ensures tasks are requeued rather than lost if the worker process dies unexpectedly.

**`app/worker/queue.py` structure:**
```python
import redis
from celery import Celery
from app.config import settings

redis_conn = redis.from_url(settings.REDIS_URL, decode_responses=False)

celery_app = Celery(
    "devlens",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.worker.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_pool="solo",
    task_max_retries=3,
    task_default_retry_delay=30,
)

def enqueue_job(task_func, **kwargs):
    return task_func.apply_async(kwargs=kwargs)
```

**Redis on Windows:**
Use Memurai (memurai.com) — a native Windows Redis-compatible server for development. Free developer edition. Installs and runs as a Windows service automatically.

**Tests:** `tests/unit/test_queue.py` — 6 tests

**Commit message:**
```
feat(backend): configure Celery with Redis as task queue (replaces RQ — Windows compatible)
```

---

### Issue 1.4 — FastAPI app initialisation and health endpoint

**Branch:** `feat/backend-fastapi-app-health-endpoint`

**Status:** ✅ Complete

**What:** Create the FastAPI app entry point, register middleware and routers, and add the health endpoint.

**Why:** Without a running FastAPI app nothing can be tested. The health endpoint is the first demonstrable piece of the system.

**Key decision — lifespan over on_event:**
FastAPI deprecated `@app.on_event("startup")` and `@app.on_event("shutdown")` in favour of the `lifespan` context manager pattern. We use `lifespan` from the start to avoid deprecation warnings and align with current FastAPI best practice. Everything before the `yield` in lifespan runs on startup, everything after runs on shutdown.

**Key decision — CORS limited to FRONTEND_URL:**
The CORS middleware only allows requests from `settings.FRONTEND_URL` — not the entire world. This means the API is only callable from our React frontend in the browser. Direct curl calls still work because curl does not send an Origin header.

**`app/main.py` structure:**
```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routes.auth import router as auth_router
from app.routes.health import router as health_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(
    title="DevLens",
    description="AI-powered code review analyst",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=[settings.FRONTEND_URL], ...)
app.include_router(health_router)
app.include_router(auth_router)
```

**Health endpoint response:**
```json
{
  "status": "ok",
  "queue_depth": 0,
  "redis_connected": true,
  "worker_count": 0,
  "ai_engine": "huggingface",
  "app_env": "development"
}
```

**Interactive API docs available at:** `http://localhost:8000/docs`

**Tests:** `tests/unit/test_main.py` — 6 tests

**Commit message:**
```
feat(backend): initialise FastAPI app with CORS and health endpoint
```

---

## Epic 2 — Database Models and Migrations

> Define every table Phase 1 needs, create the migrations, and apply them.

---

### Issue 2.1 — SQLAlchemy models

**Branch:** `feat/backend-orm-models-all-tables`

**Status:** ✅ Complete

**What:** Create all SQLAlchemy ORM models for Phase 1 using the modern `Mapped` and `mapped_column` API.

**Why:** Models define the shape of the database. Alembic reads them to generate migrations. Every service that touches the database uses these.

**Key decision — Mapped and mapped_column over Column:**
We use SQLAlchemy 2.0's modern `Mapped[type]` annotation syntax rather than the legacy `Column()` approach. This gives us full type safety — your IDE understands exactly what type each column holds. `Mapped[str | None]` clearly communicates a nullable column in a way `Column(String, nullable=True)` does not.

**Key decision — UUID primary keys:**
All primary keys are UUIDs rather than auto-incrementing integers. UUIDs are safe to expose in URLs — they reveal nothing about table size or insertion order. Integer IDs like `/commits/1` tell an attacker exactly how many commits exist.

**Key decision — is_personal flag on Organisation:**
Rather than having separate models for personal accounts and team accounts, every user gets an `Organisation` row with `is_personal=True` for personal GitHub accounts. This means the same `org_id` scoping logic works identically for both — no special cases anywhere in the codebase.

**Models created:**
- `app/models/organisation.py` — `Organisation`
- `app/models/user.py` — `User` (primary_role nullable = not yet onboarded)
- `app/models/repo.py` — `Repo` (security_threshold column for CI gate)
- `app/models/commit.py` — `Commit`
- `app/models/job.py` — `Job` (queue_wait_ms, analysis_ms, end_to_end_ms for observability)
- `app/models/score.py` — `Score`
- `app/models/issue.py` — `Issue` (explanation + suggestion columns for learning)

**`app/models/__init__.py` exports all models so Alembic detects them.**

**Tests:** `tests/unit/test_models.py` — 14 tests

**Commit message:**
```
feat(backend): add SQLAlchemy ORM models for all Phase 1 tables
```

---

### Issue 2.2 — Initial migration: create tables

**Branch:** `feat/backend-migration-create-initial-tables`

**Status:** ✅ Complete

**What:** Generate and apply the Alembic migration that creates all Phase 1 tables.

**Why:** Without applying the migration, the database has no tables and nothing works.

**Key decision — autogenerate for table creation:**
We use `--autogenerate` for the initial tables migration because Alembic can compare our models to the empty database and generate the correct SQL. We do NOT use autogenerate for indexes — those are written manually in their own migration.

**Commands run:**
```
uv run alembic revision --autogenerate -m "create_initial_tables"
uv run alembic upgrade head
```

**Verification:**
```
psql -U postgres -d devlens -c "\dt"
```
Should list: commits, issues, jobs, organisations, repos, scores, users

**Tests:** `tests/integration/test_migrations.py` — 7 tests

**Commit message:**
```
feat(backend/migrations): create initial tables migration
```

---

### Issue 2.3 — Indexes migration

**Branch:** `feat/backend-migration-add-indexes`

**Status:** ✅ Complete

**What:** Generate and apply a dedicated Alembic migration that adds all indexes.

**Why:** Without indexes the system works under light load but breaks under team-level concurrency. A full table scan on `jobs` on every worker poll is catastrophic at scale.

**Key decision — indexes in their own migration:**
Indexes are never mixed with table creation migrations. Keeping them separate means they can be dropped and recreated independently without touching the schema.

**Key decision — no autogenerate for indexes:**
Alembic's autogenerate does not reliably detect custom indexes. We write them manually.

**Indexes created:**
```
users:         idx_users_github_id
repos:         idx_repos_org
commits:       idx_commits_org_repo, idx_commits_org_pushed, idx_commits_author
jobs:          idx_jobs_status, idx_jobs_commit, idx_jobs_status_retry
scores:        idx_scores_commit, idx_scores_org_dimension
issues:        idx_issues_commit, idx_issues_org_severity, idx_issues_org_dimension
```

**downgrade() function fully implemented** — every index can be dropped cleanly.

**Tests:** `tests/integration/test_indexes.py` — 7 tests

**Commit message:**
```
feat(backend/migrations): add indexing strategy for all high-traffic query patterns
```

---

## Epic 3 — Authentication

> GitHub OAuth login, JWT issuance, onboarding, role switching, and middleware that enforces auth on every route.

---

### Issue 3.1 — Pydantic schemas for auth

**Branch:** `feat/backend-auth-pydantic-schemas`

**Status:** ✅ Complete

**What:** Define the request and response shapes for all auth operations and the GitHub webhook payload.

**Key decision — model_config extra=ignore on webhook schema:**
`GitHubPushPayload` uses `model_config = {"extra": "ignore"}` — any fields GitHub sends that we have not defined are silently stripped. GitHub sends dozens of fields we do not need.

**Key decision — from_attributes on UserResponse:**
`model_config = {"from_attributes": True}` allows Pydantic to build the response directly from a SQLAlchemy model instance without manually constructing a dict.

**Schemas created:**
- `app/schemas/auth.py` — GitHubCallbackQuery, OnboardingRequest, RoleSwitchRequest, JWTPayload, AuthResponse, UserResponse
- `app/schemas/webhook.py` — GitHubRepository, GitHubPusher, GitHubCommit, GitHubPushPayload

**Tests:** `tests/unit/test_auth_schemas.py` — 8 tests, `tests/unit/test_webhook_schemas.py` — 4 tests

**Commit message:**
```
feat(backend/schemas): add auth request and response schemas
```

---

### Issue 3.2 — Auth service

**Branch:** `feat/backend-auth-service-oauth-jwt`

**Status:** ✅ Complete

**What:** The business logic for GitHub OAuth exchange, user creation, JWT creation and validation.

**Key decision — HS256 over RS256:**
We use symmetric signing because DevLens is a single-server application. RS256 (asymmetric) is needed when multiple separate services verify tokens — we do not have that complexity yet.

**Key decision — GitHub ID not username as foreign key:**
GitHub's numeric `id` is our permanent link. Usernames can change; IDs never do.

**Key decision — active_role in JWT not database:**
Role switching issues a new JWT rather than writing to the database. Role is a UI preference, not a security boundary.

**Key decision — db.flush() not db.commit() in service:**
Services use `flush()` to get generated IDs without committing. The route handler controls the transaction boundary — if anything fails after the service call, the entire transaction rolls back cleanly.

**Key decision — httpx over requests:**
FastAPI is async. The `requests` library is blocking and would freeze the event loop.

**Functions in `app/services/auth_service.py`:**
- `exchange_github_code(code)` — trades OAuth code for GitHub access token
- `get_github_user(access_token)` — fetches user profile from GitHub API
- `get_or_create_org(db, github_user)` — upserts organisation row
- `get_or_create_user(db, github_user)` — upserts user row
- `set_primary_role(db, user, role)` — sets role during onboarding
- `is_onboarded(user)` — True if primary_role is not None
- `create_jwt(user, active_role=None)` — signs JWT with all payload fields
- `decode_jwt(token)` — verifies and decodes JWT, raises ValueError on failure

**Tests:** `tests/unit/test_auth_service.py` — 14 tests

**Commit message:**
```
feat(backend/services): add auth service — OAuth exchange, user upsert, JWT
```

---

### Issue 3.3 — Auth middleware

**Branch:** `feat/backend-auth-middleware-jwt-enforcement`

**Status:** ✅ Complete

**What:** FastAPI dependencies that decode the JWT and inject `org_id` and `active_role` into every protected route before the handler runs.

**Key decision — DB lookup on every request:**
We look up the user in the database on every request. If a user is deleted or suspended, the change takes effect immediately — not after their JWT expires. The cost is one indexed DB query per request.

**Key decision — generic 401 error message:**
We never tell callers whether the token was missing, expired, or tampered with — specific error messages help attackers understand what to fix.

**Key decision — sliding window rate limiting:**
Sliding window counts the last 60 seconds from now rather than fixed buckets, preventing burst patterns that exploit bucket boundaries.

**Key decision — in-memory rate limit store:**
Rate limit counters are in-memory per process for Phase 1. Move to Redis when scaling horizontally.

**Dependencies in `app/middleware/auth.py`:**
- `get_current_user` — validates JWT, looks up user in DB, returns User object
- `get_active_role` — extracts active_role from JWT without DB lookup
- `get_org_id` — extracts org_id from JWT without DB lookup

**`app/middleware/rate_limit.py`:**
- 100 requests per minute per JWT identity (falls back to IP for unauthenticated endpoints)
- Returns 429 with `Retry-After` header on exceed

**Tests:** `tests/unit/test_auth_middleware.py` — 7 tests, `tests/unit/test_rate_limit.py` — 4 tests

**Commit message:**
```
feat(backend/middleware): add JWT auth dependency and rate limiter
```

---

### Issue 3.4 — Auth routes

**Branch:** `feat/backend-auth-routes-oauth-onboarding`

**Status:** ✅ Complete

**What:** The auth endpoints — GitHub OAuth initiation, OAuth callback, onboarding, role switching, and current user.

**Key decision — RedirectResponse over returning URL as JSON:**
The login endpoint returns a redirect directly. The browser follows it automatically — cleaner UX than the frontend parsing a URL and redirecting itself.

**Key decision — token in URL query param not cookie:**
JWT passed as a query parameter for Phase 1 simplicity. A future security hardening phase would switch to HTTP-only cookies.

**Key decision — generic error on OAuth failure:**
When the OAuth callback fails we redirect to `/login?error=auth_failed`. We never expose the actual exception in the URL.

**Key decision — dependency_overrides for testing:**
FastAPI captures dependency references at startup, not at call time. Patching the import does not work. We use `app.dependency_overrides[get_current_user] = lambda: mock_user` in tests — this tells FastAPI directly to use our mock.

**GitHub OAuth App setup required:**
- GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
- Homepage URL: `http://localhost:5173`
- Callback URL: `http://localhost:5173/auth/callback`
- Copy Client ID and Client Secret to `.env`

**Endpoints in `app/routes/auth.py`:**
- `GET /auth/github` — redirect to GitHub OAuth consent screen
- `GET /auth/callback` — handle GitHub redirect, create user, issue JWT
- `POST /auth/onboarding` — set primary_role on first login (protected)
- `POST /auth/switch-role` — update active_role in session, issue new JWT (protected)
- `GET /auth/me` — return current user profile (protected)

**Testing via Swagger UI:**
1. Visit `http://localhost:8000/auth/github` in browser
2. Complete GitHub OAuth flow
3. Copy token from redirect URL (everything after `token=`)
4. Open `http://localhost:8000/docs`
5. Click Authorize → paste token (without "Bearer" prefix — Swagger adds it)
6. Test any protected endpoint

**Tests:** `tests/unit/test_auth_routes.py` — 11 tests

**Commit message:**
```
feat(backend/routes): add GitHub OAuth, callback, and onboarding endpoints
```

---

## Epic 4 — Webhook Pipeline

> Receive GitHub events, validate them, deduplicate, and enqueue for analysis.

---

### Issue 4.1 — Webhook schemas and service

**Branch:** `feat/backend-webhook-service-validate-enqueue`

**Status:** 🔲 Not started

**What:** The service that validates the GitHub webhook signature, deduplicates by commit SHA, and enqueues the analysis job.

**Tasks:**
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
  - `enqueue_analysis(db, sha, repo_full_name, changed_files, pusher)`:
    - Create `Commit` row in DB
    - Create `Job` row in DB (status: pending)
    - Call `enqueue_job(analyse_commit, job_id=str(job.id))`
    - Call `mark_processed(redis_conn, sha)`
    - Return job id
- [ ] Write tests in `tests/unit/test_webhook_service.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/services): add webhook service — signature validation, dedup, enqueue
```

---

### Issue 4.2 — Webhook route

**Branch:** `feat/backend-webhook-route-github-push`

**Status:** 🔲 Not started

**What:** The `POST /webhook/github` endpoint — the entry point for all GitHub push events.

**Tasks:**
- [ ] Create `app/routes/webhook.py`:
  - `POST /webhook/github`:
    - Read raw request body as bytes (required for HMAC validation — parsing first corrupts the bytes)
    - Validate `X-Hub-Signature-256` header via `webhook_service.validate_signature()`
    - Only process `push` events — check `X-GitHub-Event` header, return 200 silently for all others
    - Parse body as `GitHubPushPayload`
    - Skip branch deletions — `payload.after` will be all zeros on delete events
    - Check `webhook_service.is_duplicate()` — return 200 silently if duplicate
    - Call `webhook_service.enqueue_analysis()`
    - Return `HTTP 202 Accepted` immediately
    - Total response time must be under 200ms — GitHub retries on slow responses
- [ ] Register webhook router in `main.py`
- [ ] Write tests in `tests/unit/test_webhook_route.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/routes): add POST /webhook/github — validate, dedup, enqueue
```

---

## Epic 5 — AI Service Layer

> The swappable analysis engine — HuggingFace primary, local model fallback, circuit breaker.

---

### Issue 5.1 — Abstract AI interface

**Branch:** `feat/backend-ai-abstract-interface`

**Status:** 🔲 Not started

**What:** The base class that defines the contract every AI implementation must follow.

**Tasks:**
- [ ] Create `app/ai/base.py`:
  - `AnalysisResult` dataclass:
    - `scores: dict`, `issues: list[dict]`, `engine: str`, `degraded: bool`
  - `BaseAnalyser` abstract class:
    - `analyse(files: list[dict]) -> AnalysisResult` — abstract method
- [ ] Write tests in `tests/unit/test_ai_base.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/ai): add abstract analyser interface and AnalysisResult dataclass
```

---

### Issue 5.2 — HuggingFace analyser

**Branch:** `feat/backend-ai-huggingface-analyser`

**Status:** 🔲 Not started

**What:** The primary AI implementation that calls the HuggingFace inference API.

**Tasks:**
- [ ] Create `app/ai/huggingface.py` — `HuggingFaceAnalyser(BaseAnalyser)`:
  - Model: `microsoft/codebert-base`
  - 25 second timeout on every API call
  - Each issue includes generated `explanation` and `suggestion`
  - Return `AnalysisResult(engine="huggingface", degraded=False)`
  - Raise `httpx.TimeoutException` on timeout
- [ ] Write tests in `tests/unit/test_huggingface_analyser.py` (mock HTTP calls)
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/ai): add HuggingFace analyser implementation
```

---

### Issue 5.3 — Local model analyser

**Branch:** `feat/backend-ai-local-model-fallback`

**Status:** 🔲 Not started

**What:** The fallback AI implementation that runs a model locally — no API calls, no rate limits.

**Tasks:**
- [ ] Install: `uv add transformers torch`
- [ ] Create `app/ai/local.py` — `LocalAnalyser(BaseAnalyser)`:
  - Model loaded lazily — only on first call, not on import
  - All results marked `degraded=True`
  - Return `AnalysisResult(engine="local", degraded=True)`
- [ ] Write tests in `tests/unit/test_local_analyser.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/ai): add local model analyser with lazy loading
```

---

### Issue 5.4 — Circuit breaker

**Branch:** `feat/backend-ai-circuit-breaker`

**Status:** 🔲 Not started

**What:** Tracks HuggingFace failures and automatically routes to the local model after 3 consecutive failures. Resets after a 5-minute cooldown.

**Tasks:**
- [ ] Create `app/ai/circuit_breaker.py` — `CircuitBreaker`:
  - `record_failure()`, `record_success()`, `should_use_fallback()`, `get_analyser()`
  - Trips after 3 consecutive failures
  - Cooldown: 300 seconds (5 minutes)
  - Singleton instance shared across all workers
- [ ] Write tests in `tests/unit/test_circuit_breaker.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/ai): add circuit breaker — 3 failures trip to local, 5min cooldown
```

---

## Epic 6 — Worker

> The background process that picks jobs, runs analysis, saves results, and broadcasts via WebSocket.

---

### Issue 6.1 — Analysis service

**Branch:** `feat/backend-analysis-service-orchestration`

**Status:** 🔲 Not started

**What:** The orchestration service the worker calls — fetch files, run AI analysis, save results.

**Tasks:**
- [ ] Create `app/services/analysis_service.py`:
  - `fetch_changed_files(repo_full_name, commit_sha, github_token)`
  - `run_analysis(files)` — calls circuit_breaker.get_analyser().analyse()
  - `save_results(db, job, commit, result)` — single transaction, no partial writes
- [ ] Write tests in `tests/unit/test_analysis_service.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/services): add analysis service — fetch files, run AI, save results
```

---

### Issue 6.2 — Notification service

**Branch:** `feat/backend-notification-service-websocket-broadcast`

**Status:** 🔲 Not started

**What:** Broadcasts job events via WebSocket to all connected clients in the org with the full result payload.

**Key decision — full payload over WebSocket:**
Sending the full result in the WebSocket event allows the frontend to call `queryClient.setQueryData()` directly — eliminating one REST round trip after analysis completes.

**Tasks:**
- [ ] Create `app/services/notification_service.py`:
  - `connections: dict[str, list[WebSocket]]` keyed by org_id
  - `register()`, `unregister()`, `broadcast_job_started()`, `broadcast_job_complete()`
  - Handle disconnected clients gracefully on send failure
- [ ] Write tests in `tests/unit/test_notification_service.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/services): add notification service — WebSocket broadcast with full payload
```

---

### Issue 6.3 — Worker task

**Branch:** `feat/backend-worker-analyse-commit-task`

**Status:** 🔲 Not started

**What:** The Celery task that orchestrates the full analysis pipeline. Idempotent — safe to retry.

**Tasks:**
- [ ] Update `app/worker/tasks.py` — `analyse_commit(job_id: str)`:
  - Idempotency guard — return immediately if job already complete
  - Record queue_wait_ms on pickup
  - Broadcast job.started → fetch files → run AI → save results → broadcast job.complete
  - On exception: increment retry_count, log structured error, re-raise for Celery retry
- [ ] Write tests in `tests/unit/test_worker_tasks.py`
- [ ] Run ruff and full test suite

**To run the Celery worker:**
```
uv run celery -A app.worker.queue.celery_app worker --loglevel=info
```

**Commit message:**
```
feat(backend/worker): add analyse_commit task — full pipeline, idempotent, structured logging
```

---

## Epic 7 — API Routes

> The REST endpoints and WebSocket connection the React frontend calls.

---

### Issue 7.1 — Dashboard and commit schemas

**Branch:** `feat/backend-dashboard-commit-response-schemas`

**Status:** 🔲 Not started

**Tasks:**
- [ ] Create `app/schemas/dashboard.py`:
  - `ScoreResponse`, `IssueResponse`, `DeveloperDashboardResponse`, `CommitDetailResponse`
- [ ] Write tests in `tests/unit/test_dashboard_schemas.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/schemas): add developer dashboard and commit detail response schemas
```

---

### Issue 7.2 — Dashboard service

**Branch:** `feat/backend-dashboard-service-developer-view`

**Status:** 🔲 Not started

**What:** Queries the database and builds the role-aware dashboard response. Receives the resolved user as a parameter — never re-fetches from auth.

**Key decision — user passed as parameter not re-fetched:**
`dashboard_service` receives the user object from the route handler (which got it from middleware). It never calls `auth_service` to re-fetch — that would be a cross-domain service call, which is the anti-pattern we explicitly ruled out.

**Tasks:**
- [ ] Create `app/services/dashboard_service.py`:
  - `get_developer_dashboard(db, user)` — latest commit, scores, issues, 30-day growth, streak
  - `get_commit_detail(db, user, sha)` — full commit result scoped to user.org_id
- [ ] Write tests in `tests/unit/test_dashboard_service.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/services): add dashboard service — developer view and commit detail
```

---

### Issue 7.3 — Dashboard and commit routes

**Branch:** `feat/backend-routes-dashboard-commits-repos`

**Status:** 🔲 Not started

**Tasks:**
- [ ] Create `app/routes/dashboard.py` — `GET /api/dashboard/developer`
- [ ] Create `app/routes/repos.py` — `GET /api/commits/:sha/results`, `GET /api/repos`
- [ ] Register both routers in `main.py`
- [ ] Write tests in `tests/unit/test_dashboard_routes.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/routes): add developer dashboard, commit detail, and repos endpoints
```

---

### Issue 7.4 — WebSocket route

**Branch:** `feat/backend-websocket-route-live-events`

**Status:** 🔲 Not started

**What:** The persistent WebSocket connection that pushes full result payloads to the dashboard.

**Tasks:**
- [ ] Create `app/routes/websocket.py`:
  - `WS /ws/live` — JWT auth on handshake via `?token=` query param
  - Register with notification_service on connect, unregister on disconnect
  - Ping every 30 seconds to detect silent drops
- [ ] Register WebSocket router in `main.py`
- [ ] Write tests in `tests/unit/test_websocket_route.py`
- [ ] Run ruff and full test suite

**Commit message:**
```
feat(backend/routes): add WebSocket /ws/live — auth on handshake, full payload broadcast
```

---

## Epic 8 — Frontend Foundation

> React app setup, auth flow, and the core hooks and context that every view depends on.

---

### Issue 8.1 — Frontend dependencies and project config

**Branch:** `feat/frontend-dependencies-react-query-tailwind`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `npm install @tanstack/react-query axios react-router-dom recharts`
- [ ] `npm install -D tailwindcss @tailwindcss/vite`
- [ ] Configure Tailwind in `vite.config.js`
- [ ] Create `src/queryClient.js` — staleTime 30s, retry 2, no refetch on focus
- [ ] Wrap `src/main.jsx` in QueryClientProvider, BrowserRouter, AuthContext, WebSocketContext
- [ ] Confirm `VITE_API_BASE_URL=http://localhost:8000` in `.env`

**Commit message:**
```
feat(frontend): add React Query, Axios, React Router, Recharts, and Tailwind
```

---

### Issue 8.2 — Auth context and API client

**Branch:** `feat/frontend-auth-context-axios-client`

**Status:** 🔲 Not started

**Tasks:**
- [ ] Create `src/api/client.js` — Axios with JWT interceptor, 401 redirect handler
- [ ] Create `src/context/AuthContext.jsx` — JWT in localStorage, decoded on load
- [ ] Create `src/hooks/useAuth.js`

**Commit message:**
```
feat(frontend): add AuthContext, Axios client with JWT interceptor, useAuth hook
```

---

### Issue 8.3 — WebSocket context and hook

**Branch:** `feat/frontend-websocket-context-direct-cache-update`

**Status:** 🔲 Not started

**Key decision — direct cache update over invalidation:**
On `job.complete` event, call `queryClient.setQueryData()` directly with the full payload — eliminates one REST round trip compared to invalidating and refetching.

**Tasks:**
- [ ] Create `src/context/WebSocketContext.jsx` — single shared WS connection, exponential backoff reconnection
- [ ] Create `src/hooks/useWebSocket.js` — direct cache update on job.complete, REST fill on reconnect

**Commit message:**
```
feat(frontend): add WebSocket context and hook with direct React Query cache update
```

---

### Issue 8.4 — App routing and auth guard

**Branch:** `feat/frontend-routing-auth-guard`

**Status:** 🔲 Not started

**Tasks:**
- [ ] Create `src/App.jsx` with all routes
- [ ] Auth guard: not authenticated → /login, not onboarded → /onboarding, onboarded → render

**Commit message:**
```
feat(frontend): add app routing, auth guard, and OAuth callback handler
```

---

## Epic 9 — Frontend Pages and Components

---

### Issue 9.1 — Shared components

**Branch:** `feat/frontend-shared-components-topnav-scores-issues`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `TopNav.jsx` — logo, avatar, logout, live indicator dot
- [ ] `ScoreRing.jsx` — animated SVG ring, number counts up on mount
- [ ] `ScoreGrid.jsx` — 5 ScoreRings in a row
- [ ] `IssueRow.jsx` — severity, title, file:line, timestamp
- [ ] `IssueExplanation.jsx` — expandable why + fix
- [ ] `IssueList.jsx` — filterable by severity
- [ ] `DegradedWarning.jsx` — yellow banner when local model ran

**Commit message:**
```
feat(frontend/components): add shared components — TopNav, ScoreRing, ScoreGrid, IssueList, DegradedWarning
```

---

### Issue 9.2 — Onboarding page

**Branch:** `feat/frontend-onboarding-role-selection`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `src/pages/Onboarding.jsx` — 5 role cards, POST /auth/onboarding on submit, save JWT, redirect

**Commit message:**
```
feat(frontend/pages): add onboarding page — role selection on first login
```

---

### Issue 9.3 — Developer dashboard hooks

**Branch:** `feat/frontend-hooks-dashboard-commit-queries`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `src/hooks/useDashboard.js`, `src/api/dashboard.js`
- [ ] `src/hooks/useCommit.js`, `src/api/commits.js`

**Commit message:**
```
feat(frontend/hooks): add useDashboard and useCommit React Query hooks
```

---

### Issue 9.4 — Developer dashboard view

**Branch:** `feat/frontend-developer-dashboard-view`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `src/views/DeveloperView.jsx` — loading/error/empty states, ScoreGrid, IssueList, GrowthChart, StreakBadge
- [ ] `src/pages/Dashboard.jsx` — reads activeRole, renders DeveloperView for Phase 1

**Commit message:**
```
feat(frontend/views): add developer dashboard — scores, issues, growth chart, streak
```

---

### Issue 9.5 — Commit detail page

**Branch:** `feat/frontend-commit-detail-page`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `src/pages/CommitDetail.jsx` — commit info, job metadata, ScoreGrid, IssueList with expandable explanations

**Commit message:**
```
feat(frontend/pages): add commit detail page — full result with explanations
```

---

### Issue 9.6 — Growth chart component

**Branch:** `feat/frontend-growth-chart-recharts`

**Status:** 🔲 Not started

**Tasks:**
- [ ] `src/components/charts/GrowthChart.jsx` — Recharts LineChart, one line per dimension, hover tooltip

**Commit message:**
```
feat(frontend/components): add GrowthChart — Recharts line chart for score trends
```

---

## Epic 10 — Integration and Demo Readiness

---

### Issue 10.1 — Cloudflare Tunnel setup

**Branch:** `feat/infra-cloudflare-tunnel-webhook-ingress`

**Status:** 🔲 Not started

**Why Cloudflare Tunnel over ngrok:**
ngrok's free tier resets the URL on every restart — every restart means updating the webhook URL in GitHub. Cloudflare Tunnel gives a stable URL that never changes, is completely free, and has no session timeout.

**Tasks:**
- [ ] Install cloudflared (Mac: brew, Windows: cloudflare.com/products/tunnel)
- [ ] `cloudflared tunnel --url http://localhost:8000`
- [ ] Register `https://something.trycloudflare.com/webhook/github` as GitHub webhook
- [ ] Secret: same value as `GITHUB_WEBHOOK_SECRET` in `.env`
- [ ] Add setup instructions to README

**Commit message:**
```
docs(infra): add Cloudflare Tunnel setup instructions to README
```

---

### Issue 10.2 — Start the Celery worker

**Branch:** `feat/infra-rq-worker-setup`

**Status:** 🔲 Not started

**Tasks:**
- [ ] Start worker: `uv run celery -A app.worker.queue.celery_app worker --loglevel=info`
- [ ] Verify output shows `app.worker.tasks.analyse_commit` registered
- [ ] Add worker start command to README

**Commit message:**
```
docs(worker): add Celery worker start instructions to README
```

---

### Issue 10.3 — End-to-end integration test

**Branch:** `test/phase-1-end-to-end-integration`

**Status:** 🔲 Not started

**All must be running:**
- [ ] FastAPI: `uv run uvicorn app.main:app --reload`
- [ ] Celery: `uv run celery -A app.worker.queue.celery_app worker --loglevel=info`
- [ ] Memurai / Redis
- [ ] Cloudflare Tunnel with webhook registered
- [ ] React frontend: `npm run dev`

**The test:**
- [ ] Login with GitHub, complete onboarding
- [ ] Push a commit with an intentional SQL injection issue
- [ ] Live indicator activates within 2 seconds
- [ ] Scores and issues appear within 30 seconds — no refresh
- [ ] Security issue flagged with explanation and suggestion
- [ ] `end_to_end_ms` in jobs table under 30000
- [ ] Commit detail page shows full results
- [ ] DegradedWarning does NOT appear (HuggingFace ran)

**Commit message:**
```
test(integration): phase 1 end-to-end flow verified
```

---

### Issue 10.4 — Update README

**Branch:** `docs/phase-1-setup-and-run-instructions`

**Status:** 🔲 Not started

**Tasks:**
- [ ] Backend setup, frontend setup, Cloudflare Tunnel instructions
- [ ] Submodule note: `git submodule update --init --recursive`
- [ ] Prerequisites: Python 3.11+, Node 18+, PostgreSQL, Memurai, uv, cloudflared

**Commit message:**
```
docs(readme): add Phase 1 setup and run instructions
```

---

## Changes from original plan

| Original | Changed to | Reason |
|---|---|---|
| `rq` for job queue | `celery` | RQ uses Unix fork — incompatible with Windows |
| `ngrok` for tunnel | Cloudflare Tunnel | ngrok free tier resets URL on restart |
| `Config` inner class in pydantic | `model_config = SettingsConfigDict(...)` | Pydantic V2 deprecation |
| `@app.on_event` in FastAPI | `lifespan` context manager | FastAPI deprecation |
| WS invalidates React Query cache | WS sends full payload, direct cache update | Removes one round trip |
| `patch()` for FastAPI dependency mocking | `app.dependency_overrides` | FastAPI caches dependency references at startup |

---

## Phase 1 — Done when

- [ ] A real GitHub repo is connected
- [ ] A real push triggers a real webhook
- [ ] Real AI analysis runs — HuggingFace or local fallback
- [ ] Scores and issues appear on the dashboard in real time via WebSocket
- [ ] Every issue has a plain-English explanation and a suggested fix
- [ ] End-to-end latency is under 30 seconds
- [ ] The growth chart shows trend data after multiple pushes
- [ ] The commit detail page shows the full result for any commit
- [ ] Full test suite passes — unit and integration
- [ ] ruff format and ruff check pass with zero errors

---

*Phase 2 begins after every item above is checked.*