from urllib.parse import parse_qs, urlparse

import pytest

import app.api.auth as auth_module


class _FakeResponse:
    def __init__(self, text: str):
        self.text = text


class _FakeAsyncClient:
    def __init__(self, response_text: str, bucket: list[str]):
        self._response_text = response_text
        self._bucket = bucket

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str):
        self._bucket.append(url)
        return _FakeResponse(self._response_text)


@pytest.mark.asyncio
async def test_send_sms_uses_api_key_and_goodsid_when_configured(monkeypatch):
    calls: list[str] = []

    monkeypatch.setenv("SMSBAO_USERNAME", "official-user")
    monkeypatch.delenv("SMSBAO_PASSWORD", raising=False)
    monkeypatch.setenv("SMSBAO_API_KEY", "official-api-key")
    monkeypatch.setenv("SMSBAO_GOODSID", "123456")
    monkeypatch.setattr(
        auth_module.httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient("0", calls),
    )

    success, message = await auth_module.send_sms("13800138000", "654321")

    assert success is True
    assert message == "验证码发送成功"
    assert len(calls) == 1
    parsed = parse_qs(urlparse(calls[0]).query)
    assert parsed["u"] == ["official-user"]
    assert parsed["p"] == ["official-api-key"]
    assert parsed["m"] == ["13800138000"]
    assert parsed["g"] == ["123456"]
    assert parsed["c"] == ["【北京攻玉智研科技】您的验证码是654321。如非本人操作，请忽略本短信"]


@pytest.mark.asyncio
async def test_send_sms_md5_hashes_password_when_api_key_missing(monkeypatch):
    calls: list[str] = []

    monkeypatch.setenv("SMSBAO_USERNAME", "official-user")
    monkeypatch.setenv("SMSBAO_PASSWORD", "plain-password")
    monkeypatch.delenv("SMSBAO_API_KEY", raising=False)
    monkeypatch.delenv("SMSBAO_GOODSID", raising=False)
    monkeypatch.setattr(
        auth_module.httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient("0", calls),
    )

    success, _ = await auth_module.send_sms("13800138000", "123456")

    assert success is True
    parsed = parse_qs(urlparse(calls[0]).query)
    assert parsed["p"] == ["9a0ef3ecf101a8b0856f98eb6b2e2c24"]
    assert "g" not in parsed


@pytest.mark.asyncio
async def test_send_sms_uses_prehashed_password_as_is(monkeypatch):
    calls: list[str] = []

    monkeypatch.setenv("SMSBAO_USERNAME", "official-user")
    monkeypatch.setenv("SMSBAO_PASSWORD", "9a0ef3ecf101a8b0856f98eb6b2e2c24")
    monkeypatch.delenv("SMSBAO_API_KEY", raising=False)
    monkeypatch.setattr(
        auth_module.httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient("0", calls),
    )

    success, _ = await auth_module.send_sms("13800138000", "123456")

    assert success is True
    parsed = parse_qs(urlparse(calls[0]).query)
    assert parsed["p"] == ["9a0ef3ecf101a8b0856f98eb6b2e2c24"]


@pytest.mark.asyncio
async def test_send_sms_maps_production_error_codes(monkeypatch):
    monkeypatch.setenv("SMSBAO_USERNAME", "official-user")
    monkeypatch.setenv("SMSBAO_API_KEY", "official-api-key")
    monkeypatch.delenv("SMSBAO_PASSWORD", raising=False)
    monkeypatch.setattr(
        auth_module.httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient("50", []),
    )

    success, message = await auth_module.send_sms("13800138000", "123456")

    assert success is False
    assert message == "短信内容未通过审核或含敏感词"
