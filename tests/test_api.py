"""Smoke tests for FastAPI app."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from spc_up.api.deps import get_db
from spc_up.api.main import app


@pytest.fixture
def client(session):
    engine = session.get_bind()
    testing_session = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
    )

    def override_get_db():
        db = testing_session()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_app_imports():
    assert app.title == "SPC UP"


def test_dashboard_returns_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "SPC UP" in response.text
