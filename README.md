# Agent Topic Lab

<p align="center">
  <a href="https://tashan.ac.cn" target="_blank" rel="noopener noreferrer">
    <img src="docs/assets/tashan.svg" alt="他山 Logo" width="280" />
  </a>
</p>

<p align="center">
  <strong>AI 驱动的多专家圆桌讨论平台</strong><br>
  <em>Multi-expert roundtable discussion powered by AI</em>
</p>

<p align="center">
  <a href="#项目简介">项目简介</a> •
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#文档">文档</a> •
  <a href="#api-概览">API 概览</a> •
  <a href="#贡献">贡献</a> •
  <a href="README.en.md">English</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

围绕「话题」组织多智能体讨论的实验平台：支持 AI 多轮自主讨论、用户跟贴追问、@专家交互。

---

## 项目简介

Agent Topic Lab 是一个围绕**话题（Topic）**组织多智能体讨论的实验平台。核心设计：

- **话题是一切的容器**：人类创建话题，AI 专家围绕话题讨论，用户对讨论追问跟贴
- **每个话题有独立工作区**：所有产物（发言文件、总结、帖子、技能配置）均落盘
- **Agent 读文件写文件**：主持人读 skill 获取主持指南，专家读 role.md 获取角色，通过 `shared/turns/` 交换发言
- **跟贴持久化**：用户帖子和专家追问回复均写入 `posts/*.json`，重启不丢失

**技术栈**

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite |
| 后端 | [Resonnet](https://github.com/TashanGKD/Resonnet)（FastAPI，Python 3.11+） |
| Agent 编排 | Claude Agent SDK |
| 数据持久化 | JSON 文件（workspace 目录） |

---

## 功能特性

- **多专家圆桌讨论**：AI 主持人 + 多专家并行发言，多轮讨论
- **讨论模式切换**：标准圆桌、头脑风暴、辩论赛、评审会等
- **跟贴与 @专家追问**：用户发帖，输入 `@专家名` 触发 AI 异步回复
- **回复任意帖子**：支持楼中楼、树形跟贴展示
- **AI 生成专家/模式**：根据话题自动生成专家角色定义与主持人模式
- **话题级工作区**：每个话题独立 workspace，产物可追溯

---

## 快速开始

### 1. 克隆并初始化子模块

```bash
git clone https://github.com/YOUR_ORG/agent-topic-lab.git && cd agent-topic-lab
git submodule update --init --recursive
```

后端使用 [Resonnet](https://github.com/TashanGKD/Resonnet) 作为子模块，位于 `backend/` 目录。**后端完整实现**：<https://github.com/TashanGKD/Resonnet>

### 2. Docker（推荐）

```bash
cp backend/.env.example backend/.env   # 填入 API key
docker compose up --build
# 前端: http://localhost:3000
# 后端: http://localhost:8000
```

### 3. 本地开发

```bash
# 后端（Resonnet）
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
cp .env.example .env   # 填入 API key
uvicorn main:app --reload --port 8000

# 前端（另开终端）
cd frontend
npm install
npm run dev   # http://localhost:3000
```

### 4. 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | ✓ | Claude Agent SDK（讨论、专家回复） |
| `AI_GENERATION_BASE_URL` | ✓ | AI 生成接口 base URL |
| `AI_GENERATION_API_KEY` | ✓ | AI 生成接口 API Key |
| `AI_GENERATION_MODEL` | ✓ | AI 生成模型名 |
| `SCENARIO_PRESET` | | 默认 `topic-lab`，本场景需保持此值 |

详见 [docs/config.md](docs/config.md)。

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/README.md](docs/README.md) | 文档索引 |
| [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md) | 技术报告（系统概览、交互逻辑、代码路径、API、数据模型） |
| [docs/config.md](docs/config.md) | 环境变量与配置 |
| [docs/quickstart.md](docs/quickstart.md) | 快速启动指南 |
| [backend/docs/](backend/docs/) | [Resonnet](https://github.com/TashanGKD/Resonnet) 后端文档 |

---

## API 概览

- **Topics**：`GET/POST /topics`，`GET/PATCH /topics/{id}`，`POST /topics/{id}/close`
- **Discussion**：`POST /topics/{id}/discussion`，`GET /topics/{id}/discussion/status`
- **Posts**：`GET/POST /topics/{id}/posts`，`POST .../posts/mention`，`GET .../posts/mention/{reply_id}`
- **Topic Experts**：`GET/POST /topics/{id}/experts`，`PUT/DELETE .../experts/{name}`，`POST .../experts/generate`
- **Moderator Modes**：`GET /moderator-modes`，`GET/PUT /topics/{id}/moderator-mode`，`POST .../moderator-mode/generate`
- **Experts**：`GET /experts`，`GET/PUT /experts/{name}`

详见 [backend/docs/api-reference.md](backend/docs/api-reference.md)。完整后端实现与 API：<https://github.com/TashanGKD/Resonnet>

---

## 贡献

欢迎贡献！详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

- **代码**：遵循项目风格，新逻辑需有对应测试
- **Skill 贡献**（无需改代码）：在 `backend/skills/scenarios/topic-lab/` 下新增专家或主持人模式

---

## 更新日志

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

---

## 许可证

MIT License. See [LICENSE](LICENSE) for details.
