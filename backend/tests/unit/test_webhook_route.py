"""
Unit tests for POST /webhook/github.
All service calls and DB interactions are mocked.
"""

import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app

# ─── Helpers ──────────────────────────────────────────────────────────────────

WEBHOOK_SECRET = "test_secret"

VALID_PAYLOAD = {
    "ref": "refs/heads/main",
    "after": "a" * 40,
    "repository": {
        "id": 12345,
        "name": "backend",
        "full_name": "acme/backend",
        "default_branch": "main",
    },
    "pusher": {"name": "alice", "email": "alice@example.com"},
    "commits": [
        {
            "id": "a" * 40,
            "message": "fix: SQL injection",
            "added": ["auth.py"],
            "modified": [],
            "removed": [],
        }
    ],
}


def _sign(payload: dict, secret: str = WEBHOOK_SECRET) -> str:
    body = json.dumps(payload).encode()
    mac = hmac.new(secret.encode(), msg=body, digestmod=hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


def _make_headers(payload: dict, event: str = "push") -> dict:
    return {
        "X-Hub-Signature-256": _sign(payload),
        "X-GitHub-Event": event,
        "Content-Type": "application/json",
    }


# Override DB dependency so tests never touch a real database.
def _mock_db():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    yield db


app.dependency_overrides[get_db] = _mock_db

client = TestClient(app, raise_server_exceptions=False)


# ─── Tests ────────────────────────────────────────────────────────────────────


def test_valid_push_returns_202():
    """A correctly signed push event is accepted and returns 202."""
    import uuid

    mock_user = MagicMock()
    mock_user.org_id = uuid.uuid4()
    mock_user.github_id = 99

    def _db_with_user():
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = mock_user
        yield db

    app.dependency_overrides[get_db] = _db_with_user

    with (
        patch("app.routes.webhook.webhook_service.validate_signature"),
        patch("app.routes.webhook.webhook_service.is_duplicate", return_value=False),
        patch(
            "app.routes.webhook.webhook_service.enqueue_analysis",
            return_value="job-123",
        ),
    ):
        resp = client.post(
            "/webhook/github",
            json=VALID_PAYLOAD,
            headers=_make_headers(VALID_PAYLOAD),
        )

    app.dependency_overrides[get_db] = _mock_db  # restore default
    assert resp.status_code == 202


def test_invalid_signature_returns_401():
    """A tampered or missing signature is rejected with 401."""
    resp = client.post(
        "/webhook/github",
        json=VALID_PAYLOAD,
        headers={
            "X-Hub-Signature-256": "sha256=badhash",
            "X-GitHub-Event": "push",
            "Content-Type": "application/json",
        },
    )
    assert resp.status_code == 401


def test_non_push_event_returns_200():
    """Non-push events (ping, pull_request, etc.) are silently accepted."""
    with patch("app.routes.webhook.webhook_service.validate_signature"):
        resp = client.post(
            "/webhook/github",
            json=VALID_PAYLOAD,
            headers=_make_headers(VALID_PAYLOAD, event="ping"),
        )
    assert resp.status_code == 200


def test_branch_deletion_returns_200():
    """A push where 'after' is all zeros (branch delete) is silently accepted."""
    delete_payload = {**VALID_PAYLOAD, "after": "0" * 40}
    with patch("app.routes.webhook.webhook_service.validate_signature"):
        resp = client.post(
            "/webhook/github",
            json=delete_payload,
            headers=_make_headers(delete_payload),
        )
    assert resp.status_code == 200


def test_duplicate_sha_returns_200():
    """A duplicate commit SHA is silently dropped."""
    with (
        patch("app.routes.webhook.webhook_service.validate_signature"),
        patch("app.routes.webhook.webhook_service.is_duplicate", return_value=True),
    ):
        resp = client.post(
            "/webhook/github",
            json=VALID_PAYLOAD,
            headers=_make_headers(VALID_PAYLOAD),
        )
    assert resp.status_code == 200


def test_enqueue_analysis_is_called_for_valid_push():
    """enqueue_analysis is called exactly once for a valid new push."""
    import uuid

    mock_user = MagicMock()
    mock_user.org_id = uuid.uuid4()
    mock_user.github_id = 99

    def _db_with_user():
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = mock_user
        yield db

    app.dependency_overrides[get_db] = _db_with_user

    with (
        patch("app.routes.webhook.webhook_service.validate_signature"),
        patch("app.routes.webhook.webhook_service.is_duplicate", return_value=False),
        patch(
            "app.routes.webhook.webhook_service.enqueue_analysis",
            return_value="job-123",
        ) as mock_enqueue,
    ):
        client.post(
            "/webhook/github",
            json=VALID_PAYLOAD,
            headers=_make_headers(VALID_PAYLOAD),
        )

    app.dependency_overrides[get_db] = _mock_db  # restore default
    mock_enqueue.assert_called_once()


def test_unknown_pusher_returns_200():
    """If the pusher is not in our DB and the repo is unknown, return 200 gracefully."""
    with patch("app.routes.webhook.webhook_service.validate_signature"):
        # DB returns None for both repo and user lookups (default mock behaviour).
        resp = client.post(
            "/webhook/github",
            json=VALID_PAYLOAD,
            headers=_make_headers(VALID_PAYLOAD),
        )
    assert resp.status_code == 200
