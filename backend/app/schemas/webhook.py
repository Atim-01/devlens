from pydantic import BaseModel


class GitHubRepository(BaseModel):
    id: int
    name: str
    full_name: str
    default_branch: str


class GitHubPusher(BaseModel):
    name: str
    email: str | None = None


class GitHubCommit(BaseModel):
    id: str
    message: str
    added: list[str] = []
    removed: list[str] = []
    modified: list[str] = []


class GitHubPushPayload(BaseModel):
    ref: str
    after: str
    repository: GitHubRepository
    pusher: GitHubPusher
    commits: list[GitHubCommit] = []

    model_config = {"extra": "ignore"}
