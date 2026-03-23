from app.models import Commit, Issue, Job, Organisation, Repo, Score, User


def test_organisation_tablename():
    assert Organisation.__tablename__ == "organisations"


def test_user_tablename():
    assert User.__tablename__ == "users"


def test_repo_tablename():
    assert Repo.__tablename__ == "repos"


def test_commit_tablename():
    assert Commit.__tablename__ == "commits"


def test_job_tablename():
    assert Job.__tablename__ == "jobs"


def test_score_tablename():
    assert Score.__tablename__ == "scores"


def test_issue_tablename():
    assert Issue.__tablename__ == "issues"


def test_organisation_has_required_columns():
    columns = [c.name for c in Organisation.__table__.columns]
    assert "id" in columns
    assert "github_id" in columns
    assert "name" in columns
    assert "is_personal" in columns
    assert "created_at" in columns


def test_user_has_primary_role_column():
    columns = [c.name for c in User.__table__.columns]
    assert "primary_role" in columns
    assert "org_id" in columns


def test_job_has_metrics_columns():
    columns = [c.name for c in Job.__table__.columns]
    assert "queue_wait_ms" in columns
    assert "analysis_ms" in columns
    assert "end_to_end_ms" in columns
    assert "degraded" in columns


def test_issue_has_learning_columns():
    columns = [c.name for c in Issue.__table__.columns]
    assert "explanation" in columns
    assert "suggestion" in columns


def test_all_models_have_org_id():
    models = [User, Repo, Commit, Job, Score, Issue]
    for model in models:
        columns = [c.name for c in model.__table__.columns]
        assert "org_id" in columns, f"{model.__tablename__} is missing org_id"


def test_all_models_have_uuid_primary_key():
    models = [Organisation, User, Repo, Commit, Job, Score, Issue]
    for model in models:
        pk_cols = [c for c in model.__table__.columns if c.primary_key]
        assert len(pk_cols) == 1
        assert str(pk_cols[0].type) == "UUID"
