from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,  # 'pool_pre_ping=True` means SQLAlchemy tests the connection before using it — if the database restarted, it reconnects automatically instead of crashing.
    pool_size=10,  # `pool_size=10` and `max_overflow=20` means up to 30 simultaneous database connections can be open at once — enough for multiple workers running concurrently.
    max_overflow=20,
)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """
    `get_db()` is a FastAPI dependency. Any route that needs a database session declares it as a parameter and FastAPI injects it automatically, closing it cleanly when the request ends.

    """

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# `get_db()` is a FastAPI dependency. Any route that needs a database session declares it as a parameter and FastAPI injects it automatically, closing it cleanly when the request ends.
