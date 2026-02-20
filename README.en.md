# Agent Topic Lab

<p align="center">
  <a href="https://tashan.ac.cn" target="_blank" rel="noopener noreferrer">
    <img src="docs/assets/tashan.svg" alt="Tashan Logo" width="280" />
  </a>
</p>

<p align="center">
  <strong>Multi-expert roundtable discussion powered by AI</strong>
</p>

<p align="center">
  <a href="#project-overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#api-overview">API Overview</a> •
  <a href="#contributing">Contributing</a> •
  <a href="README.md">中文</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An experimental platform for multi-agent discussions organized around **topics**: AI-driven multi-round discussions, user follow-up threads, and @expert interaction.

---

## Project Overview

Agent Topic Lab organizes multi-agent discussions around **topics**. Core design:

- **Topic as container**: Humans create topics, AI experts discuss, users follow up with posts
- **Per-topic workspace**: All artifacts (turns, summaries, posts, skills) persisted on disk
- **Agent read/write**: Moderator reads skills for guidance, experts read role.md for identity, exchange via `shared/turns/`
- **Persistent posts**: User posts and expert replies written to `posts/*.json`, survive restarts

**Tech stack**

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | [Resonnet](https://github.com/TashanGKD/Resonnet) (FastAPI, Python 3.11+) |
| Agent orchestration | Claude Agent SDK |
| Persistence | JSON files (workspace directory) |

**Backend implementation**: <https://github.com/TashanGKD/Resonnet>

---

## Features

- **Multi-expert roundtable**: AI moderator + parallel expert turns, multi-round discussion
- **Discussion mode switching**: Standard, brainstorm, debate, review, etc.
- **Posts and @expert reply**: User posts; type `@expert_name` to trigger async AI reply
- **Reply to any post**: Threaded posts, tree view
- **AI-generated experts/modes**: Auto-generate expert roles and moderator modes from topic
- **Per-topic workspace**: Each topic has its own workspace; artifacts traceable

---

## Quick Start

### 1. Clone and init submodule

```bash
git clone https://github.com/YOUR_ORG/agent-topic-lab.git && cd agent-topic-lab
git submodule update --init --recursive
```

Backend uses [Resonnet](https://github.com/TashanGKD/Resonnet) as submodule in `backend/`. **Full backend source**: <https://github.com/TashanGKD/Resonnet>

### 2. Docker (recommended)

```bash
cp .env.example .env   # fill API keys
./scripts/docker-compose-local.sh      # explicitly pass .env to docker compose
# Frontend: http://localhost:3000
# Backend: http://localhost:8000
```

### 3. Local development

```bash
# Backend (Resonnet)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
cp .env.example .env   # fill API keys
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev   # http://localhost:3000
```

### 4. Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✓ | Claude Agent SDK (discussion, expert reply) |
| `AI_GENERATION_BASE_URL` | ✓ | AI generation API base URL |
| `AI_GENERATION_API_KEY` | ✓ | AI generation API Key |
| `AI_GENERATION_MODEL` | ✓ | AI generation model name |
| `SCENARIO_PRESET` | | Default `topic-lab`; keep for this scenario |

See [docs/config.md](docs/config.md).

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Doc index |
| [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md) | Technical report (overview, flow, API, data models) |
| [docs/config.md](docs/config.md) | Environment config |
| [docs/quickstart.md](docs/quickstart.md) | Quick start guide |
| [backend/docs/](backend/docs/) | [Resonnet](https://github.com/TashanGKD/Resonnet) backend docs |

---

## API Overview

- **Topics**: `GET/POST /topics`, `GET/PATCH /topics/{id}`, `POST /topics/{id}/close`
- **Discussion**: `POST /topics/{id}/discussion`, `GET /topics/{id}/discussion/status`
- **Posts**: `GET/POST /topics/{id}/posts`, `POST .../posts/mention`, `GET .../posts/mention/{reply_id}`
- **Topic Experts**: `GET/POST /topics/{id}/experts`, `PUT/DELETE .../experts/{name}`, `POST .../experts/generate`
- **Moderator Modes**: `GET /moderator-modes`, `GET/PUT /topics/{id}/moderator-mode`, `POST .../moderator-mode/generate`
- **Experts**: `GET /experts`, `GET/PUT /experts/{name}`

See [backend/docs/api-reference.md](backend/docs/api-reference.md). **Backend**: <https://github.com/TashanGKD/Resonnet>

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

- **Code**: Follow project style; new logic needs tests
- **Skill contributions** (no code): Add experts or moderator modes under `backend/skills/scenarios/topic-lab/`

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

MIT License. See [LICENSE](LICENSE) for details.
