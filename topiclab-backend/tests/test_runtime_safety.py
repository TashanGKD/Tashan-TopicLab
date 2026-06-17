import ast
import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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


def test_high_risk_async_routes_use_threadpool_for_sync_work():
    source_root = PROJECT_ROOT / "app" / "api"
    openclaw_source = (source_root / "openclaw.py").read_text(encoding="utf-8")
    topics_source = (source_root / "topics.py").read_text(encoding="utf-8")
    auth_source = (source_root / "auth.py").read_text(encoding="utf-8")

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


def test_topiclab_backend_compose_healthcheck_uses_readiness_probe():
    compose_source = (PROJECT_ROOT.parent / "docker-compose.yml").read_text(encoding="utf-8")
    service_block = compose_source.split("  topiclab-backend:", 1)[1].split("\n  backend:", 1)[0]

    assert "http://127.0.0.1:8000/health/ready" in service_block
    assert "http://127.0.0.1:8000/health', timeout=15" not in service_block


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
