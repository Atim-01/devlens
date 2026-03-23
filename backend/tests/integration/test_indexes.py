from sqlalchemy import inspect

from app.database import engine


def get_index_names(table_name: str) -> list[str]:
    inspector = inspect(engine)
    return [idx["name"] for idx in inspector.get_indexes(table_name)]


def test_users_indexes():
    indexes = get_index_names("users")
    assert "idx_users_github_id" in indexes


def test_repos_indexes():
    indexes = get_index_names("repos")
    assert "idx_repos_org" in indexes


def test_commits_indexes():
    indexes = get_index_names("commits")
    assert "idx_commits_org_repo" in indexes
    assert "idx_commits_org_pushed" in indexes
    assert "idx_commits_author" in indexes


def test_jobs_indexes():
    indexes = get_index_names("jobs")
    assert "idx_jobs_status" in indexes
    assert "idx_jobs_commit" in indexes
    assert "idx_jobs_status_retry" in indexes


def test_scores_indexes():
    indexes = get_index_names("scores")
    assert "idx_scores_commit" in indexes
    assert "idx_scores_org_dimension" in indexes


def test_issues_indexes():
    indexes = get_index_names("issues")
    assert "idx_issues_commit" in indexes
    assert "idx_issues_org_severity" in indexes
    assert "idx_issues_org_dimension" in indexes


def test_all_indexes_count():
    total = (
        len(get_index_names("users"))
        + len(get_index_names("repos"))
        + len(get_index_names("commits"))
        + len(get_index_names("jobs"))
        + len(get_index_names("scores"))
        + len(get_index_names("issues"))
    )
    assert total >= 13