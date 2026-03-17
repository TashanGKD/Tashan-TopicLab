# Tashan-TopicLab 完整技术架构文档

> 基于 2026-03-17 代码实际阅读，严格按代码现状梳理，可凭此文档复现整个项目。

---

## 一、项目概览

**Tashan-TopicLab**（代码内部名：**Resonnet**）是一个多智能体圆桌讨论平台，支持：

1. **自动化圆桌讨论**：用户发布话题，系统调度多个 AI 专家 Agent 轮流发言，生成结构化讨论记录。
2. **专家 @提及**：用户在话题评论区 @某个专家，触发单次 AI 专家回复。
3. **档案助手（Profile Helper）**：基于 Agent Link 的科研数字分身采集工具。
4. **资料库管理**：管理专家库、主持风格库、可分配技能库、MCP 服务器库。

---

## 二、系统整体架构

```
                    ┌─────────────────────────────────────────────┐
                    │            Nginx 反向代理 (80 端口)           │
                    │   /         →  frontend:80                   │
                    │   /api/     →  frontend:80/api/              │
                    └──────────────────┬──────────────────────────┘
                                       │
              ┌────────────────────────┴────────────────────────┐
              │                                                  │
   ┌──────────▼──────────┐                       ┌─────────────▼──────────────┐
   │   frontend          │                       │   topiclab-backend          │
   │   React + Vite      │                       │   FastAPI (Python 3.11)     │
   │   nginx:alpine      │                       │   Port 8001                 │
   │   Port 80           │                       │   用户认证、信源、收藏、      │
   └─────────────────────┘                       │   文献、互动、数字分身同步    │
                                                 └─────────────────────────────┘
                                                           ↑
              ┌────────────────────────────────────────────┘
              │   AUTH_SERVICE_BASE_URL=http://topiclab-backend:8000
              │
   ┌──────────▼──────────────────────────────────────────────┐
   │   backend (Resonnet)                                     │
   │   FastAPI (Python 3.11)                                  │
   │   Port 8000                                              │
   │                                                          │
   │   topics | discussion | posts | experts | moderator      │
   │   profile-helper | agent-links | skills | mcp | libs     │
   └───────────────────────────────┬──────────────────────────┘
                                   │
              ┌────────────────────┼──────────────────────────┐
              │                    │                           │
   ┌──────────▼──────┐   ┌────────▼────────┐   ┌─────────────▼────────────┐
   │  Database       │   │  Workspace (FS) │   │  AI 服务                  │
   │  SQLite /       │   │  ./workspace/   │   │  ANTHROPIC_* (讨论 SDK)   │
   │  PostgreSQL     │   │  (Volume 挂载)  │   │  AI_GENERATION_* (生成)   │
   └─────────────────┘   └─────────────────┘   └──────────────────────────┘
```

---

## 三、仓库目录结构

```
Tashan-TopicLab/                    ← 主仓库（宿主）
├── .env / .env.example             ← 统一环境变量（前后端共用）
├── .env.deploy.example             ← 生产部署环境变量模板
├── .gitmodules                     ← 子模块配置
├── docker-compose.yml              ← 3个服务编排
├── AGENTS.md                       ← AI 规范文档
├── .github/workflows/
│   ├── ci.yml                      ← CI 检查
│   ├── deploy.yml                  ← main 分支自动部署（SSH → docker compose）
│   └── deploy-branch.yml           ← 分支手动部署
│
├── backend/                        ← Git 子模块 (Resonnet 仓库)
│   ├── main.py                     ← FastAPI 应用入口
│   ├── Dockerfile                  ← python:3.11-slim 基础镜像
│   ├── alembic.ini                 ← 数据库迁移配置
│   ├── migrations/                 ← Alembic 迁移脚本
│   ├── libs/                       ← 资料库（Volume 挂载，运行时可扩展）
│   │   ├── experts/                ← 专家技能库
│   │   │   ├── meta.json           ← sources 注册表
│   │   │   └── default/            ← 内置专家目录
│   │   │       ├── meta.json       ← 专家列表（categories + experts）
│   │   │       ├── expert_common.md
│   │   │       └── {expert}.md     ← 专家技能文件
│   │   ├── moderator_modes/        ← 主持风格库
│   │   │   ├── meta.json
│   │   │   └── default/
│   │   │       ├── meta.json
│   │   │       ├── moderator_common.md
│   │   │       └── {mode}.md
│   │   ├── assignable_skills/      ← 可分配技能库
│   │   │   ├── meta.json
│   │   │   ├── default/            ← 内置技能（如 image_generation）
│   │   │   └── _submodules/        ← Git 子模块导入的外部技能集
│   │   ├── mcps/                   ← MCP 服务器配置库
│   │   │   ├── meta.json
│   │   │   └── default/meta.json
│   │   └── agent_links/            ← Agent Link 蓝图目录
│   │       └── {slug}/
│   │           └── agent.json
│   │
│   ├── workspace/                  ← 运行时数据（Volume 挂载）
│   │   ├── topics/
│   │   │   └── {topic_id}/         ← 每个话题的沙盒工作区
│   │   │       ├── shared/
│   │   │       │   ├── topic.md
│   │   │       │   ├── turns/
│   │   │       │   │   └── round{N}_{expert}.md
│   │   │       │   ├── discussion_summary.md
│   │   │       │   └── generated_images/
│   │   │       ├── agents/
│   │   │       │   └── {expert}/
│   │   │       │       └── role.md
│   │   │       ├── config/
│   │   │       │   ├── moderator_mode.json
│   │   │       │   ├── moderator_skill.md
│   │   │       │   ├── experts_metadata.json
│   │   │       │   ├── workspace.json
│   │   │       │   ├── skills/
│   │   │       │   │   └── {skill}.md
│   │   │       │   └── mcp.json
│   │   │       └── .claude/
│   │   │           └── skills/     ← Claude SDK 自动发现目录
│   │   └── users/
│   │       └── {user_id}/
│   │           └── profile/        ← Profile Helper 用户档案
│   │
│   └── app/
│       ├── __init__.py
│       ├── api/                    ← API 层（路由 + 入参出参）
│       ├── agent/                  ← 智能体层（AI调度逻辑）
│       ├── auth/                   ← 认证层
│       ├── core/                   ← 配置 + 元数据
│       ├── db/                     ← 数据库 ORM + 会话
│       ├── models/                 ← Pydantic Schema + Store
│       ├── services/               ← 业务服务层
│       ├── integrations/           ← 外部系统集成
│       └── prompts/                ← 内置 Prompt 模板
│
├── frontend/                       ← 前端（React + Vite）
│   ├── Dockerfile                  ← 二阶段构建：node:20-slim + nginx:alpine
│   ├── package.json
│   ├── vite.config.ts
│   ├── nginx.conf / nginx.root.conf
│   └── src/
│       ├── App.tsx                 ← 路由总入口
│       ├── api/
│       │   ├── client.ts           ← axios + 所有 API 类型定义与调用函数
│       │   └── auth.ts             ← tokenManager（LocalStorage JWT）
│       ├── pages/                  ← 页面组件
│       ├── components/             ← 公共 UI 组件
│       ├── hooks/                  ← 自定义 Hook
│       └── modules/
│           └── profile-helper/     ← Profile Helper 独立模块
│
└── topiclab-backend/               ← 子模块（另一个 FastAPI 服务）
    └── ...                         ← 用户认证、信源、收藏等
```

---

## 四、后端架构（Resonnet）

### 4.1 四层架构

```
main.py (FastAPI app)
    │
    ├── API Layer (app/api/)         ← 路由、入参验证、出参序列化（每文件 ≤200行）
    │       ↓
    ├── Agent Layer (app/agent/)     ← AI调度逻辑、工作区操作、沙盒执行
    │       ↓
    ├── Service Layer (app/services/)← 业务服务（agent_links、profile_helper）
    │       ↓
    └── Data Layer
            ├── app/db/models.py    ← SQLAlchemy ORM 模型
            ├── app/db/session.py   ← 同步 sessionmaker + session_scope()
            ├── app/models/schemas.py ← Pydantic Schema（请求/响应类型）
            └── app/models/store.py  ← 数据库 CRUD 操作封装
```

### 4.2 启动入口 `main.py`

- **FastAPI 应用**：`app = FastAPI(title="Resonnet API", version="0.1.0")`
- **CORS 中间件**：允许所有来源（`allow_origins=["*"]`）
- **两种运行模式**（`RESONNET_MODE` 环境变量）：
  - `standalone`：完整模式。启动时执行 Alembic 数据库迁移，重置 RUNNING 状态的讨论，加载全部路由（含 topics/posts/discussion）。
  - `executor`：纯 Agent 执行模式。不加载 topics/posts/discussion 路由，不连数据库，只提供 Agent 执行 API。
- **路由注册**：

| 路由前缀 | 文件 | 功能 |
|---------|------|------|
| `/topics` | `topics.py` | 话题 CRUD、图片资源服务 |
| `/topics` | `posts.py` | 帖子管理、专家 @提及 |
| `/topics` | `discussion.py` | 圆桌讨论启动/状态查询 |
| `/topics` | `topic_experts.py` | 话题级专家管理 |
| `/moderator-modes` | `moderator_modes.py` | 主持风格管理 |
| `/skills` | `skills.py` | 可分配技能库 |
| `/experts` | `experts.py` | 全局专家库 |
| `/mcp` | `mcp.py` | MCP 服务器库 |
| `/libs` | `libs.py` | 资料库缓存管理 |
| `/profile-helper` | `profile_helper.py` | 数字档案助手 |
| `/agent-links` | `agent_links.py` | Agent Link 管理 |
| `/executor` | `executor.py` | Agent 执行器 |
| `/health` | inline | 健康检查 |

### 4.3 数据库层

**ORM 框架**：SQLAlchemy（同步，绝不使用 `async with`）

**连接配置**（`app/db/session.py`）：
```python
# standalone 模式：SQLite（自动创建于 workspace/resonnet.sqlite3）
# executor 模式：PostgreSQL（通过 TOPICDATABASE_URL 或 DATABASE_URL 指定）

_build_engine() 参数：
  - pool_pre_ping=True
  - pool_size=10（DB_POOL_SIZE）
  - max_overflow=20（DB_MAX_OVERFLOW）
  - pool_recycle=1800（DB_POOL_RECYCLE_SECONDS）
  - SQLite: check_same_thread=False
```

**`session_scope()` 上下文管理器**：自动 commit/rollback/close，所有 DB 操作必须在此上下文内进行。

**数据模型**（`app/db/models.py`）：

| 表名 | 主键 | 主要字段 |
|------|------|----------|
| `topics` | `id` (UUID str) | title, body, category, status, mode, num_rounds, expert_names(JSON), discussion_status, moderator_mode_id |
| `discussion_runs` | `topic_id` (FK) | status, turns_count, cost_usd, completed_at |
| `discussion_turns` | `id` (UUID str) | topic_id(FK), turn_key, round_num, expert_name, body, source_file |
| `posts` | `id` (UUID str) | topic_id(FK), author, author_type, expert_name, body, mentions(JSON), in_reply_to_id, status |

**关联关系**：
- `TopicRecord` → `DiscussionRunRecord`：一对一（`back_populates="discussion_run"`，cascade delete）
- `TopicRecord` → `PostRecord[]`：一对多（`back_populates="topic"`，cascade delete）

### 4.4 配置层

**文件**：`app/core/config.py`

**环境变量加载顺序**：
1. 先找项目根 `.env`（宿主仓库 `.env`）
2. fallback 到 `backend/.env`

**关键配置分组**：

| 配置组 | 环境变量 | 用途 |
|--------|---------|------|
| 讨论 Agent | `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` | claude_agent_sdk 圆桌讨论调用 |
| AI 生成 | `AI_GENERATION_BASE_URL`、`AI_GENERATION_API_KEY`、`AI_GENERATION_MODEL` | 专家/主持风格 AI 生成（HTTP API 方式，非 SDK） |
| 数据库 | `TOPICDATABASE_URL` / `DATABASE_URL` | SQLAlchemy 连接串 |
| 工作区 | `WORKSPACE_BASE` | workspace 根目录，默认 `/app/workspace` |
| 认证 | `AUTH_MODE`（none/jwt/proxy）、`AUTH_REQUIRED`、`AUTH_SERVICE_BASE_URL` | 认证模式 |
| 运行模式 | `RESONNET_MODE`（standalone/executor） | 服务启动模式 |
| 资料库 | 路径函数族（`get_experts_dir()`等） | libs/ 各子目录路径 |

**⚠️ 两套 AI 配置严格隔离**：`ANTHROPIC_*` 只用于 claude_agent_sdk 讨论，`AI_GENERATION_*` 只用于 HTTP 接口式生成（专家生成、主持风格生成），绝不互相 fallback。

---

## 五、Agent 调度系统

### 5.1 圆桌讨论流程

```
POST /topics/{id}/discussion
    │
    ├── 校验：话题存在、专家不为空、非 RUNNING 状态
    ├── 更新 DB: discussion_status = "running"
    ├── 读取工作区 config/moderator_mode.json → 确定 num_rounds
    ├── asyncio.create_task(run_discussion_background(...))
    └── 立即返回 202（RUNNING 状态）

run_discussion_background（异步后台任务）
    │
    ├── run_discussion_for_topic()
    │       ├── ensure_topic_workspace() → 创建/确认工作区目录结构
    │       ├── init_discussion_history() → 写 shared/topic.md（供专家读取话题）
    │       ├── copy_skills_to_workspace() → 从 libs/assignable_skills/ 拷贝选定技能到 config/skills/
    │       │   ⚠️ image_generation 技能始终被强制包含
    │       ├── copy_mcp_to_workspace() → 从 libs/mcps/ 拷贝选定 MCP 服务器到 config/mcp.json
    │       ├── get_agent_config() → {api_key, base_url, model}
    │       ├── exclusive_topic_sandbox(topic_id, ws_path, "discussion") → 互斥锁
    │       └── run_discussion(workspace_dir, config, topic, ...)
    │               ├── build_experts_from_workspace() → AgentDefinition[]
    │               │     每个专家 = 工作区 agents/{name}/role.md
    │               │               + libs/experts/{source}/expert_common.md（语言指令占位符替换）
    │               │               + EXPERT_SECURITY_SUFFIX（反注入沙盒约束）
    │               │               + build_workspace_boundary(ws_abs)（路径隔离）
    │               ├── prepare_moderator_skill(ws_path, topic, expert_names, num_rounds)
    │               │     → 渲染主持技能到 config/moderator_skill.md
    │               │     → 包含：技能分配指令 + 图片生成指导 + 来源引用护栏
    │               ├── sync_claude_skill_discovery_files() → 镜像到 .claude/skills/
    │               ├── _load_mcp_servers_for_sdk() → 从 config/mcp.json 读取 MCP 配置
    │               ├── ClaudeAgentOptions(
    │               │     allowed_tools=[Read,Write,Edit,Glob,Grep,Task,WebFetch,WebSearch] + mcp_*
    │               │     permission_mode="bypassPermissions"
    │               │     system_prompt=moderator_system.md + workspace_boundary
    │               │     cwd=ws_abs, add_dirs=[ws_abs]
    │               │     agents={name: AgentDefinition}（子 agent 定义）
    │               │     mcp_servers={...}
    │               │   )
    │               └── async for message in query(prompt, options): → 主持人开始主持
    │                   主持人读 config/moderator_skill.md → 调用子 agent Task → 专家轮流发言
    │                   每轮专家写文件：shared/turns/round{N}_{name}.md
    │                   图片保存到：shared/generated_images/
    │
    ├── sanitize_discussion_turn_sources() → 过滤非可核验来源链接
    ├── validate_discussion_outputs() → 验证所有 turns 文件 + summary + 至少一张图片
    ├── sync_discussion_turns() → 从 shared/turns/ 同步到 DB discussion_turns 表
    └── 更新 DB: discussion_status = "completed" / "failed"
```

### 5.2 专家 @提及流程

```
POST /topics/{id}/posts/mention
    │
    ├── 校验：话题存在、非讨论运行中（409 冲突）、专家在工作区中存在
    ├── 写 user_post（status="completed"）到工作区
    ├── 写 reply_post（status="pending"）到工作区（占位符）
    └── threading.Thread(target=_run_expert_reply_sync, daemon=True).start()
        → run_expert_reply_sandboxed()
        │   ├── 若 OS 沙盒可用（sandbox-exec/bwrap）：通过 IPC JSON 在沙盒子进程中执行
        │   └── 若无沙盒：直接 asyncio.run(run_expert_reply(...))
        │
        └── run_expert_reply()
            ├── claude_agent_sdk.query(prompt, options)
            │   （专家读取 agents/{name}/role.md + shared/topic.md + posts + @mention 内容）
            └── 更新 reply_post.body + status="completed"
```

### 5.3 OS 级沙盒隔离

**设计目的**：防止 Agent 写入工作区以外的文件（跨话题污染、系统文件篡改）。

**检测顺序**（`app/agent/sandbox_exec.py`）：
1. **macOS Seatbelt**（`sandbox-exec`）：Apple 内核沙盒，写权限仅允许 ws_path + IPC 临时目录 + ~/.claude + /tmp
2. **Linux Bubblewrap**（`bwrap`）：namespace 隔离，只挂载 ws_path 和必要系统路径为 bind-mount
3. **fallback**：仅靠 Prompt 约束（`EXPERT_SECURITY_SUFFIX` + `build_workspace_boundary()`）

**IPC 机制**：
- 主进程写 `/tmp/agent-topic-lab-{uuid}/input.json`（任务配置）
- 沙盒子进程（`sandbox_runner.py`）读 input.json → 执行 → 写 output.json
- 主进程读 output.json → 清理临时目录

### 5.4 专家系统

**专家来源**（`libs/experts/` 两层结构）：

```
libs/experts/
├── meta.json           ← sources 注册表：{"sources": {"default": {...}, "topiclab_shared": {...}}}
└── {source_id}/
    ├── meta.json       ← {"categories": {...}, "experts": {"physicist": {name, skill_file, description, perspective}}}
    ├── expert_common.md    ← 公共部分（工作区规则、讨论规则、语言指令占位符）
    └── {skill_file}.md     ← 专家角色技能文件
```

**专家加载优先级**（`build_experts_from_workspace()`）：
1. `workspace/agents/{name}/role.md`（话题级自定义）→ 追加 expert_common.md
2. fallback → `libs/experts/{source}/{skill_file}.md`（全局默认）
3. 工作区专属专家（AI 生成，无全局定义）：直接读 role.md

**专家类型**：
- `preset`：从全局库预设专家中添加
- `custom`：用户手写 role_content 创建
- `ai_generated`：系统用 AI_GENERATION API 生成角色描述

### 5.5 主持风格系统

**PRESET_MODES**：从 `libs/moderator_modes/default/meta.json` 加载，每个 mode 包含 `{id, name, description, num_rounds, convergence_strategy, prompt_file}`。

**自定义模式（`mode_id="custom"`）**：用户提供 `custom_prompt`，与 `moderator_common.md` 合并后保存到 `config/moderator_mode.json`。

**主持技能渲染流程**（`prepare_moderator_skill()`）：
```
config/moderator_mode.json → 读取 mode_id, num_rounds, custom_prompt
    ↓
加载 libs/moderator_modes/{source}/{mode_id}.md（主持角色部分）
    + libs/moderator_modes/{source}/moderator_common.md（公共规则）
    ↓
替换占位符：{topic}, {ws_abs}, {expert_names_str}, {num_experts}, {num_rounds}, {output_language_instruction}
    ↓
追加技能分配指令（列出 config/skills/*.md）
    ↓
追加图片生成指导（含必须产出图片的规则）
    ↓
追加来源引用护栏
    ↓
写入 config/moderator_skill.md
```

---

## 六、认证系统

### 6.1 三种认证模式

**配置**：`AUTH_MODE` 环境变量（`none` / `jwt` / `proxy`）

| 模式 | 实现类 | 行为 |
|------|--------|------|
| `none` | `NoneAuthProvider` | 所有请求匿名通过（开发默认） |
| `jwt` | `JwtBridgeAuthProvider` | 读 Bearer Token → 调用 topiclab-backend `/auth/me` 验证 |
| `proxy` | `ProxyHeaderAuthProvider` | 读 HTTP 代理头（反向代理注入用户信息） |

### 6.2 认证依赖链

```python
# FastAPI 依赖注入链
get_current_auth_context(request, credentials)
    → get_auth_provider().resolve_from_bearer(token)
    → get_user_from_token(token)              # jwt 模式
        → httpx.GET AUTH_SERVICE_BASE_URL/auth/me
        → 返回 {"user": {"id": ..., "username": ...}}
    → 返回 {"auth_context": AuthContext, "user": {...}, "token": "..."}

get_current_user_from_auth_service(auth_ctx)  ← 向下兼容的旧依赖
    → auth_ctx["user"]
```

### 6.3 作者名解析

帖子发布时：优先使用认证用户的 `username` / `phone` / `user-{id}`，仅在匿名时使用客户端传入的 `author` 字段。

---

## 七、工作区文件系统

每个话题有独立的沙盒工作区：`workspace/topics/{topic_id}/`

### 7.1 目录结构与文件职责

```
workspace/topics/{topic_id}/
├── shared/
│   ├── topic.md                    ← 话题标题 + 正文（专家从此读取，不从 DB 读）
│   ├── turns/
│   │   └── round{N}_{expert}.md    ← AI 专家每轮发言内容（命名规范严格）
│   ├── discussion_summary.md       ← 圆桌总结（由主持人 Agent 写入）
│   └── generated_images/           ← AI 生成的图片文件
│       └── round2_concept_map.png
│
├── agents/
│   └── {expert_name}/
│       └── role.md                 ← 该话题下专家的角色定义（可个性化）
│
├── config/
│   ├── moderator_mode.json         ← {mode_id, num_rounds, custom_prompt, skill_list, mcp_server_ids, model}
│   ├── moderator_skill.md          ← 渲染后的主持技能（每次讨论前重新生成）
│   ├── workspace.json              ← {output_language, output_language_name}
│   ├── experts_metadata.json       ← [{name, label, description, source, added_at, masked, ...}]
│   ├── skills/
│   │   └── {skill_id}.md           ← 拷贝自 libs/assignable_skills/ 的技能文件
│   └── mcp.json                    ← {"mcpServers": {sid: {command/url/...}}}
│
└── .claude/
    └── skills/                     ← 镜像 config/skills/，供 Claude SDK 自动发现
        └── {slug}/
            └── SKILL.md
```

### 7.2 关键操作

**`read_discussion_history(ws_path)`**：
- 扫描 `shared/turns/*.md`，按文件名字典排序
- 从文件名提取 round 数和专家名（`roundN_expertname.md`）
- 查 `experts_metadata.json` 获取显示名
- 拼接格式：`## Round N - ExpertLabel\n\n{content}\n\n---`

**图片路径约定**：
- Agent 保存到：`shared/generated_images/{name}.png`
- Markdown 引用：`/api/topics/{id}/assets/generated_images/{path}`
- API 端点提供图片压缩/缓存服务（WebP 格式，quality 72）

**语言检测**（`init_workspace_language_from_topic()`）：
- 话题标题/正文中 CJK 字符占比 ≥ 30% → 设置 `output_language=zh`
- 否则设置 `en`
- 显式设置后不再覆盖

---

## 八、可分配资源库（libs/）

所有 libs 子库遵循相同的**两层元数据结构**：

```
libs/{resource_type}/
├── meta.json         ← {"sources": {"default": {id, name}, "topiclab_shared": {...}}}
└── {source_id}/
    └── meta.json     ← {"categories": {...}, "{resources}": {"id": {name, description, ...}}}
```

**双路径合并**：`builtin`（Docker 镜像内 `/app/libs_builtin`）+ `primary`（Volume 挂载 `/app/libs`）。主路径覆盖内置路径（`{**builtin, **primary}`），支持运行时热更新。

**缓存刷新**：`POST /libs/invalidate-cache` 可清除内存缓存，触发从磁盘重新加载。缓存 TTL 由 `LIBS_CACHE_TTL_SECONDS`（默认 60 秒）控制。

### 8.1 可分配技能（assignable_skills）

- `default/`：内置技能（`image_generation` 等）
- `_submodules/`：通过 Git 子模块导入的外部技能集（如 `ai-research`、`anthropics`）
- 技能文件路径规则：
  - 内置：`assignable_skills/default/{category}/{slug}.md`
  - 子模块：`assignable_skills/_submodules/{source}/{skills_dir}/{category}/{slug}/SKILL.md`

### 8.2 MCP 服务器（mcps）

两种类型：
- **stdio 类型**：`{command, args, env}`，env 中 `${VAR_NAME}` 模式在运行时替换为实际环境变量
- **HTTP 类型**：`{type: "http", url, headers}`

---

## 九、Profile Helper（数字档案助手）

### 9.1 架构

```
前端 ProfileHelperPage
    │ SSE / 轮询
    ▼
POST /profile-helper/session
    ↓
app/services/profile_helper/ 模块
    ├── agent.py          ← 主入口，SSE 流式响应
    ├── block_agent.py    ← Block 渲染 Agent（将 AI 输出转为结构化 Block）
    ├── llm_client.py     ← AI_GENERATION_BASE_URL HTTP 调用
    ├── profile_parser.py ← 解析 Markdown 档案
    ├── prompts.py        ← 系统提示词
    ├── scientist_match.py← 科学家匹配算法
    ├── scientists_db.py  ← 科学家数据库
    ├── sessions.py       ← 会话管理（文件存储）
    └── tools.py          ← Agent 工具函数
```

### 9.2 档案存储

- 路径：`workspace/users/{user_id}/profile/` 或 `workspace/profile_helper/profiles/{session_id}/`
- 格式：Markdown 模板渲染后的 `.md` 文件

---

## 十、Agent Links（智能体链路）

**概念**：将一个预配置的 AI 工作流（"蓝图"）暴露为可访问的聊天接口。

**蓝图结构**（`libs/agent_links/{slug}/agent.json`）：
```json
{
  "slug": "tashan-profile-helper-demo",
  "name": "...",
  "module": "profile_helper",
  "entry_skill": "collect-basic-info",
  "blueprint_root": "/path/to/blueprint",
  "rule_file_path": "/path/.cursor/rules/profile-collector.mdc",
  "skills_path": "/path/.cursor/skills",
  "welcome_message": "你好，我是科研数字分身采集助手。"
}
```

**发现顺序**：
1. `libs/agent_links/` 目录（disk）
2. `AGENT_BLUEPRINT_BASE` 环境变量指向的目录（自动扫描子目录）
3. 硬编码 fallback：`/Users/zeruifang/Documents/tashanlink/tashan-profile-helper_demo`

---

## 十一、前端架构

### 11.1 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 框架 | React | 18.2 |
| 语言 | TypeScript | 5.3 |
| 构建 | Vite | 5.1 |
| 路由 | react-router-dom | 6.22 |
| HTTP | axios | 1.6 |
| 样式 | Tailwind CSS | 3.4 |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex | |
| 测试 | vitest + @testing-library/react | |

### 11.2 路由结构

```
/ → TopicList（话题广场）
/topics/new → CreateTopic（发布话题）
/topics/:id → TopicDetail（话题详情，含讨论结果 + 评论区）
/experts/:name/edit → ExpertEdit（专家技能编辑）
/library/:section → LibraryPage（experts/skills/mcp/moderator-modes）
/profile-helper/* → ProfileHelperPage（数字档案助手）
/agent-links → AgentLinkLibraryPage（Agent Link 列表）
/agent-links/:slug → AgentLinkChatPage（聊天界面）
/source-feed/:section → SourceFeedPage（信源流）
/login, /register → 登录注册
/favorites → MyFavoritesPage（我的收藏）
```

### 11.3 API 客户端（`src/api/client.ts`）

- **axios 实例**：`baseURL = ${BASE_URL}api`（配合 Vite 的 `BASE_URL` 参数）
- **请求拦截器**：自动从 `tokenManager.get()` 读取 JWT，注入 `Authorization: Bearer {token}` 头
- **按资源分组的 API 对象**：`topicsApi`, `postsApi`, `discussionApi`, `expertsApi`, `topicExpertsApi`, `moderatorModesApi`, `skillsApi`, `mcpApi`, `profileHelperApi`, `sourceFeedApi`, `literatureApi`, `libsApi`

### 11.4 内置模型列表（`ROUNDTABLE_MODELS`）

```
qwen3.5-plus, qwen-flash, qwen3-max, deepseek-v3.2, MiniMax-M2.1, kimi-k2.5, glm-5, glm-4.7
```

---

## 十二、部署架构

### 12.1 Docker Compose 三服务

```yaml
services:
  topiclab-backend:   # Port 8001 → 8000  (用户认证、信源等)
    image: python:3.11-slim (via daocloud镜像)
    volumes: ${WORKSPACE_PATH}:/app/workspace

  backend:            # Port 8000 → 8000  (Resonnet 核心)
    image: python:3.11-slim (via daocloud镜像)
    volumes:
      - ${WORKSPACE_PATH}:/app/workspace
      - ${LIBS_PATH}:/app/libs

  frontend:           # Port 80 → ${FRONTEND_PORT}
    image: node:20-slim + nginx:alpine (via daocloud镜像)
    args: VITE_BASE_PATH=${VITE_BASE_PATH:-/topic-lab/}
    depends_on: backend(healthy), topiclab-backend(healthy)
```

**健康检查**：`python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"`

### 12.2 前端 Nginx 路由

**两套配置**（由 `VITE_BASE_PATH` 决定）：
- `VITE_BASE_PATH=/`：使用 `nginx.root.conf`（部署在域名根路径）
- `VITE_BASE_PATH=/topic-lab/`：使用 `nginx.conf`（部署在子路径）

Nginx 代理规则（由 GitHub Actions 写入宿主机 `/etc/nginx/snippets/`）：
```nginx
location / {
    proxy_pass http://127.0.0.1:${FRONTEND_PORT};
}
location /api/ {
    proxy_pass http://127.0.0.1:${FRONTEND_PORT}/api/;
}
```

前端 Nginx 内部转发：
- `/api/` → `http://backend:8000`（Resonnet）
- 其余 → SPA index.html

### 12.3 CI/CD 流程

**触发条件**：push to `main` 分支

**执行步骤**：
1. SSH 到部署服务器（`DEPLOY_HOST`/`DEPLOY_USER`/`SSH_PRIVATE_KEY`）
2. `git clone`（首次）或 `git fetch && git reset --hard origin/main`
3. 配置子模块 URL（HTTPS Token 认证）
4. `git submodule update --init --recursive`（含 backend + assignable_skills 子模块）
5. 写入 `DEPLOY_ENV` secret 到 `.env`
6. `docker compose build --no-cache`
7. `docker compose down && docker compose up -d`
8. `docker image prune -f`
9. 生成/更新宿主机 Nginx 配置 snippet
10. `sudo nginx -t && sudo nginx -s reload`

---

## 十三、数据流示例

### 13.1 发布话题并启动圆桌讨论

```
用户 → POST /topics（title, body, category）
    → DB: 创建 TopicRecord（status=open, discussion_status=pending）
    → FS: ensure_topic_workspace → 创建目录结构
    → FS: 写默认专家 role.md（4个内置专家）
    → DB: 设置 moderator_mode_id="standard"

用户 → POST /topics/{id}/discussion（num_rounds, skill_list, mcp_server_ids）
    → DB: discussion_status = "running"
    → asyncio.create_task(...)  ← 立即返回 202
    → [后台] run_discussion_for_topic()
        → 写 shared/topic.md
        → 拷贝技能和 MCP 配置到工作区
        → claude_agent_sdk.query() → 主持人 + N个专家 Agent
        → 专家轮流写 shared/turns/roundN_{expert}.md
        → 至少一张图片写入 shared/generated_images/
        → 验证产出完整性
        → DB: discussion_status = "completed", cost_usd, turns_count

用户 → GET /topics/{id}/discussion/status
    → 读 DB + 实时读 shared/turns/*.md 构建 discussion_history
    → 返回 progress（已完成轮数、当前发言者）
```

### 13.2 用户 @提及专家

```
用户 → POST /topics/{id}/posts/mention（author, body, expert_name）
    → 校验：非讨论运行中 + 专家在工作区
    → FS: 保存 user_post（status=completed）
    → FS: 保存 reply_post（status=pending, body=""）
    → 启动 daemon 线程 → run_expert_reply_sandboxed()
        → [OS 沙盒中] claude_agent_sdk.query()
        → 专家读取话题 + 历史 posts + @mention 内容
        → 生成回复
    → FS: 更新 reply_post（body=回复内容, status=completed）

用户 → GET /topics/{id}/posts/mention/{reply_post_id}（轮询）
    → 返回 reply_post（status=pending/completed/failed）
```

---

## 十四、环境变量完整清单

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `ANTHROPIC_API_KEY` | ✅ | - | 圆桌讨论 claude_agent_sdk API Key |
| `ANTHROPIC_BASE_URL` | - | "" | 自定义 Claude API 地址 |
| `ANTHROPIC_MODEL` | - | "" | 默认讨论模型 |
| `AI_GENERATION_BASE_URL` | ✅ | - | 专家/主持风格生成 API 地址 |
| `AI_GENERATION_API_KEY` | ✅ | - | 专家/主持风格生成 API Key |
| `AI_GENERATION_MODEL` | ✅ | - | 专家/主持风格生成模型名 |
| `RESONNET_MODE` | - | `executor` | `standalone` / `executor` |
| `TOPICDATABASE_URL` | 生产必需 | SQLite（standalone） | PostgreSQL 连接串 |
| `DATABASE_URL` | 生产必需 | - | TOPICDATABASE_URL 的 fallback |
| `WORKSPACE_BASE` | - | `/app/workspace` | 工作区根目录 |
| `AUTH_MODE` | - | `none` | `none` / `jwt` / `proxy` |
| `AUTH_REQUIRED` | - | `false` | JWT 模式下是否强制认证 |
| `AUTH_SERVICE_BASE_URL` | jwt 模式需 | `http://topiclab-backend:8000` | 认证服务地址 |
| `ACCOUNT_SYNC_ENABLED` | - | `false` | 是否同步档案到外部账号系统 |
| `LIBS_CACHE_TTL_SECONDS` | - | `60` | 资料库内存缓存 TTL（0=不缓存） |
| `DB_POOL_SIZE` | - | `10` | 数据库连接池大小 |
| `DB_MAX_OVERFLOW` | - | `20` | 连接池溢出上限 |
| `DB_POOL_RECYCLE_SECONDS` | - | `1800` | 连接回收间隔（秒） |
| `FRONTEND_PORT` | - | `3000` | 前端容器对外端口 |
| `BACKEND_PORT` | - | `8000` | Resonnet 后端端口 |
| `TOPICLAB_BACKEND_PORT` | - | `8001` | topiclab-backend 端口 |
| `VITE_BASE_PATH` | - | `/topic-lab/` | 前端 SPA 基础路径 |
| `LIBS_PATH` | - | `./backend/libs` | libs 目录 volume 路径 |
| `WORKSPACE_PATH` | - | `./workspace` | workspace 目录 volume 路径 |

---

## 十五、复现项目步骤

### 15.1 本地开发环境

```bash
# 1. 克隆主仓库（含子模块）
git clone --recurse-submodules <repo_url>
cd Tashan-TopicLab

# 2. 配置环境变量
cp .env.example .env
# 填写：ANTHROPIC_API_KEY, AI_GENERATION_BASE_URL, AI_GENERATION_API_KEY, AI_GENERATION_MODEL

# 3. 本地开发 backend（在 backend/ 中）
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env  # 填写 ANTHROPIC_* 和 AI_GENERATION_*
# 设置 RESONNET_MODE=standalone（会自动使用 SQLite）
uvicorn main:app --reload --port 8000

# 4. 本地开发 frontend
cd ../frontend
npm install
VITE_BASE_PATH=/ npm run dev    # 访问 http://localhost:5173
```

### 15.2 生产部署（Docker Compose）

```bash
# 1. 准备 .env（参考 .env.deploy.example）
# 必须设置：ANTHROPIC_API_KEY, AI_GENERATION_*, DATABASE_URL
# 建议：RESONNET_MODE=standalone（若独立部署不依赖 topiclab-backend）

# 2. 启动
docker compose up -d

# 3. 首次启动会自动执行 Alembic 数据库迁移（standalone 模式）
```

### 15.3 关键依赖

| 依赖 | 说明 |
|------|------|
| `claude_agent_sdk` | Anthropic Claude Agent SDK，用于多智能体圆桌讨论 |
| `fastapi` + `uvicorn` | API 框架 + ASGI 服务器 |
| `sqlalchemy` | ORM（同步模式） |
| `alembic` | 数据库迁移 |
| `httpx` | 异步 HTTP 客户端（用于认证回调） |
| `Pillow` | 图片压缩/格式转换 |
| `python-dotenv` | 环境变量加载 |
| `anthropic` | Anthropic Python SDK |

---

*文档基于代码实际阅读生成，撰写时间：2026-03-17*
