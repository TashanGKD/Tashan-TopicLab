import ast
import importlib
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_postgres_engine_sets_pool_and_statement_timeouts(monkeypatch):
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("TOPICLAB_ALLOW_NON_SQLITE_TEST_DB", "1")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/topiclab")
    monkeypatch.setenv("DB_POOL_TIMEOUT", "7")
    monkeypatch.setenv("DB_CONNECT_TIMEOUT", "4")
    monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "12000")
    monkeypatch.setenv("DB_LOCK_TIMEOUT_MS", "3000")
    monkeypatch.setenv("DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", "25000")

    import app.storage.database.postgres_client as postgres_client

    postgres_client.reset_db_state()
    postgres_client = importlib.reload(postgres_client)
    captured = {}

    class FakeEngine:
        def dispose(self):
            pass

    def fake_create_engine(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return FakeEngine()

    monkeypatch.setattr(postgres_client, "create_engine", fake_create_engine)

    postgres_client.get_engine()

    assert captured["kwargs"]["pool_timeout"] == 7
    assert captured["kwargs"]["connect_args"]["connect_timeout"] == 4
    options = captured["kwargs"]["connect_args"]["options"]
    assert "-c statement_timeout=12000" in options
    assert "-c lock_timeout=3000" in options
    assert "-c idle_in_transaction_session_timeout=25000" in options


def test_ready_health_performs_database_probe(tmp_path, monkeypatch):
    database_path = tmp_path / "ready-health.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(tmp_path / "workspace"))

    import app.storage.database.postgres_client as postgres_client
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "topiclab-backend",
        "database": "ok",
    }

    postgres_client.reset_db_state()


def test_topiclink_zvec_store_is_initialized_without_database_cache(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclink-startup.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(tmp_path / "workspace"))

    import app.storage.database.postgres_client as postgres_client
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app):
        import app.api.topiclink as topiclink_module

        assert topiclink_module._zvec_collection is not None
        with postgres_client.get_db_session() as session:
            table_count = session.execute(
                text(
                    "SELECT COUNT(*) FROM sqlite_master "
                    "WHERE type = 'table' AND name = 'topic_link_embedding_cache'"
                )
            ).scalar_one()

    assert table_count == 0
    postgres_client.reset_db_state()


def test_topiclink_zvec_startup_failure_does_not_skip_existing_service_initializers(monkeypatch):
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

    import app.storage.database.inspiration_store as inspiration_store
    import app.storage.database.postgres_client as postgres_client
    import app.storage.database.site_assets_store as site_assets_store
    import app.storage.database.youth_ted_store as youth_ted_store
    import main as main_module

    calls: list[str] = []
    monkeypatch.setattr(postgres_client, "init_auth_tables", lambda: calls.append("auth"))
    monkeypatch.setattr(main_module, "init_topic_tables", lambda: calls.append("topics"))
    monkeypatch.setattr(
        main_module.topiclink_router,
        "initialize_topiclink_storage",
        lambda: (_ for _ in ()).throw(RuntimeError("test Zvec failure")),
    )
    monkeypatch.setattr(site_assets_store, "ensure_site_assets_schema_and_seed", lambda: calls.append("site_assets"))
    monkeypatch.setattr(youth_ted_store, "ensure_youth_ted_schema_and_seed", lambda: calls.append("youth_ted"))
    monkeypatch.setattr(inspiration_store, "ensure_inspiration_schema_and_seed", lambda: calls.append("inspiration"))
    monkeypatch.setattr(main_module.topiclink_router, "start_topiclink_metadata_worker", lambda: calls.append("worker"))

    with TestClient(main_module.app):
        pass

    assert calls == ["auth", "topics", "site_assets", "youth_ted", "inspiration", "worker"]


def test_global_ready_health_does_not_depend_on_topiclink_zvec(tmp_path, monkeypatch):
    database_path = tmp_path / "topiclink-ready.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("WORKSPACE_BASE", str(tmp_path / "workspace"))

    import app.storage.database.postgres_client as postgres_client
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app) as client:
        import app.api.topiclink as topiclink_module

        topiclink_module._zvec_error = "test Zvec failure"
        response = client.get("/health/ready")
        topiclink_response = client.get("/api/v1/topiclink/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "topiclab-backend",
        "database": "ok",
    }
    assert topiclink_response.status_code == 503
    assert topiclink_response.json() == {
        "status": "not_ready",
        "service": "topiclink",
        "zvec": "error",
    }
    postgres_client.reset_db_state()


def test_high_risk_async_routes_use_threadpool_for_sync_work():
    source_root = PROJECT_ROOT / "app" / "api"
    openclaw_source = (source_root / "openclaw.py").read_text(encoding="utf-8")
    topics_source = (source_root / "topics.py").read_text(encoding="utf-8")
    auth_source = (source_root / "auth.py").read_text(encoding="utf-8")
    topiclink_source = (source_root / "topiclink.py").read_text(encoding="utf-8")

    assert "from starlette.concurrency import run_in_threadpool" in openclaw_source
    assert "run_in_threadpool(\n        _load_openclaw_home_payload" in openclaw_source
    assert "run_in_threadpool(\n        _search_openclaw_topics_payload" in openclaw_source
    assert "from starlette.concurrency import run_in_threadpool" in topics_source
    assert "run_in_threadpool(\n            _list_arcade_pending_reviews" in topics_source
    assert "await run_in_threadpool(verify_openclaw_api_key, token)" in topics_source
    assert "await run_in_threadpool(verify_access_token, token)" in topics_source
    assert "from starlette.concurrency import run_in_threadpool" in auth_source
    assert "await run_in_threadpool(verify_access_token, credentials.credentials)" in auth_source
    assert "await run_in_threadpool(verify_openclaw_api_key, token)" in auth_source
    assert "await run_in_threadpool(_load_me_payload" in auth_source
    assert "await asyncio.to_thread(_read_embedding_cache, model, inputs)" in topiclink_source
    assert "await asyncio.to_thread(\n        _write_embedding_cache" in topiclink_source


def test_topiclab_backend_compose_healthcheck_uses_readiness_probe():
    compose_source = (PROJECT_ROOT.parent / "docker-compose.yml").read_text(encoding="utf-8")
    service_block = compose_source.split("  topiclab-backend:", 1)[1].split("\n  backend:", 1)[0]

    assert "http://127.0.0.1:8000/health/ready" in service_block
    assert "http://127.0.0.1:8000/health', timeout=15" not in service_block


def test_resonnet_docker_build_accepts_package_index_overrides():
    compose_source = (PROJECT_ROOT.parent / "docker-compose.yml").read_text(encoding="utf-8")
    dockerfile_source = (PROJECT_ROOT.parent / "backend" / "Dockerfile").read_text(encoding="utf-8")
    service_block = compose_source.split("  backend:", 1)[1].split("\n  frontend:", 1)[0]

    assert "PIP_INDEX_URL:" in service_block
    assert "PIP_TRUSTED_HOST:" in service_block
    assert "PIP_TIMEOUT:" in service_block
    assert "PIP_RETRIES:" in service_block
    assert "ARG PIP_INDEX_URL=" in dockerfile_source
    assert "ARG PIP_TRUSTED_HOST=" in dockerfile_source
    assert "ARG PIP_TIMEOUT=" in dockerfile_source
    assert "ARG PIP_RETRIES=" in dockerfile_source
    assert 'echo "index-url = ${PIP_INDEX_URL}"' in dockerfile_source
    assert 'echo "trusted-host = ${PIP_TRUSTED_HOST}"' in dockerfile_source
    assert 'echo "timeout = ${PIP_TIMEOUT}"' in dockerfile_source
    assert 'echo "retries = ${PIP_RETRIES}"' in dockerfile_source
    assert "pip install --no-cache-dir -e . && exit 0" in dockerfile_source
    assert dockerfile_source.rstrip().split("EXPOSE", 1)[0].rstrip().endswith("exit 1")


def test_topiclab_backend_keeps_two_workers_and_zvec_sidecar_is_single_writer():
    dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
    compose_source = (PROJECT_ROOT.parent / "docker-compose.yml").read_text(encoding="utf-8")
    zvec_service = compose_source.split("  topiclink-zvec:", 1)[1].split("\n  backend:", 1)[0]

    assert '"--workers", "2"' in dockerfile
    assert 'app.topiclink_zvec_service:app' in zvec_service
    assert '"--workers", "1"' in zvec_service
    assert "TOPICLINK_ZVEC_SERVICE_URL=" in zvec_service


def test_topiclink_zvec_sidecar_exposes_single_writer_cache_contract(monkeypatch):
    monkeypatch.delenv("TOPICLINK_ZVEC_SERVICE_URL", raising=False)
    import app.topiclink_zvec_service as service

    calls: list[str] = []
    monkeypatch.setattr(service.topiclink, "_ensure_zvec_collection", lambda: calls.append("open"))
    monkeypatch.setattr(service.topiclink, "start_topiclink_metadata_worker", lambda: calls.append("start"))

    async def fake_stop():
        calls.append("stop")

    monkeypatch.setattr(service.topiclink, "stop_topiclink_metadata_worker", fake_stop)
    monkeypatch.setattr(service.topiclink, "probe_topiclink_storage", lambda session: None)
    monkeypatch.setattr(service.topiclink, "_read_zvec_cache", lambda model, inputs: [[1.0, 0.0] for _ in inputs])
    monkeypatch.setattr(service.topiclink, "_write_zvec_cache", lambda model, inputs, vectors: True)
    monkeypatch.setattr(service.topiclink, "_prune_zvec_cache", lambda force=False: 2)
    monkeypatch.setattr(service.topiclink, "_topiclink_zvec_doc_count", lambda collection: 7)

    with TestClient(service.app) as client:
        health = client.get("/health/ready")
        assert health.json()["status"] == "ready"
        assert health.json()["doc_count"] == 7
        assert client.post("/cache/fetch", json={"model": "m", "inputs": ["a"]}).json() == {
            "vectors": [[1.0, 0.0]]
        }
        assert client.post(
            "/cache/upsert",
            json={"model": "m", "inputs": ["a"], "vectors": [[1.0, 0.0]]},
        ).json() == {"written": 1}
        assert client.post("/cache/prune", json={"force": True}).json() == {"deleted": 2}
        monkeypatch.setenv("TOPICLINK_ZVEC_MIN_DOC_COUNT", "8")
        underfilled = client.get("/health/ready")
        assert underfilled.status_code == 503
        assert underfilled.json()["zvec"] == "underfilled"

    assert calls == ["open", "start", "open", "open", "stop"]


def test_async_api_handlers_do_not_call_sync_auth_verifiers_directly():
    blocked_names = {"verify_access_token", "verify_openclaw_api_key"}
    offenders: list[str] = []

    class DirectAuthCallVisitor(ast.NodeVisitor):
        def __init__(self, path: Path) -> None:
            self.path = path
            self.async_stack: list[str] = []

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            self.async_stack.append(node.name)
            self.generic_visit(node)
            self.async_stack.pop()

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            if not self.async_stack:
                self.generic_visit(node)

        def visit_Call(self, node: ast.Call) -> None:
            if self.async_stack and isinstance(node.func, ast.Name) and node.func.id in blocked_names:
                offenders.append(f"{self.path.relative_to(PROJECT_ROOT)}:{node.lineno}:{self.async_stack[-1]}")
            self.generic_visit(node)

    for path in sorted((PROJECT_ROOT / "app" / "api").glob("*.py")):
        visitor = DirectAuthCallVisitor(path)
        visitor.visit(ast.parse(path.read_text(encoding="utf-8"), filename=str(path)))

    assert offenders == []
