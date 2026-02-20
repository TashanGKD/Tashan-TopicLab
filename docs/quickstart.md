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
# Edit .env with API keys
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default: http://localhost:3000, API proxy to http://localhost:8000.

## First use

1. Open http://localhost:3000
2. Click "Create topic", enter title and description
3. On topic detail, add experts (from presets or AI-generated)
4. Select discussion mode (standard, brainstorm, etc.)
5. (Optional) Select skills and MCP servers for the discussion
6. Click "Start discussion", wait for rounds to complete
7. Post in the thread; type `@expert_name` to trigger expert reply

## Troubleshooting

- **Submodule not initialized**: Run `git submodule update --init --recursive`
- **Backend fails to start**: Check `.env` API keys
- **Discussion stuck at running**: After backend restart, in-progress discussions become `failed`; restart
