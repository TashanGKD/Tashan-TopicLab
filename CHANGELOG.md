# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-03-12

### Added

**Frontend**

- Auth entry pages and state-aware nav: `/login`, `/register`, and token-based user menu/logout
- Profile Helper sub-routes and scale flows: `/profile-helper/*`, `/profile-helper/scales`, `/profile-helper/scales/:scaleId`
- Digital twin import to topic experts, including masked import path for private twins
- Responsive inline discussion images in Markdown posts, including large image fit for narrow screens and topic asset URL support

**TopicLab Account Service**

- New standalone `topiclab-backend` service with auth APIs: `POST /auth/send-code`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- Digital twin persistence APIs: `POST /auth/digital-twins/upsert`, `GET /auth/digital-twins`, `GET /auth/digital-twins/{agent_name}`

### Changed

- Nginx split proxy path: `/topic-lab/api/auth/*` routes to `topiclab-backend`, other `/topic-lab/api/*` routes continue to Resonnet
- Profile Helper API client now attaches auth headers for authenticated routes
- Docs in `docs/` are aligned to English-only content, including lifecycle and deploy/config updates
- Discussion agent guidance now explains when image generation is appropriate, the academic visual style, the `shared/generated_images/` output directory, and the `/api/topics/{topic_id}/assets/generated_images/...` Markdown embedding format
- Discussion moderator guidance now treats images as a required deliverable when the topic explicitly asks for a diagram, figure, or architecture chart
- For explicit "generate a figure/diagram" topics, moderator guidance now requires assigning image generation in round 1 and producing a first visual draft in round 1
- Discussion source citations now enforce verifiable external `https://` URLs; non-verifiable pseudo-links (e.g. `/api/2026-*`) are filtered from turn files with a guardrail marker
- New topics now initialize with only the four built-in scholar roles, and default discussion skills are web search plus image generation
- The old "Image & Video Generation" assignable skill is renamed to "Image Generation" to match actual capability

## [1.3.0] - 2026-03-07

### Added

**Backend (Resonnet)**

- Agent Links: `GET /agent-links`, `GET /agent-links/{slug}`, `POST /agent-links/import/preview`, `POST /agent-links/import`, `POST /agent-links/{slug}/session`, `POST /agent-links/{slug}/chat` (SSE), `POST /agent-links/{slug}/files/upload`
- Profile Helper: `GET /profile-helper/session`, `POST /profile-helper/chat` (SSE), `GET /profile-helper/profile/{session_id}`, `GET /profile-helper/download/{session_id}`, `POST /profile-helper/session/reset/{session_id}`
- Experts import: `POST /experts/import-profile` — import forum profile into global expert library (topiclab_shared)

**Frontend**

- Agent Link library page `/agent-links`: blueprint list, import, session creation, SSE chat stream, workspace file upload
- Agent Link chat page `/agent-links/:slug`: streaming chat, session binding
- Research Digital Persona (Profile Helper) page `/profile-helper`: standalone route, session, streaming chat, profile download

**Docs**

- README, CHANGELOG, api-reference: sync API overview (Agent Links, Profile Helper, Skills, Libs, Experts import-profile)

## [1.2.0] - 2026-03-01

### Added

**Backend (Resonnet 0.3.0)**

- Expert share to platform: `POST /topics/{id}/experts/{name}/share` — share topic expert to `libs/experts/topiclab_shared/`
- Moderator mode share to platform: `POST /topics/{id}/moderator-mode/share` — share custom mode to `libs/moderator_modes/topiclab_shared/`
- Topic-level moderator config: `skill_list`, `mcp_server_ids`, `model` persisted per topic
- Discussion params: `skill_list`, `mcp_server_ids`, `allowed_tools` in start-discussion request

**Frontend**

- Expert card portal menu: edit/share actions on expert cards; "Share" shares to platform library
- Moderator mode share: "Share to moderator mode library" dialog in TopicConfigTabs/ModeratorModeConfig; `mode_id`, `name`, `description` input
- AI discussion tab UX: rename to "AI Discussion"; shortcut button; expanded description; hide when started; nudge animation
- `topicExpertsApi.share()`, `moderatorModesApi.share()`; refetch experts list after share

**Docs**

- `docs/share-flow-sequence.md` — expert share and moderator mode share sequence diagrams
- `docs/deploy.md` — `.env.deploy.example`, nginx config, deploy workflow

### Fixed

- **Backend**: Expert share no longer returns 500 when `topiclab_shared/meta.json` does not exist (first share)
- TopNav mobile width and overflow on small viewports
- UI validation messages and input constraints

### Changed

- ExpertList/ExpertSelector: `onShare` callback; refetch after share
- ExpertGrid: show share action for non-preset experts (`source !== 'preset'`)

## [1.1.0] - 2026-02-21

### Added

**Backend (Resonnet)**

- Libs meta TTL cache with `LIBS_CACHE_TTL_SECONDS`; cache stampede protection
- `POST /libs/invalidate-cache` for hot-reload
- Search param `q` on skills/mcp/moderator-modes list endpoints
- `GET /experts/{name}/content`; `GET /experts?fields=minimal` for faster list

**Frontend**

- Mobile responsiveness: TopNav hamburger menu on small screens; responsive padding (`px-4 sm:px-6`); `viewport-fit=cover` and `safe-area-inset-*` for notched devices; TopicDetail mobile TOC; TabPanel horizontal scroll; touch target optimization (44px for reply buttons)
- `MobileSourceCategoryToc`: two-level mobile directory (source → category); source row selects, category row navigates; scroll fade hint; labels "Source" / "Category" for hierarchy
- Library grids (Expert, Skill, MCP, ModeratorMode): single-column layout on mobile; full-width cards; selected chips panel `max-h-28` with overflow scroll in embed mode; compact chip bubbles on mobile
- TopicDetail/TopicList: title and status badge on same line on all breakpoints
- TopicList: hide body paragraph when topic has no body content
- TOC alignment fix: `self-start` and `items-start` to prevent sidebar stretch; `min-w-0 overflow-x-hidden` to avoid overlap
- `libsApi.invalidateCache()`; "Refresh library" button on SkillLibrary
- `expertsApi.list(params?)`, `expertsApi.getContent(name)`; `q` param on list APIs
- ExpertList, ExpertSelector: fetch content on demand when opening detail

**Docs**

- `docs/LIBS_API_TESTS_AND_FRONTEND.md` — test coverage, frontend API usage
- `docs/LIBS_SEARCH_PERFORMANCE_AND_API_UNIFICATION.md` — performance & API unification

### Changed

- Backend README: API overview, env vars (`LIBS_CACHE_TTL_SECONDS`)
- ExpertList/ExpertSelector: no longer rely on list's skill_content; use getContent on open
- TopicList: show discussion mode and creation date
- Topic config (skills, MCP, model): persist across page reloads

## [1.0.0] - 2026-02-20

Public release.

### Added

- **Docs for open source**: Technical report in `docs/TECHNICAL_REPORT.md`; open-source README with project overview, quick start, doc index
- **Tashan logo** and explicit backend link to [Resonnet](https://github.com/TashanGKD/Resonnet)
- **English docs**: `README.en.md`, `docs/*`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`
- **Docs cleanup**: Removed obsolete design docs; merged unimplemented plans into `docs/FUTURE_PLAN.md`
- **Code contribution skill**: `.cursor/skills/code-contribution/SKILL.md` (commit convention, testing, file layout)
- **CI workflow**: `.github/workflows/ci.yml` — diff-based jobs (frontend build, backend unit/integration, Docker build), pipeline layers
