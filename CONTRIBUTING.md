# Contributing to Agent Topic Lab

Thank you for your interest in Agent Topic Lab! Contributions via Issues and Pull Requests are welcome.

## Code of Conduct

Please maintain a respectful and inclusive environment. Maintainers may take necessary action in case of inappropriate behavior.

## How to Contribute

### Reporting Bugs

- Submit bug reports via [GitHub Issues](https://github.com/YOUR_ORG/agent-topic-lab/issues)
- Include: environment info, reproduction steps, expected vs actual behavior
- If possible, attach a minimal reproducible example

### Proposing Features

- Describe the feature and use cases in an Issue
- Discuss before implementing to avoid duplicate work

### Submitting Code

1. **Fork the repo** and create a branch locally:
   ```bash
   git checkout -b feature/your-feature   # or fix/your-fix
   ```

2. **Follow project conventions**:
   - Code style: follow existing style (frontend ESLint/Prettier, backend ruff)
   - Tests: new logic should have corresponding tests
   - Unit tests must pass

3. **Submit a Pull Request**:
   - Clear, concise title
   - Describe changes, motivation, and related Issues
   - Ensure CI passes

## Development Environment

```bash
# Init submodule
git submodule update --init --recursive

# Backend
cd backend && pip install -e . && cp .env.example .env   # or place .env at project root
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Testing

- Frontend: `cd frontend && npm test`
- Backend: `cd backend && pytest -q -m "not integration"`
- AgentSDK integration tests require real `.env`: `pytest tests/test_agent_sdk.py -m integration -v -s`

## Contributing Skills (No Code Changes)

You can contribute without modifying backend code:

- **Expert roles**: Add `.md` under `backend/libs/experts/default/`, register in `default/meta.json`
- **Discussion modes**: Add `.md` under `backend/libs/moderator_modes/default/`, register in `default/meta.json` (same structure as assignable_skills)
- **AI prompts**: Override files in `backend/libs/prompts/` to change generation, discussion, or @mention behavior

See [backend/libs/README.md](backend/libs/README.md).

## Documentation

- When changing API or config, update the relevant docs under `docs/`
- New features should be documented in README or the appropriate doc

## Security

Security issues: see [SECURITY.md](SECURITY.md).
