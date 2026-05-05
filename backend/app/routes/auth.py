from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    OnboardingRequest,
    RoleSwitchRequest,
    UserResponse,
)
from app.services.auth_service import (
    create_jwt,
    exchange_github_code,
    get_github_user,
    get_or_create_user,
    is_onboarded,
    set_primary_role,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ─── Step 1 of OAuth: Redirect to GitHub ──────────────────────────────────────


@router.get("/github")
async def github_login():
    """
    Redirect the user to GitHub's OAuth consent screen. Scopes requested:
    - read:user — lets us fetch their profile (username, avatar, email)
    - user:email — lets us fetch their email address specifically
    - read:org — lets us see which GitHub orgs they belong to (needed
      for Phase 2 when we detect team membership for role suggestions)
    """
    github_oauth_url = (
        "https://github.com/login/oauth/authorize"
        f"?client_id={settings.GITHUB_CLIENT_ID}"
        f"&redirect_uri={settings.GITHUB_REDIRECT_URI}"
        "&scope=read:user,user:email,read:org"
    )
    return RedirectResponse(url=github_oauth_url)


# ─── Step 2 of OAuth: Handle GitHub's callback ────────────────────────────────


@router.get("/callback")
async def github_callback(code: str, db: Session = Depends(get_db)):
    """
    Handle GitHub's redirect back to DevLens after the user approves access.
    """
    try:
        # Exchange the code for a GitHub access token
        access_token = await exchange_github_code(code)

        # Use the token to get the user's GitHub profile
        github_user = await get_github_user(access_token)

        # Create or retrieve the user in our database.
        # We wrap this in a try/finally to ensure the DB transaction
        # is committed or rolled back cleanly.
        user = get_or_create_user(db, github_user)
        db.commit()

    except Exception:
        # Something went wrong — redirect to login with a generic error.
        # We never expose the actual exception to the browser URL because
        # error messages can leak information about our system internals.
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error=auth_failed")

    # Issue a DevLens JWT for this user
    token = create_jwt(user)

    # New user — send them to onboarding to pick their primary role
    if not is_onboarded(user):
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/onboarding?token={token}")

    # Returning user — send them straight to the dashboard
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard?token={token}")


# ─── Onboarding: Set primary role (called once, first login only) ─────────────


@router.post("/onboarding", response_model=AuthResponse)
async def complete_onboarding(
    request: OnboardingRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Set the user's primary role — called once during first login.
    """
    if is_onboarded(current_user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboarding already completed. Use settings to change your role.",
        )

    updated_user = set_primary_role(db, current_user, request.primary_role)
    db.commit()

    # Issue a fresh JWT with the primary_role now populated
    token = create_jwt(updated_user)
    return AuthResponse(access_token=token)


# ─── Role Switch: Update active_role for the session ─────────────────────────


@router.post("/switch-role", response_model=AuthResponse)
async def switch_role(
    request: RoleSwitchRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Switch the user's active role for this session.

    The user's primary_role never changes here — only active_role changes.
    We issue a new JWT with the updated active_role. The frontend replaces
    its stored token and re-renders the dashboard in the new role view.
    """
    # Issue a new JWT with the requested active_role
    # create_jwt accepts an explicit active_role to override the default
    token = create_jwt(current_user, active_role=request.active_role)
    return AuthResponse(access_token=token)


# ─── Current User: Return the authenticated user's profile ────────────────────


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """
    Return the current authenticated user's profile.

    The frontend calls this on app load to confirm the stored JWT is still
    valid and to get the latest user data. If this returns 401 the frontend
    knows to redirect to login.

    Note: active_role defaults to primary_role here because we do not have
    access to the raw JWT in this handler — get_current_user only returns
    the user object. In Phase 2 we will refactor this to also return the
    active_role from the token. For now primary_role is the safe default.
    """
    return UserResponse(
        id=str(current_user.id),
        username=current_user.username,
        avatar_url=current_user.avatar_url,
        primary_role=current_user.primary_role,
        active_role=current_user.primary_role,
        org_id=str(current_user.org_id),
    )
