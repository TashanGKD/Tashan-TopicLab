# Configuration

## Environment Variables

Config file: `.env` at project root (or `backend/.env`). The backend loads project root `./.env` first when backend is a submodule. Copy from `.env.example` or `backend/.env.example` and edit.

### 1. Claude Agent SDK (Discussion orchestration, expert reply)

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://dashscope.aliyuncs.com/apps/anthropic   # optional, DashScope etc.
ANTHROPIC_MODEL=qwen-flash   # optional
```

Used for:
- Multi-round discussion (`run_discussion`)
- @expert reply (`run_expert_reply`)

### 2. AI Generation (Expert/Moderator generation & Source-feed topic body)

```bash
AI_GENERATION_API_KEY=your_key_here
AI_GENERATION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_GENERATION_MODEL=qwen-flash
```

Used for:
- AI-generated expert role
- AI-generated moderator mode
- **Source-feed topic body generation** (async background task): when a topic is created from a source article, the system immediately returns with a fallback placeholder body and starts a background task that reads the full article text (`content_md`) via `AI_GENERATION_MODEL` to generate a structured discussion guide (context / core issue / why it matters / suggested discussion questions) which is written back to the topic once complete
- **Source-feed topic role generation** (async background task): when a topic is created from a source article, the system uses `AI_GENERATION_MODEL` with 4 **concurrent** requests (one per dimension: 技术/产业/研究/治理) to generate 4 discussion roles tailored to the topic. Roles are written to the executor workspace and topic DB once complete. If env is not set, the topic remains with empty experts (user may add manually).

If `AI_GENERATION_API_KEY` / `AI_GENERATION_BASE_URL` / `AI_GENERATION_MODEL` are not set, the source-feed topic body silently falls back to the template-generated placeholder. Role generation is skipped and the topic starts with no experts. All other features continue to work normally.

**Note**: Both configs are strictly separate; do not mix them.

### 3. Libraries

All libraries (experts, moderator_modes, mcps, assignable_skills, prompts) are loaded from `backend/libs/`. No scenario preset.

**Docker**: When `LIBS_PATH` points to a custom empty directory (e.g. for persistence), the backend merges from both built-in and the mount. See [backend/docs/config.md](backend/docs/config.md) for details.

### 4. Workspace (optional)

```bash
WORKSPACE_BASE=./workspace
```

Topic workspace root directory.

### 5. Account and Authentication Modes (Profile Helper)

```bash
# Resonnet auth mode: none | jwt | proxy
AUTH_MODE=none
# Enforce authentication (default: false)
AUTH_REQUIRED=false
# Account service base URL used in jwt mode
AUTH_SERVICE_BASE_URL=http://topiclab-backend:8000
# Sync published twins to account DB digital_twins
ACCOUNT_SYNC_ENABLED=false
```

- **AUTH_MODE=none**: default anonymous mode for OSS trial and MVP usage.
- **AUTH_MODE=jwt**: validates `Authorization: Bearer` via the external account service.
- **AUTH_MODE=proxy**: trusts upstream identity headers such as `X-User-Id` (optional `X-Tenant-Id`, `X-User-Scopes`).
- **AUTH_REQUIRED**: in `jwt` mode, return 401 when token is missing.
- **AUTH_SERVICE_BASE_URL**: account service URL for token introspection in `jwt` mode.
- **ACCOUNT_SYNC_ENABLED**: after publish, call `/auth/digital-twins/upsert`; when disabled, the main flow does not depend on account storage.

The account service can run independently. Resonnet core flows still work in `AUTH_MODE=none` without hard dependency on account storage.

### 6. Research Digital Persona Helper (Profile Helper Agent)

```bash
# Max internal tool/thinking iterations per request (default 40, minimum 5)
PROFILE_HELPER_MAX_TOOL_ITERATIONS=40
```

- **PROFILE_HELPER_MAX_TOOL_ITERATIONS**: limits internal agent loop rounds in Profile Helper. Higher values reduce "maximum tool calls reached" failures, but increase latency and token usage. Recommended range: 20-60.

### 7. MCP Library (read-only)

MCP servers are configured in `backend/libs/mcps/`, using the same structure as skills. The `/mcp` page is read-only and used for selecting MCPs during topic discussion. Supported types: `npm`, `uvx`, `remote`. See [backend/docs/mcp-config.md](backend/docs/mcp-config.md).

### 8. Source Feed Cache (optional)

```bash
# Short-lived list cache for GET /source-feed/articles (seconds, default 30)
SOURCE_FEED_LIST_CACHE_TTL_SECONDS=30
```

- `SOURCE_FEED_LIST_CACHE_TTL_SECONDS`: controls in-process short TTL cache for source-feed list pages (`limit + offset` key).  
- Set to `0` to disable cache.

### 9. Literature (Academic) Tab (Backend Proxy)

The "Academic" sub-tab under the Source Feed page uses the same upstream as the "Media" sub-tab: **topiclab-backend** proxies to **IC (INFORMATION_COLLECTION_BASE_URL)** at `GET /api/v1/literature/recent`.

- Use the same `INFORMATION_COLLECTION_BASE_URL` as the source feed (e.g. `http://ic.nexus.tashan.ac.cn`); no separate frontend direct connection is needed.
- If the IC literature API requires the `x-ingest-token` header, configure it in the **topiclab-backend** environment:
  ```bash
  LITERATURE_SHARED_TOKEN=your_token
  ```
  If unset, the proxy sends no header; if IC enforces the token, the request may return 401.

### 10. AMiner Open Platform Proxy (Free-Tier API)

**topiclab-backend** proxies seven free-tier AMiner Open Platform endpoints. User requests are forwarded to `datacenter.aminer.cn` with the API key on the backend; the frontend does not call AMiner directly.

- **Environment variable** (required; otherwise the proxy returns 503):
  ```bash
  AMINER_API_KEY=   # Obtain from open.aminer.cn console
  ```
- **Route prefix**: `/aminer`, `/api/v1/aminer`
- **Endpoints**: Paper search (GET), Scholar search (POST), Patent search (POST), Organization search (POST), Venue search (POST), Paper info (POST), Patent info (GET). See [aminer-open-api-limits.md](../api/aminer-open-api-limits.md).

## Rules

1. **Do not mix the two API configs**: `ANTHROPIC_*` for Claude Agent SDK, `AI_GENERATION_*` for OpenAI-compatible API
2. **No fallback**: Missing `AI_GENERATION_API_KEY` does not fall back to `ANTHROPIC_API_KEY`
3. **Different API formats**: `ANTHROPIC_BASE_URL` expects Anthropic-compatible API; `AI_GENERATION_BASE_URL` expects OpenAI-compatible API

## Validation

The app will refuse to start if required variables are unset.

## More

Full Resonnet configuration: [backend/docs/config.md](backend/docs/config.md). **Backend source**: [Resonnet](https://github.com/TashanGKD/Resonnet)
