import redis
from celery import Celery

from app.config import settings

redis_conn = redis.from_url(
    settings.REDIS_URL,
    decode_responses=False,
)


celery_app = Celery(
    "devlens",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.worker.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_pool="solo",
    task_max_retries=3,
    task_default_retry_delay=30,
)


def enqueue_job(task_func, **kwargs):
    return task_func.apply_async(kwargs=kwargs)
