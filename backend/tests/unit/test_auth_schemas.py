import pytest
from pydantic import ValidationError

from app.schemas.auth import (
    AuthResponse,
    JWTPayload,
    OnboardingRequest,
    RoleSwitchRequest,
    UserResponse,
)


def test_onboarding_request_valid():
    req = OnboardingRequest(primary_role="developer")
    assert req.primary_role == "developer"


def test_onboarding_request_requires_primary_role():
    with pytest.raises(ValidationError):
        OnboardingRequest()


def test_role_switch_request_valid():
    req = RoleSwitchRequest(active_role="senior")
    assert req.active_role == "senior"


def test_auth_response_default_token_type():
    resp = AuthResponse(access_token="sometoken")
    assert resp.token_type == "bearer"


def test_auth_response_requires_access_token():
    with pytest.raises(ValidationError):
        AuthResponse()


def test_jwt_payload_valid():
    payload = JWTPayload(
        user_id="abc",
        org_id="xyz",
        github_id=12345,
        primary_role="developer",
        active_role="developer",
    )
    assert payload.user_id == "abc"
    assert payload.github_id == 12345


def test_user_response_from_dict():
    data = {
        "id": "abc-123",
        "username": "atim",
        "avatar_url": "https://github.com/avatar.png",
        "primary_role": "developer",
        "active_role": "developer",
        "org_id": "org-xyz",
    }
    resp = UserResponse(**data)
    assert resp.username == "atim"
    assert resp.primary_role == "developer"


def test_user_response_avatar_url_optional():
    data = {
        "id": "abc-123",
        "username": "atim",
        "avatar_url": None,
        "primary_role": "developer",
        "active_role": "developer",
        "org_id": "org-xyz",
    }
    resp = UserResponse(**data)
    assert resp.avatar_url is None
