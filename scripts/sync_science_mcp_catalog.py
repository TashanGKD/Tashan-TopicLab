#!/usr/bin/env python3
"""Build the checked-in SkillHub-shaped snapshot for the active science MCP catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from urllib.parse import urlparse
from pathlib import Path
from typing import Any


DEFAULT_DESTINATION = Path(__file__).resolve().parents[1] / "topiclab-backend" / "app" / "data" / "science_mcp_catalog.json"
REQUIRED_DIMENSIONS = ("domains", "subdomains", "stages", "functions")
ALLOWED_REVIEW_STATUS = {"taxonomy_reviewed"}
TAXONOMY_SOURCE = "TashanGKD/tashan-research-skills:skills/find-science-skills/data/science_skill_catalog.json"

# Keep this list synchronized with ``skill_hub._build_skill_summary``.  The
# MCP catalog is read-only, but its cards and detail payloads use the same
# human-facing metadata contract as SkillHub.  Domain/stage/function fields
# remain MCP-specific additions rather than replacements for the shared card
# fields.
SKILLHUB_CARD_FIELDS = (
    "id", "slug", "name", "tagline", "summary", "description",
    "category_key", "category_name", "cluster_key", "cluster_name",
    "tags", "capabilities", "framework", "compatibility_level",
    "pricing_status", "price_points", "license", "source_url",
    "source_name", "docs_url", "install_command", "latest_version",
    "openclaw_ready", "featured", "hero_note", "total_reviews",
    "avg_rating", "total_favorites", "total_downloads", "weekly_downloads",
    "viewer_favorited", "author_openclaw_agent_id", "created_at", "updated_at",
    "published_at",
)

INFO_PAGE_FIELDS = (
    "summary", "license", "license_status", "license_source", "license_raw",
    "version", "repository_url", "homepage_url", "keywords", "install_commands",
    "transport", "tool_names", "tool_names_source", "tool_count",
    "tool_count_kind", "mcp_identity_mentioned", "source",
    "taxonomy_upgrade_candidate",
)
LICENSE_EVIDENCE_FIELDS = (
    "evidence_source_key", "repository", "relative_path", "scope", "license",
    "license_raw", "license_source", "status", "license_status", "source_url",
    "final_url", "http_status", "fetched_at", "content_sha256", "content_bytes",
    "error", "reason",
)


def _first_sentence(value: str) -> str:
    text = " ".join(value.split())
    # Do not split on a bare dot: package names, versions and URLs contain dots.
    for separator in ("。", ". ", "；", ";"):
        if separator in text:
            text = text.split(separator, 1)[0]
            break
    return text[:240].strip()


def _research_clause(value: str) -> str:
    """Extract the first research-facing clause from provenance-heavy evidence."""
    text = " ".join(value.split()).strip()
    if not text:
        return ""
    # Registry/package/README prefixes are evidence, not the user-facing MCP story.
    # Split on audit separators first so a description after ``记录；`` is retained.
    candidates: list[str] = []
    for segment in text.replace("。", "；").split("；"):
        segment = segment.strip(" ;")
        if not segment:
            continue
        if "：" in segment:
            segment = segment.rsplit("：", 1)[1].strip()
        elif ":" in segment and not segment.lower().startswith(("http://", "https://")):
            segment = segment.rsplit(":", 1)[1].strip()
        if segment.startswith(("io.", "http", "v0.", "v1.")):
            continue
        provenance = (
            "官方 MCP Registry" in segment
            or "npm 当前包元数据" in segment
            or "npm 当前元数据" in segment
            or "维护仓库" in segment
            or "README" in segment
            or "Registry exact" in segment
        )
        if provenance:
            anchor = re.search(r"(?:明确|描述|说明|提供|连接|覆盖|面向|支持|使用|把|通过|暴露|为)\s*", segment)
            if not anchor:
                continue
            segment = segment[anchor.start() :]
        segment = _first_sentence(segment)
        if not segment or segment.startswith(("io.", "http", "v0.", "v1.")):
            continue
        if "Model Context Protocol/MCP server" in segment or "仓库元数据显示" in segment:
            continue
        if re.match(r"^\d+\s*(?:个\s*)?(?:工具|tools)", segment, flags=re.IGNORECASE) and "resources" in segment.lower():
            continue
        if segment.startswith(("Apache-", "MIT", "BSD-", "GPL", "ISC", "未归档")):
            continue
        if re.match(r"^[a-z][a-z0-9_-]*_[a-z0-9_/-]+", segment):
            continue
        if any(
            marker in segment
            for marker in (
                "官方 MCP Registry",
                "npm 当前包元数据",
                "维护仓库 README",
                "README probe matched",
                "scientific-domain implementation",
                "probe matched MCP terminology",
                "GitHub 维护仓库",
                "canonical URL",
                "本轮仅",
                "尚未做",
                "未安装",
            )
        ):
            continue
        segment = re.sub(r"^(?:明确(?:实现|称其为|为)?|描述(?:为)?|说明(?:为)?|description)\s*", "", segment, flags=re.IGNORECASE).strip()
        # Tool/resource counts describe the protocol surface, not the research
        # story that SkillHub shows in its cards.
        if re.match(r"^\d+\s*(?:个\s*)?(?:工具|tools)", segment, flags=re.IGNORECASE) and (
            "resources" in segment.lower() or "资源" in segment
        ):
            continue
        candidates.append(segment)
    if candidates:
        return candidates[0]
    fallback = _first_sentence(text)
    if re.match(r"^\d+\s*(?:个\s*)?(?:工具|tools)", fallback, flags=re.IGNORECASE) and (
        "resources" in fallback.lower() or "资源" in fallback
    ):
        return ""
    return fallback


def _explicit_evidence_description(value: Any) -> str:
    """Extract an explicitly labelled package/README description.

    The active catalog keeps provenance-heavy evidence in one string.  Some
    entries already contain a first-party ``description:`` field, but the
    surrounding registry/audit text can otherwise win the generic-summary
    fallback.  Only an explicitly labelled description is promoted here; no
    capability is inferred from a name or from taxonomy labels.
    """
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    for match in re.finditer(r"(?:^|[;；\n])\s*(?:description|简介|摘要)\s*[:：]\s*(.+)", text, flags=re.IGNORECASE):
        candidate = match.group(1)
        candidate = re.split(
            r"(?:[;；]\s*(?:科研用途归类|仅完成|First-party|官方|canonical)|<\/?(?:div|p|section)\b)",
            candidate,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        candidate = re.sub(r"<[^>]+>", " ", candidate)
        candidate = re.sub(r"\s+", " ", candidate).strip(" ;；")
        candidate = _first_sentence(candidate)
        if not candidate or candidate.casefold() in {"mcp", "mcp server", "model context protocol"}:
            continue
        if "Model Context Protocol 身份" in candidate and len(candidate) < 80:
            continue
        if any(
            marker in candidate.casefold()
            for marker in (
                "readme probe matched",
                "scientific-domain implementation",
                "repository is a scientific-domain",
                "probe matched mcp terminology",
            )
        ):
            continue
        return candidate[:240]
    return ""


def _explicit_evidence_heading(value: Any) -> str:
    """Use a descriptive README heading when no labelled description exists."""
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    for match in re.finditer(r"(?:^|\s)#\s+(.+?)(?=\s+Canonical README|\s+First-party|\s+Official MCP Registry|$)", text, flags=re.IGNORECASE):
        candidate = match.group(1).split("[", 1)[0]
        candidate = re.sub(r"\[[^\]]*\]\([^)]*\)", " ", candidate)
        candidate = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", candidate)
        candidate = re.sub(r"<[^>]+>", " ", candidate)
        candidate = re.sub(r"^[-_*#\s]+", "", candidate)
        candidate = re.sub(r"^mcp[-_\w]*\s+", "", candidate, flags=re.IGNORECASE)
        # Protect the common ``U.S.`` abbreviation from the sentence splitter.
        candidate = candidate.replace("U.S.", "US_ABBR")
        candidate = _first_sentence(candidate).replace("US_ABBR", "U.S.").strip(" -|")
        if len(candidate) < 6:
            continue
        if any(marker in candidate.casefold() for marker in ("readme", "model context protocol", "mcp server", "canonical")):
            # Keep product titles that include MCP, but reject headings that
            # only repeat the protocol/audit label.
            if len(candidate.split()) <= 5 and "mcp" in candidate.casefold():
                continue
        return candidate[:240]
    return ""


def _summary(entry: dict[str, Any], taxonomy: dict[str, Any]) -> str:
    raw_action = str(entry.get("function") or "").strip()
    taxonomy_function = str(taxonomy.get("function") or "").strip()
    explicit_description = _explicit_evidence_description(entry.get("evidence"))
    if explicit_description:
        return explicit_description
    explicit_heading = _explicit_evidence_heading(entry.get("evidence"))
    if explicit_heading:
        return explicit_heading
    if raw_action and raw_action != taxonomy_function and len(raw_action) > 5:
        return raw_action[:240]
    evidence = _research_clause(str(entry.get("evidence") or ""))
    if evidence and not any(
        prefix in evidence
        for prefix in ("维护仓库 README", "官方 MCP Registry", "npm 当前包元数据", "GitHub 维护仓库")
    ) and evidence not in {"io", "科研 MCP 工具"} and "canonical" not in evidence and "provider-pack" not in evidence and "可访问" not in evidence:
        return evidence
    fallback = _research_clause(str(entry.get("overlap") or ""))
    if fallback and fallback not in {"io", "科研 MCP 工具"}:
        return fallback
    subdomain = str(taxonomy.get("subdomain") or "通用科研")
    function = str(taxonomy.get("function") or "科研服务")
    return f"面向{subdomain}的{function} MCP 服务"


def _usable_summary(value: Any) -> str:
    """Keep user-facing cards from showing CSS, endpoint JSON, or empty text."""
    text = " ".join(str(value or "").split()).strip()
    # Short Chinese research tasks such as ``文献检索`` or ``样本质控`` are
    # still meaningful descriptions; reject only genuinely empty/noisy tokens.
    if len(text) < 6:
        return ""
    lower = text.casefold()
    if text.startswith(("{", "<style", ":root", "--")):
        return ""
    if any(marker in lower for marker in ("font-family:", "webfontconfig", "--navy", "--bg:", "color: #")):
        return ""
    if text.count("{") >= 1 and text.count("}") >= 1:
        return ""
    return text[:240]


def _is_taxonomy_only_summary(value: Any) -> bool:
    """Identify the generic catalog sentence that should not hide evidence."""
    text = _usable_summary(value)
    return bool(text and re.fullmatch(r"面向.+的 MCP 服务。?", text))


_TOOL_NOISE_EXACT = {
    "api", "debug", "delete", "docker", "env", "error", "false", "gateway",
    "get", "http", "https", "info", "json", "markdown", "mcp", "npm", "npx",
    "patch", "pip", "post", "put", "server", "sse", "stdio", "tools", "true",
    "getting-started", "getting_started", "streamable-http", "streamable http", "uvx", "warn", "websocket",
}
_TOOL_ACTION_SEGMENTS = {
    "add", "analyze", "calculate", "call", "check", "classify", "compare", "compute",
    "convert", "create", "delete", "describe", "download", "execute", "extract", "fetch",
    "find", "generate", "get", "inspect", "list", "load", "lookup", "measure", "network",
    "open", "process", "predict", "query", "read", "recommend", "remove", "report", "resolve",
    "retrieve", "run", "save", "search", "start", "stop", "summarize", "train", "traceroute",
    "calc", "detect", "dns", "mtr", "ping", "recent",
    "update", "upload", "validate", "write",
}
_TOOL_DESCRIPTIVE_SUFFIXES = ("_call", "_data", "_details", "_info", "_measurement", "_report", "_results", "_samples", "_split", "_status", "_summary")
_TOOL_PARAMETER_EXACT = {
    "agent", "api_prefix", "auth_mode", "category", "client", "config", "exclude_tags", "from_area",
    "from_asn", "from_country", "from_prefix", "from_probes", "include_tags", "is_oneoff", "limit",
    "locations", "method", "name", "options", "payload", "probe_count", "query_params", "response_format",
    "target", "topic", "voice",
}
_TOOL_NOISE_SUFFIXES = (
    "_api_key", "_auth_mode", "_dir", "_host", "_jwt_token", "_key", "_level",
    "_log_level", "_mode", "_mount_path", "_namespaces", "_path", "_port", "_prefix",
    "_secret", "_token", "_url", "_verify",
)
_TOOL_NOISE_EXTENSIONS = (".json", ".jsonc", ".mcpb", ".md", ".py", ".toml", ".yaml", ".yml")


def _clean_tool_names(value: Any) -> list[str]:
    """Keep only plausible MCP tool identifiers for user-facing display.

    The first-party extractor intentionally keeps broad backtick evidence.  Some
    README pages place environment variables, transport values and filenames in
    the same section, so the raw list must not be presented as if every token
    were an executable MCP tool.  Raw page/cache evidence remains preserved in
    the active catalog and source metadata.
    """
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for raw in value:
        name = " ".join(str(raw).split()).strip()
        if not name or len(name) > 80 or any(char.isspace() for char in name):
            continue
        lower = name.casefold()
        if lower in _TOOL_NOISE_EXACT or lower in {"get", "post", "put", "patch", "delete"}:
            continue
        if lower in {"fastmcp", "smiles", "inchi", "molblock", "pytest", "python"}:
            continue
        if lower.endswith(_TOOL_NOISE_EXTENSIONS) or lower in {"dockerfile", "server.json"}:
            continue
        if re.fullmatch(r"[A-Z][A-Z0-9_]{2,}", name):
            continue
        if re.search(r"(?:https?://|localhost:\d+|^[a-z0-9.-]+\.[a-z]{2,}/)", lower):
            continue
        if any(token in lower for token in ("token", "_api_key", "_secret", "oauth", "jwt")):
            continue
        segments = [part for part in re.split(r"[_-]", lower) if part]
        action_like = any(part in _TOOL_ACTION_SEGMENTS for part in segments) or any(
            part.startswith(tuple(f"{prefix}" for prefix in _TOOL_ACTION_SEGMENTS))
            for part in segments
        )
        if lower in _TOOL_PARAMETER_EXACT or (lower.startswith(("from_", "include_", "exclude_", "is_")) and not action_like):
            continue
        if not action_like and any(lower.endswith(suffix) for suffix in _TOOL_NOISE_SUFFIXES):
            continue
        if not action_like and not any(lower.endswith(suffix) for suffix in _TOOL_DESCRIPTIVE_SUFFIXES):
            continue
        if lower.startswith(("mcp-", "mcp_")) and "_" not in lower[4:]:
            continue
        if name in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            continue
        if name not in names:
            names.append(name)
    return names[:32]


def _clean_explicit_tool_names(value: Any) -> list[str]:
    """Clean names that came from an explicit Tool/Function table or list.

    A table headed ``Tools`` is stronger evidence than an arbitrary backtick in
    prose, so do not require an English action verb in the identifier.  Keep the
    structural/noise filters and the strict identifier grammar so configuration
    keys, URLs, transport names, and headings still cannot leak into the UI.
    """
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for raw in value:
        name = " ".join(str(raw).split()).strip(" `*_\t")
        if not name or len(name) > 80 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]{2,80}", name):
            continue
        if name.endswith(":"):
            continue
        lower = name.casefold()
        if (lower in _TOOL_NOISE_EXACT and lower not in {"delete", "get", "info"}) or lower in {
            "description", "function", "name", "tool", "tools",
            "capability", "capabilities", "mcp", "server",
        }:
            continue
        if lower.endswith(_TOOL_NOISE_EXTENSIONS) or lower in {"dockerfile", "server.json"}:
            continue
        if re.fullmatch(r"[A-Z][A-Z0-9_]{2,}", name):
            continue
        if re.search(r"(?:https?://|localhost:\d+|^[a-z0-9.-]+\.[a-z]{2,}/)", lower):
            continue
        if any(token in lower for token in ("token", "_api_key", "_secret", "oauth", "jwt")):
            continue
        if lower in _TOOL_PARAMETER_EXACT or lower in {
            "area", "areas", "argument", "arguments", "behavior", "behaviour",
            "bash", "cmd", "curl", "docker", "git", "npm", "npx", "pip", "powershell", "python", "sh", "uv", "uvx", "zsh",
            "changes", "family", "feature", "features", "format", "input", "inputs",
            "key", "key_parameters", "model", "models", "mode", "modes", "output", "outputs",
            "parameter", "parameters", "purpose", "question", "required", "schema", "session", "sessions",
            "signature", "signatures", "tier", "type", "types", "variable", "variables", "arxiv_id", "arxiv_ids",
            "example", "examples", "total",
            "download", "manifest", "script", "split", "where",
        }:
            continue
        if name not in names:
            names.append(name)
    return names[:32]


def _extract_evidence_tool_names(value: Any) -> list[str]:
    """Extract tool identifiers from already-reviewed first-party evidence.

    README/package evidence is stored in the active catalog as provenance.  A
    number of reviewed entries contain a Markdown tool table even when the
    separate info-page fetch did not succeed.  Reading only identifiers from
    explicit tool sections makes the detail view useful without treating
    arbitrary backticks, configuration keys, or prose as capabilities.
    """
    text = str(value or "")
    if not text:
        return []
    # Restrict table/list parsing to an explicitly titled tool section.  This
    # prevents install snippets, modality lists, navigation links, and generic
    # Markdown tables elsewhere in a README from becoming capabilities.
    sections: list[str] = []
    # Markdown examples frequently contain Python comments such as
    # ``# For very large papers``.  Treat only headings outside fenced code as
    # document structure; otherwise the example can truncate the tool section
    # before later, real ``call_tool(...)`` examples are reached.
    fence_intervals: list[tuple[int, int]] = []
    open_fence: int | None = None
    for fence in re.finditer(r"(?m)^[ \t]*(```|~~~)", text):
        if open_fence is None:
            open_fence = fence.start()
        else:
            fence_intervals.append((open_fence, fence.end()))
            open_fence = None
    if open_fence is not None:
        fence_intervals.append((open_fence, len(text)))

    def _inside_fence(position: int) -> bool:
        return any(start <= position < end for start, end in fence_intervals)

    markdown_headings = [
        match for match in re.finditer(r"(?im)^(#{1,6})\s+", text)
        if not _inside_fence(match.start())
    ]
    heading_matches = [match for match in re.finditer(
        r"(?im)^(#{1,6})\s*(?:[^\w\s#]{1,8}\s*)?(?:available\s+)?(?:mcp\s+)?(?:tools?|functions?|capabilities)(?:\s+(?:exposed|surface|list|overview|reference|provided))?(?:\s*\(\s*\d+\s*(?:\+\s*)?(?:total)?\s*\))?\s*:?[ \t]*$",
        text,
    ) if not _inside_fence(match.start())]
    for match in heading_matches:
        level = len(match.group(1))
        end = len(text)
        # Tool inventories are often grouped under nested headings (for
        # example ``## Tools`` followed by ``### Creating Measurements``).
        # Keep those nested tables, and stop only at the next heading at the
        # same or a higher level.
        for next_heading in markdown_headings:
            if next_heading.start() < match.end():
                continue
            if len(next_heading.group(1)) <= level:
                end = next_heading.start()
                break
        sections.append(text[match.start():end])
    # Only a plural ``MCP Tools:`` marker is treated as a compact inventory.
    # Singular prose such as ``the server exposes the following MCP tool:``
    # is descriptive text; parsing the words after it produced false names
    # like ``places`` and ``occupation`` from ordinary sentences.
    compact_list_present = bool(re.search(r"\bMCP\s+Tools\s*[:：]", text, flags=re.IGNORECASE))
    if not sections and not compact_list_present:
        return []
    explicit_text = "\n".join(sections)
    explicit_candidates: list[str] = []
    backtick_candidates: list[str] = []
    # Markdown tables: the first cell is conventionally the executable tool.
    # A tools section often contains nested parameter/capability tables too;
    # prefer blocks whose header explicitly says Tool/Function/Capability/Name
    # so parameter names such as ``arxiv_id`` do not become capabilities.
    tool_table_blocks: list[str] = []
    group_tool_table_blocks: list[str] = []

    def _table_block_end(header: re.Match[str]) -> int:
        block_end = len(explicit_text)
        cursor = header.end()
        while cursor < len(explicit_text):
            line_end = explicit_text.find("\n", cursor)
            if line_end < 0:
                line_end = len(explicit_text)
            line = explicit_text[cursor:line_end]
            if not line.lstrip().startswith("|"):
                block_end = cursor
                break
            cursor = line_end + (1 if line_end < len(explicit_text) else 0)
        return block_end

    for header in re.finditer(
        r"(?im)^[ \t]*\|\s*(?:tool|function|capability|name)\s*\|[^\n]*\n",
        explicit_text,
    ):
        tool_table_blocks.append(explicit_text[header.start():_table_block_end(header)])
    # Instrument/control READMEs often group executable names under a first
    # column such as ``Group`` and put the actual tools in the second column.
    # Treat only that explicit ``Group/Category | Tools`` shape as a tool table.
    for header in re.finditer(
        r"(?im)^[ \t]*\|\s*(?:group|category|section)\s*\|\s*(?:tools?|functions?|capabilities?)\s*\|[^\n]*\n",
        explicit_text,
    ):
        group_tool_table_blocks.append(explicit_text[header.start():_table_block_end(header)])
    table_text = "\n".join(tool_table_blocks)
    group_table_text = "\n".join(group_tool_table_blocks)
    # Some first-party READMEs document the executable surface through literal
    # SDK calls rather than a Markdown table (for example
    # ``call_tool("search_papers", ...)``).  Capture only the first string
    # argument of these calls, and only inside an explicitly titled tools
    # section.  This avoids mistaking response fields such as ``total_results``
    # for MCP tools.
    tool_call_candidates = [
        match.group(1).strip()
        for match in re.finditer(
            r"(?i)\b(?:call_tool|use_tool)\s*\(\s*['\"]([A-Za-z][A-Za-z0-9_.:-]{2,80})['\"]",
            explicit_text,
        )
    ]
    explicit_candidates.extend(tool_call_candidates)
    heading_tool_candidates = [
        match.group(1).strip(" `*_\t")
        for match in re.finditer(
            r"(?im)^[ \t]*#{2,6}\s*(?:\*\*)?`?([A-Za-z][A-Za-z0-9_.:-]{2,80})(?:\([^\n)]{0,120}\))?`?(?:\*\*)?[ \t]*$",
            explicit_text,
        )
        if re.search(r"[_:.]", match.group(1)) or match.group(1)[:1].islower()
    ]
    explicit_candidates.extend(heading_tool_candidates)
    explicit_candidates.extend(
        match.group(1).strip(" `*_\t")
        for match in re.finditer(
            r"(?m)^[ \t]*\|\s*(?:\*\*)?`?([A-Za-z][A-Za-z0-9_.:-]{2,80})(?:\([^|`\n]{0,120}\))?`?(?:\*\*)?(?:\s+[^\w\s|]{1,8})?\s*\|",
            table_text,
        )
    )
    explicit_candidates.extend(
        tool_name
        for row in re.finditer(r"(?m)^[ \t]*\|\s*[^|\n]+\|\s*([^|\n]+)\|", group_table_text)
        for tool_name in re.findall(r"`([A-Za-z][A-Za-z0-9_.:-]{2,80})`", row.group(1))
    )
    # README bullet lists such as ``• zotero_search: Search Zotero``.
    bullet_candidates = [
        match.group(1).strip(" `*_\t")
        for match in re.finditer(
            r"^[ \t]*(?:[•*\-]\s+)\*{0,2}`?([A-Za-z][A-Za-z0-9_.:-]{2,80})(?:\([^|`\n]{0,120}\))?`?\*{0,2}(?=\s*[:：-])",
            explicit_text,
            flags=re.MULTILINE,
        )
    ]
    # Narrative bullets (``Security:``, ``Multi-format Support:``) are not
    # executable identifiers.  Keep the lower-case/compound forms normally
    # used for tool names while leaving title-case prose out of the catalog.
    explicit_candidates.extend(
        candidate for candidate in bullet_candidates
        if candidate[:1].islower() or re.search(r"[_:.]", candidate)
    )
    # Explicit backtick identifiers in a tools section.  The sanitizer below
    # removes transport/configuration names that happen to share the section.
    # When explicit tool tables exist, parsing every backtick in their rows
    # would also collect parameter names from the Key Parameters column.
    # The first-cell table parser above is sufficient in that case.
    backtick_source = explicit_text if not tool_table_blocks and not group_tool_table_blocks and not heading_tool_candidates and not tool_call_candidates and not bullet_candidates else ""
    backtick_candidates.extend(
        match.group(1).strip()
        for match in re.finditer(r"`([A-Za-z][A-Za-z0-9_.:-]{2,80})`", backtick_source)
    )
    # Compact README/package metadata lists such as ``7 MCP Tools: foo, bar``.
    compact_source = explicit_text if sections else text
    for match in re.finditer(
        r"(?:\bMCP\s+Tools\b|\btools\b)\s*(?:\*{0,2})\s*[:：]\s*([^.;；\n]{3,600})",
        compact_source,
        flags=re.IGNORECASE,
    ):
        # A prose ``tools:`` marker immediately before a Markdown table is
        # not a compact tool list; splitting ``| Group | Tools |`` would
        # otherwise surface ``Group`` as a fake capability.
        if "|" in match.group(1):
            continue
        list_text = re.split(r"\s+(?:[-*]{1,3}\s+\*{0,2}|##)\s*", match.group(1), maxsplit=1)[0]
        for token in re.split(r"[,，、|]", list_text):
            candidate = token.strip(" `*_\t")
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]{2,80}", candidate) and (
                candidate[:1].islower() or re.search(r"[_:.]", candidate)
            ):
                explicit_candidates.append(candidate)
    names = _clean_explicit_tool_names(explicit_candidates)
    for name in _clean_tool_names(backtick_candidates):
        if name not in names:
            names.append(name)
    return names[:32]


def _extract_evidence_tool_count(value: Any) -> dict[str, Any] | None:
    """Extract an explicit MCP tool count without inventing tool names."""
    text = str(value or "")
    if not text:
        return None
    word_numbers = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
        "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
        "nineteen": 19, "twenty": 20,
    }
    patterns = (
        (r"(?im)^\s*#{1,6}\s*(?:[^\w\s#]{1,8}\s*)?(?:available\s+)?(?:mcp\s+)?(?:tools?|functions?|capabilities)\s*\(\s*(\d+)\s*(?:\+\s*)?(?:total)?\s*\)", "exact"),
        (r"\b(\d+)\s*\+\s*(?:MCP\s*)?(?:bridge\s*)?tools?\b(?!\s+call\b)", "at_least"),
        (r"\b(\d+)\s*(?:个\s*)?(?:MCP\s*)?(?:bridge\s*)?tools?\b(?!\s+call\b)", "exact"),
        (r"(\d+)\s*余个(?:[^\n。；,，]{0,40})?工具(?!调用)", "at_least"),
        (r"(\d+)\s*个(?:[^\n。；,，]{0,40})?工具(?!调用)", "exact"),
        (r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:MCP\s*)?(?:bridge\s*)?tools?\b(?!\s+call\b)", "exact"),
    )
    matches: list[tuple[int, str]] = []
    for pattern, kind in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            raw_value = match.group(1)
            number = int(raw_value) if raw_value.isdigit() else word_numbers.get(raw_value.casefold(), 0)
            if number:
                matches.append((number, kind))
    if not matches:
        return None
    values = {value for value, _ in matches}
    return {
        "tool_count": max(values),
        "tool_count_kind": "at_least" if len(values) > 1 or any(kind == "at_least" for _, kind in matches) else "exact",
    }


def _extract_info_tool_count(value: Any, kind: Any = None) -> dict[str, Any] | None:
    """Normalize a count extracted from a cached first-party info page."""
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    if count <= 0:
        return None
    normalized_kind = str(kind or "exact").strip().casefold()
    return {
        "tool_count": count,
        "tool_count_kind": "at_least" if normalized_kind == "at_least" else "exact",
    }


def _merge_tool_counts(*counts: dict[str, Any] | None) -> dict[str, Any] | None:
    """Keep the strongest explicit count without fabricating a tool list."""
    valid = [item for item in counts if isinstance(item, dict) and int(item.get("tool_count") or 0) > 0]
    if not valid:
        return None
    values = [int(item["tool_count"]) for item in valid]
    return {
        "tool_count": max(values),
        "tool_count_kind": "at_least" if len(set(values)) > 1 or any(item.get("tool_count_kind") == "at_least" for item in valid) else "exact",
    }


def _tool_summary(info_page: dict[str, Any], skillhub: dict[str, Any]) -> str:
    names = _clean_tool_names(info_page.get("tool_names"))
    if not names:
        names = _clean_tool_names(skillhub.get("capabilities"))
    names = names[:8]
    return f"一手资料列出 MCP 工具：{'、'.join(names)}。" if names else ""


def _display_task(entry: dict[str, Any], taxonomy: dict[str, Any], skillhub: dict[str, Any]) -> str:
    raw_action = " ".join(str(entry.get("function") or "").split()).strip()
    taxonomy_function = str(taxonomy.get("function") or "").strip()
    if raw_action and raw_action != taxonomy_function:
        return raw_action[:240]
    info_page = skillhub.get("info_page") or {}
    for candidate in (
        skillhub.get("info_page_summary"),
        info_page.get("summary"),
        skillhub.get("summary"),
        _summary(entry, taxonomy),
    ):
        usable = _usable_summary(candidate)
        if usable and usable != taxonomy_function:
            return usable[:240]
    return taxonomy_function or "未细分"


def _display_readiness(entry: dict[str, Any], taxonomy: dict[str, Any]) -> tuple[str, int]:
    trusted = (
        str(entry.get("status") or "") == "verified_source"
        or str(taxonomy.get("evidence_scope") or "") == "source_reviewed"
    )
    return ("trusted", 90) if trusted else ("provisional", 70)


def _source_name(source_url: str) -> str:
    host = urlparse(source_url).netloc.casefold()
    if host == "github.com":
        return "GitHub canonical repository"
    if host in {"pypi.org", "www.pypi.org"}:
        return "PyPI package metadata"
    if host in {"www.npmjs.com", "npmjs.com", "registry.npmjs.org"}:
        return "npm package metadata"
    if host == "registry.modelcontextprotocol.io":
        return "Official MCP Registry"
    return host or "Canonical source"


def _skillhub_description(summary: str, task: str, taxonomy: dict[str, Any]) -> str:
    parts = [summary.strip()]
    if task.strip() and task.strip() != str(taxonomy.get("function") or "").strip() and task.strip() not in summary:
        parts.append(f"研究任务：{task.strip()}")
    route = " / ".join(
        str(taxonomy.get(key) or "").strip()
        for key in ("domain", "subdomain", "stage", "function")
        if str(taxonomy.get(key) or "").strip()
    )
    if route:
        parts.append(f"研究路径：{route}。")
    return " ".join(part for part in parts if part).strip()


def _compact_mapping(value: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    """Project first-party facts without leaking local cache/debug fields."""
    if not isinstance(value, dict):
        return {}
    compact: dict[str, Any] = {}
    for field in fields:
        field_value = value.get(field)
        if field_value is None or field_value == "" or field_value == []:
            continue
        compact[field] = field_value
    return compact


def build_snapshot(source_payload: dict[str, Any], source_path: Path) -> dict[str, Any]:
    entries = source_payload.get("entries")
    expansion = source_payload.get("active_catalog_expansion") or {}
    if not isinstance(entries, list) or not entries:
        raise ValueError("active catalog must contain a non-empty entries list")
    dimensions = {
        key: list(expansion.get(key) or [])
        for key in REQUIRED_DIMENSIONS
    }
    if any(not values for values in dimensions.values()):
        raise ValueError("active catalog is missing taxonomy dimensions")

    snapshot_entries: list[dict[str, Any]] = []
    ids: set[str] = set()
    urls: set[str] = set()
    allowed_values = {key: set(values) for key, values in dimensions.items()}
    for entry in entries:
        taxonomy = entry.get("taxonomy") or {}
        entry_id = str(entry.get("id") or "").strip()
        source_url = str(taxonomy.get("source_url") or entry.get("url") or "").strip()
        if not entry_id or entry_id in ids:
            raise ValueError(f"duplicate or empty active MCP id: {entry_id!r}")
        if not source_url or source_url in urls:
            raise ValueError(f"duplicate or empty active MCP source URL: {source_url!r}")
        if taxonomy.get("review_status") not in ALLOWED_REVIEW_STATUS:
            raise ValueError(f"active MCP is not taxonomy_reviewed: {entry_id}")
        for key in ("domain", "subdomain", "stage", "function"):
            if taxonomy.get(key) not in allowed_values[key + "s"]:
                raise ValueError(f"invalid {key} for {entry_id}: {taxonomy.get(key)!r}")
        ids.add(entry_id)
        urls.add(source_url)
        skillhub = entry.get("skillhub") or {}
        info_page = dict(skillhub.get("info_page") or {})
        raw_info_tools = info_page.get("tool_names")
        if info_page.get("tool_names_source") in {"explicit_tool_section", "explicit_json_tools", "explicit_mixed", "explicit_tool_doc"}:
            clean_info_tools = _clean_explicit_tool_names(raw_info_tools)
        else:
            clean_info_tools = _clean_tool_names(raw_info_tools)
        if isinstance(raw_info_tools, list):
            info_page["tool_names"] = clean_info_tools
        info_page = _compact_mapping(info_page, INFO_PAGE_FIELDS)
        evidence_tools = _extract_evidence_tool_names(entry.get("evidence"))
        info_tool_count = _extract_info_tool_count(info_page.get("tool_count"), info_page.get("tool_count_kind"))
        evidence_tool_count = _merge_tool_counts(
            _extract_evidence_tool_count(entry.get("evidence")),
            info_tool_count,
        )
        source_metadata = entry.get("source_metadata") or {}
        info_fetch_status = str(source_metadata.get("fetch_status") or "").strip().casefold()
        info_page_fetched = info_fetch_status == "fetched"
        if info_page_fetched:
            info_page_status = "extracted"
        elif info_fetch_status:
            info_page_status = "unavailable"
        else:
            info_page_status = "not_attempted"
        capability_tools = clean_info_tools or evidence_tools
        capability_source = (
            "info_page" if clean_info_tools or info_tool_count else
            "canonical_source" if evidence_tools else
            "canonical_source" if evidence_tool_count else
            "task_description"
        )
        capability_mode = "tool_list" if capability_tools else "tool_count" if evidence_tool_count else "task_description"
        tool_count = max(len(capability_tools), int((evidence_tool_count or {}).get("tool_count") or 0))
        capability_evidence = {
            "tool_names": capability_tools,
            "tool_count": tool_count,
            "tool_count_kind": (evidence_tool_count or {}).get("tool_count_kind", "exact") if tool_count else None,
            "tool_names_source": capability_source if capability_tools else None,
            "capability_mode": capability_mode,
        }
        information_status = {
            "source_review": str(taxonomy.get("evidence_scope") or "unknown"),
            "info_page": info_page_status,
            "capability_evidence": capability_mode,
        }
        if source_metadata.get("http_status") is not None:
            information_status["info_page_http_status"] = source_metadata.get("http_status")
        if source_metadata.get("error"):
            information_status["info_page_error"] = str(source_metadata.get("error"))[:240]
        readiness, quality_score = _display_readiness(entry, taxonomy)
        # Preserve factual first-party fields collected by the MCP enrichment
        # pass.  Fall back to the catalog narrative when no page was fetched;
        # never replace a fetched summary with a taxonomy template.
        catalog_summary = skillhub.get("summary")
        if _is_taxonomy_only_summary(catalog_summary):
            catalog_summary = None
        summary_candidates = (
            ("info_page_description", skillhub.get("info_page_summary")),
            ("info_page_description", info_page.get("summary")),
            ("canonical_tool_evidence", _tool_summary(info_page, skillhub)),
            ("catalog_summary", catalog_summary),
            ("catalog_narrative", _summary(entry, taxonomy)),
        )
        summary_source = "taxonomy_fallback"
        summary = ""
        for candidate_source, candidate in summary_candidates:
            usable = _usable_summary(candidate)
            if usable:
                summary = usable
                summary_source = candidate_source
                break
        if not summary:
            summary = f"面向{taxonomy.get('subdomain') or '科研对象'}的 MCP 服务。"
        summary = _usable_summary(summary)
        task = _display_task(entry, taxonomy, skillhub)
        reviewed_at = taxonomy.get("reviewed_at") or source_payload.get("generated_at")
        tags = list(dict.fromkeys(
            [str(tag).strip() for tag in (skillhub.get("tags") or []) if str(tag).strip()]
            + [
                str(taxonomy.get(key) or "").strip()
                for key in ("domain", "subdomain", "stage", "function")
                if str(taxonomy.get(key) or "").strip()
            ]
        ))
        capabilities = capability_tools or _clean_tool_names(skillhub.get("capabilities"))
        if not capabilities:
            capabilities = [task] if task else [str(taxonomy.get("function") or "科研动作")]
        framework = str(skillhub.get("framework") or "Model Context Protocol").strip()
        compatibility = str(
            skillhub.get("compatibility_level")
            or skillhub.get("compatibility")
            or "catalog_only"
        ).strip()
        pricing = str(
            skillhub.get("pricing_status")
            or skillhub.get("pricing")
            or "not_applicable"
        ).strip()
        # The source catalog is authoritative after the license-promotion pass.
        # Do not fall back to legacy nested SkillHub/info-page values: those
        # can be stale or unnormalised and would make the projected Hub count
        # disagree with the canonical active catalog.
        license_name = str(entry.get("license") or "").strip() or None
        license_status = str(entry.get("license_status") or ("identified" if license_name else "unknown")).strip()
        license_source = str(entry.get("license_source") or "").strip() or None
        license_raw = str(entry.get("license_raw") or "").strip() or None
        license_evidence = _compact_mapping(
            entry.get("license_evidence") or source_metadata.get("license_evidence"),
            LICENSE_EVIDENCE_FIELDS,
        )
        source_name = str(skillhub.get("source_name") or _source_name(source_url)).strip()
        docs_url = str(skillhub.get("docs") or info_page.get("homepage_url") or source_url).strip()
        install_command = str(skillhub.get("install_command") or "").strip() or None
        latest_version = str(skillhub.get("latest_version") or info_page.get("version") or "").strip() or None
        snapshot_entries.append(
            {
                "id": entry_id,
                "slug": entry_id,
                "name": str(entry.get("name") or entry_id),
                "tagline": _first_sentence(summary),
                "summary": summary,
                "summary_source": summary_source,
                "description": _skillhub_description(summary, task, taxonomy),
                "domain": taxonomy["domain"],
                "subdomain": taxonomy["subdomain"],
                "stage": taxonomy["stage"],
                "function": taxonomy["function"],
                "task": task,
                "category_key": taxonomy["domain"],
                "category_name": taxonomy["domain"],
                "cluster_key": taxonomy["subdomain"],
                "cluster_name": taxonomy["subdomain"],
                "tags": tags,
                "capabilities": capabilities,
                "capability_evidence": capability_evidence,
                "information_status": information_status,
                "framework": framework,
                "compatibility_level": compatibility,
                "pricing_status": pricing,
                "price_points": 0,
                "license": license_name,
                "license_status": license_status,
                "license_source": license_source,
                "license_raw": license_raw,
                "license_evidence": license_evidence,
                "quality_score": quality_score,
                "readiness": readiness,
                "review_status": "taxonomy_reviewed",
                "status": str(entry.get("status") or "unknown"),
                "source_url": source_url,
                "source_name": source_name,
                "docs_url": docs_url,
                "install_command": install_command,
                "latest_version": latest_version,
                "transport": list(skillhub.get("transport") or info_page.get("transport") or []),
                "info_page_fetched": info_page_fetched,
                "openclaw_ready": False,
                "featured": False,
                "hero_note": "面向科研对象与科研动作的 MCP 目录记录；Hub 仅提供证据与来源，不在站内安装或执行。",
                "total_reviews": 0,
                "avg_rating": 0,
                "total_favorites": 0,
                "total_downloads": 0,
                "weekly_downloads": 0,
                "viewer_favorited": False,
                "author_openclaw_agent_id": None,
                "created_at": reviewed_at,
                "updated_at": reviewed_at,
                "published_at": reviewed_at,
                "classification_rationale": str(taxonomy.get("rationale") or ""),
                "source_verification": {
                    "status": taxonomy.get("evidence_scope"),
                    "checked_at": reviewed_at,
                    "observed_path": source_url,
                    **_compact_mapping(
                        source_metadata,
                        ("fetch_status", "final_url", "http_status", "fetched_at", "content_sha256", "content_bytes"),
                    ),
                    "review_required": taxonomy.get("evidence_scope") != "source_reviewed",
                },
                "evidence": str(entry.get("evidence") or ""),
                "overlap_difference": str(entry.get("overlap") or ""),
                "reviewed_at": reviewed_at,
                "evidence_scope": taxonomy.get("evidence_scope"),
            }
        )

    dimension_order = {
        key: {value: index for index, value in enumerate(dimensions[key])}
        for key in REQUIRED_DIMENSIONS
    }
    snapshot_entries.sort(key=lambda item: (
        dimension_order["domains"].get(str(item.get("domain") or ""), 10_000),
        dimension_order["subdomains"].get(str(item.get("subdomain") or ""), 10_000),
        dimension_order["stages"].get(str(item.get("stage") or ""), 10_000),
        dimension_order["functions"].get(str(item.get("function") or ""), 10_000),
        str(item.get("name") or item.get("id") or ""),
    ))

    hub_index = source_payload.get("mcp_hub_index") or {}
    license_status_counts = {
        status: sum(str(item.get("license_status") or "missing") == status for item in snapshot_entries)
        for status in sorted({str(item.get("license_status") or "missing") for item in snapshot_entries})
    }
    compact_hub_index = {
        "classification_mode": hub_index.get("classification_mode") or "domain_long_tail_deep_taxonomy",
        "gap_policy": hub_index.get("gap_policy") or "structural_notes_not_expansion_targets",
        "domain_coverage": hub_index.get("domain_coverage") or {"covered": len(dimensions["subdomains"]), "total": len(dimensions["subdomains"])},
        "stage_counts": hub_index.get("stage_counts") or {},
        "function_counts": hub_index.get("function_counts") or {},
        "mcp_gap_pairs": hub_index.get("mcp_gap_pairs") or [],
        "license_coverage": {
            "known": sum(bool(item.get("license")) for item in snapshot_entries),
            "missing": sum(not bool(item.get("license")) for item in snapshot_entries),
            "evidence_status_counts": license_status_counts,
            "evidence_complete": sum(isinstance(item.get("license_evidence"), dict) for item in snapshot_entries),
            "policy": "record first-party license fields and missing state only; no license or legal audit",
        },
        "presentation_quality": {
            "active_records": len(snapshot_entries),
            "summary_complete": sum(bool(item.get("summary")) for item in snapshot_entries),
            "task_complete": sum(bool(item.get("task")) for item in snapshot_entries),
            "source_complete": sum(bool(item.get("source_url")) for item in snapshot_entries),
            "evidence_complete": sum(bool(item.get("evidence")) for item in snapshot_entries),
            "rationale_complete": sum(bool(item.get("classification_rationale")) for item in snapshot_entries),
            "description_complete": sum(bool(item.get("description")) for item in snapshot_entries),
            "tags_complete": sum(bool(item.get("tags")) for item in snapshot_entries),
            "capabilities_complete": sum(bool(item.get("capabilities")) for item in snapshot_entries),
            "tool_evidence": sum((item.get("capability_evidence") or {}).get("capability_mode") in {"tool_list", "tool_count"} for item in snapshot_entries),
            "tool_name_evidence": sum((item.get("capability_evidence") or {}).get("capability_mode") == "tool_list" for item in snapshot_entries),
            "tool_count_only": sum((item.get("capability_evidence") or {}).get("capability_mode") == "tool_count" for item in snapshot_entries),
            "task_only_capability": sum((item.get("capability_evidence") or {}).get("capability_mode") == "task_description" for item in snapshot_entries),
            "info_page_fetched": sum(bool(item.get("info_page_fetched")) for item in snapshot_entries),
            "info_page_unavailable": sum((item.get("information_status") or {}).get("info_page") == "unavailable" for item in snapshot_entries),
            "info_page_not_attempted": sum((item.get("information_status") or {}).get("info_page") == "not_attempted" for item in snapshot_entries),
            "skillhub_field_aligned": len(snapshot_entries),
            "source_reviewed": sum(item.get("evidence_scope") == "source_reviewed" for item in snapshot_entries),
            "trusted_display": sum(item.get("readiness") == "trusted" for item in snapshot_entries),
            "provisional_display": sum(item.get("readiness") == "provisional" for item in snapshot_entries),
            "license_known": sum(bool(item.get("license")) for item in snapshot_entries),
            "license_missing": sum(not bool(item.get("license")) for item in snapshot_entries),
            "license_evidence_status_counts": license_status_counts,
            "license_evidence_complete": sum(isinstance(item.get("license_evidence"), dict) for item in snapshot_entries),
            "batch_scope": "active_catalog_full_pass",
        },
    }
    skillhub_parity = {
        "reference": "TopicLab SkillHub card/detail contract",
        "card_fields": list(SKILLHUB_CARD_FIELDS),
        "card_field_coverage": {
            field: sum(field in item for item in snapshot_entries)
            for field in SKILLHUB_CARD_FIELDS
        },
        "mcp_taxonomy_fields": [
            "domain", "subdomain", "stage", "function", "task",
            "classification_rationale", "source_verification", "evidence_scope",
        ],
        "detail_surfaces": [
            "content", "reviews", "favorite", "download_status", "source_asset",
            "related_mcps",
        ],
        "read_only_policy": "MCP entries expose catalog metadata and source evidence only; no installation, execution, or package download is performed by TopicLab.",
    }
    taxonomy_index = dict(source_payload.get("active_catalog_index") or {})
    taxonomy_index["taxonomy_source"] = TAXONOMY_SOURCE
    raw = json.dumps(source_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return {
        "schema": "science_mcp_catalog_v1",
        "generated_at": source_payload.get("generated_at"),
        "active_catalog_count": len(snapshot_entries),
        "retired_archive_excluded": True,
        "source": {
            "path": source_path.name,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "review_status": "taxonomy_reviewed_only",
        },
        "dimensions": dimensions,
        "taxonomy_index": taxonomy_index,
        "hub_index": compact_hub_index,
        "skillhub_parity": skillhub_parity,
        "mcps": snapshot_entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Active science-mcp-catalog.json")
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    destination = args.destination.resolve()
    payload = json.loads(source.read_text(encoding="utf-8"))
    snapshot = build_snapshot(payload, source)
    serialized = (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    current = destination.read_bytes() if destination.exists() else None
    if args.check:
        if current != serialized:
            print(f"OUTDATED: {destination}")
            return 1
        print(f"OK: {snapshot['active_catalog_count']} active MCPs; snapshot is current")
        return 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    if current != serialized:
        destination.write_bytes(serialized)
        print(f"UPDATED: {snapshot['active_catalog_count']} active MCPs -> {destination}")
    else:
        print(f"UNCHANGED: {snapshot['active_catalog_count']} active MCPs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
