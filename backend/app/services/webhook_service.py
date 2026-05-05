import hashlib
import hmac

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models.commit import Commit
from app.models.job import Job
from app.models.repo import Repo
from app.worker.queue import enqueue_job, redis_conn
from app.worker.tasks import analyse_commit

# Redis key prefix and TTL for idempotency store.
# A commit SHA stored here means we have already enqueued it.
# 24-hour TTL matches the architecture spec — long enough to catch
# GitHub's retry window, short enough not to block legitimate re-analysis.
_DEDUP_PREFIX = "devlens:dedup:"
_DEDUP_TTL_SECONDS = 86400  # 24 hours


# ─── Signature Validation ─────────────────────────────────────────────────────


def validate_signature(payload_bytes: bytes, signature_header: str | None) -> None:
    """
    Validate the HMAC-SHA256 signature GitHub attaches to every webhook.

    GitHub signs the raw request body with our GITHUB_WEBHOOK_SECRET and
    sends the result in the X-Hub-Signature-256 header as 'sha256=<hex>'.
    We recompute the same HMAC and compare using hmac.compare_digest() —
    a constant-time comparison that prevents timing attacks.

    We must receive the raw bytes before any JSON parsing — parsing first
    would change whitespace and break the signature check.

    Raises HTTP 401 if the signature is missing or does not match.
    """
    if not signature_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing webhook signature",
        )

    # GitHub sends: "sha256=<hex_digest>"
    # We need just the hex digest part for comparison.
    if not signature_header.startswith("sha256="):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature format",
        )

    expected_sig = signature_header[len("sha256=") :]

    # Compute HMAC-SHA256 of the raw payload using our webhook secret.
    # The secret must be encoded to bytes for the HMAC computation.
    mac = hmac.new(
        settings.GITHUB_WEBHOOK_SECRET.encode("utf-8"),
        msg=payload_bytes,
        digestmod=hashlib.sha256,
    )
    computed_sig = mac.hexdigest()

    # compare_digest() is constant-time — it does not short-circuit on the
    # first mismatched character. This prevents timing attacks where an
    # attacker could guess the signature one character at a time by measuring
    # response times.
    if not hmac.compare_digest(computed_sig, expected_sig):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )


# ─── Idempotency ──────────────────────────────────────────────────────────────


def is_duplicate(sha: str) -> bool:
    """
    Check whether we have already enqueued a job for this commit SHA.

    GitHub retries webhooks when it does not receive a fast response.
    Without this check, a slow response or a transient error would cause
    the same commit to be analysed multiple times.

    Returns True if the SHA is already in the Redis idempotency store.
    """
    key = f"{_DEDUP_PREFIX}{sha}"
    return redis_conn.exists(key) == 1


def mark_processed(sha: str) -> None:
    """
    Record a commit SHA in the Redis idempotency store with a 24-hour TTL.

    Called immediately after enqueuing — before returning HTTP 202 —
    so that any retry from GitHub within the TTL window is silently dropped.
    """
    key = f"{_DEDUP_PREFIX}{sha}"
    redis_conn.setex(key, _DEDUP_TTL_SECONDS, "1")


# ─── Repo Resolution ──────────────────────────────────────────────────────────


def get_or_create_repo(
    db: Session,
    org_id,
    github_repo_id: int,
    name: str,
    full_name: str,
    default_branch: str,
) -> Repo:
    """
    Find or create the Repo row for the repository that sent this webhook.

    The Commit model requires an internal repo UUID. The webhook payload
    gives us GitHub's numeric repo ID, so we look up by that and create
    the row if it does not exist yet.

    Uses flush() not commit() — the caller (enqueue_analysis) controls
    the transaction boundary.
    """
    repo = db.query(Repo).filter(Repo.github_repo_id == github_repo_id).first()

    if not repo:
        repo = Repo(
            org_id=org_id,
            github_repo_id=github_repo_id,
            name=name,
            full_name=full_name,
            default_branch=default_branch,
        )
        db.add(repo)
        db.flush()

    return repo


# ─── Enqueue ──────────────────────────────────────────────────────────────────


def enqueue_analysis(
    db: Session,
    org_id,
    sha: str,
    repo_github_id: int,
    repo_name: str,
    repo_full_name: str,
    default_branch: str,
    branch: str,
    author_github_id: int | None,
    commit_message: str,
    files_changed: int,
) -> str:
    """
    Create the Commit and Job rows, enqueue the Celery task, and mark the
    SHA as processed in the idempotency store.

    Returns the job ID (UUID string) so the route handler can include it
    in the 202 response for debugging purposes.

    Transaction boundary: this function uses flush() throughout. The route
    handler calls db.commit() after this returns. If anything fails between
    here and the commit, the entire transaction rolls back — no orphaned
    rows, no job without a commit, no commit without a job.
    """
    # Resolve or create the repo row so we have an internal UUID for the FK.
    repo = get_or_create_repo(
        db,
        org_id=org_id,
        github_repo_id=repo_github_id,
        name=repo_name,
        full_name=repo_full_name,
        default_branch=default_branch,
    )

    # Create the commit row.
    commit = Commit(
        org_id=org_id,
        repo_id=repo.id,
        sha=sha,
        branch=branch,
        author_github_id=author_github_id,
        message=commit_message,
        files_changed=files_changed,
    )
    db.add(commit)
    db.flush()  # Generates commit.id so Job FK is available

    # Create the job row — starts in 'pending' state.
    job = Job(
        org_id=org_id,
        commit_id=commit.id,
        status="pending",
    )
    db.add(job)
    db.flush()  # Generates job.id so we can pass it to Celery

    # Enqueue the Celery task. The worker receives only the job_id —
    # it fetches everything else from the database. This keeps the
    # message payload small and avoids stale data in the queue.
    enqueue_job(analyse_commit, job_id=str(job.id))

    # Mark the SHA as processed so duplicate webhooks are dropped.
    mark_processed(sha)

    return str(job.id)
