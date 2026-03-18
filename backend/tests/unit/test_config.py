from app.config import settings

def test_settings_loads():
    assert settings.APP_ENV in ("development", "production", "test")

def test_settings_has_required_fields():
    assert settings.DATABASE_URL
    assert settings.REDIS_URL
    assert settings.JWT_SECRET
    assert settings.JWT_EXPIRE_HOURS > 0