import importlib

from sqlalchemy import text


def test_inspiration_schema_initialization_is_cached(tmp_path, monkeypatch):
    database_path = tmp_path / "inspiration-perf.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    from app.storage.database import inspiration_store, postgres_client

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    inspiration_store = importlib.reload(inspiration_store)

    calls = {"ddl": 0, "seed": 0, "backfill": 0}
    original_apply = inspiration_store._apply_inspiration_ddl
    original_seed = inspiration_store._seed_inspiration_demands
    original_backfill = inspiration_store._backfill_clue_numbers

    def counted_apply(session):
        calls["ddl"] += 1
        return original_apply(session)

    def counted_seed(session):
        calls["seed"] += 1
        return original_seed(session)

    def counted_backfill(session):
        calls["backfill"] += 1
        return original_backfill(session)

    monkeypatch.setattr(inspiration_store, "_apply_inspiration_ddl", counted_apply)
    monkeypatch.setattr(inspiration_store, "_seed_inspiration_demands", counted_seed)
    monkeypatch.setattr(inspiration_store, "_backfill_clue_numbers", counted_backfill)

    inspiration_store.list_public_demands()
    inspiration_store.list_public_demands()

    assert calls == {"ddl": 1, "seed": 1, "backfill": 1}

    postgres_client.reset_db_state()


def test_inspiration_hot_path_indexes_are_created(tmp_path, monkeypatch):
    database_path = tmp_path / "inspiration-indexes.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    from app.storage.database import inspiration_store, postgres_client

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    inspiration_store = importlib.reload(inspiration_store)

    with postgres_client.get_db_session() as session:
        inspiration_store.ensure_inspiration_schema_and_seed_for_session(session)
        index_rows = session.execute(text("SELECT name FROM sqlite_master WHERE type = 'index'")).fetchall()

    indexes = {row[0] for row in index_rows}
    assert "idx_inspiration_demands_public_updated" in indexes
    assert "idx_inspiration_updates_public_stage_latest" in indexes
    assert "idx_inspiration_assistant_runs_status_created" in indexes

    postgres_client.reset_db_state()
