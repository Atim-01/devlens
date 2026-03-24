from app.schemas.auth import (
    AuthResponse,
    GitHubCallbackQuery,
    JWTPayload,
    OnboardingRequest,
    RoleSwitchRequest,
    UserResponse,
)
from app.schemas.webhook import GitHubPushPayload

__all__ = [
    "GitHubCallbackQuery",
    "OnboardingRequest",
    "RoleSwitchRequest",
    "JWTPayload",
    "AuthResponse",
    "UserResponse",
    "GitHubPushPayload",
]
