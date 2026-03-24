from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.auth_service import decode_jwt

# ─── Token Extractor ──────────────────────────────────────────────────────────

# HTTPBearer is a FastAPI utility that extracts the token from the
# Authorization header automatically. It expects the format:
# Authorization: Bearer <token>
#
# Decision: We use HTTPBearer over a custom header extractor because it
# is the industry standard for REST APIs and FastAPI handles the extraction
# and error responses for us. The alternative — reading the header manually
# — gives more control but adds boilerplate for no real benefit here.
#
# auto_error=True means FastAPI returns a 403 automatically if the
# Authorization header is missing entirely, before our code even runs.
bearer_scheme = HTTPBearer(auto_error=True)


# ─── Core Auth Dependency ─────────────────────────────────────────────────────


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI dependency that validates the JWT and returns the current user.

    This is the heart of our authentication system. Any route that declares
    this as a dependency is automatically protected — FastAPI calls this
    function before the route handler runs.

    The flow:
    1. HTTPBearer extracts the token from the Authorization header
    2. We decode and validate the JWT signature and expiry
    3. We look up the user in the database by user_id from the token
    4. We return the user object — injected into the route handler

    Decision: We look up the user in the database on every request rather
    than trusting the JWT payload alone. This means if a user is deleted
    or their account is suspended, the change takes effect immediately —
    not after their JWT expires. The cost is one extra DB query per request,
    which is acceptable and fast with our indexes in place.

    The alternative — trusting the JWT payload entirely — is faster but
    means a deleted user can still make requests until their token expires.
    For a security tool like DevLens, we choose correctness over speed.
    """
    # Define the error we will raise if anything goes wrong.
    # We use a single generic error message deliberately — we never want
    # to tell an attacker whether the token was missing, expired, or invalid.
    # Specific error messages help attackers understand what to fix.
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # Decode the JWT — raises ValueError if invalid or expired
        payload = decode_jwt(credentials.credentials)
        user_id: str = payload.get("user_id")

        if user_id is None:
            raise credentials_exception

    except ValueError:
        raise credentials_exception

    # Look up the user in the database.
    # We import User here inside the function to avoid circular imports
    # between middleware and models as the codebase grows.
    user = db.query(User).filter(User.id == user_id).first()

    if user is None:
        raise credentials_exception

    return user


# ─── Role Extraction Helpers ──────────────────────────────────────────────────


async def get_active_role(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """
    Extract the active_role from the JWT without a database lookup.

    Used by endpoints that need the role for data filtering but do not
    need the full user object. This saves one DB query on those routes.

    Decision: We read active_role from the JWT payload directly rather than
    from the database. Role switching issues a new JWT — so the JWT is always
    the source of truth for the current active role. This is different from
    user identity (where we always hit the DB) because role is a UI preference,
    not a security boundary.
    """
    try:
        payload = decode_jwt(credentials.credentials)
        active_role = payload.get("active_role")
        if active_role is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
            )
        return active_role
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )


async def get_org_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """
    Extract org_id from the JWT without a database lookup.

    Every database query in DevLens is scoped to an org_id. This dependency
    gives route handlers and services the org_id without needing the full
    user object.

    This is the tenant isolation enforcement point — every query that uses
    this org_id is automatically scoped to the correct organisation.
    """
    try:
        payload = decode_jwt(credentials.credentials)
        org_id = payload.get("org_id")
        if org_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
            )
        return org_id
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
