import importlib

import httpx
import pytest
from fastapi import FastAPI


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("TOPICLAB_TESTING", "1")

    import app.api.skills as skills_module

    importlib.reload(skills_module)

    app = FastAPI()
    app.include_router(skills_module.router)
    app.include_router(skills_module.router, prefix="/api/v1")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as test_client:
        yield test_client, skills_module


@pytest.mark.anyio
async def test_skills_proxy_routes_to_resonnet(client, monkeypatch):
    test_client, skills_module = client

    async def fake_request_json(method, path, **kwargs):
        assert method == "GET"
        if path == "/skills/assignable":
            assert kwargs["params"]["q"] == "dream"
            return [{"id": "research-dream:research-dream"}]
        if path == "/skills/assignable/research-dream:research-dream":
            return {"id": "research-dream:research-dream", "content_path": "/skills/assignable/research-dream:research-dream/content"}
        if path == "/skills/assignable/research-dream:research-dream/content":
            return {"content": "# Research Dream"}
        raise AssertionError(f"Unexpected upstream path: {path}")

    monkeypatch.setattr(skills_module, "request_json", fake_request_json)

    listed = await test_client.get("/skills/assignable", params={"q": "dream"})
    assert listed.status_code == 200, listed.text
    assert listed.json() == [{"id": "research-dream:research-dream"}]

    detailed = await test_client.get("/api/v1/skills/assignable/research-dream:research-dream")
    assert detailed.status_code == 200, detailed.text
    assert detailed.json()["id"] == "research-dream:research-dream"

    content = await test_client.get("/skills/assignable/research-dream:research-dream/content")
    assert content.status_code == 200, content.text
    assert content.json()["content"] == "# Research Dream"
