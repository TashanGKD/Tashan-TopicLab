# Youth TED Data Contract

## Storage

`topiclab-backend` owns Youth TED storage.

Table: `youth_ted_activities`

Core columns:

- `id`: text primary key. Use the slug unless there is a separate durable ID.
- `slug`: unique public identity, for example `youth-ted-2026-05-06`.
- `status`: `published` to show in the public list.
- `sort_order`: lower values appear first.
- `payload_json`: JSON object serialized from the payload below.
- `poster_webp`: WebP bytes.
- `poster_mime_type`: usually `image/webp`.

Public API:

- `GET /api/v1/youth-ted/activities`
- `GET /api/v1/youth-ted/activities/{slug}/poster.webp`

## Payload

`payload_json` must contain these top-level keys:

```json
{
  "label": "往期回顾",
  "title": "他山青年 TED：前沿 AI 进展专场讨论",
  "meta": "2026-05-06 周三 20:00-23:00",
  "summary": "一句话说明本场讨论为什么值得看。",
  "content": {}
}
```

For poster-only publishing, derive these fields as follows:

- `slug`: `youth-ted-YYYY-MM-DD`, where the date is the latest completed Wednesday 20:00 Asia/Shanghai event.
- `label`: `往期回顾` after the meeting has ended.
- `title`: prefer poster text; otherwise use `他山青年 TED：前沿 AI 进展专场讨论`.
- `meta`: `YYYY-MM-DD 周三 20:00-23:00`.
- `summary`: one sentence extracted from the local transcript artifact, not generic AI copy.
- `sort_order`: newest first. Use `10` for the newest activity and increase older rows by `10` when reordering is needed.

## Content JSON

Use this shape for `content`. Keep it compact enough for activity-card/detail rendering.

```json
{
  "format_version": 2,
  "meeting": {
    "meeting_id": "11337785712281941677",
    "meeting_code": "49237646949",
    "sub_meeting_id": "1778068800",
    "started_at": "2026-05-06T20:00:00+08:00",
    "ended_at": "2026-05-06T23:00:00+08:00",
    "recording_url": "https://meeting.tencent.com/crm/...",
    "transcript_url": "https://meeting.tencent.com/ctm/...",
    "record_file_id": "cloud-record-file-id",
    "transcript_record_file_id": "transcript-record-file-id"
  },
  "agenda": [
    "AI 前沿进展分享",
    "Agent4S 及他山世界最新进展同步",
    "社区案例深度讨论"
  ],
  "topics": [
    {
      "question": "AI对话记忆该归谁？",
      "icon": {
        "paths": [
          "M7 4h8a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z",
          "M8 8h6",
          "M8 12h5",
          "M8 16h3"
        ]
      },
      "title": "AI对话记忆的数据归属",
      "hook": "从本地优先、跨平台捕获和个人知识库讨论AI对话数据是否应该由用户真正拥有。",
      "tags": ["本地记忆", "数据自有"],
      "source": "transcript",
      "confidence": "high"
    }
  ],
  "tags": [
    "AI对话记忆该归谁？"
  ],
  "keywords": [
    "AI对话记忆该归谁？"
  ],
  "icons": [
    {
      "paths": [
        "M7 4h8a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z",
        "M8 8h6",
        "M8 12h5",
        "M8 16h3"
      ]
    }
  ],
  "interest_points": [
    {
      "title": "Codex 接管 Mac 的工作流正在成形",
      "hook": "从写代码走向接管目标、上下文和工具链，Agentic Engineering 的边界正在外扩。",
      "why_it_matters": "适合关注个人生产力、AI IDE、自动化工作流的成员继续追踪。",
      "tags": ["Codex", "Agentic Engineering"],
      "source": "transcript",
      "confidence": "medium"
    }
  ],
  "glossary": [
    {
      "term": "OPC",
      "definition": "One Person Company / 一人公司语境下的内容、产品与运营闭环。",
      "tags": ["content", "creator"]
    }
  ],
  "people_or_projects": [
    {
      "name": "Vesti",
      "type": "project",
      "note": "本地优先 AI 记忆中台。"
    }
  ],
  "transcript": {
    "paragraph_count": 314,
    "source": "tencent_meeting_mcp",
    "local_raw_path": "workspace/youth-ted/transcripts/youth-ted-2026-05-06/raw_response.json",
    "local_body_path": "workspace/youth-ted/transcripts/youth-ted-2026-05-06/body.json",
    "local_markdown_path": "workspace/youth-ted/transcripts/youth-ted-2026-05-06/transcript.md",
    "extracted_at": "2026-05-12T16:48:35+08:00"
  }
}
```

Rules:

- Prefer 3-6 `interest_points`.
- Prefer 8-10 `topics` for poster-only publishing, or 8-12 when manually curating a longer transcript. Each item should be a structured object with `question`, `icon`, `title`, `hook`, `tags`, `source`, and `confidence`.
- `topics[].question` is the primary display text. It should be a concise question or topic sentence, usually within 18 Chinese characters, not a loose keyword.
- `topics[].icon` is the primary decorative marker for the question bubble. Store SVG line-icon data in the database so icon changes do not require a frontend deploy. Supported fields are `viewBox`, `strokeWidth`, `paths`, `rects`, `circles`, `lines`, and `polylines`. Keep the optional top-level `icons` compatibility array aligned to `topics[].icon`.
- Use `tags` and `keywords` only as compatibility JSON string arrays. When present, mirror the `topics[].question` values so older frontends do not keep showing stale short keywords.
- Public-facing topics must be extracted from local transcript artifacts, be meaning-distinct, and be specific enough to invite opening the activity.
- Avoid unfamiliar all-English acronyms such as `OPC` in public topic questions unless the user explicitly requests them or the term is defined in adjacent UI copy.
- Prefer 0-8 `glossary` entries.
- Store IDs, URLs, and local transcript artifact paths for traceability, not full transcript text.
- Generate structured fields from local transcript files only. Do not treat a transient API response in the chat context as the extraction source of truth.
- Use `source: "poster"` only when the item comes from the poster image and was not confirmed by transcript text.
- Use `confidence: "low" | "medium" | "high"`.

## Local Transcript Artifacts

Save Tencent Meeting transcript artifacts under:

```text
workspace/youth-ted/transcripts/{slug}/
```

Expected files:

- `raw_response.json`: exact stdout JSON returned by `tencent-meeting-mcp`.
- `body.json`: parsed Tencent response body when the response has a JSON body string.
- `transcript.md`: human-readable transcript text and paragraph metadata for model extraction.
- `trace.json`: `X-Tc-Trace`, `rpcUuid`, status code, meeting ID, record file ID, and generation timestamp.

Extraction rule:

1. Fetch/save transcript artifacts.
2. Inspect `transcript.md` and `body.json`.
3. Produce a separate `content.json` following the `Content JSON` shape.
4. Use `content.json` as `--content-json` when upserting the activity.

## Current Known Youth TED Records

Meeting:

- `meeting_id`: `11337785712281941677`
- `meeting_code`: `49237646949`

2026-04-29:

- `sub_meeting_id`: `1777464000`
- Cloud recording URL: `https://meeting.tencent.com/crm/24MyQ6Ey9e`
- Transcript URL: `https://meeting.tencent.com/ctm/24MyyOOX06`
- Cloud `record_file_id`: `2049461150024175617`
- Transcript `record_file_id`: `2049459359656075265`
- Transcript paragraph count observed: `382`

2026-05-06:

- `sub_meeting_id`: `1778068800`
- Cloud recording URL: `https://meeting.tencent.com/crm/NgaXnRZ745`
- Transcript URL: `https://meeting.tencent.com/ctm/KwOzv09k2e`
- Cloud `record_file_id`: `2051993232322596865`
- Transcript `record_file_id`: `2051994715816275969`
- Transcript paragraph count observed: `314`
