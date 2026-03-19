from unittest.mock import MagicMock


def test_celery_app_name():
    from app.worker.queue import celery_app

    assert celery_app.main == "devlens"


def test_celery_broker_url():
    from app.worker.queue import celery_app

    assert celery_app.conf.broker_url is not None


def test_celery_task_serializer():
    from app.worker.queue import celery_app

    assert celery_app.conf.task_serializer == "json"


def test_celery_acks_late():
    from app.worker.queue import celery_app

    assert celery_app.conf.task_acks_late is True


def test_celery_worker_pool():
    from app.worker.queue import celery_app

    assert celery_app.conf.worker_pool == "solo"


def test_enqueue_job_calls_apply_async():
    from app.worker.queue import enqueue_job

    mock_task = MagicMock()
    mock_task.apply_async = MagicMock(return_value=MagicMock(id="test-job-id"))

    result = enqueue_job(mock_task, job_id="abc-123")

    mock_task.apply_async.assert_called_once_with(kwargs={"job_id": "abc-123"})
    assert result.id == "test-job-id"
