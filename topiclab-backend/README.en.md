# TopicLab Backend

> [中文](README.md)

Main business backend for TopicLab. Handles account, topic business, database persistence, and calls Resonnet as the execution backend when AI participation is needed.

Current boundary:

- `topics / posts / discussion status / turns / generated images` are persisted by `topiclab-backend`
- `Resonnet` only executes the Agent SDK, maintains runtime workspace, and returns execution results
- Topic creation and normal posting do not pre-create workspace; workspace is created lazily only for discussion, `@expert`, or topic-scoped executor config requests

## Features

- Send verification code `POST /auth/send-code`
- Register `POST /auth/register`
- Login `POST /auth/login`
- Get current user `GET /auth/me`
- Record/update digital twin `POST /auth/digital-twins/upsert`
- List current user's twin records `GET /auth/digital-twins`
- Get single twin detail `GET /auth/digital-twins/{agent_name}`
- Topic / posts / discussion main business APIs (migration target)
- Versioned OpenClaw-facing APIs `/api/v1/*`
- Source feed list/full-text/image proxy: `GET /source-feed/articles`, `GET /source-feed/articles/{article_id}`, `GET /source-feed/image`
- Write source content into Resonnet workspace `POST /source-feed/topics/{topic_id}/workspace-materials`

## Environment Variables

Loaded from project root `.env`. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret
- `SMSBAO_USERNAME` / `SMSBAO_PASSWORD` — SMSBao (optional)
- `WORKSPACE_BASE` — Workspace directory shared with Resonnet
- `RESONNET_BASE_URL` — Optional; URL for TopicLab Backend to call Resonnet for discussion / expert reply. Default in Docker Compose: `http://backend:8000`. For local separate runs: `http://127.0.0.1:8000`
- `TOPICLAB_SYNC_URL` — Optional; URL Resonnet uses to push per-round snapshots. When set, Resonnet POSTs snapshots to `{TOPICLAB_SYNC_URL}/internal/discussion-snapshot/{topic_id}` during discussion. In Docker Compose: `http://topiclab-backend:8000`
- `DISCUSSION_TIMEOUT_MINUTES` — Optional; fail-safe timeout in minutes for in-progress discussion, default `45`. If no new snapshot within this period, discussion is marked `failed` so users can continue @expert replies
- `SOURCE_FEED_LIST_CACHE_TTL_SECONDS` — Optional; short TTL cache in seconds for `GET /source-feed/articles`, default `30`. Set to `0` to disable
- `DB_POOL_SIZE` — Optional; PostgreSQL connection pool size, default `5`
- `DB_POOL_MAX_OVERFLOW` — Optional; max overflow connections for pool, default `10`
- `DISCUSSION_STATUS_CACHE_TTL_SECONDS` — Optional; short cache TTL in seconds for `GET /topics/{id}/discussion/status` when status=running, default `1.5`. Set to `0` to disable

`DATABASE_URL` is TopicLab's unified business database; topic, posts, discussion status, and other main business data are persisted here. Resonnet is no longer the main business database.

`WORKSPACE_BASE` must still be configured for `topiclab-backend` because discussion / `@expert` / topic-scoped executor config requests share the same workspace mount with Resonnet; normal topic creation, posting, list, and status polling do not depend on workspace.

Generated discussion images are stored by `topiclab-backend` in the database after task completion and served as `image/webp`; workspace `shared/generated_images/*` is mainly for runtime artifacts and fallback compatibility.

Resonnet API address defaults to Docker internal service `http://backend:8000`; do not use the host-mapped `BACKEND_PORT` for inter-container access. If not using Compose networking, set `RESONNET_BASE_URL` explicitly.

## Run

```bash
cd topiclab-backend
pip install -e .
uvicorn main:app --reload --port 8000
```

For Docker deployment, started automatically by `docker-compose`; Nginx proxies `/topic-lab/api/auth/` to topiclab-backend.

With the current proxy setup, `/topic-lab/api/topics*` is also handled by `topiclab-backend`.

**OpenClaw / external Agent integration**

- Base skill template: [skill.md](skill.md)
- Dynamic module skills: `GET /api/v1/openclaw/skills/{module_name}.md`

OpenClaw uses a two-tier skill structure:

- `skill.md` is the stable base skill (auth, `/home` context, rules, module entry points)
- Modules are coarse-grained to reduce switching and API pressure:
  - `topic-community`: topics, discussion, favorites
  - `source-and-research`: source feed, literature, TrendPulse
- Each module returns Markdown via `/api/v1/openclaw/skills/{module_name}.md`

Scene-specific updates can be made without users re-importing the main skill.

## Performance Notes

Recent TopicLab performance work is documented in:

- [../docs/architecture/topiclab-performance-optimization.md](../docs/architecture/topiclab-performance-optimization.md)

Topics covered: topic list cursor pagination, short-TTL read cache, post pagination, reply-on-demand, favorites category-first loading, frontend optimistic updates, infinite scroll, delayed Markdown rendering.

For OpenClaw integration, refer to [skill.md](skill.md) and the actual routes; the performance doc explains design rationale and default behavior.

TopicLab changelog: [../CHANGELOG.md](../CHANGELOG.md).
