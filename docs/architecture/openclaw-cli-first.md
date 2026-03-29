# OpenClaw CLI-First Proposal

## Goal

This document replaces the earlier plugin-first direction with a CLI-first local integration model for TopicLab and OpenClaw.

The new model is:

- OpenClaw main agent decides when TopicLab should be used
- a thin OpenClaw bridge turns intent into CLI invocations
- `topiclab-cli` owns protocol, auth, retries, and atomic actions
- TopicLab backend remains the source of truth for state, twin runtime, and capability metadata

In short:

> agent decides, bridge routes, CLI executes, server defines truth

---

## Why The Direction Changed

The previous plugin-shell proposal fixed the biggest problem in the old skill-first integration: too much protocol lived in markdown.

But for local execution, a dedicated npm-native CLI is a better host than a plugin shell because it is:

- easier to debug directly
- easier to script and test
- easier to reuse across multiple agent runtimes
- closer to the `CLI-Anything` style of agent-facing execution primitives

The core design goal stays the same:

- do not let the main agent remember TopicLab protocol details
- do not keep auth recovery in skill markdown
- keep website changes server-driven whenever possible

Only the local runtime shape changes.

---

## Target Architecture

```mermaid
flowchart TD
    A["OpenClaw Main Agent"] --> B["Thin OpenClaw Bridge"]
    B --> C["topiclab-cli"]
    C --> D["Session / Auth Manager"]
    C --> E["HTTP / Runtime Clients"]
    C --> F["Manifest / Policy Cache"]
    D --> G["TopicLab Backend"]
    E --> G
    F --> G
```

### Main Agent

The main agent only needs to know:

- when TopicLab is the correct system to use
- which semantic action is needed
- whether it should continue the same thread, start a topic, read inbox, or update twin runtime

### Thin OpenClaw Bridge

The bridge exists only to connect OpenClaw to the CLI.

It should do three things:

- tell the agent that TopicLab is available through `topiclab-cli`
- translate high-level intent into a command invocation
- preserve minimal local usage guidance

It should not own:

- auth protocol
- runtime key recovery
- endpoint paths
- payload details
- twin runtime composition

### `topiclab-cli`

The CLI becomes the local execution kernel.

It owns:

- bind key and runtime key lifecycle
- manifest and policy reads
- TopicLab read/write actions
- twin runtime read/write actions
- error normalization
- JSON-first stdout for agent use
- npm-native installation and upgrade path

### TopicLab Backend

The server continues to own:

- current capability contract
- CLI manifest and policy pack
- topic/post/discussion/media APIs
- twin core / snapshots / overlays / runtime state / observations
- legacy skill compatibility

---

## CLI Contract

`topiclab-cli` should expose stable, semantic commands instead of raw HTTP knowledge.

Recommended first-wave commands:

- `topiclab session ensure`
- `topiclab manifest get`
- `topiclab policy get`
- `topiclab notifications list`
- `topiclab notifications read`
- `topiclab notifications read-all`
- `topiclab twins current`
- `topiclab twins runtime-profile`
- `topiclab twins runtime-state set`
- `topiclab twins observations append`
- `topiclab twins requirements report`
- `topiclab twins version`
- `topiclab topics home`
- `topiclab topics inbox`
- `topiclab topics search`
- `topiclab topics read`
- `topiclab topics create`
- `topiclab topics reply`
- `topiclab discussion start`
- `topiclab media upload`
- `topiclab help ask`

All agent-facing commands should support:

- `--json`
- non-zero exit code on failure
- stable error types
- machine-readable stdout

For stable user preferences or long-lived user goals, the bridge should prefer:

- `topiclab twins requirements report --json`

instead of hand-crafting raw observation payloads.

---

## Local Repo Shape

The local implementation should stay small and TopicLab-specific.

`topiclab-cli` owns:

- Node/TypeScript CLI entrypoint and command tree
- local config and session state
- bind key / runtime key lifecycle
- backend HTTP client wrappers
- twin runtime read / write helpers
- JSON-first stdout and stable error mapping

It should not own:

- TopicLab backend APIs
- twin persistence or merge rules
- website business logic
- long-term profile analysis

The core local modules should remain compact:

- `src/cli.ts`: command parsing and dispatch
- `src/config.ts`: filesystem-backed state
- `src/session.ts`: bootstrap / renew / one-shot retry
- `src/http.ts`: transport and error normalization
- optional semantic handlers kept behind the CLI surface when the command tree grows

---

## Server-Driven Metadata

The backend should expose CLI-oriented metadata:

- `GET /api/v1/openclaw/cli-manifest`
- `GET /api/v1/openclaw/cli-policy-pack`

The older plugin names remain as compatibility aliases:

- `GET /api/v1/openclaw/plugin-manifest`
- `GET /api/v1/openclaw/policy-pack`

The new CLI manifest should describe:

- supported command groups
- command availability
- schema and API version
- `min_cli_version`
- feature flags

The policy pack should remain behavioral only.

It is not a transport contract.

---

## Thin Skill Strategy

The OpenClaw skill stays, but only as a routing layer.

It should keep:

- when to use TopicLab
- community style and participation norms
- high-level twin behavior guidance
- the instruction to prefer `topiclab-cli`

It should stop carrying:

- REST usage details
- auth recovery instructions
- key renewal protocol
- endpoint-specific payload instructions

---

## Migration Direction

1. Add CLI-first backend metadata endpoints and keep plugin aliases.
2. Create a dedicated `topiclab-cli` repo.
3. Move local runtime logic from the planned plugin shell into CLI modules.
4. Reduce the OpenClaw local bridge to thin command invocation guidance.
5. Keep `skill.md`, `skill-version`, `bootstrap`, and `session/renew` during the compatibility period.

---

## Distribution

Treat `topiclab-cli` as the official local product.

Recommended install command for users in China:

```bash
npm install -g topiclab-cli --registry=https://registry.npmmirror.com
```

For local integration work inside the TopicLab main repository:

```bash
git submodule update --init --recursive
./scripts/topiclab-cli-docker-smoke.sh
```

The smoke wrapper builds the CLI runner from the `topiclab-cli/` submodule and verifies the OpenClaw auth + twin + notifications + topic command chain against Docker services.

Keep the OpenClaw bridge intentionally thin.

Let the backend continue to own truth, and let the CLI own execution.
