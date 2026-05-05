import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.middleware.auth import get_current_user
from app.services.auth_service import create_jwt

client = TestClient(app, follow_redirects=False)


def make_mock_user(primary_role="developer"):
    """
    Creates a mock user with a real UUID so PostgreSQL does not reject it.
    We use FastAPI's dependency override system instead of patching to ensure
    FastAPI actually uses our mock when resolving the get_current_user dependency.
    """
    user = MagicMock()
    user.id = str(uuid.uuid4())
    user.org_id = str(uuid.uuid4())
    user.github_id = 12345
    user.username = "atim"
    user.avatar_url = "https://github.com/avatar.png"
    user.primary_role = primary_role
    return user


# ─── /auth/github ─────────────────────────────────────────────────────────────


def test_github_login_redirects_to_github():
    response = client.get("/auth/github")
    assert response.status_code == 307
    assert "github.com/login/oauth/authorize" in response.headers["location"]


def test_github_login_includes_client_id():
    response = client.get("/auth/github")
    location = response.headers["location"]
    assert "client_id=" in location


def test_github_login_includes_required_scopes():
    response = client.get("/auth/github")
    location = response.headers["location"]
    assert "scope=" in location


# ─── /auth/callback ───────────────────────────────────────────────────────────


def test_callback_redirects_to_onboarding_for_new_user():
    mock_user = make_mock_user(primary_role=None)

    with (
        patch(
            "app.routes.auth.exchange_github_code",
            new_callable=AsyncMock,
            return_value="gho_test_token",
        ),
        patch(
            "app.routes.auth.get_github_user",
            new_callable=AsyncMock,
            return_value={
                "id": 12345,
                "login": "atim",
                "avatar_url": None,
                "email": None,
            },
        ),
        patch(
            "app.routes.auth.get_or_create_user",
            return_value=mock_user,
        ),
    ):
        response = client.get("/auth/callback?code=test_code")

    assert response.status_code == 307
    assert "onboarding" in response.headers["location"]


def test_callback_redirects_to_dashboard_for_returning_user():
    mock_user = make_mock_user(primary_role="developer")

    with (
        patch(
            "app.routes.auth.exchange_github_code",
            new_callable=AsyncMock,
            return_value="gho_test_token",
        ),
        patch(
            "app.routes.auth.get_github_user",
            new_callable=AsyncMock,
            return_value={
                "id": 12345,
                "login": "atim",
                "avatar_url": None,
                "email": None,
            },
        ),
        patch(
            "app.routes.auth.get_or_create_user",
            return_value=mock_user,
        ),
    ):
        response = client.get("/auth/callback?code=test_code")

    assert response.status_code == 307
    assert "dashboard" in response.headers["location"]


def test_callback_redirects_to_login_on_failure():
    with patch(
        "app.routes.auth.exchange_github_code",
        new_callable=AsyncMock,
        side_effect=ValueError("Bad code"),
    ):
        response = client.get("/auth/callback?code=bad_code")

    assert response.status_code == 307
    assert "error=auth_failed" in response.headers["location"]


# ─── /auth/onboarding ─────────────────────────────────────────────────────────


def test_onboarding_sets_primary_role():
    """
    We use app.dependency_overrides to inject our mock user directly into
    FastAPI's dependency resolution system. This is the correct way to mock
    FastAPI dependencies — patching the import does not work because FastAPI
    caches the dependency reference at startup, not at call time.
    """
    mock_user = make_mock_user(primary_role=None)
    token = create_jwt(mock_user)
    updated_user = make_mock_user(primary_role="developer")

    app.dependency_overrides[get_current_user] = lambda: mock_user

    with patch("app.routes.auth.set_primary_role", return_value=updated_user):
        response = client.post(
            "/auth/onboarding",
            json={"primary_role": "developer"},
            headers={"Authorization": f"Bearer {token}"},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_onboarding_rejects_already_onboarded_user():
    mock_user = make_mock_user(primary_role="developer")
    token = create_jwt(mock_user)

    app.dependency_overrides[get_current_user] = lambda: mock_user

    response = client.post(
        "/auth/onboarding",
        json={"primary_role": "qa"},
        headers={"Authorization": f"Bearer {token}"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 400


# ─── /auth/switch-role ────────────────────────────────────────────────────────


def test_switch_role_returns_new_token():
    mock_user = make_mock_user(primary_role="senior")
    token = create_jwt(mock_user)

    app.dependency_overrides[get_current_user] = lambda: mock_user

    response = client.post(
        "/auth/switch-role",
        json={"active_role": "developer"},
        headers={"Authorization": f"Bearer {token}"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert "access_token" in response.json()


# ─── /auth/me ─────────────────────────────────────────────────────────────────


def test_get_me_returns_user_profile():
    mock_user = make_mock_user(primary_role="developer")
    token = create_jwt(mock_user)

    app.dependency_overrides[get_current_user] = lambda: mock_user

    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "atim"
    assert data["primary_role"] == "developer"


def test_get_me_requires_auth():
    """
    With no Authorization header, HTTPBearer returns 403 Forbidden.
    FastAPI distinguishes between missing credentials (403) and
    invalid credentials (401). This is standard HTTP semantics.
    """
    app.dependency_overrides.clear()
    response = client.get("/auth/me")
    assert response.status_code == 401
