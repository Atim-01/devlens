import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

# ─── In-Memory Rate Limit Store ───────────────────────────────────────────────

# We use a simple in-memory dictionary to track request counts per identity.
# Structure: { "identity_key": [timestamp1, timestamp2, ...] }
#
# Decision: In-memory storage rather than Redis for rate limiting.
# This is a deliberate simplification for Phase 1. The tradeoff is that
# rate limits are per-process — if we run multiple API server instances,
# each has its own counter and a user could make 100 requests to each.
# For a single-instance deployment (which we are deploying to Render free tier)
# this is perfectly adequate.
#
# When we scale to multiple instances, we move the counters to Redis.
# The interface stays identical — only the storage backend changes.
_request_log: dict[str, list[float]] = defaultdict(list)

# Configuration constants
MAX_REQUESTS = 100  # Maximum requests allowed in the window
WINDOW_SECONDS = 60  # Time window in seconds (1 minute)


def _get_identity_key(request: Request) -> str:
    """
    Derive a unique key to identify the caller for rate limiting purposes.

    We prefer the JWT user_id over the IP address because:
    - Multiple users behind the same NAT share an IP — IP limiting would
      unfairly block all of them when one user hits the limit
    - A single user on a dynamic IP would reset their limit on every
      IP change if we used IP-based limiting

    We fall back to IP if there is no authenticated user — this handles
    unauthenticated endpoints like /auth/github and /api/health.
    """
    # Try to get user_id from the JWT if present
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from app.services.auth_service import decode_jwt

            token = auth_header.split(" ")[1]
            payload = decode_jwt(token)
            user_id = payload.get("user_id")
            if user_id:
                return f"user:{user_id}"
        except ValueError:
            pass

    # Fall back to client IP address
    client_ip = request.client.host if request.client else "unknown"
    return f"ip:{client_ip}"


def check_rate_limit(request: Request) -> None:
    """
    Check if the caller has exceeded their rate limit.

    Raises HTTP 429 if the limit is exceeded, with a Retry-After header
    telling the client how many seconds to wait before retrying.

    This uses a sliding window algorithm — we count requests in the last
    60 seconds, not in fixed 60-second buckets. This prevents the burst
    pattern where a user makes 100 requests at 00:59 and another 100 at
    01:01, effectively making 200 requests in 2 seconds.
    """
    identity = _get_identity_key(request)
    now = time.time()
    window_start = now - WINDOW_SECONDS

    # Remove timestamps outside the current window — sliding window cleanup
    _request_log[identity] = [ts for ts in _request_log[identity] if ts > window_start]

    # Check if the limit has been exceeded
    if len(_request_log[identity]) >= MAX_REQUESTS:
        # Calculate how long until the oldest request falls outside the window
        oldest = _request_log[identity][0]
        retry_after = int(oldest + WINDOW_SECONDS - now) + 1

        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please slow down.",
            headers={"Retry-After": str(retry_after)},
        )

    # Record this request
    _request_log[identity].append(now)
