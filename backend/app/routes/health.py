from fastapi import APIRouter

from app.config import settings
from app.worker.queue import celery_app, redis_conn

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    try:
        redis_status = redis_conn.ping()
    except Exception:
        redis_status = False

    try:
        celery_inspect = celery_app.control.inspect()
        active_workers = celery_inspect.active()
        worker_count = len(active_workers) if active_workers else 0
    except Exception:
        worker_count = 0

    return {
        "status": "ok",
        "queue_depth": 0,
        "redis_connected": redis_status,
        "worker_count": worker_count,
        "ai_engine": "huggingface",
        "app_env": settings.APP_ENV,
    }
