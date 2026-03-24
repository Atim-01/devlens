from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.auth_service import (
    VALID_ROLES,
    create_jwt,
    decode_jwt,
    is_onboarded,
    set_primary_role,
)


# ─── JWT Tests ────────────────────────────────────────────────────────────────


def make_mock_user(primary_role="developer"):
    """Helper that creates a mock user object for testing."""
    user = MagicMock()
    user.id = "test-user-id-123"
    user.org_id = "test-org-id-456"
    user.github_id = 12345678
    user.primary_role = primary_role
    return user


def test_create_jwt_returns_string():
    user = make_mock_user()
    token = create_jwt(user)
    assert isinstance(token, str)
    assert len(token) > 0


def test_create_jwt_payload_contains_required_fields():
    user = make_mock_user()
    token = create_jwt(user)
    payload = decode_jwt(token)
    assert "user_id" in payload
    assert "org_id" in payload
    assert "github_id" in payload
    assert "primary_role" in payload
    assert "active_role" in payload
    assert "exp" in payload


def test_create_jwt_active_role_defaults_to_primary_role():
    user = make_mock_user(primary_role="senior")
    token = create_jwt(user)
    payload = decode_jwt(token)
    assert payload["active_role"] == "senior"


def test_create_jwt_active_role_can_be_overridden():
    user = make_mock_user(primary_role="senior")
    token = create_jwt(user, active_role="developer")
    payload = decode_jwt(token)
    assert payload["primary_role"] == "senior"
    assert payload["active_role"] == "developer"


def test_decode_jwt_raises_on_invalid_token():
    with pytest.raises(ValueError, match="Invalid token"):
        decode_jwt("this.is.not.a.valid.token")


def test_decode_jwt_raises_on_tampered_token():
    user = make_mock_user()
    token = create_jwt(user)
    # Tamper with the token by changing one character in the signature
    tampered = token[:-5] + "XXXXX"
    with pytest.raises(ValueError):
        decode_jwt(tampered)


# ─── Onboarding and Role Tests ────────────────────────────────────────────────


def test_is_onboarded_false_when_no_role():
    user = make_mock_user(primary_role=None)
    assert is_onboarded(user) is False


def test_is_onboarded_true_when_role_set():
    user = make_mock_user(primary_role="developer")
    assert is_onboarded(user) is True


def test_set_primary_role_valid():
    user = make_mock_user(primary_role=None)
    db = MagicMock()
    result = set_primary_role(db, user, "qa")
    assert user.primary_role == "qa"
    db.flush.assert_called_once()


def test_set_primary_role_invalid_raises():
    user = make_mock_user(primary_role=None)
    db = MagicMock()
    with pytest.raises(ValueError, match="Invalid role"):
        set_primary_role(db, user, "superadmin")


def test_all_valid_roles_are_accepted():
    db = MagicMock()
    for role in VALID_ROLES:
        user = make_mock_user(primary_role=None)
        set_primary_role(db, user, role)
        assert user.primary_role == role


# ─── GitHub OAuth Tests ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_exchange_github_code_success():
    mock_response = MagicMock()
    mock_response.json.return_value = {"access_token": "gho_test_token"}
    mock_response.raise_for_status = MagicMock()

    with patch("app.services.auth_service.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=MagicMock(post=AsyncMock(return_value=mock_response))
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)

        from app.services.auth_service import exchange_github_code

        token = await exchange_github_code("test_code")
        assert token == "gho_test_token"


@pytest.mark.asyncio
async def test_exchange_github_code_raises_on_error():
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "error": "bad_verification_code",
        "error_description": "The code passed is incorrect or expired.",
    }
    mock_response.raise_for_status = MagicMock()

    with patch("app.services.auth_service.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=MagicMock(post=AsyncMock(return_value=mock_response))
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)

        from app.services.auth_service import exchange_github_code

        with pytest.raises(ValueError, match="GitHub OAuth error"):
            await exchange_github_code("bad_code")