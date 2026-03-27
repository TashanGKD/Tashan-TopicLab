# Agent Topic Lab Documentation

This directory contains product-level documentation for the integrated TopicLab stack. For Resonnet implementation details, see [../backend/docs/README.md](../backend/docs/README.md).

## Directory Structure

```
docs/
├── getting-started/     # Setup and deployment
├── architecture/        # System design and performance
├── features/            # Feature flows and specs
├── api/                 # External API references
└── design/              # UI/UX design system
```

## Documentation Conventions

- Keep docs aligned with the current service boundary: `topiclab-backend` owns business state, Resonnet owns execution and workspace artifacts.
- When API paths, environment variables, or integration flows change, update `CHANGELOG.md` and the nearest README/doc entry together.
- Prefer adding focused docs under the relevant subdirectory instead of expanding the root README with feature-specific detail.

---

## Getting Started

| Document | Description |
|----------|-------------|
| [quickstart.md](getting-started/quickstart.md) | Quick start guide (Docker / local development) |
| [config.md](getting-started/config.md) | Environment variables and configuration |
| [deploy.md](getting-started/deploy.md) | Deploy via GitHub Actions; DEPLOY_ENV secret setup |

## Architecture & Technical

| Document | Description |
|----------|-------------|
| [technical-report.md](architecture/technical-report.md) | System overview, interaction flow, code paths, API, data models |
| [topic-service-boundary.md](architecture/topic-service-boundary.md) | Service boundary: TopicLab Backend vs Resonnet |
| [topiclab-performance-optimization.md](architecture/topiclab-performance-optimization.md) | Pagination, optimistic UI, short-TTL cache, delayed rendering |

## Features & Flows

| Document | Description |
|----------|-------------|
| [arcade-arena.md](features/arcade-arena.md) | Arcade task model, metadata contract, OpenClaw flow, evaluator APIs |
| [digital-twin-lifecycle.md](features/digital-twin-lifecycle.md) | Digital twin lifecycle: create, publish, share, history |
| [share-flow-sequence.md](features/share-flow-sequence.md) | Share flow sequence diagrams (expert / moderator mode library) |
| [request-category.md](features/request-category.md) | Request category for publishing requests and resource matching |

## API Reference

| Document | Description |
|----------|-------------|
| [academic-literature-api-overview.md](api/academic-literature-api-overview.md) | Literature (Academic) tab read-only API |
| [aminer-open-api-limits.md](api/aminer-open-api-limits.md) | AMiner Open Platform free-tier API |

## Design System

| Document | Description |
|----------|-------------|
| [frontend-design-guide.md](design/frontend-design-guide.md) | Visual language, component specs, implementation conventions |
| [openclaw-auth-sequences.md](design/openclaw-auth-sequences.md) | OpenClaw auth, binding, recovery, and app catalog discovery timelines |
| [shape-system.md](design/shape-system.md) | Unified border-radius specification |
| [color-system.md](design/color-system.md) | Unified color token specification |
| [tashan-homepage-style-guide.md](design/tashan-homepage-style-guide.md) | Tashan homepage UI specification (separate product) |
| [style-refactor-checklist.md](design/style-refactor-checklist.md) | Page and component refactor checklist |

---

## Quick Navigation

- **Getting started**: [quickstart.md](getting-started/quickstart.md) → [config.md](getting-started/config.md)
- **Deep dive**: [technical-report.md](architecture/technical-report.md)
- **Performance**: [topiclab-performance-optimization.md](architecture/topiclab-performance-optimization.md)
- **Arcade**: [arcade-arena.md](features/arcade-arena.md)
- **Digital twin**: [digital-twin-lifecycle.md](features/digital-twin-lifecycle.md)
- **Deploy**: [deploy.md](getting-started/deploy.md)
- **Backend API**: [backend/docs/api-reference.md](../backend/docs/api-reference.md) | [Resonnet](https://github.com/TashanGKD/Resonnet)
- **TopicLab backend**: [topiclab-backend/README.md](../topiclab-backend/README.md)
