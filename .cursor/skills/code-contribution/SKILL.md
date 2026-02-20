---
name: code-contribution
description: Guides coding agents on how to contribute code to Agent Topic Lab. Use when implementing features, fixing bugs, submitting PRs, or when the user asks about contribution workflow, commit format, or testing requirements.
---

# Code Contribution Guide

When contributing code to Agent Topic Lab, follow this workflow.

## Project Structure

- **Frontend**: `frontend/` — React 18 + TypeScript + Vite
- **Backend**: `backend/` — [Resonnet](https://github.com/TashanGKD/Resonnet) submodule (FastAPI, Python 3.11+)

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**Scopes** (preferred):
- `frontend` — UI, components, pages, API client
- `api` — Backend API routes (in `backend/app/api/`)
- `agent` — Backend agent logic (in `backend/app/agent/`)
- `posts`, `topics`, `experts`, `moderator` — Domain-specific

**Examples**:
```
feat(frontend): add reply button to post thread
fix(api): handle empty body in mention reply
docs(readme): add backend link to Resonnet
test(api): add 404 cases for topic experts
chore: update backend submodule
```

**Rules**:
- Lowercase subject; no period at end
- Breaking changes: `feat(api)!: remove deprecated field`

## Unit Tests

### Frontend

- **Run**: `cd frontend && npm test` (if test script exists)
- **Lint**: `cd frontend && npm run build` (TypeScript + Vite)
- Follow existing component patterns; new logic should have tests when feasible

### Backend (Resonnet)

- **Required**: New or changed logic must have corresponding tests
- **Run before PR**: `cd backend && pytest -q -m "not integration"`
- **CI**: Must pass unit tests
- **Fixtures**: Use `tmp_path` for isolated workspace; `monkeypatch.setenv("WORKSPACE_BASE", ...)`
- **API tests**: See [backend/tests/API_TEST_GUIDE.md](../../backend/tests/API_TEST_GUIDE.md)

**Integration tests** (Agent SDK):
- Mark with `@pytest.mark.integration` and `@pytest.mark.slow`
- Require real `.env`; `ANTHROPIC_API_KEY` must not be `test`
- Run: `cd backend && pytest tests/test_agent_sdk.py -m integration -v -s`
- Full local CI: `cd backend && bash scripts/ci_local.sh`

## Code Style

- **Frontend**: ESLint, Prettier; follow existing style
- **Backend**: `ruff` or `black`; follow Resonnet conventions
- No logic changes when translating comments or error messages

## PR Checklist

Before submitting:

- [ ] Unit tests pass: `cd backend && pytest -q -m "not integration"`
- [ ] Frontend builds: `cd frontend && npm run build`
- [ ] If touching `backend/app/api` or `backend/app/agent`: run integration tests with real `.env`
- [ ] Commit messages follow Conventional Commits
- [ ] Docs updated when API or config changes
- [ ] No sensitive data (API keys, secrets) in code or commits

## File Layout

| Change type | Location | Update |
|-------------|----------|--------|
| Frontend UI | `frontend/src/pages/`, `frontend/src/components/` | Components, pages |
| Frontend API client | `frontend/src/api/client.ts` | Types, axios calls |
| Backend API routes | `backend/app/api/*.py` | + tests in `backend/tests/test_api.py` |
| Backend agent logic | `backend/app/agent/*.py` | + integration tests if Agent SDK |
| Backend config | `backend/app/core/config.py` | + `docs/config.md` |
| Backend schemas | `backend/app/models/schemas.py` | |
| Skills (no code) | `backend/libs/experts/default/` or `backend/libs/moderator_modes/default/` | Add `.md`, register in `default/meta.json` |

## Submodule Notes

- Backend is a git submodule; changes to `backend/` are committed in the submodule repo (Resonnet)
- For agent-topic-lab–specific backend changes: either contribute upstream to Resonnet, or document local patches
- Updating submodule: `cd backend && git pull origin main` then commit the submodule pointer in agent-topic-lab

## CI Pipeline

GitHub Actions: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

- **Diff-based**: Only runs jobs for changed paths (frontend, backend API, backend Agent SDK, Docker)
- **Layer 0**: `detect-changes` — sets `run_frontend`, `run_api`, `run_agent_sdk`, `run_docker`
- **Layer 1**: `frontend-build`, `unit-tests-api`, `unit-tests-agent-sdk`, `docker-build` (parallel)
- **Layer 2**: `integration-tests-agent-sdk` (requires `ANTHROPIC_API_KEY` secret; skipped if not set)

## References

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — Full contribution guide
- [backend/tests/API_TEST_GUIDE.md](../../backend/tests/API_TEST_GUIDE.md) — API test writing
- [Resonnet](https://github.com/TashanGKD/Resonnet) — Backend implementation
