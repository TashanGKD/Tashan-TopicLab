import gzip
import json

import pytest
import zvec

from scripts.migrate_topiclink_embedding_cache_to_zvec import migrate_cache, zvec_document_id


def _write_cache(path, *, dimensions: int = 4) -> list[dict]:
    rows = [
        {
            "cache_key": "Qwen3-Embedding-8B:first",
            "model": "Qwen3-Embedding-8B",
            "text_hash": "first",
            "vector_json": json.dumps([1.0, 0.0, 0.0, 0.0][:dimensions]),
            "dimensions": dimensions,
            "created_at": "2026-05-20T00:00:00Z",
            "updated_at": "2026-05-20T00:00:00Z",
            "last_used_at": "2026-05-20T00:00:00Z",
        },
        {
            "cache_key": "Qwen3-Embedding-8B:second",
            "model": "Qwen3-Embedding-8B",
            "text_hash": "second",
            "vector_json": json.dumps([0.0, 1.0, 0.0, 0.0][:dimensions]),
            "dimensions": dimensions,
            "created_at": "2026-05-20T00:00:00Z",
            "updated_at": "2026-05-20T00:00:00Z",
            "last_used_at": "2026-05-20T00:00:00Z",
        },
    ]
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    return rows


def test_migrates_embedding_cache_to_queryable_zvec_collection(tmp_path):
    source = tmp_path / "cache.jsonl.gz"
    rows = _write_cache(source)
    target = tmp_path / "topiclink.zvec"

    first = migrate_cache(source, target, batch_size=1, optimize=False)
    second = migrate_cache(source, target, batch_size=2, optimize=False)

    assert first == {
        "source_rows": 2,
        "upserted_rows": 2,
        "model": "Qwen3-Embedding-8B",
        "dimensions": 4,
    }
    assert second == first

    collection = zvec.open(str(target))
    document_ids = [zvec_document_id(row["cache_key"]) for row in rows]
    fetched = collection.fetch(document_ids, include_vector=False)
    assert set(fetched) == set(document_ids)
    assert fetched[document_ids[0]].fields["cache_key"] == rows[0]["cache_key"]
    matches = collection.query(
        queries=zvec.Query(field_name="embedding", vector=[1.0, 0.0, 0.0, 0.0]),
        topk=1,
        output_fields=["model", "text_hash"],
    )
    assert matches[0].id == document_ids[0]
    assert matches[0].fields["model"] == "Qwen3-Embedding-8B"


def test_normalizes_legacy_cache_key_to_runtime_key(tmp_path):
    source = tmp_path / "cache.jsonl.gz"
    rows = _write_cache(source)
    rows[0]["cache_key"] = "legacy-hashed-cache-key"
    with gzip.open(source, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")

    target = tmp_path / "topiclink.zvec"
    migrate_cache(source, target, optimize=False)

    collection = zvec.open(str(target))
    runtime_key = f"{rows[0]['model']}:{rows[0]['text_hash']}"
    fetched = collection.fetch(
        [zvec_document_id(runtime_key), zvec_document_id(rows[0]["cache_key"])],
        include_vector=False,
    )

    assert zvec_document_id(runtime_key) in fetched
    assert zvec_document_id(rows[0]["cache_key"]) not in fetched
    assert fetched[zvec_document_id(runtime_key)].fields["cache_key"] == runtime_key


def test_rejects_mixed_embedding_dimensions(tmp_path):
    source = tmp_path / "cache.jsonl.gz"
    rows = _write_cache(source)
    rows[1]["dimensions"] = 3
    rows[1]["vector_json"] = json.dumps([0.0, 1.0, 0.0])
    with gzip.open(source, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")

    with pytest.raises(ValueError, match="dimension"):
        migrate_cache(source, tmp_path / "topiclink.zvec", optimize=False)
