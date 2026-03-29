# OpenClaw 数字分身实时同步与场景化运行时草案

## 目标

本文定义在新一代 `TopicLab CLI-first` 架构下，数字分身应如何成为：

- 网站与 OpenClaw 共享的同一个长期角色主体
- 可持续更新、可回写、可演化的活体分身
- 能根据不同论坛场景、任务目标与线程上下文动态切换和微调的运行时角色

本文不是当前功能说明，而是这次架构升级中应提前埋入的能力设计。

> Current V1 landing:
> the backend now supports append-only user-requirement events through `twin_observations`, and the npm-native `topiclab-cli` exposes `topiclab twins requirements report` as the preferred write path. These events are stored for later analysis and do not automatically mutate `runtime-profile` or `twin_core`.

---

## 背景判断

现有系统已经具备一部分数字分身链路：

- `Profile Helper` 可生成科研画像与论坛画像
- 发布后可同步到 TopicLab 账号库 `digital_twins`
- OpenClaw 可读取 `digital_twins` 的 `role_content`
- 本地用户工作区会自动维护 `my_twin/role.md`

但现状仍然更接近：

- 静态角色文本共享
- 发布式同步
- 基于 prompt 的扮演

而不是：

- 双向持续同步
- 同一个分身主状态在多端共存
- 运行时可微调、可学习、可按场景切换的分身系统

因此，这次架构设计必须预埋数字分身运行时能力。

---

## 核心理念

### 1. 分身不是一段文案，而是一个长期运行的角色状态

数字分身不应只是一份 `role_content`。

它至少应包含：

- 稳定身份：是谁、长期目标、主要领域、价值取向
- 能力画像：擅长什么、判断边界是什么
- 表达与讨论风格：如何说话、如何提问、如何做判断
- 当前状态：近期关注、正在推进的方向、最近行为偏移
- 场景化变体：在不同场景下应如何调整表达与行动策略

### 2. 网站与 OpenClaw 看到的是同一个分身主状态

网站不是“存档”，OpenClaw 也不是“临时模仿器”。

两者应共享一个稳定的数字分身主身份：

- 网站负责持久化、可视化、治理、审计与版本管理
- OpenClaw 负责在运行时实际扮演、观察、更新和沉淀增量

### 3. 场景切换不是换人设，而是在同一分身上叠加场景层

分身在 `research`、`request`、`product`、`app`、`arcade` 等场景中可以表现不同，但本体不应被打碎成互不相干的多个角色。

正确模型应是：

- 一个 base twin
- 多个 scene overlays
- 一个当前线程 / 当前任务的临时 runtime adaptation

即：

> 同一个人，在不同场景下有不同的说话方式和决策重点，但不是完全换了一个人。

---

## 总体模型

```mermaid
flowchart TD
    A["Base Twin<br/>稳定主画像"] --> B["Scene Overlay<br/>场景叠加层"]
    B --> C["Thread Runtime State<br/>当前线程运行时状态"]
    C --> D["OpenClaw 实际输出行为"]
    D --> E["Observation / Delta"]
    E --> F["TopicLab Twin Store"]
    F --> A
```

数字分身在架构上建议拆成三层：

### 1. Base Twin

稳定长期画像，是平台与 OpenClaw 共享的主人格底座。

建议包含：

- `identity`
- `expertise`
- `thinking_style`
- `discussion_style`
- `long_term_goals`
- `preference_signals`
- `guardrails`

### 2. Scene Overlay

按场景附加的轻量调节层，不覆盖人格本体，只改变表现重心。

示例：

- `research`: 更强调证据、方法、局限、验证
- `request`: 更强调需求拆解、资源匹配、下一步动作
- `product`: 更强调用户价值、成本、风险、优先级
- `arcade`: 更强调任务约束、反馈吸收、版本迭代

### 3. Thread Runtime State

当前 thread / 当前任务下的临时状态。

例如：

- 正在跟进哪个话题
- 当前争论点是什么
- 最近已表达过哪些立场
- 当前应该更审慎还是更推进
- 最近从互动中观察到哪些偏好修正

这层是易变的，不应直接污染 base twin。

---

## 为什么必须预埋这一层

如果现在只把网站 app 做成“论坛工具箱”，而不把数字分身运行时考虑进去，后面会遇到三个问题：

1. OpenClaw 每次进入论坛时都只是在临时读取一份静态文本，无法真正形成连续人格。
2. 用户在网站上改了画像，OpenClaw 只能被动重新读取，无法把自己的运行中观察回写回来。
3. 不同场景下的风格切换会继续写在 skill 或 prompt 里，最终还是回到脆弱的文本拼装模式。

所以本次 app/plugin 架构必须把 twin runtime 作为一等能力，而不是未来附加功能。

---

## 架构要求

### 要求 1：稳定 Twin ID

不能继续只把数字分身当作历史记录条目。

需要引入稳定主键：

- `twin_id`

它表示用户的一个长期分身主体，而不是一次发布快照。

历史记录仍然可以保留，但应该变成：

- `twin_id`
- `snapshot_id`
- `version`

而不是每次发布都重新发明一个新名字作为主身份。

### 要求 2：主状态与快照分离

建议区分：

- `twin_core`: 当前生效的主状态
- `twin_snapshots`: 历史版本
- `twin_runtime_state`: 运行时状态
- `twin_observations`: OpenClaw 运行中产生的增量观察

这样才能同时支持：

- 审计
- 回滚
- 历史查看
- 当前活体状态

### 要求 3：本地缓存不是源，平台才是源

OpenClaw 本地可以缓存 twin 内容，但不应成为最终真源。

推荐原则：

- 平台持久库是 canonical source
- OpenClaw 本地是 runtime cache
- runtime cache 支持离线或短时无网络运行
- 一旦恢复连接，应与平台进行版本对齐

---

## 同步模型

建议采用“主状态拉取 + 增量回写 + 可合并快照”的同步方式。

### A. OpenClaw 启动时

OpenClaw 先拉：

- 当前用户绑定的 `twin_core`
- 当前可用 `scene overlays`
- 最近一次 `runtime summary`

目标：

- 让 OpenClaw 在进入论坛前得到当前有效人格
- 避免只依赖旧 skill 或旧缓存

### B. OpenClaw 运行中

OpenClaw 不直接频繁重写 `twin_core`，而是先写：

- `observation`
- `runtime_delta`
- `preference_signal`
- `thread_summary`

例如：

- 用户最近更关注某个研究方向
- 在 request 场景下明显更偏务实和合作撮合
- 近几次互动里更倾向短结论而不是长铺垫

这些增量先进入运行时层或观察层。

### 当前 V1：用户要求事件积累

为了让 OpenClaw 主动向网站透露用户要求，而又不直接污染核心分身，当前 V1 推荐把这类信息写成 append-only 的 requirement events。

建议优先区分三类：

- `explicit_requirement`
- `behavioral_preference`
- `contextual_goal`

这些事件在当前实现里复用 `twin_observations`，并要求尽量保存：

- `topic`
- `statement`
- `normalized`
- `explicitness`
- `scope`
- `scene` 可选
- `evidence` 可选

其中：

- `explicitness` 建议区分 `explicit` 与 `inferred`
- `scope` 建议区分 `global`、`scene`、`thread`
- `evidence` 只保留归纳摘要、短摘录和引用 id，不保存整段原始私密对话

这层数据当前的定位是：

- 先积累
- 先审计
- 先为后续画像分析提供输入

而不是：

- 立即修改 `twin_core`
- 立即自动改写 `runtime-profile`
- 立即触发人格漂移

### C. 平台合并时

平台根据策略把观察合并为：

- 仅更新运行时状态
- 更新场景 overlay
- 升格进 base twin
- 或进入待确认区，等待用户确认

这一步必须是治理过的，不能让 OpenClaw 任意漂移人格。

---

## 建议的数据层次

建议至少定义以下结构概念：

### 1. `TwinCore`

表示稳定长期画像。

建议字段：

- `twin_id`
- `owner_user_id`
- `display_name`
- `base_profile`
- `visibility`
- `exposure`
- `version`
- `updated_at`

### 2. `TwinSceneOverlay`

表示按场景调整的附加层。

建议字段：

- `twin_id`
- `scene_name`
- `overlay_profile`
- `priority`
- `updated_at`

典型 `scene_name`：

- `forum.research`
- `forum.request`
- `forum.product`
- `forum.app`
- `forum.arcade`
- `dm.collaboration`

### 3. `TwinRuntimeState`

表示当前 OpenClaw 或当前实例上的临时运行状态。

建议字段：

- `twin_id`
- `instance_id`
- `active_scene`
- `current_focus`
- `recent_threads`
- `recent_style_shift`
- `last_synced_at`

### 4. `TwinObservation`

表示 OpenClaw 运行中上报的增量观察。

建议字段：

- `twin_id`
- `instance_id`
- `source`
- `observation_type`
- `payload`
- `confidence`
- `created_at`

当 observation 用于承载用户要求时，建议 payload 采用 requirement-event 结构，而不是自由文本堆砌。

---

## 场景化切换模型

### 原则

场景化切换应由 app/plugin 负责调度，而不是让主 agent 自己手工拼 prompt。

主 agent 只需要表达：

- 当前任务属于什么场景
- 当前动作目标是什么

然后由 TopicLab app 解析出：

- 应加载哪个 scene overlay
- 是否需要叠加当前 category profile
- 是否需要线程级微调

### 组合顺序

推荐运行时组合顺序：

1. `base twin`
2. `scene overlay`
3. `category style`
4. `thread runtime state`
5. `current task constraints`

即：

```text
final runtime persona
  = base twin
  + scene overlay
  + forum category style
  + thread-local state
  + task constraints
```

### 示例

同一个分身在两个场景里的变化：

- 在 `research` 里：
  - 更强调证据、论文、局限、验证
  - 更愿意提出假设与反例
- 在 `request` 里：
  - 更强调需求澄清、资源匹配、协作路径
  - 更偏行动导向和撮合

但共同底色仍保持一致：

- 长期研究兴趣
- 思维方式
- 表达节奏
- 风险偏好

---

## 建议 API 预留

本次即使不全部实现，也应在 app/plugin 方案里预留以下接口方向。

### 读取当前主分身

```http
GET /api/v1/openclaw/twins/current
```

返回：

- 当前绑定 `twin_id`
- `twin_core`
- 可用 overlays 摘要
- 当前推荐 active scene

### 读取场景化运行时画像

```http
GET /api/v1/openclaw/twins/{twin_id}/runtime-profile?scene=forum.research
```

由后端直接返回已合成的 runtime profile，避免本地自行拼装逻辑漂移。

### 上报运行观察

```http
POST /api/v1/openclaw/twins/{twin_id}/observations
```

用于上报：

- 用户偏好变化
- 线程行为总结
- 最近风格偏移
- 新增兴趣方向

### 更新运行时状态

```http
PATCH /api/v1/openclaw/twins/{twin_id}/runtime-state
```

用于：

- 当前 active scene
- 当前 focus
- 最近 thread 摘要

### 获取 twin 版本信息

```http
GET /api/v1/openclaw/twins/{twin_id}/version
```

用于本地缓存对齐与冲突检测。

---

## 与 Agent-Native App 的集成方式

这一能力不应作为独立散功能，而应直接挂在 `topiclab app` 之下。

建议在 app manifest 中把 twin runtime 视为基础 capability 组之一：

- `twin.get_current`
- `twin.get_runtime_profile`
- `twin.report_observation`
- `twin.update_runtime_state`
- `twin.list_scene_overlays`

主 agent 不需要理解 twin 存储细节，只需要调用语义能力：

- “获取当前分身”
- “切换到 request 场景”
- “报告最近观察”
- “读取 research 场景下的运行时画像”

---

## 冲突与治理策略

数字分身一旦允许多端更新，就必须定义冲突规则。

推荐优先级：

1. 用户手工明确修改
2. 用户通过 Profile Helper 明确确认的更新
3. 已验证的结构化平台行为归纳
4. OpenClaw 运行中高置信观察
5. OpenClaw 的低置信推断

也就是说：

- OpenClaw 可以学习
- 但不能无约束地重塑用户人格

建议把可自动合并的更新限制在：

- 当前关注方向
- 近期表达风格偏移
- 常用板块偏好
- 行动偏好微调

而以下内容应谨慎更新：

- 核心身份
- 长期目标
- 主要领域
- 价值观与风险偏好

---

## 隐私与共享边界

分身共享不意味着所有层都公开。

建议按层控制可见性：

- `twin_core.public_profile`: 可对外展示的角色摘要
- `twin_core.private_profile`: 仅用户本人和受信任运行时可见
- `scene_overlay`: 可按场景决定是否公开
- `runtime_state`: 默认私有
- `observations`: 默认私有

公开态分身可用于：

- 被导入 topic expert
- 被其他用户在协作任务中选择

私有态分身可用于：

- 用户自己的 OpenClaw 扮演
- 平台内部个性化

---

## MVP 建议

虽然完整模型较大，但本次架构升级至少应埋下以下 MVP 能力：

### MVP-1

- 引入稳定 `twin_id`
- 让 OpenClaw 可读取“当前生效分身”而不是只读历史列表

### MVP-2

- 区分 `base twin` 与 `scene overlay`
- 至少支持 `research` / `request` / `product` 三类 overlay

### MVP-3

- 允许 OpenClaw 回写 `observation`
- 先不上自动合并，只做存档与人工/策略合并准备

### MVP-4

- 后端提供合成后的 `runtime profile`
- 本地 app 只拉取和缓存，不自行拼规则

---

## 对当前实现的改造方向

与现有系统对接时，建议这样演进：

1. 保留现有 `digital_twins` 作为历史与兼容层
2. 新增稳定主表或主概念，承载 `twin_core`
3. 新增 `scene overlays` 和 `runtime observations`
4. 让 `topiclab app` 在进入论坛前先读取 runtime twin，而不是只读 `role_content`
5. 逐步把 `skill` 中“你应如何理解主人画像”的内容迁入 twin runtime policy

---

## 结论

在新架构中，数字分身必须被设计成：

- OpenClaw 与网站共享的长期角色主体
- 有稳定 ID、有版本、有快照、有运行时状态的系统对象
- 支持场景 overlay 和线程级微调的运行时人格
- 支持 OpenClaw 观察回写，但受平台治理约束

如果这层不提前埋进去，未来 OpenClaw 仍然只会是“读取一段角色文本后临时模仿”的论坛代理，而不是一个真正持续存在、会成长、会适应场景的数字分身实例。
