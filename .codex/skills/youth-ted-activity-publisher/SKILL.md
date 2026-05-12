---
name: youth-ted-activity-publisher
description: Publish or update 他山青年 TED activity records in TopicLab. Use when Codex needs to convert Youth TED posters from PNG/JPEG to WebP, upsert records into the `youth_ted_activities` database table, fetch or summarize Tencent Meeting recordings/transcripts, generate structured activity JSON from transcript content, or verify that `/api/v1/youth-ted/activities` shows the event on the website.
---

# Youth TED Activity Publisher

## Overview

Use this skill to turn a Youth TED meeting package into a website activity card: poster image -> WebP blob, Tencent Meeting transcript -> local transcript artifact -> compact structured JSON, and both -> `topiclab-backend` database.

The default user request may contain only one poster image. In that case, do not ask for meeting IDs first. Assume the activity is the latest completed Wednesday 20:00 Asia/Shanghai Tencent Meeting, discover the transcript from Tencent Meeting, generate question-style topics with icons, and upsert the activity into `topiclab.youth_ted_activities`.

The canonical backend is `topiclab-backend`, not `backend`. The frontend activity list reads `GET /api/v1/youth-ted/activities`; do not edit the frontend fallback poster or fallback activity unless the user explicitly asks.

## Workflow

### Poster-Only Default Path

When the user only gives a poster image and asks to publish/update Youth TED:

1. Plan the event from the latest completed Wednesday 20:00 slot:

```bash
topiclab-backend/.venv/bin/python .codex/skills/youth-ted-activity-publisher/scripts/plan_latest_wednesday_activity.py \
  --poster /absolute/path/to/poster.png
```

Use the script output as the run plan:

- `slug`: default public identity, for example `youth-ted-2026-05-06`
- `event.query_start` / `event.query_end`: Tencent Meeting search window
- `event.meeting_code`: default recurring meeting code, `49237646949`
- `meta`: default list text, for example `2026-05-06 周三 20:00-23:00`
- `artifacts.content_json`: where to write generated content JSON

2. Discover the Tencent Meeting transcript:

- Use `tencent-meeting-mcp`.
- Call `convert_timestamp` first if using relative time in prose; the planning script already emits absolute ISO times.
- Query `get_user_ended_meetings` for the planned window.
- Query `get_records_list` using the planned `meeting_code` or discovered `meeting_id`.
- Pick the record whose meeting starts closest to Wednesday 20:00 and whose transcript can be fetched.
- Use the transcript `record_file_id`, not the cloud recording video file ID. If multiple IDs are present, validate by calling `get_transcripts_paragraphs` or `get_transcripts_details`; the valid transcript ID returns paragraphs/text.
- Preserve and report `X-Tc-Trace` / `rpcUuid` from Tencent responses.

3. Save transcript data locally using `save_tencent_transcript.py`.

4. Generate `content.json` from the local transcript artifact:

- Produce 8-10 public-facing `topics`, unless the user asks for another count.
- Each `topics[]` item must include `question`, `icon`, `title`, `hook`, `tags`, `source`, and `confidence`.
- The visible question should be concrete and problem-shaped, not a loose keyword list.
- Store the icon in `topics[].icon` and mirror icons into the top-level `icons` compatibility array so future frontend display changes do not require redeploying code.
- Mirror `topics[].question` into top-level `tags` and `keywords` for compatibility.
- Keep `transcript` trace fields and local artifact paths. Do not store full transcript text in DB.

5. Upsert with `upsert_youth_ted_activity.py`.

- Use the poster path supplied by the user.
- Use the script-planned slug and meta unless the poster clearly contains a different date/time.
- Prefer `label=往期回顾` for completed meetings.
- Write to DB unless the user explicitly asks for dry-run.
- Keep newest activities first. Use `sort_order=10` for the newest item and increment older activities by 10 if reordering is needed.

6. Verify the API and image endpoint:

- `GET /api/v1/youth-ted/activities` includes the slug.
- `poster_url` returns `image/webp` and starts with `RIFF....WEBP`.
- The running backend may cache results for `YOUTH_TED_CACHE_TTL_SECONDS` seconds, default `60`; wait, restart the backend, or set TTL to `0` for immediate local verification.

### Full Manual Path

1. Confirm the event identity when the user provides explicit details:
   - Date and time.
   - Poster image path.
   - Tencent Meeting `meeting_id`, `meeting_code`, cloud recording record/file IDs, and transcript record/file IDs when available.
   - Whether the user wants a production-visible DB write now. If unclear, run `--dry-run` first.

2. Save transcript data locally before extraction:
   - Use `tencent-meeting-mcp` if available.
   - For relative dates, call `convert_timestamp` first.
   - Use the transcript `record_file_id`, not the cloud recording file ID.
   - Preserve and report `X-Tc-Trace` / `rpcUuid` from Tencent responses.
   - Save the raw response and parsed body under `workspace/youth-ted/transcripts/{slug}/`.
   - Do not extract `topics`, `interest_points`, `glossary`, or compatibility `keywords` directly from an in-memory API response. Treat the local transcript file as the source of truth.

```bash
topiclab-backend/.venv/bin/python .codex/skills/youth-ted-activity-publisher/scripts/save_tencent_transcript.py \
  --slug youth-ted-2026-05-06 \
  --meeting-id 11337785712281941677 \
  --record-file-id 2051994715816275969
```

3. Generate `content` JSON from the local transcript artifact:
   - Read `references/data-contract.md`.
   - Read the saved transcript file, usually `workspace/youth-ted/transcripts/{slug}/transcript.md` plus `body.json` when more structure is needed.
   - Keep entries concise and structured for UI display.
   - Prefer `topics`, `interest_points`, `glossary`, and `people_or_projects`.
   - For public-facing discovery, extract question-style topics rather than loose keywords. Each topic should answer "this session discusses what question?" or "what topic is worth opening?"
   - Prefer 8-12 meaning-distinct `topics` unless the user asks for a different count.
   - Keep topic questions concise, usually within 18 Chinese characters, and make them specific enough to invite a click.
   - Set `topics` as the primary structured field. Keep `tags` and `keywords` only as compatibility arrays when useful; if present, they should mirror the topic questions instead of old short keywords.
   - Prefer understandable Chinese phrasing. Avoid unfamiliar all-English acronyms such as `OPC` unless the transcript context clearly defines them and the user explicitly wants that wording. Common AI terms such as `AI`, `Agent`, `AgentOS`, or local product names may be kept.
   - Do not store the full transcript text in `content`; store local transcript path, record IDs, paragraph count, and a short extraction summary.
   - Do not invent claims. If a point is inferred from a poster rather than transcript text, mark `source` as `poster`.

4. Upsert the activity with the script:

```bash
topiclab-backend/.venv/bin/python .codex/skills/youth-ted-activity-publisher/scripts/upsert_youth_ted_activity.py \
  --slug youth-ted-2026-05-06 \
  --poster /absolute/path/to/poster.png \
  --label 往期回顾 \
  --title "他山青年 TED：前沿 AI 进展专场讨论" \
  --meta "2026-05-06 周三 20:00-23:00" \
  --summary "围绕 Vibe Coding、Agentic Engineering、OPC 内容创作与 AI 产品生态展开讨论。" \
  --content-json /absolute/path/to/content.json \
  --sort-order 20 \
  --dry-run
```

Remove `--dry-run` only when publishing/updating the website DB is intended.

Run production upserts sequentially for multiple activities. Avoid parallel writes to `youth_ted_activities`; concurrent schema checks or `ON CONFLICT` updates can hit PostgreSQL DDL/upsert lock contention.

5. Verify after writing:
   - `GET /api/v1/youth-ted/activities` includes the slug.
   - `poster_url` returns `image/webp` and starts with `RIFF....WEBP`.
   - The running backend may cache results for `YOUTH_TED_CACHE_TTL_SECONDS` seconds, default `60`; wait, restart the backend, or set TTL to `0` for immediate local verification.

## Data Contract

Read `references/data-contract.md` before creating or reviewing `content` JSON. Keep this skill's DB writes compatible with:

- Table: `youth_ted_activities`
- Backend store: `topiclab-backend/app/storage/database/youth_ted_store.py`
- Public API: `topiclab-backend/app/api/youth_ted.py`
- Frontend consumer: `frontend/src/pages/YouthTedPage.tsx`

## Script Notes

Use `topiclab-backend/.venv/bin/python` so Pillow, SQLAlchemy, and psycopg2 are available.

Planner script:

- `scripts/plan_latest_wednesday_activity.py` computes the latest completed Wednesday 20:00 activity from the current Asia/Shanghai time.
- It prints slug, meta, Tencent Meeting search window, artifact paths, and command templates.
- Use `--allow-in-progress` only when intentionally publishing before the expected 23:00 end time.

Upsert script:

- Loads `DATABASE_URL` from repo root `.env` unless `--database-url` is passed.
- Converts any supported image to WebP.
- Ensures the Youth TED table exists using the backend's own store code.
- Upserts by `slug`.
- Prints one JSON object with the action, slug, poster stats, DB target summary, and API paths.
