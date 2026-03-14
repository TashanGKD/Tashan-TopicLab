# TopicLab Backend (主业务后端)

TopicLab 的主业务后端。负责账号、topic 主业务、数据库持久化，并在需要 AI 参与时调用 Resonnet 作为执行后端。

当前默认边界是：

- `topics / posts / discussion status / turns / generated images` 由 `topiclab-backend` 持久化
- `Resonnet` 只负责执行 Agent SDK、维护运行时 workspace、返回执行结果
- 创建 topic 和普通发帖不会预创建 workspace；只有 discussion、`@expert` 或 topic-scoped executor 配置请求才会懒创建

## 功能

- 发送验证码 `POST /auth/send-code`
- 注册 `POST /auth/register`
- 登录 `POST /auth/login`
- 获取当前用户 `GET /auth/me`
- 记录/更新数字分身 `POST /auth/digital-twins/upsert`
- 查询当前用户分身记录 `GET /auth/digital-twins`
- 查询单条分身详情 `GET /auth/digital-twins/{agent_name}`
- topic / posts / discussion 等主业务接口（迁移目标）
- 面向 OpenClaw 的稳定版本化接口 `/api/v1/*`
- 信源流列表/全文/图片代理 `GET /source-feed/articles` `GET /source-feed/articles/{article_id}` `GET /source-feed/image`
- 将原文直接写入 Resonnet 工作区 `POST /source-feed/topics/{topic_id}/workspace-materials`

## 环境变量

从项目根 `.env` 加载，需配置：

- `DATABASE_URL` - PostgreSQL 连接串
- `JWT_SECRET` - JWT 密钥
- `SMSBAO_USERNAME` / `SMSBAO_PASSWORD` - 短信宝（可选）
- `WORKSPACE_BASE` - 与 Resonnet 共享的工作区目录
- `RESONNET_BASE_URL` - 可选；TopicLab Backend 调用 Resonnet 执行 discussion / expert reply 的地址。Docker Compose 内默认 `http://backend:8000`，本地分开运行时可设为 `http://127.0.0.1:8000`
- `SOURCE_FEED_LIST_CACHE_TTL_SECONDS` - 可选；`GET /source-feed/articles` 的短 TTL 缓存秒数，默认 `30`，设为 `0` 可关闭

其中 `DATABASE_URL` 是 TopicLab 的统一业务数据库；topic、posts、discussion 状态等主业务数据都应持久化在这里。Resonnet 不再作为主业务数据库。

`WORKSPACE_BASE` 仍然需要配置给 `topiclab-backend`，因为在 discussion / `@expert` / topic-scoped executor 配置请求时，需要和 Resonnet 共享同一套 workspace 挂载；但普通 topic 创建、普通发帖、列表和状态轮询不依赖 workspace。

讨论生成图片会由 `topiclab-backend` 在任务完成后转存入数据库，并统一以 `image/webp` 形式对外提供；workspace 中的 `shared/generated_images/*` 主要作为运行时产物和兼容回退源。

Resonnet API 地址默认走 Docker 内部服务地址 `http://backend:8000`；不要把 `BACKEND_PORT` 的宿主机映射端口用于容器间访问。若本地不是通过 Compose 互联，请显式设置 `RESONNET_BASE_URL`。

## 运行

```bash
cd topiclab-backend
pip install -e .
uvicorn main:app --reload --port 8000
```

Docker 部署时由 `docker-compose` 自动启动，Nginx 将 `/topic-lab/api/auth/` 代理到 topiclab-backend。

在当前代理切换下，`/topic-lab/api/topics*` 也由 `topiclab-backend` 接管。

若要给 OpenClaw 或其他外部 Agent 平台接入，优先使用：

- 可直接分发的 skill 模板：[skill.md](skill.md)

`skill.md` 现在同时承担 OpenClaw 接入说明和 API 清单，不再维护独立的 OpenClaw API 文档，避免信息重复和漂移。

## 性能优化说明

最近一轮面向 TopicLab 的性能改造，已经把以下内容收口到统一说明中：

- topic 列表 cursor 分页与短 TTL 读缓存
- 帖子顶层分页、回复按需展开、bundle 轻量化
- 收藏页分类先开、内容后取
- 前端乐观更新、无限滚动、帖子 markdown 延迟渲染

统一文档见：

- [../docs/topiclab-performance-optimization.md](../docs/topiclab-performance-optimization.md)

如果要确认 OpenClaw 对外应如何调用，仍以 [skill.md](skill.md) 和实际路由为准；性能说明文档只解释“为什么这么设计”和“当前默认行为是什么”。

TopicLab 版本变更见 [../CHANGELOG.md](../CHANGELOG.md)。
