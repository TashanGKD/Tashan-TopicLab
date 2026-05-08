# Academic (Literature) API Overview (Read-Only)

This document lists only the **query (read)** endpoints available for the **Literature** area on the IC service (`/api/v1`). Write APIs are not included. Endpoints unrelated to literature (e.g. we-mp-rss webhook, jobs, articles) are also excluded.

---

## 1. Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/literature/papers` | Paginated paper list |
| GET | `/api/v1/literature/papers/{paper_id}` | Single paper aggregated detail (recent, topics) |
| GET | `/api/v1/literature/recent` | Paginated recent view list |
| GET | `/api/v1/literature/topic-runs` | Paginated BERTopic run list |
| GET | `/api/v1/literature/topic-runs/{period}` | Full BERTopic result for a period |
| GET | `/api/v1/literature/topic-runs/{period}/topics/{topic_id}` | Single topic detail within a period |

**Authentication**: If the server sets `LITERATURE_SHARED_TOKEN`, these endpoints require the header `x-ingest-token: <token>`.

---

## 2. Endpoint Details

### 2.1 GET /api/v1/literature/papers

- **Purpose**: Paginated paper list; list response does not include `abstract` by default.
- **Query params**: `limit` (default 20, max 100), `offset` (default 0), `title` (fuzzy), `author` (fuzzy), `primary_category` (exact), `category` (match in categories), `published_from`, `published_to`
- **Sort**: `published DESC`, `paper_id DESC`
- **Response**: Paginated list; each item includes `paper_id`, `title`, `authors`, `primary_category`, `categories`, `published`, `updated`, `pdf_url`, `doi`, `journal_ref`, `comment`, `created_at`, `updated_at`, etc.

### 2.2 GET /api/v1/literature/papers/{paper_id}

- **Purpose**: Aggregated detail for a single paper.
- **Response**: `paper` (full metadata), `recent` (recent record if any, else null), `topics` (period/topic_id list where this paper is a representative doc).
- **Not found**: 404.

### 2.3 GET /api/v1/literature/recent

- **Purpose**: Paginated recent view list (compact “recent” view for literature clients).
- **Query params**: `limit`, `offset`, `category` (match compact_category), `tag` (match in tags), `published_day_from`, `published_day_to`
- **Sort**: `published_day DESC`, `paper_id DESC`
- **Response**: Paginated list in recent compact format.

The frontend accesses this via topiclab-backend proxy; see [config.md](../getting-started/config.md) (Literature section).

**Note**: The in-app **Source feed → Academic** sub-tab does **not** use this endpoint; it uses the same article-list bridge as **Source feed → Media** (`GET /source-feed/articles` with `source_type=gqy`). As of a live probe against the default IC host, **`source_feed_name` is not honored** (responses match the unfiltered `gqy` stream). The web client therefore **pages through `gqy`** and keeps rows whose **`source_feed_name`** is exactly one of `arXiv cs.AI`, `arXiv cs.LG`, or `arXiv cs.CV` (plus id dedupe when merging). topiclab-backend still accepts optional `source_feed_name` for forward-compatibility when IC implements it.

### 2.4 GET /api/v1/literature/topic-runs

- **Purpose**: Paginated list of BERTopic run results.
- **Query params**: `limit`, `offset`
- **Sort**: `period DESC`
- **Response**: Each item has `period`, `n_topics`, `n_documents`, `created_at`, `updated_at` (no topic details).

### 2.5 GET /api/v1/literature/topic-runs/{period}

- **Purpose**: Full BERTopic result for a period (all topics and representative_docs).
- **Response**: `period`, `n_topics`, `n_documents`, `created_at`, `updated_at`, `topics[]` (with `topic_id`, `keywords`, `paper_count`, `representative_docs`).
- **Not found**: 404.

### 2.6 GET /api/v1/literature/topic-runs/{period}/topics/{topic_id}

- **Purpose**: Single topic detail within a period.
- **Response**: `period`, `topic_id`, `keywords`, `paper_count`, `representative_docs`.
- **Not found**: 404 when period or topic_id does not exist.

---

## 3. Relation to Other Areas

The following are **not** part of the Literature area (for reference only):

- **Webhook / jobs / articles**: `POST /api/v1/webhooks/we-mp-rss`, `GET/POST /api/v1/jobs/*`, `GET /api/v1/articles/*` — used for WeChat RSS ingestion and article storage; not part of the Literature domain.
- **Health**: `GET /api/v1/health` — general health and queue status.

The **query** APIs for the Literature area are only the six endpoints in **§1 Overview**.
