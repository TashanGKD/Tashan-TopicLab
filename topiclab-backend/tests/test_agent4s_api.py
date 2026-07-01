import importlib

from sqlalchemy import create_engine
from sqlalchemy import text


def _create_agent4s_table(session):
    session.execute(
        text(
            """
            CREATE TABLE agent4s_wechat_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                album_id TEXT NOT NULL DEFAULT '4525736241471864843',
                msgid TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                cover_url TEXT NOT NULL,
                link TEXT NOT NULL,
                read_count INTEGER,
                like_count INTEGER,
                share_count INTEGER,
                published_at TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_hidden BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
    )


def _insert_article(
    session,
    *,
    msgid,
    title,
    published_at,
    read_count=0,
    is_hidden=False,
):
    session.execute(
        text(
            """
            INSERT INTO agent4s_wechat_articles
                (msgid, title, cover_url, link, read_count, published_at, is_hidden)
            VALUES
                (:msgid, :title, :cover_url, :link, :read_count, :published_at, :is_hidden)
            """
        ),
        {
            "msgid": msgid,
            "title": title,
            "cover_url": f"https://example.com/{msgid}.jpg",
            "link": f"https://mp.weixin.qq.com/s/{msgid}",
            "read_count": read_count,
            "published_at": published_at,
            "is_hidden": is_hidden,
        },
    )


def test_agent4s_wechat_articles_read_from_shared_database(tmp_path, monkeypatch):
    database_path = tmp_path / "tashanhomepage.sqlite3"
    monkeypatch.setenv("TOPICLAB_TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("TASHAN_HOMEPAGE_DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("JWT_SECRET", "test-secret")

    from fastapi.testclient import TestClient
    from app.storage.database import postgres_client
    import main as main_module

    postgres_client.reset_db_state()
    importlib.reload(postgres_client)
    main_module = importlib.reload(main_module)

    homepage_engine = create_engine(f"sqlite:///{database_path}")
    with homepage_engine.begin() as session:
        _create_agent4s_table(session)
        _insert_article(
            session,
            msgid="old",
            title="Agent4S old",
            published_at="2026-05-17T23:46:45+08:00",
            read_count=1435,
        )
        _insert_article(
            session,
            msgid="new",
            title="Agent4S new",
            published_at="2026-06-15T17:04:57+08:00",
            read_count=214,
        )
        _insert_article(
            session,
            msgid="hidden",
            title="Agent4S hidden",
            published_at="2026-06-20T17:04:57+08:00",
            read_count=1,
            is_hidden=True,
        )

    with TestClient(main_module.app) as test_client:
        response = test_client.get("/api/v1/agent4s/wechat-articles")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"] == "tashanhomepage"
    assert [article["msgid"] for article in payload["articles"]] == ["new", "old"]
    assert payload["articles"][0]["title"] == "Agent4S new"
    assert payload["articles"][0]["read_count"] == 214
    assert payload["articles"][0]["cover_url"] == "https://example.com/new.jpg"

    postgres_client.reset_db_state()
