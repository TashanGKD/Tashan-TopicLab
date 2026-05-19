import httpx
import pytest


@pytest.mark.asyncio
async def test_request_inspiration_llm_uses_configured_chat_completions_url(monkeypatch):
    from app.services.inspiration_llm import request_inspiration_llm

    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers.get("authorization")
        captured["payload"] = httpx.Request(request.method, request.url, content=request.content).read()
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "{\"ok\":true}"}}]},
        )

    monkeypatch.setenv("INSPIRATION_LLM_CHAT_COMPLETIONS_URL", "https://newapi.tashan.chat/v1/chat/completions")
    monkeypatch.setenv("INSPIRATION_LLM_API_KEY", "test-key")
    monkeypatch.setenv("INSPIRATION_LLM_MODEL", "DeepSeek-V4-Flash")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        content = await request_inspiration_llm(
            [{"role": "user", "content": "hi"}],
            temperature=0.1,
            client=client,
        )

    assert content == "{\"ok\":true}"
    assert captured["url"] == "https://newapi.tashan.chat/v1/chat/completions"
    assert captured["authorization"] == "Bearer test-key"
    assert b'"model":"DeepSeek-V4-Flash"' in captured["payload"]
    assert b'"temperature":0.1' in captured["payload"]


@pytest.mark.asyncio
async def test_request_inspiration_llm_requires_dedicated_env(monkeypatch):
    from app.services.inspiration_llm import InspirationLLMNotConfigured, request_inspiration_llm

    monkeypatch.delenv("INSPIRATION_LLM_CHAT_COMPLETIONS_URL", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_API_KEY", raising=False)
    monkeypatch.delenv("INSPIRATION_LLM_MODEL", raising=False)
    monkeypatch.setenv("AI_GENERATION_BASE_URL", "https://legacy.example/v1")
    monkeypatch.setenv("AI_GENERATION_API_KEY", "legacy-key")
    monkeypatch.setenv("AI_GENERATION_MODEL", "legacy-model")

    with pytest.raises(InspirationLLMNotConfigured):
        await request_inspiration_llm([{"role": "user", "content": "hi"}])
