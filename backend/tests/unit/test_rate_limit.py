from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.middleware.rate_limit import MAX_REQUESTS, check_rate_limit


def make_mock_request(ip: str = "127.0.0.1") -> MagicMock:
    """Helper that creates a mock FastAPI request object."""
    request = MagicMock()
    request.headers = {}
    request.client.host = ip
    return request


def test_first_request_passes():
    request = make_mock_request(ip="10.0.0.1")
    # Should not raise
    check_rate_limit(request)


def test_requests_within_limit_pass():
    request = make_mock_request(ip="10.0.0.2")
    for _ in range(MAX_REQUESTS - 1):
        check_rate_limit(request)


def test_request_exceeding_limit_raises_429():
    request = make_mock_request(ip="10.0.0.3")

    # Fill up to the limit
    for _ in range(MAX_REQUESTS):
        check_rate_limit(request)

    # This one should be rejected
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit(request)

    assert exc_info.value.status_code == 429
    assert "Retry-After" in exc_info.value.headers


def test_rate_limit_response_includes_retry_after():
    request = make_mock_request(ip="10.0.0.4")

    for _ in range(MAX_REQUESTS):
        check_rate_limit(request)

    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit(request)

    retry_after = exc_info.value.headers.get("Retry-After")
    assert retry_after is not None
    assert int(retry_after) > 0
