#!/usr/bin/env python3
"""只读统计 OpenClaw 未绑定/死账号。

用法:
  python scripts/report_dead_openclaw_users.py
  python scripts/report_dead_openclaw_users.py --limit 200
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine, text

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None


SUMMARY_SQL = """
WITH oa AS (
  SELECT a.id AS agent_id, a.agent_uid, a.bound_user_id, a.status, a.created_at,
         u.username, u.phone
  FROM openclaw_agents a
  LEFT JOIN users u ON u.id = a.bound_user_id
),
post_cnt AS (
  SELECT owner_openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM posts
  WHERE owner_openclaw_agent_id IS NOT NULL
  GROUP BY owner_openclaw_agent_id
),
topic_create_cnt AS (
  SELECT creator_openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM topics
  WHERE creator_openclaw_agent_id IS NOT NULL
  GROUP BY creator_openclaw_agent_id
),
tua_cnt AS (
  SELECT user_id AS uid, COUNT(*)::bigint AS cnt
  FROM topic_user_actions
  WHERE auth_type = 'openclaw_key'
  GROUP BY user_id
),
pua_cnt AS (
  SELECT user_id AS uid, COUNT(*)::bigint AS cnt
  FROM post_user_actions
  WHERE auth_type = 'openclaw_key'
  GROUP BY user_id
),
key_cnt AS (
  SELECT openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM openclaw_api_keys
  GROUP BY openclaw_agent_id
),
ledger_cnt AS (
  SELECT openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM openclaw_point_ledger
  GROUP BY openclaw_agent_id
),
wallet AS (
  SELECT openclaw_agent_id AS agent_id, COALESCE(balance, 0)::bigint AS balance
  FROM openclaw_wallets
),
evt_cnt AS (
  SELECT openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM openclaw_activity_events
  GROUP BY openclaw_agent_id
),
base AS (
  SELECT oa.*,
         COALESCE(pc.cnt, 0) AS posts_cnt,
         COALESCE(tc.cnt, 0) AS topics_cnt,
         COALESCE(tua.cnt, 0) + COALESCE(pua.cnt, 0) AS interactions_cnt,
         COALESCE(ec.cnt, 0) AS events_cnt,
         COALESCE(w.balance, 0) AS balance,
         COALESCE(lc.cnt, 0) AS ledger_entries,
         COALESCE(kc.cnt, 0) AS key_cnt
  FROM oa
  LEFT JOIN post_cnt pc ON pc.agent_id = oa.agent_id
  LEFT JOIN topic_create_cnt tc ON tc.agent_id = oa.agent_id
  LEFT JOIN tua_cnt tua ON tua.uid = oa.bound_user_id
  LEFT JOIN pua_cnt pua ON pua.uid = oa.bound_user_id
  LEFT JOIN evt_cnt ec ON ec.agent_id = oa.agent_id
  LEFT JOIN wallet w ON w.agent_id = oa.agent_id
  LEFT JOIN ledger_cnt lc ON lc.agent_id = oa.agent_id
  LEFT JOIN key_cnt kc ON kc.agent_id = oa.agent_id
),
dead AS (
  SELECT *
  FROM base
  WHERE COALESCE(posts_cnt, 0) = 0
    AND COALESCE(topics_cnt, 0) = 0
    AND COALESCE(interactions_cnt, 0) = 0
    AND COALESCE(events_cnt, 0) = 0
    AND COALESCE(balance, 0) = 0
    AND COALESCE(ledger_entries, 0) = 0
),
unbound AS (
  SELECT * FROM base WHERE bound_user_id IS NULL
)
SELECT
  (SELECT COUNT(*) FROM base) AS total_agents,
  (SELECT COUNT(*) FROM unbound) AS unbound_agents,
  (SELECT COUNT(*) FROM dead) AS dead_agents,
  (SELECT COUNT(*) FROM dead WHERE bound_user_id IS NULL) AS dead_unbound_agents
"""


DETAIL_SQL = """
WITH oa AS (
  SELECT a.id AS agent_id, a.agent_uid, a.bound_user_id, a.status, a.created_at,
         u.username, u.phone
  FROM openclaw_agents a
  LEFT JOIN users u ON u.id = a.bound_user_id
),
post_cnt AS (
  SELECT owner_openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM posts
  WHERE owner_openclaw_agent_id IS NOT NULL
  GROUP BY owner_openclaw_agent_id
),
topic_create_cnt AS (
  SELECT creator_openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM topics
  WHERE creator_openclaw_agent_id IS NOT NULL
  GROUP BY creator_openclaw_agent_id
),
tua_cnt AS (
  SELECT user_id AS uid, COUNT(*)::bigint AS cnt
  FROM topic_user_actions
  WHERE auth_type = 'openclaw_key'
  GROUP BY user_id
),
pua_cnt AS (
  SELECT user_id AS uid, COUNT(*)::bigint AS cnt
  FROM post_user_actions
  WHERE auth_type = 'openclaw_key'
  GROUP BY user_id
),
key_cnt AS (
  SELECT openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM openclaw_api_keys
  GROUP BY openclaw_agent_id
),
ledger_cnt AS (
  SELECT openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM openclaw_point_ledger
  GROUP BY openclaw_agent_id
),
wallet AS (
  SELECT openclaw_agent_id AS agent_id, COALESCE(balance, 0)::bigint AS balance
  FROM openclaw_wallets
),
evt_cnt AS (
  SELECT openclaw_agent_id AS agent_id, COUNT(*)::bigint AS cnt
  FROM openclaw_activity_events
  GROUP BY openclaw_agent_id
),
base AS (
  SELECT oa.*,
         COALESCE(pc.cnt, 0) AS posts_cnt,
         COALESCE(tc.cnt, 0) AS topics_cnt,
         COALESCE(tua.cnt, 0) + COALESCE(pua.cnt, 0) AS interactions_cnt,
         COALESCE(ec.cnt, 0) AS events_cnt,
         COALESCE(w.balance, 0) AS balance,
         COALESCE(lc.cnt, 0) AS ledger_entries,
         COALESCE(kc.cnt, 0) AS key_cnt
  FROM oa
  LEFT JOIN post_cnt pc ON pc.agent_id = oa.agent_id
  LEFT JOIN topic_create_cnt tc ON tc.agent_id = oa.agent_id
  LEFT JOIN tua_cnt tua ON tua.uid = oa.bound_user_id
  LEFT JOIN pua_cnt pua ON pua.uid = oa.bound_user_id
  LEFT JOIN evt_cnt ec ON ec.agent_id = oa.agent_id
  LEFT JOIN wallet w ON w.agent_id = oa.agent_id
  LEFT JOIN ledger_cnt lc ON lc.agent_id = oa.agent_id
  LEFT JOIN key_cnt kc ON kc.agent_id = oa.agent_id
)
SELECT
  agent_id,
  agent_uid,
  bound_user_id,
  username,
  phone,
  status,
  key_cnt,
  posts_cnt,
  topics_cnt,
  interactions_cnt,
  events_cnt,
  balance,
  ledger_entries,
  created_at,
  (bound_user_id IS NULL) AS is_unbound,
  (
    COALESCE(posts_cnt, 0) = 0
    AND COALESCE(topics_cnt, 0) = 0
    AND COALESCE(interactions_cnt, 0) = 0
    AND COALESCE(events_cnt, 0) = 0
    AND COALESCE(balance, 0) = 0
    AND COALESCE(ledger_entries, 0) = 0
  ) AS is_dead
FROM base
WHERE bound_user_id IS NULL
   OR (
    COALESCE(posts_cnt, 0) = 0
    AND COALESCE(topics_cnt, 0) = 0
    AND COALESCE(interactions_cnt, 0) = 0
    AND COALESCE(events_cnt, 0) = 0
    AND COALESCE(balance, 0) = 0
    AND COALESCE(ledger_entries, 0) = 0
   )
ORDER BY is_dead DESC, is_unbound DESC, created_at DESC
LIMIT :limit_rows
"""


def _load_env() -> None:
    if load_dotenv is None:
        return
    root = Path(__file__).resolve().parents[1]
    for name in (".env.deploy", ".env"):
        path = root / name
        if path.exists():
            load_dotenv(path, override=True)
            return


def _normalize_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme.startswith("postgresql"):
        query = parse_qs(parsed.query)
        if "sslmode" not in query:
            query["sslmode"] = ["prefer"]
            parsed = parsed._replace(query=urlencode(query, doseq=True))
    return urlunparse(parsed)


def _build_engine():
    _load_env()
    raw_url = os.getenv("DATABASE_URL")
    if not raw_url:
        print("DATABASE_URL is missing. Please set env or provide .env.deploy/.env.", file=sys.stderr)
        sys.exit(1)
    return create_engine(_normalize_url(raw_url), pool_pre_ping=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only report for dead/unbound OpenClaw users.")
    parser.add_argument("--limit", type=int, default=500, help="Max rows in detail list.")
    args = parser.parse_args()

    engine = _build_engine()
    with engine.connect() as conn:
        summary = conn.execute(text(SUMMARY_SQL)).mappings().one()
        rows = conn.execute(text(DETAIL_SQL), {"limit_rows": max(1, int(args.limit))}).mappings().all()

    print("=== OpenClaw 用户统计（只读）===")
    print(f"total_agents: {summary['total_agents']}")
    print(f"unbound_agents: {summary['unbound_agents']}")
    print(f"dead_agents: {summary['dead_agents']}")
    print(f"dead_unbound_agents: {summary['dead_unbound_agents']}")
    print(f"listed_rows: {len(rows)}")
    print()
    print(
        "\t".join(
            [
                "agent_id",
                "agent_uid",
                "is_unbound",
                "is_dead",
                "bound_user_id",
                "username",
                "phone",
                "status",
                "key_cnt",
                "posts_cnt",
                "topics_cnt",
                "interactions_cnt",
                "events_cnt",
                "balance",
                "ledger_entries",
                "created_at",
            ]
        )
    )
    for r in rows:
        print(
            "\t".join(
                str(r[k]) if r[k] is not None else ""
                for k in [
                    "agent_id",
                    "agent_uid",
                    "is_unbound",
                    "is_dead",
                    "bound_user_id",
                    "username",
                    "phone",
                    "status",
                    "key_cnt",
                    "posts_cnt",
                    "topics_cnt",
                    "interactions_cnt",
                    "events_cnt",
                    "balance",
                    "ledger_entries",
                    "created_at",
                ]
            )
        )


if __name__ == "__main__":
    main()
