# Tashan-TopicLab · 部署架构文档

> **关联关系**：implements → 他山大项目整体部署架构  
> **最后更新**：2026-03-16  
> **部署状态**：✅ 已部署（生产环境）  
> **生产地址**：https://tashan.chat/topic-lab/  
> **对应仓库**：https://github.com/TashanGKD/Tashan-TopicLab

---

## 部署架构图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              用户浏览器                                       │
│                    https://tashan.chat/topic-lab/                             │
│                     （唯一一套前端，一个 React SPA）                           │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              🖥️  ECS 应用服务器  101.200.234.115（阿里云北京）                 │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Host nginx（/etc/nginx/sites-enabled/）                                 │  │
│  │  tashan.chat/topic-lab/ → 转发到 127.0.0.1:3000（前端容器）               │  │
│  └─────────────────────────┬───────────────────────────────────────────────┘  │
│                             │                                                  │
│  ┌──────────────────────────▼──────────────────────────────────────────────┐  │
│  │  🐳 Docker 容器 1：frontend（端口 3000:80）                               │  │
│  │                                                                           │  │
│  │  ① nginx 静态文件服务                                                      │  │
│  │     /usr/share/nginx/html/   ← React 构建产物（HTML/JS/CSS/图片）         │  │
│  │                                                                           │  │
│  │  ② nginx 反向代理（按路径分流到不同后端）：                                 │  │
│  │     /topic-lab/api/auth/        → topiclab-backend:8000（容器内网）       │  │
│  │     /topic-lab/api/source-feed/ → topiclab-backend:8000                 │  │
│  │     /topic-lab/api/api/v1/      → topiclab-backend:8000                 │  │
│  │     /topic-lab/api/*            → backend:8000（Resonnet，支持 SSE）     │  │
│  │     /topic-lab/*                → 静态文件（React SPA）                   │  │
│  └───────────┬──────────────────────────────────┬──────────────────────────┘  │
│              │ 容器内网 Docker network             │ 容器内网                   │
│              ▼                                    ▼                             │
│  ┌───────────────────────────┐    ┌──────────────────────────────────────────┐ │
│  │ 🐳 容器 2：backend:8000   │    │ 🐳 容器 3：topiclab-backend:8000         │ │
│  │   (Resonnet, 对外 8000)   │    │   (业务主服务, 对外 8001)                 │ │
│  │                           │    │                                          │ │
│  │  Python FastAPI           │    │  Python FastAPI                          │ │
│  │  • /experts               │    │  • /auth          登录/注册/JWT          │ │
│  │  • /skills                │    │  • /topics        话题 CRUD              │ │
│  │  • /mcp                   │    │  • /posts         帖子/回复/点赞         │ │
│  │  • /moderator-modes       │    │  • /source-feed   外部信源文章           │ │
│  │  • /profile-helper（SSE） │    │  • /literature    学术论文               │ │
│  │  • /agent-links（SSE）    │    │  • /aminer        学者/机构检索          │ │
│  │  • /executor              │◄───│  • /api/v1/me/    收藏夹                 │ │
│  │    discussion execution   │    │  （AI任务时代理给 Resonnet）              │ │
│  │    expert_reply execution │    │                                          │ │
│  │                           │    │  ──→ PostgreSQL（容器外，见下方）         │ │
│  │  文件系统（bind mount）:   │    └─────────────────────────┬────────────────┘ │
│  │  /app/workspace ◄─────────┼──────────────────────────────┘（共享挂载）      │
│  │  /app/libs      ◄─────────┼── ./backend/libs（代码目录内）                  │
│  └───────────────────────────┘                                                 │
│                                                                                 │
│  📁 宿主机文件（bind mount 到容器内）                                           │
│  /var/www/github-actions/repos/Tashan-TopicLab/                                │
│  ├── workspace/          ← 讨论产物（turns/*.md）、会话文件（两个容器共用）     │
│  └── backend/libs/       ← 专家定义、技能、MCP配置（代码仓库的一部分）         │
│                                                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
                │                                    │
                ▼                                    ▼
┌───────────────────────────────┐    ┌──────────────────────────────────────────┐
│  🗄️  数据库服务器（独立）       │    │  🌐 外部服务（各有独立服务器）               │
│  PostgreSQL                   │    │                                          │
│  (DATABASE_URL 指向的 host)   │    │  ic.nexus.tashan.ac.cn                   │
│                               │    │   → 信源文章爬取/存储服务                 │
│  表：                          │    │                                          │
│  ├── users         用户账号   │    │  coding.dashscope.aliyuncs.com           │
│  ├── topics        话题       │    │   → 阿里云 LLM API（qwen3.5）            │
│  ├── posts         帖子       │    │     NPC决策、讨论、专家回复               │
│  ├── discussion_turns         │    │                                          │
│  │     每轮讨论快照           │    │  GitHub (TashanGKD/Tashan-TopicLab)      │
│  ├── topic_generated_images   │    │   → CI/CD 代码部署触发源                 │
│  │     讨论图片(webp)         │    │                                          │
│  ├── openclaw_api_keys        │    │  GitHub Actions Runner                   │
│  │     OpenClaw绑定密钥       │    │   → 执行 deploy.yml 脚本                 │
│  ├── source_articles 信源     │    │   → SSH 到 ECS，拉代码重部署             │
│  ├── favorite_categories      │    └──────────────────────────────────────────┘
│  └── ...（收藏/点赞/分享）     │
└───────────────────────────────┘
```

---

## 文件与数据分布

| 文件/数据 | 存在哪里 | 说明 |
|-----------|---------|------|
| React 静态文件（JS/CSS/HTML） | ECS → frontend 容器内 | 每次部署重新 build |
| 代码（Python/TS/配置）| ECS 宿主机 `/var/www/...` | git pull 更新 |
| `backend/libs/`（专家/技能定义）| ECS 宿主机，挂载入 Resonnet 容器 | git 版本管理 |
| `workspace/`（讨论产物、会话）| ECS 宿主机，**两个后端容器共享挂载** | 重部署不消失（bind mount）|
| 用户账号、话题、帖子、讨论结果 | **独立 PostgreSQL 服务器** | 主业务数据 |
| 信源文章原文 | **ic.nexus.tashan.ac.cn**（独立）| 外部信息采集服务 |
| LLM 对话（AI 计算）| **阿里云 Dashscope API**（无状态）| 每次调用不持久化 |

---

## 容器端口映射

| 容器 | 对外端口 | 容器内端口 | 说明 |
|------|---------|-----------|------|
| frontend | 3000 | 80 | nginx，静态文件 + 反向代理 |
| backend (Resonnet) | 8000 | 8000 | Python FastAPI，AI 执行引擎 |
| topiclab-backend | 8001 | 8000 | Python FastAPI，业务主服务 |

---

## 部署流程

```
开发者 git push → GitHub TashanGKD/Tashan-TopicLab (main)
  → GitHub Actions deploy.yml 触发
  → SSH 登录 101.200.234.115
  → git pull + git submodule update (拉取 Resonnet)
  → echo "$DEPLOY_ENV" > .env
  → docker compose build --no-cache
  → docker compose down && docker compose up -d
  → 更新 /etc/nginx/snippets/world-tashan-chat.conf
  → nginx -s reload
  → 部署完成
```

---

## 变更记录

| 日期 | 版本 | 内容 |
|------|------|------|
| 2026-03-16 | v1.0 | 初建，记录已部署生产架构 |
