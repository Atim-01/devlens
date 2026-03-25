from sqlalchemy import inspect, text

from app.database import engine


def test_all_tables_exist():
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    expected = [
        "organisations",
        "users",
        "repos",
        "commits",
        "jobs",
        "scores",
        "issues",
    ]
    for table in expected:
        assert table in tables, f"Table '{table}' is missing from the database"


def test_organisations_columns():
    inspector = inspect(engine)
    columns = [c["name"] for c in inspector.get_columns("organisations")]
    assert "id" in columns
    assert "github_id" in columns
    assert "name" in columns
    assert "is_personal" in columns
    assert "created_at" in columns


def test_users_columns():
    inspector = inspect(engine)
    columns = [c["name"] for c in inspector.get_columns("users")]
    assert "org_id" in columns
    assert "primary_role" in columns
    assert "github_id" in columns


def test_jobs_metrics_columns_exist():
    inspector = inspect(engine)
    columns = [c["name"] for c in inspector.get_columns("jobs")]
    assert "queue_wait_ms" in columns
    assert "analysis_ms" in columns
    assert "end_to_end_ms" in columns
    assert "degraded" in columns


def test_issues_learning_columns_exist():
    inspector = inspect(engine)
    columns = [c["name"] for c in inspector.get_columns("issues")]
    assert "explanation" in columns
    assert "suggestion" in columns


def test_all_tables_have_org_id():
    inspector = inspect(engine)
    tables_needing_org_id = ["users", "repos", "commits", "jobs", "scores", "issues"]
    for table in tables_needing_org_id:
        columns = [c["name"] for c in inspector.get_columns(table)]
        assert "org_id" in columns, f"Table '{table}' is missing org_id"


def test_database_is_accessible():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM organisations"))
        assert result.scalar() >= 0
