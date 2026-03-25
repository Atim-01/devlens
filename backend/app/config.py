# This is your single source of truth for all configuration. Every other file in the backend will import `settings` from here instead of reading environment variables directly. This means if a variable is missing, the app fails immediately on startup with a clear error — not silently mid-request.


from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"
    GITHUB_CLIENT_ID: str
    GITHUB_CLIENT_SECRET: str
    GITHUB_WEBHOOK_SECRET: str
    JWT_SECRET: str
    JWT_EXPIRE_HOURS: int = 8
    HUGGINGFACE_API_TOKEN: str
    APP_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:5173"

    # The URL GitHub redirects to after the user approves the OAuth request.
    # This must match exactly what you register in your GitHub OAuth App settings.
    # We build it from FRONTEND_URL so it automatically updates between
    # development and production environments.
    @property
    def GITHUB_REDIRECT_URI(self) -> str:
        return f"{self.FRONTEND_URL}/auth/callback"


settings = Settings()
