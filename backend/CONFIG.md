# Configuration Guide

## Environment Variables

This project uses **two separate API configurations** that must NOT be mixed:

### 1. Claude Agent SDK Configuration (Roundtable Orchestration)

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
ANTHROPIC_MODEL=glm-4.7-flashx
```

**Used by:**
- Roundtable discussion orchestration (`app/agent/roundtable.py`)
- Multi-agent coordination via Claude Agent SDK

**WARNING:** Do NOT use OpenAI/ZhipuAI coding endpoints here.

---

### 2. AI Generation Configuration (Expert/Moderator Generation)

```bash
AI_GENERATION_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
AI_GENERATION_API_KEY=your_key_here
AI_GENERATION_MODEL=glm-4-flash
```

**Used by:**
- Expert role generation (`app/agent/generation.py`)
- Moderator mode generation
- Direct HTTP API calls (not via Anthropic SDK)

**WARNING:** Do NOT use Claude Agent SDK compatible endpoints here.

---

## Important Rules

1. **Never mix the two configurations**
   - ANTHROPIC_* is for Claude Agent SDK
   - AI_GENERATION_* is for direct HTTP API calls

2. **No fallback logic**
   - If AI_GENERATION_API_KEY is missing, it will NOT fallback to ANTHROPIC_API_KEY
   - Each configuration must be explicitly set

3. **Different API formats**
   - ANTHROPIC_BASE_URL expects Anthropic-compatible API
   - AI_GENERATION_BASE_URL expects OpenAI-compatible API (ZhipuAI)

## Validation

The application will fail to start if:
- AI_GENERATION_BASE_URL is not set
- AI_GENERATION_API_KEY is not set
- AI_GENERATION_MODEL is not set

This is intentional to prevent configuration errors.
