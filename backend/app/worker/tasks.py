from app.worker.queue import celery_app


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="app.worker.tasks.analyse_commit",
)
def analyse_commit(self, job_id: str):
    # Full implementation in Issue 6.3
    pass
