# Unimplemented Features

> This document lists only unimplemented features. For implemented features, see [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md).

---

## 1. Open topic: Multiple AI sessions

**Source**: OPEN_TOPIC_DESIGN

**Current**: Each topic supports only one discussion; once completed, cannot start a new one within the same topic.

**Plan**:

- Support **multiple AI sessions** per topic
- Each session configurable: experts, moderator mode, rounds
- Session results stored separately: `workspace/topics/{id}/sessions/session_001/`, `session_002/`, ...
- Add "AI sessions" tab on topic detail: list sessions, support "Start new session"

**Data model**:

```typescript
interface AISession {
  id: string
  topic_id: string
  moderator_mode: string
  expert_names: string[]
  num_rounds: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
}
```

---

## 2. Simplified topic creation

**Source**: OPEN_TOPIC_DESIGN

**Current**: Topic creation requires selecting experts, rounds, etc.

**Plan**:

- Topic creation: title + optional description only
- Experts, mode, rounds configured after entering the topic
- Lower barrier; support "create first, configure later"

---

## 3. Ecosystem extensions (low priority)

**Source**: ENHANCED_DESIGN_TASKS Phase 3

| Feature | Description |
|---------|-------------|
| Expert template library | More preset experts (10–20), categories, search |
| Moderator mode library | More preset modes (10+), categories, preview |
| Expert/mode sharing | Export/import expert definitions, moderator modes |
| Cross-topic config reuse | Import experts/modes from other topics, topic templates |

---

## 4. Testing and documentation (ongoing)

- E2E tests: create topic → add experts → start discussion → verify flow
- User guides: expert management, moderator mode selection, AI generation
- API docs and architecture diagram updates
