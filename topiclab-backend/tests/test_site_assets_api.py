import importlib
from io import BytesIO

import pytest
from PIL import Image


@pytest.fixture
def client(tmp_path, monkeypatch):
    database_path = tmp_path / "site_assets.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("ADMIN_PANEL_PASSWORD", "admin-secret")
    monkeypatch.setenv("SITE_ASSET_UPLOAD_KEY", "asset-upload-secret")

    from fastapi.testclient import TestClient
    from app.storage.database import postgres_client
    import app.storage.database.site_assets_store as site_assets_store
    import main as main_module

    postgres_client.reset_db_state()
    site_assets_store.clear_site_assets_cache()
    importlib.reload(postgres_client)
    site_assets_store = importlib.reload(site_assets_store)
    main_module = importlib.reload(main_module)

    with TestClient(main_module.app) as test_client:
        yield test_client, site_assets_store

    postgres_client.reset_db_state()
    site_assets_store.clear_site_assets_cache()


def test_wechat_group_qr_serves_seeded_webp(client):
    test_client, _ = client

    response = test_client.get("/api/v1/site/wechat-group-qr.webp")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.headers["cache-control"] == "public, max-age=60"
    assert response.content[:4] == b"RIFF"
    assert response.content[8:12] == b"WEBP"


def test_wechat_group_qr_supports_head_check(client):
    test_client, _ = client

    response = test_client.head("/api/v1/site/wechat-group-qr.webp")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.headers["cache-control"] == "public, max-age=60"


def test_wechat_group_qr_uses_database_update_without_code_change(client):
    test_client, site_assets_store = client
    updated = b"RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x00updated"

    site_assets_store.upsert_site_image_asset(
        key="wechat-group-qr",
        image_webp=updated,
        mime_type="image/webp",
        expires_at="2026-05-26T00:00:00+08:00",
        source_filename="wechat-qr.webp",
    )

    response = test_client.get("/api/v1/site/wechat-group-qr.webp")

    assert response.status_code == 200, response.text
    assert response.content == updated


def test_site_asset_can_be_served_by_key(client):
    test_client, site_assets_store = client
    updated = b"RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x00generic"

    site_assets_store.upsert_site_image_asset(
        key="wechat-group-qr",
        image_webp=updated,
        mime_type="image/webp",
        expires_at="2026-05-26T00:00:00+08:00",
        source_filename="wechat-qr.webp",
    )

    response = test_client.get("/api/v1/site/assets/wechat-group-qr.webp")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.headers["cache-control"] == "public, max-age=60"
    assert response.content == updated


def test_lggc_wechat_group_qr_serves_seeded_webp_by_key(client):
    test_client, _ = client

    response = test_client.get("/api/v1/site/assets/lggc-wechat-group.webp")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.content[:4] == b"RIFF"
    assert response.content[8:12] == b"WEBP"


def test_upload_key_can_upload_site_asset_by_key(client):
    test_client, _ = client
    source = BytesIO()
    Image.new("RGB", (24, 16), color=(20, 120, 240)).save(source, format="PNG")

    response = test_client.post(
        "/api/v1/site/assets/wechat-group-qr?key=asset-upload-secret",
        data={"expires_at": "2026-05-29T00:03:32+08:00"},
        files={"image": ("wechat.png", source.getvalue(), "image/png")},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["key"] == "wechat-group-qr"
    assert payload["mime_type"] == "image/webp"
    assert payload["width"] == 24
    assert payload["height"] == 16
    assert payload["url"] == "/api/v1/site/assets/wechat-group-qr.webp"
    assert payload["legacy_urls"] == ["/api/v1/site/wechat-group-qr.webp"]

    image_response = test_client.get("/api/v1/site/assets/wechat-group-qr.webp")
    assert image_response.status_code == 200, image_response.text
    assert image_response.content[:4] == b"RIFF"
    assert image_response.content[8:12] == b"WEBP"


def test_site_asset_upload_requires_valid_upload_key(client):
    test_client, _ = client

    response = test_client.post(
        "/api/v1/site/assets/wechat-group-qr?key=wrong-secret",
        files={"image": ("wechat.png", b"not an image", "image/png")},
    )

    assert response.status_code == 401
