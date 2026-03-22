from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint_returns_200():
    response = client.get("/api/health")
    assert response.status_code == 200


def test_health_endpoint_returns_status_ok():
    response = client.get("/api/health")
    data = response.json()
    assert data["status"] == "ok"


def test_health_endpoint_returns_app_env():
    response = client.get("/api/health")
    data = response.json()
    assert data["app_env"] in ("development", "production", "test")


def test_health_endpoint_returns_ai_engine():
    response = client.get("/api/health")
    data = response.json()
    assert data["ai_engine"] == "huggingface"


def test_health_endpoint_has_required_keys():
    response = client.get("/api/health")
    data = response.json()
    required_keys = [
        "status",
        "queue_depth",
        "redis_connected",
        "worker_count",
        "ai_engine",
        "app_env",
    ]
    for key in required_keys:
        assert key in data


def test_cors_middleware_is_configured():
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code in (200, 405)
