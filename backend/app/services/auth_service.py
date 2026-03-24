from datetime import UTC, datetime, timedelta

import httpx
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.models.organisation import Organisation
from app.models.user import User

# ─── Constants ────────────────────────────────────────────────────────────────

# The algorithm used to sign JWTs.
# HS256 means HMAC with SHA-256 — it uses a single secret key to both sign
# and verify tokens. This is the right choice for a single-server application
# like DevLens where the same server both creates and verifies tokens.
# The alternative is RS256 (asymmetric) which uses a private key to sign and
# a public key to verify — useful when multiple separate services need to
# verify tokens without sharing the secret. We don't need that complexity yet.
ALGORITHM = "HS256"

# The GitHub OAuth endpoints we call during the login flow.
# We define these as constants rather than hardcoding them inside functions
# so they are easy to find, change, and mock in tests.
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"

VALID_ROLES = {"developer", "senior", "qa", "devops", "cso"}


# ─── GitHub OAuth ─────────────────────────────────────────────────────────────


async def exchange_github_code(code: str) -> str:
    """
    Exchange a GitHub OAuth authorization code for an access token.

    When a user clicks 'Login with GitHub', GitHub redirects them back to our
    callback URL with a short-lived `code`. This function trades that code for
    a long-lived access token we can use to call the GitHub API on their behalf.

    The code expires after 10 minutes and can only be used once — this is
    GitHub's security mechanism to prevent replay attacks.
    """
    # We use httpx instead of the standard `requests` library because FastAPI
    # is async and `requests` is blocking — it would freeze the event loop.
    # httpx provides the same familiar API but works correctly in async context.
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
            },
            # GitHub returns form-encoded data by default.
            # Asking for JSON makes parsing much simpler.
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        data = response.json()

        # GitHub returns an `error` field in the JSON body (not an HTTP error
        # status) when the code is invalid or expired. We check explicitly.
        if "error" in data:
            raise ValueError(f"GitHub OAuth error: {data.get('error_description')}")

        return data["access_token"]


async def get_github_user(access_token: str) -> dict:
    """
    Fetch the authenticated user's profile from the GitHub API.

    This gives us their GitHub ID, username, email, and avatar — everything
    we need to create or update their DevLens account.

    We use the GitHub ID (a stable integer) as our foreign key to GitHub,
    not the username. Usernames can change; IDs never do.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GITHUB_USER_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        return response.json()


# ─── User and Organisation Management ─────────────────────────────────────────


def get_or_create_org(db: Session, github_user: dict) -> Organisation:
    """
    Find or create the organisation record for this GitHub user.

    For personal accounts, each user gets their own organisation with
    is_personal=True. This means the same org_id scoping logic works
    identically for both personal and team accounts — no special cases
    anywhere else in the codebase.

    Decision: We use github_id as the lookup key, not the username.
    If someone renames their GitHub account, their data stays intact.
    """
    github_id = github_user["id"]

    org = db.query(Organisation).filter(Organisation.github_id == github_id).first()

    if not org:
        org = Organisation(
            github_id=github_id,
            name=github_user.get("login", ""),
            # Every user who logs in with a personal GitHub account gets
            # is_personal=True. If we later support GitHub org accounts
            # (where a team authenticates as an org), we would set this False.
            is_personal=True,
        )
        db.add(org)
        db.flush()  # Flush to get the generated UUID without committing yet

    return org


def get_or_create_user(db: Session, github_user: dict) -> User:
    """
    Find or create the DevLens user record for this GitHub user.

    This is called on every login — not just the first one. If the user
    already exists we return them as-is. If they are new we create them
    with primary_role=None, which signals that onboarding is required.

    We use db.flush() rather than db.commit() so the caller controls
    the transaction boundary. This is important — if something fails
    after this call, the entire transaction rolls back cleanly.
    """
    github_id = github_user["id"]

    user = db.query(User).filter(User.github_id == github_id).first()

    if not user:
        org = get_or_create_org(db, github_user)
        user = User(
            org_id=org.id,
            github_id=github_id,
            username=github_user.get("login", ""),
            email=github_user.get("email"),
            # GitHub avatars are stable URLs that update automatically
            # when the user changes their profile picture.
            avatar_url=github_user.get("avatar_url"),
            # primary_role is intentionally None here.
            # A None primary_role is our signal that this user needs
            # to complete onboarding before accessing the dashboard.
            primary_role=None,
        )
        db.add(user)
        db.flush()

    return user


def set_primary_role(db: Session, user: User, role: str) -> User:
    """
    Set the user's primary role during onboarding.

    This is called exactly once per user — when they complete the onboarding
    screen after their first login. After this, primary_role is permanent
    unless the user explicitly changes it in settings (a future feature).

    We validate the role against VALID_ROLES here in the service rather than
    in the route handler. This means the validation logic lives in one place
    and is tested independently of HTTP concerns.
    """
    if role not in VALID_ROLES:
        raise ValueError(
            f"Invalid role '{role}'. Must be one of: {', '.join(VALID_ROLES)}"
        )

    user.primary_role = role
    db.flush()
    return user


def is_onboarded(user: User) -> bool:
    """
    Check if a user has completed onboarding.

    A user is onboarded if and only if they have a primary_role set.
    This simple boolean check is used in the auth callback route to decide
    whether to redirect to the dashboard or the onboarding screen.
    """
    return user.primary_role is not None


# ─── JWT ──────────────────────────────────────────────────────────────────────


def create_jwt(user: User, active_role: str | None = None) -> str:
    """
    Create a signed JWT for an authenticated user.

    The JWT contains everything the API needs to handle a request without
    hitting the database — user_id, org_id, and active_role. This means
    the JWT is self-contained: middleware can validate and extract all
    necessary context from the token alone.

    Decision: We store active_role in the JWT rather than in the database.
    This means role switching issues a new JWT (one API call) rather than
    writing to the database on every switch. The tradeoff is that the old
    JWT remains technically valid until it expires — we accept this because
    JWTs expire in 8 hours and role switching is not a security boundary,
    just a UI preference.

    We do NOT store sensitive data in the JWT payload. JWTs are signed but
    not encrypted — anyone can base64-decode the payload and read it.
    The signature only proves the token was issued by us, not that it's secret.
    """
    # active_role defaults to primary_role when not explicitly provided.
    # This happens on first login after onboarding — the user starts
    # in their primary role view.
    resolved_active_role = active_role or user.primary_role

    now = datetime.now(UTC)
    expire = now + timedelta(hours=settings.JWT_EXPIRE_HOURS)

    payload = {
        # Standard JWT claims — 'sub' is the subject (who the token is about),
        # 'iat' is issued-at time, 'exp' is expiry time.
        "sub": str(user.id),
        "iat": now,
        "exp": expire,
        # Custom DevLens claims
        "user_id": str(user.id),
        "org_id": str(user.org_id),
        "github_id": user.github_id,
        "primary_role": user.primary_role,
        "active_role": resolved_active_role,
    }

    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def decode_jwt(token: str) -> dict:
    """
    Decode and verify a JWT, returning the payload as a dictionary.

    This raises an exception if:
    - The token signature is invalid (tampered token)
    - The token has expired
    - The token is malformed

    We let the exception propagate to the middleware which converts it
    to an HTTP 401 response. We never silently ignore a bad token.

    Decision: We use python-jose for JWT handling rather than PyJWT.
    Both are solid libraries. python-jose has slightly more straightforward
    RSA support if we ever migrate to asymmetric signing, and it was already
    in our dependency chain via python-jose[cryptography].
    """
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except JWTError as e:
        # Re-raise as a ValueError so the caller does not need to import
        # JWTError — keeping jose as an implementation detail of this module.
        raise ValueError(f"Invalid token: {e}") from e
