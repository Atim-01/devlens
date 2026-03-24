from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.middleware.auth import get_active_role, get_current_user, get_org_id
from app.services.auth_service import create_jwt


def make_mock_user(user_id="test-user-id", primary_role="developer"):
    """Helper that creates a realistic mock user."""
    user = MagicMock()
    user.id = user_id
    user.org_id = "test-org-id"
    user.github_id = 12345
    user.primary_role = primary_role
    return user


def make_credentials(token: str) -> HTTPAuthorizationCredentials:
    """Helper that wraps a token in the credentials object FastAPI produces."""
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


# ─── get_current_user tests ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_current_user_returns_user_for_valid_token():
    mock_user = make_mock_user()
    valid_token = create_jwt(mock_user)
    credentials = make_credentials(valid_token)

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_user

    result = await get_current_user(credentials=credentials, db=mock_db)
    assert result == mock_user


@pytest.mark.asyncio
async def test_get_current_user_raises_401_for_invalid_token():
    credentials = make_credentials("not.a.valid.token")
    mock_db = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=credentials, db=mock_db)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_raises_401_when_user_not_in_db():
    mock_user = make_mock_user()
    valid_token = create_jwt(mock_user)
    credentials = make_credentials(valid_token)

    # Simulate user deleted from DB after token was issued
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=credentials, db=mock_db)

    assert exc_info.value.status_code == 401


# ─── get_active_role tests ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_active_role_returns_role_from_token():
    mock_user = make_mock_user(primary_role="senior")
    token = create_jwt(mock_user, active_role="developer")
    credentials = make_credentials(token)

    role = await get_active_role(credentials=credentials)
    assert role == "developer"


@pytest.mark.asyncio
async def test_get_active_role_raises_401_for_invalid_token():
    credentials = make_credentials("bad.token.here")

    with pytest.raises(HTTPException) as exc_info:
        await get_active_role(credentials=credentials)

    assert exc_info.value.status_code == 401


# ─── get_org_id tests ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_org_id_returns_org_id_from_token():
    mock_user = make_mock_user()
    token = create_jwt(mock_user)
    credentials = make_credentials(token)

    org_id = await get_org_id(credentials=credentials)
    assert org_id == "test-org-id"


@pytest.mark.asyncio
async def test_get_org_id_raises_401_for_invalid_token():
    credentials = make_credentials("invalid.token")

    with pytest.raises(HTTPException) as exc_info:
        await get_org_id(credentials=credentials)

    assert exc_info.value.status_code == 401
