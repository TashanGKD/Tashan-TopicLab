# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-21

### Added

**Backend (Resonnet)**

- Libs meta TTL cache with `LIBS_CACHE_TTL_SECONDS`; cache stampede protection
- `POST /libs/invalidate-cache` for hot-reload
- Search param `q` on skills/mcp/moderator-modes list endpoints
- `GET /experts/{name}/content`; `GET /experts?fields=minimal` for faster list

**Frontend**

- Mobile responsiveness: TopNav hamburger menu on small screens; responsive padding (`px-4 sm:px-6`); `viewport-fit=cover` and `safe-area-inset-*` for notched devices; TopicDetail mobile TOC; TabPanel horizontal scroll; touch target optimization (44px for reply buttons)
- `MobileSourceCategoryToc`: two-level mobile directory (source → category); source row selects, category row navigates; scroll fade hint; labels "来源" / "分类" for hierarchy
- Library grids (Expert, Skill, MCP, ModeratorMode): single-column layout on mobile; full-width cards; selected chips panel `max-h-28` with overflow scroll in embed mode; compact chip bubbles on mobile
- TopicDetail/TopicList: title and status badge on same line on all breakpoints
- TopicList: hide body paragraph when topic has no body content
- TOC alignment fix: `self-start` and `items-start` to prevent sidebar stretch; `min-w-0 overflow-x-hidden` to avoid overlap
- `libsApi.invalidateCache()`; 「刷新库」button on SkillLibrary
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
