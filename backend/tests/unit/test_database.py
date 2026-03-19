from sqlalchemy import text

from app.database import Base, SessionLocal, engine


def test_engine_connects():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        assert result.scalar() == 1


def test_session_factory_creates_session():
    db = SessionLocal()
    try:
        result = db.execute(text("SELECT 1"))
        assert result.scalar() == 1
    finally:
        db.close()


def test_base_has_metadata():
    assert Base.metadata is not None


def test_get_db_yields_session():
    from app.database import get_db

    gen = get_db()
    db = next(gen)
    assert db is not None
    try:
        next(gen)
    except StopIteration:
        pass
