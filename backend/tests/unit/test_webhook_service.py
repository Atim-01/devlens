"""
Unit tests for app/services/webhook_service.py

All Redis and database interactions are mocked — these tests run without
any external services.
"""

import hashlib
import hmac
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services.webhook_service import (
    _DEDUP_PREFIX,
    enqueue_analysis,
    is_duplicate,
    mark_processed,
    validate_signature,
)

# ─── validate_signature ───────────────────────────────────────────────────────


def _make_sig(payload: bytes, secret: str) -> str:
    """Helper: compute the correct HMAC-SHA256 signature for a payload."""
    mac = hmac.new(secret.encode("utf-8"), msg=payload, digestmod=hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


def test_validate_signature_valid():
    """A correctly signed payload passes without raising."""
    payload = b'{"ref": "refs/heads/main"}'
    secret = "test_secret"

    with patch("app.services.webhook_service.settings") as mock_settings:
        mock_settings.GITHUB_WEBHOOK_SECRET = secret
        sig = _make_sig(payload, secret)
        # Should not raise
        validate_signature(payload, sig)


def test_validate_signature_missing_header():
    """Missing signature header raises HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        validate_signature(b"payload", None)
    assert exc_info.value.status_code == 401


def test_validate_signature_wrong_format():
    """Signature without 'sha256=' prefix raises HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        validate_signature(b"payload", "md5=abc123")
    assert exc_info.value.status_code == 401


def test_validate_signature_tampered_payload():
    """A valid signature for a different payload raises HTTP 401."""
    secret = "test_secret"
    original_payload = b'{"ref": "refs/heads/main"}'
    tampered_payload = b'{"ref": "refs/heads/evil"}'

    with patch("app.services.webhook_service.settings") as mock_settings:
        mock_settings.GITHUB_WEBHOOK_SECRET = secret
        sig = _make_sig(original_payload, secret)

        with pytest.raises(HTTPException) as exc_info:
            validate_signature(tampered_payload, sig)
        assert exc_info.value.status_code == 401


def test_validate_signature_wrong_secret():
    """Signature computed with a different secret raises HTTP 401."""
    payload = b'{"ref": "refs/heads/main"}'

    with patch("app.services.webhook_service.settings") as mock_settings:
        mock_settings.GITHUB_WEBHOOK_SECRET = "real_secret"
        sig = _make_sig(payload, "wrong_secret")

        with pytest.raises(HTTPException) as exc_info:
            validate_signature(payload, sig)
        assert exc_info.value.status_code == 401


# ─── is_duplicate / mark_processed ───────────────────────────────────────────


def test_is_duplicate_returns_false_when_sha_not_in_redis():
    """SHA not in Redis → not a duplicate."""
    with patch("app.services.webhook_service.redis_conn") as mock_redis:
        mock_redis.exists.return_value = 0
        assert is_duplicate("abc123") is False
        mock_redis.exists.assert_called_once_with(f"{_DEDUP_PREFIX}abc123")


def test_is_duplicate_returns_true_when_sha_in_redis():
    """SHA already in Redis → duplicate."""
    with patch("app.services.webhook_service.redis_conn") as mock_redis:
        mock_redis.exists.return_value = 1
        assert is_duplicate("abc123") is True


def test_mark_processed_sets_key_with_ttl():
    """mark_processed stores the SHA with a 24-hour TTL."""
    with patch("app.services.webhook_service.redis_conn") as mock_redis:
        mark_processed("abc123")
        mock_redis.setex.assert_called_once_with(
            f"{_DEDUP_PREFIX}abc123",
            86400,
            "1",
        )


# ─── enqueue_analysis ─────────────────────────────────────────────────────────


def test_enqueue_analysis_creates_commit_job_and_enqueues():
    """
    enqueue_analysis creates a Commit row, a Job row, enqueues the Celery
    task, and marks the SHA as processed.
    """
    mock_db = MagicMock()
    org_id = uuid.uuid4()

    # Simulate flush() generating UUIDs on the ORM objects.
    # We capture what gets added to the session and assign IDs on flush.
    added_objects = []

    def fake_add(obj):
        added_objects.append(obj)

    def fake_flush():
        for obj in added_objects:
            if not hasattr(obj, "id") or obj.id is None:
                obj.id = uuid.uuid4()

    mock_db.add.side_effect = fake_add
    mock_db.flush.side_effect = fake_flush

    # Repo does not exist yet — query returns None so it gets created.
    mock_db.query.return_value.filter.return_value.first.return_value = None

    with (
        patch("app.services.webhook_service.enqueue_job") as mock_enqueue,
        patch("app.services.webhook_service.mark_processed") as mock_mark,
    ):
        job_id = enqueue_analysis(
            db=mock_db,
            org_id=org_id,
            sha="deadbeef" * 5,
            repo_github_id=12345,
            repo_name="backend",
            repo_full_name="acme/backend",
            default_branch="main",
            branch="main",
            author_github_id=99,
            commit_message="fix: SQL injection",
            files_changed=2,
        )

    # A job ID string should be returned
    assert isinstance(job_id, str)

    # Celery task should have been enqueued with the job_id
    mock_enqueue.assert_called_once()
    call_kwargs = mock_enqueue.call_args
    assert call_kwargs[1]["job_id"] == job_id

    # SHA should be marked as processed
    mock_mark.assert_called_once_with("deadbeef" * 5)


def test_enqueue_analysis_reuses_existing_repo():
    """
    If the Repo row already exists, enqueue_analysis reuses it rather than
    creating a duplicate.
    """
    mock_db = MagicMock()
    org_id = uuid.uuid4()

    existing_repo = MagicMock()
    existing_repo.id = uuid.uuid4()

    added_objects = []

    def fake_add(obj):
        added_objects.append(obj)

    def fake_flush():
        for obj in added_objects:
            if not hasattr(obj, "id") or obj.id is None:
                obj.id = uuid.uuid4()

    mock_db.add.side_effect = fake_add
    mock_db.flush.side_effect = fake_flush

    # First query (Repo lookup) returns existing repo.
    mock_db.query.return_value.filter.return_value.first.return_value = existing_repo

    with (
        patch("app.services.webhook_service.enqueue_job"),
        patch("app.services.webhook_service.mark_processed"),
    ):
        enqueue_analysis(
            db=mock_db,
            org_id=org_id,
            sha="cafebabe" * 5,
            repo_github_id=12345,
            repo_name="backend",
            repo_full_name="acme/backend",
            default_branch="main",
            branch="main",
            author_github_id=99,
            commit_message="chore: update deps",
            files_changed=1,
        )

    # Repo should NOT have been added to the session (it already existed)
    added_types = [type(obj).__name__ for obj in added_objects]
    assert "Repo" not in added_types
