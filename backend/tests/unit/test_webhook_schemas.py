import pytest
from pydantic import ValidationError

from app.schemas.webhook import GitHubPushPayload


def test_valid_push_payload():
    payload = GitHubPushPayload(
        ref="refs/heads/main",
        after="abc123def456",
        repository={
            "id": 123,
            "name": "devlens",
            "full_name": "atim/devlens",
            "default_branch": "main",
        },
        pusher={"name": "atim", "email": "atim@example.com"},
        commits=[],
    )
    assert payload.after == "abc123def456"
    assert payload.repository.full_name == "atim/devlens"


def test_extra_fields_are_ignored():
    payload = GitHubPushPayload(
        ref="refs/heads/main",
        after="abc123",
        repository={
            "id": 123,
            "name": "devlens",
            "full_name": "atim/devlens",
            "default_branch": "main",
        },
        pusher={"name": "atim"},
        commits=[],
        unknown_field="should be ignored",
    )
    assert not hasattr(payload, "unknown_field")


def test_commits_defaults_to_empty_list():
    payload = GitHubPushPayload(
        ref="refs/heads/main",
        after="abc123",
        repository={
            "id": 123,
            "name": "devlens",
            "full_name": "atim/devlens",
            "default_branch": "main",
        },
        pusher={"name": "atim"},
    )
    assert payload.commits == []


def test_missing_required_field_raises():
    with pytest.raises(ValidationError):
        GitHubPushPayload(
            ref="refs/heads/main",
            repository={
                "id": 123,
                "name": "devlens",
                "full_name": "atim/devlens",
                "default_branch": "main",
            },
            pusher={"name": "atim"},
        )
