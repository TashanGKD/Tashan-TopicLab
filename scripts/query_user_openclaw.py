#!/usr/bin/env python3
"""查询指定用户的 OpenClaw 数量及活动。需 DATABASE_URL。用法：
  DATABASE_URL='...' python scripts/query_user_openclaw.py [username]
  或从项目根目录加载 .env.deploy：
  python scripts/query_user_openclaw.py Zerui
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

# 加载项目根目录的 .env.deploy 或 .env
_root = Path(__file__).resolve().parents[1]
for _f in (".env.deploy", ".env"):
    _p = _root / _f
    if _p.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(_p, override=True)
        except ImportError:
            pass
        break

from sqlalchemy import create_engine, text


def main():
    username = (sys.argv[1] if len(sys.argv) > 1 else "Zerui").strip()
    url = os.getenv("DATABASE_URL")
    if not url:
        print("Usage: DATABASE_URL='...' python scripts/query_user_openclaw.py [username]", file=sys.stderr)
        print("Or ensure .env.deploy exists in project root with DATABASE_URL.", file=sys.stderr)
        sys.exit(1)

    parsed = urlparse(url)
    if parsed.scheme and "postgresql" in parsed.scheme:
        query = parse_qs(parsed.query)
        if "sslmode" not in query:
            query["sslmode"] = ["prefer"]
            parsed = parsed._replace(query=urlencode(query, doseq=True))
        url = urlunparse(parsed)

    engine = create_engine(url, pool_pre_ping=True)

    with engine.connect() as conn:
        # 1. 查找用户（username 模糊匹配）
        users = conn.execute(
            text("SELECT id, username, phone FROM users WHERE username ILIKE :pat OR phone ILIKE :pat"),
            {"pat": f"%{username}%"},
        ).fetchall()

        if not users:
            print(f"未找到用户（username/phone 包含 '{username}'）")
            sys.exit(0)

        for u in users:
            uid, uname, phone = u[0], u[1] or "", u[2] or ""
            print(f"\n=== 用户: id={uid}, username={uname or '(空)'}, phone={phone} ===\n")

            # 2. OpenClaw 数量（每个用户最多 1 个 key）
            keys = conn.execute(
                text(
                    "SELECT token_prefix, created_at, last_used_at FROM openclaw_api_keys WHERE user_id = :uid"
                ),
                {"uid": uid},
            ).fetchall()

            print(f"OpenClaw 数量: {len(keys)}")
            for k in keys:
                prefix, created, last_used = k[0], k[1], k[2]
                print(f"  - token_prefix: {prefix}, 创建: {created}, 最后使用: {last_used}")

            # 3. 该用户通过 openclaw 创建的话题
            topics = conn.execute(
                text(
                    """
                    SELECT id, title, category, creator_name, creator_auth_type, created_at
                    FROM topics
                    WHERE creator_user_id = :uid AND creator_auth_type = 'openclaw_key'
                    ORDER BY created_at DESC
                    """
                ),
                {"uid": uid},
            ).fetchall()

            print(f"\n通过 OpenClaw 创建的话题: {len(topics)} 个")
            for t in topics[:20]:
                tid, title, cat, cname, ctype, created = t[0], t[1], t[2], t[3], t[4], t[5]
                print(f"  - [{tid}] {title[:50]}... | 分类:{cat} | {created}")

            if len(topics) > 20:
                print(f"  ... 还有 {len(topics) - 20} 个")

            # 4. 该用户通过 openclaw 发的帖子
            posts = conn.execute(
                text(
                    """
                    SELECT p.id, p.topic_id, p.author, p.body, p.created_at, t.title
                    FROM posts p
                    JOIN topics t ON t.id = p.topic_id
                    WHERE p.owner_user_id = :uid AND p.owner_auth_type = 'openclaw_key'
                    ORDER BY p.created_at DESC
                    """
                ),
                {"uid": uid},
            ).fetchall()

            print(f"\n通过 OpenClaw 发的帖子: {len(posts)} 条")
            for p in posts[:15]:
                pid, tid, author, body, created, ttitle = p[0], p[1], p[2], p[3], p[4], p[5]
                body_preview = (body or "")[:60].replace("\n", " ")
                print(f"  - [{tid}] {ttitle[:30]}... | 作者:{author} | {created}")
                print(f"    内容: {body_preview}...")

            if len(posts) > 15:
                print(f"  ... 还有 {len(posts) - 15} 条")

            # 5. 该用户 openclaw 的点赞/收藏等（topic_user_actions, post_user_actions）
            topic_actions = conn.execute(
                text(
                    """
                    SELECT topic_id, liked, favorited FROM topic_user_actions
                    WHERE user_id = :uid AND auth_type = 'openclaw_key'
                    """
                ),
                {"uid": uid},
            ).fetchall()

            post_actions = conn.execute(
                text(
                    """
                    SELECT topic_id, post_id, liked FROM post_user_actions
                    WHERE user_id = :uid AND auth_type = 'openclaw_key'
                    """
                ),
                {"uid": uid},
            ).fetchall()

            if topic_actions or post_actions:
                print(f"\nOpenClaw 互动: 话题点赞/收藏 {len(topic_actions)} 条, 帖子点赞 {len(post_actions)} 条")


if __name__ == "__main__":
    main()
