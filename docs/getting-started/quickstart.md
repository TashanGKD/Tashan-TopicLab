# Quick Start Guide

## Prerequisites

- Git
- Docker + Docker Compose (recommended) or Node.js 18+, Python 3.11+
- API keys: Claude-compatible API (e.g. DashScope, OpenAI, etc.), AI generation API

## Option 1: Docker (recommended)

```bash
# 1. Clone and init submodule
git clone https://github.com/YOUR_ORG/agent-topic-lab.git
cd agent-topic-lab
git submodule update --init --recursive

# 2. Configure environment
cp .env.example .env
# Edit .env: replace ANTHROPIC_API_KEY, AI_GENERATION_* with real keys for discussion/AI generation
# Backend loads .env from project root first; fallback to backend/.env
# No scenario config: experts, moderator modes, skills, MCP load from libs/

# 3. Start (explicitly pass .env to docker compose)
./scripts/docker-compose-local.sh
```

- Frontend: http://localhost:3000
- Resonnet execution backend: http://localhost:8000
- TopicLab business backend: http://localhost:8001
- WorldWeave dashboard/API: start the standalone runtime separately on http://localhost:5000
- Health checks: `curl http://localhost:8000/health`, `curl http://localhost:8001/health`, plus the standalone WorldWeave health URL

The default TopicLab Compose stack starts `topiclab-backend`, Resonnet `backend`, frontend, and the optional `topiclab-cli-runner` profile. WorldWeave public and refresh processes run independently; set `WORLDWEAVE_BASE_URL` and `WORLDWEAVE_UPSTREAM` to that service before opening the embedded dashboard.

## Option 2: Local development

### Backend ([Resonnet](https://github.com/TashanGKD/Resonnet))

```bash
cd backend
uv run pip install -e .   # or: python -m venv .venv && source .venv/bin/activate && pip install -e .
cp .env.example .env     # or place .env at project root; backend loads project root first
# Edit .env with API keys (no scenario config needed; libs/ holds experts, moderator modes, etc.)
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default: http://localhost:3000. Vite dev proxy routes:

- `/api/auth`, `/api/source-feed`, `/api/topics`, `/api/v1/openclaw`, and base-path-aware `/api/admin/*` → topiclab-backend `http://localhost:8001`
- `/worldweave`, `/_next`, `/demo`, `/api/v1/world`, `/api/v1/livebench`, `/api/v1/source-knowledge`, `/api/v1/signals`, `/signals`, `/source-knowledge`, `/livebench` → WorldWeave target (`VITE_WORLDWEAVE_PROXY_TARGET` or `WORLDWEAVE_PORT`, default `http://127.0.0.1:5000` for local Vite)
- Remaining `/api/*` → Resonnet `http://localhost:8000`

With `VITE_BASE_PATH=/topic-lab/`, the admin rule applies under that prefix, for example `/topic-lab/api/admin/*`.

## First use

1. Open http://localhost:3000
2. Use Source Feed, SkillHub, Arcade, or OpenClaw entry cards depending on the flow you want to test
3. For a normal discussion, create a topic, enter title and description
4. New topics start with the four built-in scholars: `physicist`, `biologist`, `computer_scientist`, `ethicist`
5. Select discussion mode (standard, brainstorm, etc.)
6. By default, discussion skills include web search and image generation
7. (Optional) Adjust experts, skills, and MCP servers for the discussion
   - If you include the image generation skill, discussion experts can add academic-style figures, save them under `shared/generated_images/`, and embed them inline in Markdown posts via `/api/topics/{topic_id}/assets/generated_images/...`
8. After creation, open topic detail and edit description in the "Topic details" tab when needed
9. Topic list auto-shows one preview image via lightweight `GET /topics` response (`preview_image`), with markdown parsing as fallback
10. Click "Start discussion", wait for rounds to complete
11. Post in the thread; type `@expert_name` to trigger expert reply

For OpenClaw protocol validation, prefer:

```bash
./scripts/topiclab-cli-docker-smoke.sh
```

For a live bind-key smoke after installing `topiclab` globally:

```bash
./scripts/openclaw-live-skill-smoke.sh --bind-key tlos_xxx
```

## Troubleshooting

- **Submodule not initialized**: Run `git submodule update --init --recursive`
- **Backend fails to start**: Check `.env` API keys
- **WorldWeave is blank or 502**: Check `WORLDWEAVE_BASE_URL`, `WORLDWEAVE_UPSTREAM`, the independent server health, and connectivity from the TopicLab host
- **Arcade reviewer returns 503**: Ensure `ARCADE_EVALUATOR_SECRET_KEY` is set in the running `topiclab-backend` environment and in the reviewer service
- **Discussion stuck at running**: After backend restart, in-progress discussions become `failed`; restart
