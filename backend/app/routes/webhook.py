import json

from fastapi import APIRouter, Depends, Header, Request, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.webhook import GitHubPushPayload
from app.services import webhook_service

router = APIRouter(prefix="/webhook", tags=["webhook"])

# All-zeros SHA means a branch was deleted — nothing to analyse.
_ZERO_SHA = "0" * 40


@router.post("/github", status_code=status.HTTP_202_ACCEPTED)
async def github_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_hub_signature_256: str | None = Header(default=None),
    x_github_event: str | None = Header(default=None),
):
    # Read raw bytes first — parsing JSON before this would break the signature check.
    body = await request.body()

    # Reject anything not signed by GitHub.
    webhook_service.validate_signature(body, x_hub_signature_256)

    # Silently accept non-push events (ping, pull_request, etc.) — GitHub expects 200.
    if x_github_event != "push":
        return Response(status_code=status.HTTP_200_OK)

    payload = GitHubPushPayload(**json.loads(body))

    # Skip branch deletions.
    if payload.after == _ZERO_SHA:
        return Response(status_code=status.HTTP_200_OK)

    # Drop duplicate events — GitHub retries on slow responses.
    if webhook_service.is_duplicate(payload.after):
        return Response(status_code=status.HTTP_200_OK)

    # Collect all changed files across every commit in the push.
    changed_files = set()
    for commit in payload.commits:
        changed_files.update(commit.added + commit.modified + commit.removed)

    # Resolve the org from the first pusher's GitHub ID.
    # For Phase 1 every push comes from a user who has already logged in,
    # so their org row exists. We use org_id from the repo lookup inside enqueue_analysis.
    # We need an org_id — derive it from the existing repo row if present,
    # otherwise fall back to looking up the pusher's user row.
    from app.models.repo import Repo
    from app.models.user import User

    repo_row = (
        db.query(Repo).filter(Repo.github_repo_id == payload.repository.id).first()
    )

    if repo_row:
        org_id = repo_row.org_id
    else:
        # Repo not seen before — look up the pusher to get their org_id.
        # The pusher name is their GitHub username; match against username column.
        pusher_user = (
            db.query(User).filter(User.username == payload.pusher.name).first()
        )
        if not pusher_user:
            # Unknown pusher — return 200 so GitHub doesn't retry endlessly.
            return Response(status_code=status.HTTP_200_OK)
        org_id = pusher_user.org_id

    # Derive the commit author's GitHub ID from the pusher user row if available.
    author_row = db.query(User).filter(User.username == payload.pusher.name).first()
    author_github_id = author_row.github_id if author_row else None

    # Extract branch name from ref (e.g. "refs/heads/main" → "main").
    branch = payload.ref.replace("refs/heads/", "")

    # Build a single commit message from the first commit in the push.
    commit_message = payload.commits[0].message if payload.commits else ""

    webhook_service.enqueue_analysis(
        db=db,
        org_id=org_id,
        sha=payload.after,
        repo_github_id=payload.repository.id,
        repo_name=payload.repository.name,
        repo_full_name=payload.repository.full_name,
        default_branch=payload.repository.default_branch,
        branch=branch,
        author_github_id=author_github_id,
        commit_message=commit_message,
        files_changed=len(changed_files),
    )

    db.commit()

    return Response(status_code=status.HTTP_202_ACCEPTED)
