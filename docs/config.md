# Configuration

## Environment Variables

Config file: `backend/.env` (copy from `backend/.env.example` and edit).

### 1. Claude Agent SDK (Discussion orchestration, expert reply)

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://dashscope.aliyuncs.com/apps/anthropic   # optional, DashScope etc.
ANTHROPIC_MODEL=qwen-flash   # optional
```

Used for:
- Multi-round discussion (`run_discussion`)
- @expert reply (`run_expert_reply`)

### 2. AI Generation (Expert/Moderator generation)

```bash
AI_GENERATION_API_KEY=your_key_here
AI_GENERATION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_GENERATION_MODEL=qwen-flash
```

Used for:
- AI-generated expert role
- AI-generated moderator mode

**Note**: Both configs are strictly separate; do not mix them.

### 3. Scenario preset (optional, default topic-lab)

```bash
SCENARIO_PRESET=topic-lab
```

This frontend depends on the `topic-lab` scenario (experts, moderator modes, prompts). If unset, Resonnet defaults to `topic-lab`.

### 4. Workspace (optional)

```bash
WORKSPACE_BASE=./workspace
```

Topic workspace root directory.

### 5. MCP 库 (只读)

MCP 服务器在 `backend/skills/mcps/` 中配置，与技能库结构一致。MCP 库页面 `/mcp` 只读展示，话题讨论时可选择启用的 MCP。仅接受 npm、uvx、remote。参见 [backend/docs/mcp-config.md](backend/docs/mcp-config.md)。

## Rules

1. **Do not mix the two API configs**: `ANTHROPIC_*` for Claude Agent SDK, `AI_GENERATION_*` for OpenAI-compatible API
2. **No fallback**: Missing `AI_GENERATION_API_KEY` does not fall back to `ANTHROPIC_API_KEY`
3. **Different API formats**: `ANTHROPIC_BASE_URL` expects Anthropic-compatible API; `AI_GENERATION_BASE_URL` expects OpenAI-compatible API

## Validation

The app will refuse to start if required variables are unset.

## More

Full Resonnet configuration: [backend/docs/config.md](backend/docs/config.md). **Backend source**: [Resonnet](https://github.com/TashanGKD/Resonnet)
