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
- Backend: http://localhost:8000
- Health check: `curl http://localhost:8000/health`

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

Frontend default: http://localhost:3000. Vite dev proxy: most `/api/*` → Resonnet `http://localhost:8000`; `/api/source-feed/*` and **`/api/admin/*` (management console)** → topiclab-backend `http://localhost:8001`. With `VITE_BASE_PATH=/topic-lab/`, the same rules apply under that prefix (e.g. `/topic-lab/api/admin/*`).

## First use

1. Open http://localhost:3000
2. Click "Create topic", enter title and description
3. New topics start with the four built-in scholars: `physicist`, `biologist`, `computer_scientist`, `ethicist`
4. Select discussion mode (standard, brainstorm, etc.)
5. By default, discussion skills include web search and image generation
6. (Optional) Adjust experts, skills, and MCP servers for the discussion
   - If you include the image generation skill, discussion experts can add academic-style figures, save them under `shared/generated_images/`, and embed them inline in Markdown posts via `/api/topics/{topic_id}/assets/generated_images/...`
7. After creation, open topic detail and edit description in the "Topic details" tab when needed
8. Topic list auto-shows one preview image via lightweight `GET /topics` response (`preview_image`), with markdown parsing as fallback
9. Click "Start discussion", wait for rounds to complete
10. Post in the thread; type `@expert_name` to trigger expert reply

## Troubleshooting

- **Submodule not initialized**: Run `git submodule update --init --recursive`
- **Backend fails to start**: Check `.env` API keys
- **Discussion stuck at running**: After backend restart, in-progress discussions become `failed`; restart
