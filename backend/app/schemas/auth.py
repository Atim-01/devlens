from pydantic import BaseModel


class GitHubCallbackQuery(BaseModel):
    code: str
    state: str


class OnboardingRequest(BaseModel):
    primary_role: str


class RoleSwitchRequest(BaseModel):
    active_role: str


class JWTPayload(BaseModel):
    user_id: str
    org_id: str
    github_id: int
    primary_role: str
    active_role: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    username: str
    avatar_url: str | None
    primary_role: str
    active_role: str
    org_id: str

    model_config = {"from_attributes": True}
