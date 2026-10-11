"""User-facing MCP Hub interactions backed by the static active catalog."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from app.services.science_mcp_catalog import get_mcp_catalog_item
from app.storage.database.postgres_client import database_configured, get_db_session


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id(user: dict[str, Any]) -> int:
    try:
        return int(user["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="登录身份无效") from exc


def _json_loads(value: Any, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def _row_value(row: Any, key: str, default: Any = None) -> Any:
    if row is None:
        return default
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return mapping.get(key, default)
    return getattr(row, key, default)


def _author(row: Any, *, user_id_key: str = "author_user_id") -> dict[str, Any]:
    user_id = _row_value(row, user_id_key)
    return {
        "id": int(user_id) if user_id is not None else None,
        "display_name": _row_value(row, "author_username") or _row_value(row, "author_handle"),
        "handle": _row_value(row, "author_handle"),
    }


def _mcp(mcp_id: str) -> dict[str, Any]:
    needle = (mcp_id or "").strip()
    if not needle:
        raise HTTPException(status_code=422, detail="mcp_id 必填")
    try:
        return get_mcp_catalog_item(needle)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=404, detail="活动科研 MCP 不存在") from exc


def toggle_mcp_favorite(*, mcp_id: str, user: dict[str, Any], enabled: bool = True) -> dict[str, Any]:
    _mcp(mcp_id)
    uid = _user_id(user)
    with get_db_session() as session:
        if enabled:
            session.execute(
                text(
                    "INSERT INTO science_mcp_hub_favorites (mcp_id, user_id, created_at) "
                    "VALUES (:mcp_id, :user_id, :created_at) "
                    "ON CONFLICT(mcp_id, user_id) DO NOTHING"
                ),
                {"mcp_id": mcp_id, "user_id": uid, "created_at": _now()},
            )
        else:
            session.execute(
                text(
                    "DELETE FROM science_mcp_hub_favorites "
                    "WHERE mcp_id = :mcp_id AND user_id = :user_id"
                ),
                {"mcp_id": mcp_id, "user_id": uid},
            )
    return {"mcp_id": mcp_id, "enabled": bool(enabled)}


def get_mcp_content(*, mcp_id: str) -> dict[str, Any]:
    """Return a stable, non-executable catalog record for SkillHub-style readers."""
    item = _mcp(mcp_id)
    capability_evidence = item.get("capability_evidence") or {}
    tool_names = capability_evidence.get("tool_names") or []
    tool_count = int(capability_evidence.get("tool_count") or 0)
    tool_count_kind = capability_evidence.get("tool_count_kind") or "exact"
    capability_mode = capability_evidence.get("capability_mode") or ("tool_list" if tool_names else "task_description")
    if tool_names:
        capability_line = f"- 明确工具：{'、'.join(str(name) for name in tool_names)}"
    elif capability_mode == "tool_count" and tool_count:
        count_label = f"至少 {tool_count} 个" if tool_count_kind == "at_least" else f"{tool_count} 个"
        capability_line = f"- 工具数量：{count_label}（来源未提供可结构化的工具名称）"
    else:
        capability_line = f"- 任务能力：{capability_evidence.get('task_description') or item.get('task') or item.get('summary') or ''}"
    if item.get("license"):
        license_line = str(item["license"])
    elif item.get("license_raw"):
        license_line = f"原文：{item.get('license_raw')}"
    elif item.get("license_status") == "referenced":
        license_line = "页面引用 LICENSE（具体名称未识别）"
    elif item.get("license_status") == "unavailable":
        license_line = "来源页暂不可访问，未能确认"
    elif (item.get("information_status") or {}).get("info_page") == "unavailable":
        license_line = "来源页暂不可访问，未能确认"
    elif item.get("info_page_fetched") is False:
        license_line = "信息页暂未获取"
    else:
        license_line = "公开资料未明确"
    license_source_labels = {
        "package_metadata": "软件包元数据",
        "readme": "项目说明",
        "license_file": "LICENSE 文件",
        "license_file_search": "LICENSE 文件检索",
        "github_api_license": "GitHub 许可证接口",
        "source_unavailable": "信息页不可访问",
        "first_party_page": "一手信息页",
    }
    license_source = license_source_labels.get(str(item.get("license_source") or ""), "一手资料")
    summary_source_labels = {
        "info_page_description": "一手信息页描述",
        "canonical_tool_evidence": "canonical 工具证据",
        "catalog_summary": "目录已有摘要",
        "catalog_narrative": "目录任务/证据叙事",
        "taxonomy_fallback": "分类兜底描述",
    }
    summary_source = summary_source_labels.get(
        str(item.get("summary_source") or "catalog_narrative"),
        str(item.get("summary_source") or "目录任务/证据叙事"),
    )
    source_verification = item.get("source_verification") or {}
    source_http_status = source_verification.get("http_status")
    content = "\n".join(
        (
            f"# {item['name']}",
            "",
            f"{item.get('tagline') or item.get('summary') or ''}",
            "",
            f"- 说明：{item.get('description') or item.get('summary') or ''}",
            f"- 领域：{item['domain']} / {item['subdomain']}",
            f"- 阶段：{item['stage']}",
            f"- 功能：{item['function']}",
            f"- 任务：{item.get('task') or item['function']}",
            f"- 标签：{'、'.join(item.get('tags') or [])}",
            f"- 能力：{'；'.join(item.get('capabilities') or [])}",
            f"- 叙事依据：{summary_source}",
            f"- 身份状态：{item['status']}",
            f"- 证据范围：{item['evidence_scope']}",
            "",
            "## 这个 MCP 提供什么",
            f"- 研究对象：{item.get('subdomain') or item.get('domain') or '未细分'}",
            f"- 主要动作：{item.get('task') or item.get('function') or '未细分'}",
            capability_line,
            f"- 能力依据：{('一手资料列出的工具' if capability_mode == 'tool_list' else '一手资料明确的工具数量' if capability_mode == 'tool_count' else '目录中的任务描述')}",
            "",
            "## 分类位置",
            f"- 领域：{item['domain']} / {item['subdomain']}",
            f"- 研究阶段：{item['stage']}",
            f"- 功能分工：{item['function']}",
            "",
            "## 一手资料字段",
            f"- 许可证：{license_line}",
            f"- 许可证来源：{license_source}",
            f"- 信息页：{(item.get('information_status') or {}).get('info_page') or '未记录'}",
            f"- 版本：{item.get('latest_version') or '未记录'}",
            f"- 传输方式：{'、'.join(item.get('transport') or []) or '未记录'}",
            f"- 资料保存状态：{source_verification.get('fetch_status') or '未记录'}",
            f"- 实际来源：{source_verification.get('final_url') or item.get('source_url') or '未记录'}",
            f"- 页面响应：{f'HTTP {source_http_status}' if source_http_status else '未记录'}",
            f"- 保存时间：{source_verification.get('fetched_at') or '未记录'}",
            f"- 资料大小：{source_verification.get('content_bytes') or '未记录'}",
            f"- 资料指纹 SHA-256：{source_verification.get('content_sha256') or '未记录'}",
            "",
            "## 一手证据",
            str(item.get("evidence") or ""),
            "",
            "## 分类依据",
            str(item.get("classification_rationale") or ""),
            "",
            "## 重叠与差异",
            str(item.get("overlap_difference") or ""),
            "",
            "## 来源与文档",
            f"- 来源名称：{item.get('source_name') or '一手来源'}",
            f"- 文档地址：{item.get('docs_url') or item['source_url']}",
            f"- 最近核对：{item.get('reviewed_at') or '未记录'}",
            "",
            f"一手来源：{item['source_url']}",
        )
    )
    return {"mcp": item, "content_type": "text/markdown", "format": "mcp_catalog_record", "content": content}


def get_mcp_download_status(*, mcp_id: str) -> dict[str, Any]:
    """Expose the SkillHub-shaped download surface without executing anything.

    The active MCP catalog is intentionally evidence-only.  Keeping this route
    explicit makes the product contract discoverable while preventing an MCP
    package from being installed, started, or invoked by TopicLab.
    """
    item = _mcp(mcp_id)
    return {
        "mcp_id": item["id"],
        "available": False,
        "mode": "catalog_only",
        "reason": "请前往项目来源页查看接入与使用方式。",
        "content_url": f"/api/v1/mcp-hub/mcps/{item['id']}/content",
        "asset_url": f"/api/v1/mcp-hub/assets/{item['id']}",
        "source_url": item.get("source_url"),
    }


def get_mcp_asset(*, mcp_id: str) -> dict[str, Any]:
    """Return a non-executable evidence asset compatible with SkillHub links."""
    content = get_mcp_content(mcp_id=mcp_id)
    return {
        "mcp_id": content["mcp"]["id"],
        "filename": f"{content['mcp']['id']}-evidence.md",
        "content_type": "text/markdown",
        "content": content["content"],
        "executable": False,
    }


def list_mcp_reviews(*, mcp_id: str, limit: int = 50, sort: str = "helpful") -> dict[str, Any]:
    _mcp(mcp_id)
    if not database_configured():
        return {"mcp_id": mcp_id, "list": []}
    order = "r.helpful_count DESC, r.created_at DESC" if sort == "helpful" else "r.created_at DESC"
    with get_db_session() as session:
        rows = session.execute(
            text(
                f"""
                SELECT r.*, u.username AS author_username, u.handle AS author_handle
                FROM science_mcp_hub_reviews r
                LEFT JOIN users u ON u.id = r.author_user_id
                WHERE r.mcp_id = :mcp_id
                ORDER BY {order}
                LIMIT :limit
                """
            ),
            {"mcp_id": mcp_id, "limit": max(1, min(int(limit), 100))},
        ).fetchall()
    return {"mcp_id": mcp_id, "list": [_review_payload(row) for row in rows]}


def _review_payload(row: Any) -> dict[str, Any]:
    return {
        "id": int(_row_value(row, "id")),
        "mcp_id": _row_value(row, "mcp_id"),
        "rating": int(_row_value(row, "rating") or 0),
        "title": _row_value(row, "title"),
        "content": _row_value(row, "content"),
        "model": _row_value(row, "model"),
        "pros": _json_loads(_row_value(row, "pros_json"), []),
        "cons": _json_loads(_row_value(row, "cons_json"), []),
        "dimensions": _json_loads(_row_value(row, "dimensions_json"), {}),
        "helpful_count": int(_row_value(row, "helpful_count") or 0),
        "author": _author(row),
        "created_at": str(_row_value(row, "created_at") or ""),
        "updated_at": str(_row_value(row, "updated_at") or ""),
    }


def create_mcp_review(
    *,
    mcp_id: str,
    user: dict[str, Any],
    rating: int,
    content: str,
    title: str | None = None,
    model: str | None = None,
    pros: list[Any] | None = None,
    cons: list[Any] | None = None,
    dimensions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _mcp(mcp_id)
    uid = _user_id(user)
    body = (content or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="评议内容不能为空")
    safe_rating = max(1, min(int(rating), 5))
    now = _now()
    with get_db_session() as session:
        inserted = session.execute(
            text(
                """
                INSERT INTO science_mcp_hub_reviews (
                    mcp_id, author_user_id, rating, title, content, model,
                    pros_json, cons_json, dimensions_json, created_at, updated_at
                ) VALUES (
                    :mcp_id, :user_id, :rating, :title, :content, :model,
                    :pros_json, :cons_json, :dimensions_json, :created_at, :updated_at
                ) ON CONFLICT(mcp_id, author_user_id) DO NOTHING
                RETURNING id
                """
            ),
            {
                "mcp_id": mcp_id,
                "user_id": uid,
                "rating": safe_rating,
                "title": (title or "").strip() or None,
                "content": body,
                "model": (model or "").strip() or None,
                "pros_json": json.dumps(pros or [], ensure_ascii=False),
                "cons_json": json.dumps(cons or [], ensure_ascii=False),
                "dimensions_json": json.dumps(dimensions or {}, ensure_ascii=False),
                "created_at": now,
                "updated_at": now,
            },
        ).fetchone()
        if inserted is None:
            raise HTTPException(status_code=409, detail="你已经评议过这个科研 MCP")
        row = session.execute(
            text(
                """
                SELECT r.*, u.username AS author_username, u.handle AS author_handle
                FROM science_mcp_hub_reviews r
                LEFT JOIN users u ON u.id = r.author_user_id
                WHERE r.id = :id
                LIMIT 1
                """
            ),
            {"id": int(_row_value(inserted, "id"))},
        ).fetchone()
    return _review_payload(row)


def vote_mcp_review_helpful(*, review_id: int, user: dict[str, Any], enabled: bool = True) -> dict[str, Any]:
    uid = _user_id(user)
    with get_db_session() as session:
        review = session.execute(
            text("SELECT id, author_user_id FROM science_mcp_hub_reviews WHERE id = :id LIMIT 1"),
            {"id": int(review_id)},
        ).fetchone()
        if review is None:
            raise HTTPException(status_code=404, detail="评议不存在")
        if int(_row_value(review, "author_user_id") or 0) == uid:
            raise HTTPException(status_code=400, detail="不能给自己的评议投 helpful")
        if enabled:
            changed = session.execute(
                text(
                    "INSERT INTO science_mcp_hub_review_votes (review_id, voter_user_id, created_at) "
                    "VALUES (:review_id, :user_id, :created_at) "
                    "ON CONFLICT(review_id, voter_user_id) DO NOTHING RETURNING id"
                ),
                {"review_id": int(review_id), "user_id": uid, "created_at": _now()},
            ).fetchone()
            delta = 1
        else:
            changed = session.execute(
                text(
                    "DELETE FROM science_mcp_hub_review_votes "
                    "WHERE review_id = :review_id AND voter_user_id = :user_id "
                    "RETURNING id"
                ),
                {"review_id": int(review_id), "user_id": uid},
            ).fetchone()
            delta = -1
        if changed is not None:
            session.execute(
                text(
                    "UPDATE science_mcp_hub_reviews SET helpful_count = "
                    "CASE WHEN helpful_count + :delta > 0 THEN helpful_count + :delta ELSE 0 END, "
                    "updated_at = :now WHERE id = :id"
                ),
                {"id": int(review_id), "delta": delta, "now": _now()},
            )
        count = session.execute(text("SELECT helpful_count FROM science_mcp_hub_reviews WHERE id = :id"), {"id": int(review_id)}).scalar_one()
    return {"review_id": int(review_id), "helpful_count": int(count or 0), "enabled": bool(enabled)}


def list_mcp_wishes(*, limit: int = 50) -> dict[str, Any]:
    if not database_configured():
        return {"list": []}
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT w.*, u.username AS author_username, u.handle AS author_handle
                FROM science_mcp_hub_wishes w
                LEFT JOIN users u ON u.id = w.author_user_id
                ORDER BY w.votes_count DESC, w.created_at DESC
                LIMIT :limit
                """
            ),
            {"limit": max(1, min(int(limit), 100))},
        ).fetchall()
    return {"list": [_wish_payload(row) for row in rows]}


def _wish_payload(row: Any) -> dict[str, Any]:
    return {
        "id": int(_row_value(row, "id")),
        "title": _row_value(row, "title"),
        "content": _row_value(row, "content"),
        "domain": _row_value(row, "domain"),
        "subdomain": _row_value(row, "subdomain"),
        "stage": _row_value(row, "stage"),
        "function": _row_value(row, "function"),
        "status": _row_value(row, "status"),
        "votes_count": int(_row_value(row, "votes_count") or 0),
        "author": _author(row),
        "created_at": str(_row_value(row, "created_at") or ""),
    }


def create_mcp_wish(*, user: dict[str, Any], title: str, content: str, taxonomy: dict[str, Any] | None = None) -> dict[str, Any]:
    uid = _user_id(user)
    title = (title or "").strip()
    content = (content or "").strip()
    if not title or not content:
        raise HTTPException(status_code=422, detail="title 和 content 必填")
    taxonomy = taxonomy or {}
    with get_db_session() as session:
        inserted = session.execute(
            text(
                """
                INSERT INTO science_mcp_hub_wishes (title, content, domain, subdomain, stage, function, author_user_id, created_at, updated_at)
                VALUES (:title, :content, :domain, :subdomain, :stage, :function, :user_id, :created_at, :updated_at)
                RETURNING id
                """
            ),
            {
                "title": title,
                "content": content,
                "domain": str(taxonomy.get("domain") or "").strip() or None,
                "subdomain": str(taxonomy.get("subdomain") or "").strip() or None,
                "stage": str(taxonomy.get("stage") or "").strip() or None,
                "function": str(taxonomy.get("function") or "").strip() or None,
                "user_id": uid,
                "created_at": _now(),
                "updated_at": _now(),
            },
        ).fetchone()
        row = session.execute(
            text("SELECT w.*, u.username AS author_username, u.handle AS author_handle FROM science_mcp_hub_wishes w LEFT JOIN users u ON u.id = w.author_user_id WHERE w.id = :id"),
            {"id": int(_row_value(inserted, "id"))},
        ).fetchone()
    return _wish_payload(row)


def vote_mcp_wish(*, wish_id: int, user: dict[str, Any], enabled: bool = True) -> dict[str, Any]:
    uid = _user_id(user)
    with get_db_session() as session:
        wish = session.execute(text("SELECT id FROM science_mcp_hub_wishes WHERE id = :id LIMIT 1"), {"id": int(wish_id)}).fetchone()
        if wish is None:
            raise HTTPException(status_code=404, detail="愿望不存在")
        if enabled:
            changed = session.execute(
                text(
                    "INSERT INTO science_mcp_hub_wish_votes (wish_id, voter_user_id, created_at) "
                    "VALUES (:wish_id, :user_id, :created_at) "
                    "ON CONFLICT(wish_id, voter_user_id) DO NOTHING RETURNING id"
                ),
                {"wish_id": int(wish_id), "user_id": uid, "created_at": _now()},
            ).fetchone()
            delta = 1
        else:
            changed = session.execute(
                text(
                    "DELETE FROM science_mcp_hub_wish_votes "
                    "WHERE wish_id = :wish_id AND voter_user_id = :user_id "
                    "RETURNING id"
                ),
                {"wish_id": int(wish_id), "user_id": uid},
            ).fetchone()
            delta = -1
        if changed is not None:
            session.execute(
                text(
                    "UPDATE science_mcp_hub_wishes SET votes_count = "
                    "CASE WHEN votes_count + :delta > 0 THEN votes_count + :delta ELSE 0 END, "
                    "updated_at = :now WHERE id = :id"
                ),
                {"id": int(wish_id), "delta": delta, "now": _now()},
            )
        count = session.execute(text("SELECT votes_count FROM science_mcp_hub_wishes WHERE id = :id"), {"id": int(wish_id)}).scalar_one()
    return {"wish_id": int(wish_id), "votes_count": int(count or 0), "enabled": bool(enabled)}


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug[:80] or "mcp-collection"


def list_mcp_collections(*, user: dict[str, Any] | None = None) -> dict[str, Any]:
    if not database_configured():
        return {"list": []}
    uid = _user_id(user) if user else None
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT c.*
                FROM science_mcp_hub_collections c
                WHERE c.visibility = 'public' OR (:user_id IS NOT NULL AND c.owner_user_id = :user_id)
                ORDER BY c.updated_at DESC, c.created_at DESC
                """
            ),
            {"user_id": uid},
        ).fetchall()
        result = []
        for row in rows:
            items = session.execute(text("SELECT mcp_id, position FROM science_mcp_hub_collection_items WHERE collection_id = :id ORDER BY position, id"), {"id": int(_row_value(row, "id"))}).fetchall()
            result.append(_collection_payload(row, items))
    return {"list": result}


def _collection_payload(row: Any, items: list[Any]) -> dict[str, Any]:
    return {
        "id": int(_row_value(row, "id")),
        "slug": _row_value(row, "slug"),
        "title": _row_value(row, "title"),
        "description": _row_value(row, "description"),
        "visibility": _row_value(row, "visibility"),
        "owner_user_id": _row_value(row, "owner_user_id"),
        "items": [{"mcp_id": _row_value(item, "mcp_id"), "position": int(_row_value(item, "position") or 0)} for item in items],
        "created_at": str(_row_value(row, "created_at") or ""),
        "updated_at": str(_row_value(row, "updated_at") or ""),
    }


def create_mcp_collection(*, user: dict[str, Any], title: str, description: str, visibility: str = "private") -> dict[str, Any]:
    uid = _user_id(user)
    title = (title or "").strip()
    description = (description or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title 必填")
    visibility = visibility if visibility in {"private", "public"} else "private"
    now = _now()
    with get_db_session() as session:
        base = _slug(title)
        slug = base
        suffix = 2
        while True:
            inserted = session.execute(
                text(
                    "INSERT INTO science_mcp_hub_collections "
                    "(slug, title, description, owner_user_id, visibility, created_at, updated_at) "
                    "VALUES (:slug, :title, :description, :user_id, :visibility, :created_at, :updated_at) "
                    "ON CONFLICT(slug) DO NOTHING RETURNING id"
                ),
                {"slug": slug, "title": title, "description": description, "user_id": uid, "visibility": visibility, "created_at": now, "updated_at": now},
            ).fetchone()
            if inserted is not None:
                break
            slug = f"{base}-{suffix}"
            suffix += 1
        row = session.execute(text("SELECT * FROM science_mcp_hub_collections WHERE id = :id"), {"id": int(_row_value(inserted, "id"))}).fetchone()
    return _collection_payload(row, [])


def add_mcp_collection_item(*, collection_id: int, mcp_id: str, user: dict[str, Any]) -> dict[str, Any]:
    _mcp(mcp_id)
    uid = _user_id(user)
    with get_db_session() as session:
        collection = session.execute(text("SELECT id, owner_user_id FROM science_mcp_hub_collections WHERE id = :id LIMIT 1"), {"id": int(collection_id)}).fetchone()
        if collection is None or int(_row_value(collection, "owner_user_id") or 0) != uid:
            raise HTTPException(status_code=404, detail="集合不存在或无权编辑")
        position = session.execute(text("SELECT COALESCE(MAX(position), -1) + 1 FROM science_mcp_hub_collection_items WHERE collection_id = :id"), {"id": int(collection_id)}).scalar_one()
        session.execute(text("INSERT INTO science_mcp_hub_collection_items (collection_id, mcp_id, position, created_at) VALUES (:collection_id, :mcp_id, :position, :created_at) ON CONFLICT(collection_id, mcp_id) DO NOTHING"), {"collection_id": int(collection_id), "mcp_id": mcp_id, "position": int(position or 0), "created_at": _now()})
        session.execute(text("UPDATE science_mcp_hub_collections SET updated_at = :now WHERE id = :id"), {"id": int(collection_id), "now": _now()})
    return {"collection_id": int(collection_id), "mcp_id": mcp_id, "enabled": True}


def remove_mcp_collection_item(*, collection_id: int, mcp_id: str, user: dict[str, Any]) -> dict[str, Any]:
    uid = _user_id(user)
    with get_db_session() as session:
        collection = session.execute(text("SELECT id, owner_user_id FROM science_mcp_hub_collections WHERE id = :id LIMIT 1"), {"id": int(collection_id)}).fetchone()
        if collection is None or int(_row_value(collection, "owner_user_id") or 0) != uid:
            raise HTTPException(status_code=404, detail="集合不存在或无权编辑")
        session.execute(text("DELETE FROM science_mcp_hub_collection_items WHERE collection_id = :collection_id AND mcp_id = :mcp_id"), {"collection_id": int(collection_id), "mcp_id": mcp_id})
        session.execute(text("UPDATE science_mcp_hub_collections SET updated_at = :now WHERE id = :id"), {"id": int(collection_id), "now": _now()})
    return {"collection_id": int(collection_id), "mcp_id": mcp_id, "enabled": False}


def get_mcp_profile(*, user: dict[str, Any]) -> dict[str, Any]:
    uid = _user_id(user)
    with get_db_session() as session:
        favorites = session.execute(text("SELECT mcp_id, created_at FROM science_mcp_hub_favorites WHERE user_id = :user_id ORDER BY created_at DESC"), {"user_id": uid}).fetchall()
        reviews = session.execute(text("SELECT * FROM science_mcp_hub_reviews WHERE author_user_id = :user_id ORDER BY created_at DESC"), {"user_id": uid}).fetchall()
        wishes = session.execute(text("SELECT * FROM science_mcp_hub_wishes WHERE author_user_id = :user_id ORDER BY created_at DESC"), {"user_id": uid}).fetchall()
        submissions = session.execute(text("SELECT * FROM science_mcp_hub_submissions WHERE submitter_user_id = :user_id ORDER BY created_at DESC"), {"user_id": uid}).fetchall()
        collections = session.execute(text("SELECT * FROM science_mcp_hub_collections WHERE owner_user_id = :user_id ORDER BY created_at DESC"), {"user_id": uid}).fetchall()
    return {
        "user_id": uid,
        "favorites": [{"mcp_id": _row_value(row, "mcp_id"), "created_at": str(_row_value(row, "created_at") or "")} for row in favorites],
        "reviews": [_review_payload(row) for row in reviews],
        "wishes": [_wish_payload(row) for row in wishes],
        "submissions": [_submission_payload(row) for row in submissions],
        "collections": [_collection_payload(row, []) for row in collections],
        "stats": {"favorites": len(favorites), "reviews": len(reviews), "wishes": len(wishes), "submissions": len(submissions), "collections": len(collections)},
    }


def list_mcp_tasks(*, user: dict[str, Any]) -> dict[str, Any]:
    """SkillHub-shaped contribution tasks without points or runtime actions."""
    uid = _user_id(user)
    with get_db_session() as session:
        counts = {
            "favorite_a_mcp": int(session.execute(text("SELECT COUNT(*) FROM science_mcp_hub_favorites WHERE user_id = :id"), {"id": uid}).scalar_one() or 0),
            "review_a_mcp": int(session.execute(text("SELECT COUNT(*) FROM science_mcp_hub_reviews WHERE author_user_id = :id"), {"id": uid}).scalar_one() or 0),
            "submit_a_candidate": int(session.execute(text("SELECT COUNT(*) FROM science_mcp_hub_submissions WHERE submitter_user_id = :id"), {"id": uid}).scalar_one() or 0),
            "curate_a_collection": int(session.execute(text("SELECT COUNT(*) FROM science_mcp_hub_collections WHERE owner_user_id = :id"), {"id": uid}).scalar_one() or 0),
        }
    definitions = (
        ("favorite_a_mcp", "收藏一个科研 MCP", "把感兴趣的科研工具加入个人收藏。"),
        ("review_a_mcp", "提交一条 MCP 评议", "围绕科研对象、动作、证据与差异提交结构化评议。"),
        ("submit_a_candidate", "推荐一个科研 MCP", "分享项目地址、科研对象与主要用途。"),
        ("curate_a_collection", "建立一个研究集合", "按领域、阶段或功能整理个人研究工具清单。"),
    )
    return {"tasks": [{"task_key": key, "title": title, "description": description, "progress": min(counts[key], 1), "goal_count": 1, "completed": counts[key] > 0} for key, title, description in definitions]}


def get_mcp_hub_guide() -> str:
    return """# Science MCP Hub API\n\n## 目录与智能体检索\n\n- `GET /api/v1/mcp-hub/meta`：活动目录元数据与长尾状态。\n- `GET /api/v1/mcp-hub/mcps`：按领域、二级领域、阶段、功能检索。\n- `GET /api/v1/mcp-hub/science-catalog/finder/capabilities`：读取面向智能体的只读检索契约。\n- `POST /api/v1/mcp-hub/science-catalog/find`：用自然语言研究需求返回结构化匹配结果。请求体至少包含 `{\"query\": \"研究对象、数据类型或科研动作\"}`，可选 `limit`（不超过 12）。\n- `POST /api/v1/mcp-hub/science-catalog/find/stream`：同一检索的 SSE 版本，事件顺序为 `status`、`route`、`result`、`done`。\n\n登录用户的检索与 SkillHub 共用 AgentScope、`find-science-skills` 分类能力和 SCNet/GLM-5.2 模型复核，并消耗 `science_finder` 配额；匿名访问、模型未配置或模型失败时使用确定性的本地目录匹配。检索接口只返回 `taxonomy_reviewed` 活动条目，退休档案和待复核候选排除在外；结果包含 `driver`、`mode`、`route`、`ranking` 和 `recommendation_reason`，便于前端与智能体区分真实模型结果和本地回退。\n\n## 证据与社区\n\n- `GET /api/v1/mcp-hub/mcps/{mcp_id}/content`：读取非执行型证据记录。\n- `POST /api/v1/mcp-hub/mcps/{mcp_id}/favorite`：登录后收藏。\n- `GET/POST /api/v1/mcp-hub/mcps/{mcp_id}/reviews`：查看或提交评议。\n- `GET/POST /api/v1/mcp-hub/wishes`：科研缺口愿望墙。\n- `GET/POST /api/v1/mcp-hub/collections`：个人 MCP 集合。\n- `POST /api/v1/mcp-hub/submissions`：提交待复核候选。\n\n`active_catalog` 只包含 `taxonomy_reviewed`；退休档案、用户行为与 `needs_review` 候选均不计入活动规模。Hub 不安装、启动或调用第三方 MCP。\n"""


def list_mcp_leaderboard() -> dict[str, Any]:
    if not database_configured():
        return {"list": []}
    with get_db_session() as session:
        rows = session.execute(
            text(
                """
                SELECT u.id, u.username, u.handle,
                    (SELECT COUNT(*) FROM science_mcp_hub_reviews r WHERE r.author_user_id = u.id) AS reviews,
                    (SELECT COUNT(*) FROM science_mcp_hub_favorites f WHERE f.user_id = u.id) AS favorites,
                    (SELECT COUNT(*) FROM science_mcp_hub_wishes w WHERE w.author_user_id = u.id) AS wishes,
                    (SELECT COUNT(*) FROM science_mcp_hub_submissions s WHERE s.submitter_user_id = u.id) AS submissions
                FROM users u
                WHERE EXISTS (SELECT 1 FROM science_mcp_hub_reviews r WHERE r.author_user_id = u.id)
                   OR EXISTS (SELECT 1 FROM science_mcp_hub_favorites f WHERE f.user_id = u.id)
                   OR EXISTS (SELECT 1 FROM science_mcp_hub_wishes w WHERE w.author_user_id = u.id)
                   OR EXISTS (SELECT 1 FROM science_mcp_hub_submissions s WHERE s.submitter_user_id = u.id)
                ORDER BY reviews DESC, favorites DESC, submissions DESC, u.id
                LIMIT 20
                """
            )
        ).fetchall()
    return {"list": [{"id": int(_row_value(row, "id")), "display_name": _row_value(row, "username") or _row_value(row, "handle"), "handle": _row_value(row, "handle"), "reviews": int(_row_value(row, "reviews") or 0), "favorites": int(_row_value(row, "favorites") or 0), "wishes": int(_row_value(row, "wishes") or 0), "submissions": int(_row_value(row, "submissions") or 0)} for row in rows]}


def _submission_payload(row: Any) -> dict[str, Any]:
    return {
        "id": int(_row_value(row, "id")),
        "name": _row_value(row, "name"),
        "summary": _row_value(row, "summary"),
        "canonical_url": _row_value(row, "canonical_url"),
        "repo_url": _row_value(row, "repo_url"),
        "domain": _row_value(row, "domain"),
        "subdomain": _row_value(row, "subdomain"),
        "stage": _row_value(row, "stage"),
        "function": _row_value(row, "function"),
        "evidence": _row_value(row, "evidence"),
        "difference": _row_value(row, "difference"),
        "status": _row_value(row, "status"),
        "created_at": str(_row_value(row, "created_at") or ""),
        "updated_at": str(_row_value(row, "updated_at") or ""),
    }


def submit_mcp_candidate(*, user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    uid = _user_id(user)
    required = ("name", "summary", "canonical_url", "evidence")
    if any(not str(payload.get(key) or "").strip() for key in required):
        raise HTTPException(status_code=422, detail="name、summary、canonical_url、evidence 均必填")
    now = _now()
    with get_db_session() as session:
        inserted = session.execute(
            text(
                """
                INSERT INTO science_mcp_hub_submissions (
                    name, summary, canonical_url, repo_url, domain, subdomain, stage, function,
                    evidence, difference, status, submitter_user_id, created_at, updated_at
                ) VALUES (
                    :name, :summary, :canonical_url, :repo_url, :domain, :subdomain, :stage, :function,
                    :evidence, :difference, 'needs_review', :user_id, :created_at, :updated_at
                ) RETURNING id
                """
            ),
            {
                "name": str(payload["name"]).strip(),
                "summary": str(payload["summary"]).strip(),
                "canonical_url": str(payload["canonical_url"]).strip(),
                "repo_url": str(payload.get("repo_url") or "").strip() or None,
                "domain": str(payload.get("domain") or "").strip() or None,
                "subdomain": str(payload.get("subdomain") or "").strip() or None,
                "stage": str(payload.get("stage") or "").strip() or None,
                "function": str(payload.get("function") or "").strip() or None,
                "evidence": str(payload["evidence"]).strip(),
                "difference": str(payload.get("difference") or "").strip() or None,
                "user_id": uid,
                "created_at": now,
                "updated_at": now,
            },
        ).fetchone()
        row = session.execute(text("SELECT * FROM science_mcp_hub_submissions WHERE id = :id"), {"id": int(_row_value(inserted, "id"))}).fetchone()
    result = _submission_payload(row)
    result["active_catalog_effect"] = "none_until_taxonomy_reviewed_sync"
    return result
