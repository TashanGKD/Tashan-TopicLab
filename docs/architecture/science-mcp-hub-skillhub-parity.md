# Science MCP Hub / SkillHub 能力对齐矩阵

当前活动科研 MCP 目录是静态 `taxonomy_reviewed` 快照；用户交互、愿望和候选提交存放在独立表中。两者不能混计。

## 参考实现

页面参考为线上 [科研 SkillHub](https://world.tashan.chat/apps/skills)；对应开源仓库为 [TashanGKD/Tashan-TopicLab](https://github.com/TashanGKD/Tashan-TopicLab)。MCP Hub 复用其产品信息架构，而不是另起一套目录 UI：

- `frontend/src/pages/AppsSkillLibraryPage.tsx`：页面顺序为标题说明、`CriticWorkbench`、三维科研 Wiki、目录筛选/搜索、结果列表和选中详情。
- MCP 首页只替换标题、叙事、目录数据和服务调用；不新增 SkillHub 没有的筛选、统计卡、缺口提示、社区快捷入口或独立分页。主目录筛选只保留领域、阶段、功能。
- `frontend/src/components/apps/CriticWorkbench.tsx`：Skill/MCP 评测入口及服务不可用时的明确状态。
- `frontend/src/components/apps/FindScienceWorkbench.tsx`：领域 → 阶段 → 功能的逐层导航模型；MCP 对应实现为 `McpTaxonomyWorkbench.tsx`。
- `frontend/src/pages/AppsSkillDetailPage.tsx`：详情页使用 `ImmersiveAppShell`、`AppsPanel`、证据内容、收藏/评议/分享和登录门槛；MCP 详情保持同一壳层，但下载固定为只读不可用状态。

| SkillHub 能力 | MCP Hub 对应面 | 状态 | 约束 |
| --- | --- | --- | --- |
| Library / search / category | `/mcphub` + `/api/v1/mcp-hub/science-catalog`、`/finder/capabilities`、`/find`、`/categories` | 已实现 | 固定 9/42/5/17 taxonomy；旧 `/mcps`、`/meta`、`/search` 仅作兼容别名 |
| Streaming requirement search | `/api/v1/mcp-hub/science-catalog/find/stream` | 已实现 | 与 SkillHub 共用 AgentScope + `find-science-skills` + SCNet/GLM-5.2；登录后做模型路由和候选语义复核，匿名或模型不可用时确定性回退，页面明确显示本次结果来源 |
| Skill detail | `/mcphub/:mcpId` + `/mcps/:mcpId` | 已实现 | 只读 canonical 证据 |
| Content / guide / asset | `/mcps/:mcpId/content`、`/guide.md`、`/assets/:mcpId` | 已实现 | 返回非执行型 Markdown 证据记录 |
| Favorite | `/mcps/:mcpId/favorite` | 已实现 | 登录后写入独立收藏表 |
| Review / Helpful | `/mcps/:mcpId/reviews`、`/reviews/:id/helpful` | 已实现 | 结构化评分与证据反馈 |
| Leaderboard | `/leaderboard` | 已实现 | 仅统计 Hub 贡献 |
| Wishes / vote | `/wishes`、`/wishes/:id/vote` | 已实现 | 作为科研缺口协作层 |
| Collections | `/collections`、`/collections/:id/items/:mcpId` | 已实现 | 仅保存活动 MCP ID |
| Profile | `/profile` | 已实现 | 收藏、评议、愿望、集合、提交汇总 |
| Contribution tasks | `/tasks` | 已实现 | 无点数，不触发第三方运行 |
| Publish / version | `/submissions` + `/mcphub/publish` | 已调整 | 候选固定 `needs_review`；复核同步后才可能入活动目录 |
| Critic evaluation | 复用 `/skill-hub/evaluations` 的 `kind=mcp` 契约 | 已覆盖 | MCP Hub 不自动触发评测；仅保留用户主动提交的既有评测入口 |
| Share | `/mcphub/share?mcp=...` | 已实现 | 跳转 canonical 详情 |
| Download status | `/mcps/:mcpId/download` | 已实现（安全占位） | 保留 SkillHub 路由形态，但固定 `available=false`，不产生安装/执行动作 |
| Download / asset execution | 不提供 | 有意不实现 | 当前授权禁止安装、启动、调用第三方 MCP |
| OpenClaw key rotation | 不复制 | 有意不实现 | 不是 MCP 目录分类能力，避免引入运行时权限面 |

## 资产身份与详情路径补充

- 后端在读取活动快照时同时校验 `id` 唯一、原始 `source_url` 唯一和规范化 canonical URL 唯一；规范化只用于身份判重（协议/主机大小写、默认端口、末尾斜杠和片段），不改写保存的一手证据 URL。
- 首页选中目录卡片保留 SkillHub 的右侧展开详情，同时提供“打开完整详情”路由，可进入 `/mcphub/:mcpId` 查看完整来源记录、许可证证据和社区评议。
- MCP 与 Skill 检索统一优先读取 `SCNET_API_KEY`，固定走 SCNet 的 OpenAI-compatible `/chat/completions` 与 `GLM-5.2`；迁移期仅在新变量缺失时兼容旧 `skillhub_scnet_api_key`，不保留 Anthropic 或其他模型的隐式替代分支。
- 检索驱动状态只有三类：`model` 表示 AI 完成路径与候选复核，`model_route_local_rank` 表示 AI 完成路径但目录完成排序，`local_fallback` 表示匿名、未配置或模型调用失败后使用目录匹配。三类状态均返回 API 并在检索结果区显示，不静默降级。
- 新补全的一手信息页在完整详情中展示保存状态、实际来源、HTTP 响应、保存时间、字节数和 SHA-256；许可证优先显示规范化名称，没有名称时保留一手原文，不推断缺失许可证。

## 计数不变量

- 活动目录规模 = `science_mcp_catalog.json.entries` 中 `taxonomy.review_status == taxonomy_reviewed` 的条目数。
- 退休档案、用户行为、集合、评议、愿望和候选提交不参与活动规模或新增 KPI。
- 候选提交的 `active_catalog_effect` 固定为 `none_until_taxonomy_reviewed_sync`。
- 阶段×功能结构性 gap 只保留在索引与日志中，不作为页面提示，也不要求填满 5×17 笛卡尔积。

## 快照与提交约定

- `scripts/sync_science_mcp_catalog.py` 与 SkillHub 的目录同步脚本一样，必须显式传入 `--source`；仓库不保存个人工作区路径。
- 发布快照只保留页面、API 和来源复核需要的字段。原始缓存路径、调试用工具名和重复字段不写入仓库；最终来源 URL、HTTP 状态、抓取时间与 SHA-256 统一保存在 `source_verification`。
- 本地生成与校验命令：`python scripts/sync_science_mcp_catalog.py --source <science-mcp-catalog.json>`，随后追加 `--check` 验证结果可复现。
- CI 同时运行 MCP 快照、目录边界、社区交互与前端构建测试；活动目录和社区数据仍保持物理分离。
