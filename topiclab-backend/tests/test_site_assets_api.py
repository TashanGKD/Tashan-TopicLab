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
    monkeypatch.setenv("ADMIN_USER_IDS", "1")

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


def admin_headers(test_client):
    from app.api.auth import create_jwt_token

    return {"Authorization": f"Bearer {create_jwt_token(1, '13800138000', is_admin=True)}"}


def user_headers():
    from app.api.auth import create_jwt_token

    return {"Authorization": f"Bearer {create_jwt_token(2, '13800138002')}"}


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


def test_site_asset_metadata_includes_latest_update_time(client):
    test_client, site_assets_store = client
    updated = b"RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x00generic"

    site_assets_store.upsert_site_image_asset(
        key="wechat-group-qr",
        image_webp=updated,
        mime_type="image/webp",
        expires_at="2026-05-26T00:00:00+08:00",
        source_filename="wechat-qr.webp",
    )

    response = test_client.get("/api/v1/site/assets/wechat-group-qr")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["key"] == "wechat-group-qr"
    assert payload["mime_type"] == "image/webp"
    assert payload["expires_at"] == "2026-05-26T00:00:00+08:00"
    assert payload["source_filename"] == "wechat-qr.webp"
    assert payload["updated_at"]
    assert payload["url"] == "/api/v1/site/assets/wechat-group-qr.webp"
    assert payload["legacy_urls"] == ["/api/v1/site/wechat-group-qr.webp"]


def test_lggc_wechat_group_qr_serves_seeded_webp_by_key(client):
    test_client, _ = client

    response = test_client.get("/api/v1/site/assets/lggc-wechat-group.webp")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert response.content[:4] == b"RIFF"
    assert response.content[8:12] == b"WEBP"


def test_admin_can_upload_site_asset_by_key(client):
    test_client, _ = client
    source = BytesIO()
    Image.new("RGB", (24, 16), color=(20, 120, 240)).save(source, format="PNG")

    response = test_client.post(
        "/api/v1/site/assets/wechat-group-qr",
        headers=admin_headers(test_client),
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
    assert payload["updated_at"]

    image_response = test_client.get("/api/v1/site/assets/wechat-group-qr.webp")
    assert image_response.status_code == 200, image_response.text
    assert image_response.content[:4] == b"RIFF"
    assert image_response.content[8:12] == b"WEBP"


def test_site_asset_upload_requires_admin_authentication(client):
    test_client, _ = client

    response = test_client.post(
        "/api/v1/site/assets/wechat-group-qr",
        files={"image": ("wechat.png", b"not an image", "image/png")},
    )

    assert response.status_code == 401


def test_qr_groups_are_seeded_with_dynamic_page_metadata(client):
    test_client, _ = client

    response = test_client.get("/api/v1/site/qr-groups")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [(item["slug"], item["title"]) for item in payload["items"]] == [
        ("lggc-wechat-group", "灵感共创队群聊二维码"),
        ("world-wechat-group", "他山世界交流群二维码"),
    ]
    world = next(item for item in payload["items"] if item["slug"] == "world-wechat-group")
    assert world["path"] == "/qr/world-wechat-group"
    assert world["key"] == "wechat-group-qr"
    assert world["url"] == "/api/v1/site/assets/wechat-group-qr.webp"

    detail_response = test_client.get("/api/v1/site/qr-groups/world-wechat-group")
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["title"] == "他山世界交流群二维码"


def test_admin_can_create_qr_group_with_path_title_and_image(client):
    test_client, _ = client
    source = BytesIO()
    Image.new("RGB", (30, 40), color=(30, 180, 90)).save(source, format="PNG")

    response = test_client.post(
        "/api/v1/site/qr-groups",
        headers=admin_headers(test_client),
        data={"path": "/qr/summer-community", "title": "夏日共创群"},
        files={"image": ("summer.png", source.getvalue(), "image/png")},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["slug"] == "summer-community"
    assert payload["path"] == "/qr/summer-community"
    assert payload["title"] == "夏日共创群"
    assert payload["key"] == "qr-summer-community"
    assert payload["width"] == 30
    assert payload["height"] == 40

    detail_response = test_client.get("/api/v1/site/qr-groups/summer-community")
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["title"] == "夏日共创群"

    image_response = test_client.get("/api/v1/site/assets/qr-summer-community.webp")
    assert image_response.status_code == 200, image_response.text
    assert image_response.content[:4] == b"RIFF"
    assert image_response.content[8:12] == b"WEBP"


def test_admin_can_edit_qr_path_title_and_optionally_replace_image(client):
    test_client, _ = client

    response = test_client.put(
        "/api/v1/site/qr-groups/world-wechat-group",
        headers=admin_headers(test_client),
        data={"path": "/qr/world-community", "title": "他山世界新群"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["slug"] == "world-community"
    assert payload["path"] == "/qr/world-community"
    assert payload["title"] == "他山世界新群"
    assert payload["key"] == "wechat-group-qr"
    assert payload["webp_bytes"] is None
    assert test_client.get("/api/v1/site/qr-groups/world-wechat-group").status_code == 404
    assert test_client.get("/api/v1/site/qr-groups/world-community").status_code == 200
    assert test_client.get("/api/v1/site/wechat-group-qr.webp").status_code == 200


def test_qr_group_admin_list_and_mutations_require_admin_authentication(client):
    test_client, _ = client

    list_response = test_client.get("/api/v1/site/qr-groups/admin")
    create_response = test_client.post(
        "/api/v1/site/qr-groups",
        data={"path": "/qr/private", "title": "私有群"},
        files={"image": ("private.png", b"not-an-image", "image/png")},
    )

    assert list_response.status_code == 401
    assert create_response.status_code == 401

    forbidden_list = test_client.get("/api/v1/site/qr-groups/admin", headers=user_headers())
    forbidden_create = test_client.post(
        "/api/v1/site/qr-groups",
        headers=user_headers(),
        data={"path": "/qr/private", "title": "私有群"},
        files={"image": ("private.png", b"not-an-image", "image/png")},
    )
    assert forbidden_list.status_code == 403
    assert forbidden_create.status_code == 403


@pytest.mark.parametrize(
    ("path", "title"),
    [
        ("/qr/Uppercase", "有效标题"),
        ("/qr/has/slash", "有效标题"),
        ("/qr/valid-path", ""),
    ],
)
def test_create_qr_group_validates_path_and_title(client, path, title):
    test_client, _ = client
    source = BytesIO()
    Image.new("RGB", (8, 8), color=(0, 0, 0)).save(source, format="PNG")

    response = test_client.post(
        "/api/v1/site/qr-groups",
        headers=admin_headers(test_client),
        data={"path": path, "title": title},
        files={"image": ("qr.png", source.getvalue(), "image/png")},
    )

    assert response.status_code == 400, response.text
