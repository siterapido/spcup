"""Shared pytest fixtures."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

from spc_up.models.base import Base


@compiles(UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):
    return "CHAR(36)"


@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"


@pytest.fixture
def session() -> Session:
    """In-memory SQLite session for DB tests when Postgres is unavailable."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)
