# 技术报告：跟贴系统 + @专家追问功能

> 日期：2026-02-18
> 状态：**已实现**

---

## 一、功能概述

在圆桌讨论话题下新增**跟贴系统**，支持：

1. **持久化帖子列表**：人类输入与专家回复均以 JSON 文件存入 workspace，重启不丢失，且可作为 agent 的上下文输入
2. **@专家追问**：前端输入 `@` 弹出专家补全菜单，选中后触发后端启动 `claude_agent_sdk` agent，agent 自主进入 workspace 读取背景文件，以专家身份直接输出回复

---

## 二、数据结构

```
workspace/topics/{topic_id}/
  topic.json
  posts/                                  # 跟贴目录（NEW）
    {iso_timestamp}_{uuid}.json           # 每条帖子一个文件
  shared/
    turns/round{n}_{expert}.md            # 圆桌各轮发言
    discussion_summary.md                 # 圆桌总结
  agents/{expert_name}/role.md            # 专家 skill 文件
  config/experts_metadata.json            # 专家元数据
```

**单条帖子 JSON schema：**

```json
{
  "id": "uuid",
  "topic_id": "...",
  "author": "用户名 | expert_name",
  "author_type": "human | agent",
  "expert_name": null,
  "expert_label": null,
  "body": "正文内容（纯文本或 Markdown）",
  "mentions": ["physicist"],
  "in_reply_to_id": null,
  "status": "pending | completed | failed",
  "created_at": "2026-02-18T00:00:00+00:00"
}
```

文件名按 `created_at`（ISO 8601 冒号替换为 `-`）+ `_` + UUID 命名，天然按时间排序，并发写入无冲突。

---

## 三、后端实现

### 3.1 新增 / 修改文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `app/agent/posts.py` | NEW | `make_post()` / `save_post()` / `load_posts()` / `load_post()` — 帖子文件读写工具 |
| `app/agent/expert_reply.py` | NEW | `run_expert_reply()` — 启动专家 agent，捕获 `ResultMessage.result`，写入帖子文件 |
| `prompts/expert_reply_skill.md` | NEW | agent system prompt 的 skill 部分：指导专家如何阅读 workspace、何时快速回复、何时先确认方向 |
| `prompts/expert_reply_user_message.md` | NEW | agent user message 模板，含 `{topic_title}`、`{user_author}`、`{expert_label}`、`{user_question}` 占位符 |
| `app/models/schemas.py` | UPDATE | 新增 `Post`、`CreatePostRequest`、`MentionExpertRequest`、`MentionExpertResponse` |
| `app/api/posts.py` | NEW | 4 个 REST 端点（见 3.2）；background task 用 `threading.Thread` 启动，避免与 uvicorn event loop 冲突 |
| `app/models/store.py` | UPDATE | 删除内存 `comments_db` 及相关函数 |
| `main.py` | UPDATE | 注册 posts router，移除 comments router；新增 `logging.basicConfig(level=INFO)` |
| `app/agent/workspace.py` | UPDATE | `_get_expert_label()` 移除硬编码 `_LABELS`，改为从 `EXPERT_SPECS`（`skills/experts/meta.json`）读取 label |

### 3.2 API 端点

```
GET  /topics/{topic_id}/posts
     → 返回全部帖子，按 created_at 升序排列

POST /topics/{topic_id}/posts                    201
     body: { author, body }
     → 创建人类帖子，写入 workspace/posts/

POST /topics/{topic_id}/posts/mention            202
     body: { author, body, expert_name, in_reply_to_id? }
     → 1. 保存用户帖子
     → 2. 写入 pending 占位帖
     → 3. 在 daemon thread 启动 expert reply agent（asyncio.run）
     → 返回 { user_post, reply_post_id, status: "pending" }

GET  /topics/{topic_id}/posts/mention/{reply_post_id}
     → 读文件 status 字段，轮询回复进度（pending / completed / failed）
```

### 3.3 expert_reply agent 设计

```
system_prompt = agents/{expert_name}/role.md          # 专家身份
              + prompts/expert_reply_skill.md          # 固定回复技能
              + EXPERT_SECURITY_SUFFIX                 # 安全约束

user_prompt   = 从 prompts/expert_reply_user_message.md 加载并填充占位符

ClaudeAgentOptions:
  allowed_tools    = ["Read", "Glob"]    # 只读，不写文件
  permission_mode  = "acceptEdits"       # 尊重 allowed_tools 限制
  cwd              = workspace/topics/{topic_id}/
  max_turns        = 50
  max_budget_usd   = 10.0
```

**agent 不写文件**：agent 只读取 workspace 背景，最终回复通过 `ResultMessage.result` 返回，由 Python 侧写入 posts JSON。

**回复兜底逻辑（`_extract_reply_body`）**：

若 agent 输出格式不符预期，按以下优先级提取正文：

1. 裸 JSON `{...}` → 提取 `body` 字段
2. ` ```json {...} ``` ` 代码块 → 剥掉 fence 再提取 `body`
3. 普通代码块 → 剥掉 fence 返回内部文本
4. strip 空白后返回原文

**ResultMessage fallback**：若 `ResultMessage.result` 为空（如 `error_max_turns`），使用最后一条 `AssistantMessage` 的文字内容兜底。

### 3.4 label 维护

专家 display label 统一在 `skills/experts/meta.json` 中维护，无需在代码中硬编码。读取优先级：

1. `workspace/config/experts_metadata.json`（话题级覆盖）
2. `skills/experts/meta.json` via `EXPERT_SPECS`（全局默认）
3. `expert_key` 本身（最终兜底）

---

## 四、前端实现

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/api/client.ts` | UPDATE | 新增 `Post` interface、`postsApi`；删除 `commentsApi` |
| `src/components/PostThread.tsx` | NEW | 帖子列表展示；按 `created_at` 升序；回复帖显示引用块（截断 120 字） |
| `src/components/MentionTextarea.tsx` | NEW | 带 `@` 补全的输入框，输入 `@` 弹出专家菜单，选中后插入 `@name` |
| `src/pages/TopicDetail.tsx` | UPDATE | 集成 `PostThread` + `MentionTextarea`；提交后轮询 reply 状态直到 completed/failed |

**MentionTextarea 行为：**
- 检测到 `@` → 拉取 `topicExpertsApi.list()` → 弹出下拉菜单
- 选中专家 → 插入 `@expert_name`，关闭菜单
- 提交时：body 含有效 `@mention` → `postsApi.mention()`；否则 → `postsApi.create()`

**PostThread 行为：**
- `status=pending` → 显示 spinner + "正在思考中..."
- `status=failed` → 显示红色错误提示
- `status=completed` → 渲染 Markdown
- 回复帖顶部显示原贴引用块（作者名 + 内容摘要）

---

## 五、关键设计决策记录

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 后台任务机制 | `threading.Thread` + `asyncio.run()` | FastAPI `BackgroundTasks` 与 `asyncio.create_task` 在 uvicorn 下均有静默失败问题；独立 thread 拥有独立 event loop，可靠运行 |
| agent 工具权限 | `allowed_tools=["Read","Glob"]` + `permission_mode="acceptEdits"` | `bypassPermissions` 忽略 `allowed_tools`，导致 agent 调用 Write 乱创文件；`acceptEdits` 正确尊重工具限制 |
| agent 不写 posts 文件 | agent 只输出文本，Python 写 JSON | agent 写复杂 JSON 格式不可靠；由 Python 侧统一控制格式和 ID 保持一致性 |
| max_turns / budget | 50 turns / $10 | turns 过少（≤20）易撞上限导致 `ResultMessage.result` 为空；budget 过低（$0.5）导致被截断 |
| label 维护 | `skills/experts/meta.json` | 消除 `workspace.py` 中的硬编码 `_LABELS` 字典，与 expert skill 文件统一在 `skills/experts/` 目录维护 |
| user prompt 模板 | `prompts/expert_reply_user_message.md` | 提示词与代码解耦，产品/运营可直接修改文件而无需改代码 |

---

## 六、prompts 目录说明

```
backend/prompts/
  expert_reply_skill.md          # agent system prompt skill 部分
                                 # - 指导读文件策略
                                 # - 快速回复 vs 先确认方向的判断规则
                                 # - 禁止输出 JSON / 禁止写文件
  expert_reply_user_message.md   # agent user message 模板
                                 # 占位符：{topic_title} {user_author} {expert_label} {user_question}
```
