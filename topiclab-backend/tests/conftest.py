import os

import pytest


# Tests must never inherit a production DATABASE_URL by accident.
os.environ.setdefault("TOPICLAB_TESTING", "1")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")


@pytest.fixture(autouse=True)
def isolated_skill_hub_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILL_HUB_STORAGE_DIR", str(tmp_path / "skill_hub_uploads"))
