"""add_indexes

Revision ID: ee8edc35d136
Revises: af7528ef00c2
Create Date: 2026-03-23 15:36:14.997886

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ee8edc35d136'
down_revision: Union[str, Sequence[str], None] = 'af7528ef00c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users
    op.create_index("idx_users_github_id", "users", ["github_id"])

    # repos
    op.create_index("idx_repos_org", "repos", ["org_id"])

    # commits
    op.create_index("idx_commits_org_repo", "commits", ["org_id", "repo_id"])
    op.create_index(
        "idx_commits_org_pushed",
        "commits",
        ["org_id", "pushed_at"],
        postgresql_ops={"pushed_at": "DESC"},
    )
    op.create_index("idx_commits_author", "commits", ["author_github_id"])

    # jobs
    op.create_index("idx_jobs_status", "jobs", ["status"])
    op.create_index("idx_jobs_commit", "jobs", ["commit_id"])
    op.create_index("idx_jobs_status_retry", "jobs", ["status", "retry_count"])

    # scores
    op.create_index("idx_scores_commit", "scores", ["commit_id"])
    op.create_index("idx_scores_org_dimension", "scores", ["org_id", "dimension"])

    # issues
    op.create_index("idx_issues_commit", "issues", ["commit_id"])
    op.create_index("idx_issues_org_severity", "issues", ["org_id", "severity"])
    op.create_index("idx_issues_org_dimension", "issues", ["org_id", "dimension"])


def downgrade() -> None:
    op.drop_index("idx_users_github_id", table_name="users")
    op.drop_index("idx_repos_org", table_name="repos")
    op.drop_index("idx_commits_org_repo", table_name="commits")
    op.drop_index("idx_commits_org_pushed", table_name="commits")
    op.drop_index("idx_commits_author", table_name="commits")
    op.drop_index("idx_jobs_status", table_name="jobs")
    op.drop_index("idx_jobs_commit", table_name="jobs")
    op.drop_index("idx_jobs_status_retry", table_name="jobs")
    op.drop_index("idx_scores_commit", table_name="scores")
    op.drop_index("idx_scores_org_dimension", table_name="scores")
    op.drop_index("idx_issues_commit", table_name="issues")
    op.drop_index("idx_issues_org_severity", table_name="issues")
    op.drop_index("idx_issues_org_dimension", table_name="issues")
