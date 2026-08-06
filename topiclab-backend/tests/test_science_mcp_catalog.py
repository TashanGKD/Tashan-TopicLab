from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.science_mcp_catalog import (
    get_mcp_catalog_categories,
    get_mcp_catalog_item,
    get_mcp_catalog_meta,
    list_mcp_catalog,
    normalize_canonical_url,
)


def test_science_mcp_catalog_snapshot_is_closed_and_taxonomy_mapped():
    meta = get_mcp_catalog_meta()
    assert meta["schema"] == "science_mcp_catalog_v1"
    assert meta["total"] == 5643
    assert meta["retired_archive_excluded"] is True
    assert len(meta["dimensions"]["domains"]) == 9
    assert len(meta["dimensions"]["subdomains"]) == 42
    assert len(meta["dimensions"]["stages"]) == 5
    assert len(meta["dimensions"]["functions"]) == 17
    assert meta["hub_index"]["domain_coverage"]["status"] == "long_tail"
    assert meta["source"]["path"] == "science-mcp-catalog.json"
    assert ":\\" not in meta["source"]["path"]


def test_science_mcp_catalog_supports_skillhub_filters_and_detail():
    result = list_mcp_catalog(domain="生命科学", stage="执行采集", function="数据采集", limit=10)
    assert result["total"] == 10
    assert result["list"]
    item = result["list"][0]
    assert item["domain"] == "生命科学"
    assert item["stage"] == "执行采集"
    assert item["function"] == "数据采集"
    assert item["review_status"] == "taxonomy_reviewed"
    assert item["classification_rationale"]
    assert item["source_verification"]["observed_path"] == item["source_url"]
    assert "source_metadata" not in item
    assert get_mcp_catalog_item(item["id"])["source_url"] == item["source_url"]


def test_science_mcp_catalog_search_and_categories():
    result = list_mcp_catalog(q="蛋白", limit=10)
    assert result["total"] > 0
    categories = get_mcp_catalog_categories()
    assert categories["counts"]["domains"]["生命科学"] > 0
    assert sum(categories["status_counts"].values()) == 5643


def test_science_mcp_catalog_missing_detail_is_404():
    with pytest.raises(HTTPException) as error:
        get_mcp_catalog_item("__missing_science_mcp__")
    assert error.value.status_code == 404


def test_science_mcp_catalog_normalizes_canonical_identity_without_rewriting_evidence():
    assert normalize_canonical_url("HTTPS://Example.COM:443/research/mcp/#readme") == "https://example.com/research/mcp"
    assert normalize_canonical_url("http://example.com:8080/research/mcp/?view=raw#tools") == "http://example.com:8080/research/mcp?view=raw"
