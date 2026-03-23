import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Commit(Base):
    __tablename__ = "commits"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organisations.id"),
        nullable=False,
    )
    repo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repos.id"),
        nullable=False,
    )
    sha: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    author_github_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    files_changed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pushed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
