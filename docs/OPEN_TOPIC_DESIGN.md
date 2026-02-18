# 开放式话题设计：从"一次性讨论"到"持续协作空间"

**提出时间**：2026-02-17
**核心理念**：话题是一个开放的协作空间，支持多种 AI 交互形态

---

## 🎯 设计理念转变

### 从"固定模式"到"开放空间"

#### 旧设计（P1/P2）
```
话题 = 一次讨论
├─ 创建时选择模式（roundtable/human_agent/both）
├─ 创建时选择专家
├─ 发起一次圆桌讨论
└─ 结束
```

**限制**：
- ❌ 话题 = 一次性的讨论
- ❌ 模式固定，不可变更
- ❌ 专家固定，无法调整
- ❌ 只能发起一次圆桌

#### 新设计（开放式话题）
```
话题 = 持续的协作空间
├─ 创建：标题 + 可选说明（极简）
└─ 进入后支持多种交互：
    ├─ 🤖 发起 AI 自驱动多轮会话
    │   ├─ 自定义专家组（动态添加/生成）
    │   ├─ 自定义主持人模式
    │   ├─ 可发起多次（不同配置）
    │   └─ 每次会话独立记录
    ├─ 💬 人发帖/评论
    ├─ 🎯 人 @ 单个专家提问
    ├─ 🔄 跟贴追问
    └─ 📝 其他交互形态...
```

**优势**：
- ✅ 话题 = 长期协作项目
- ✅ 交互形态灵活多样
- ✅ 可以多次发起不同的 AI 会话
- ✅ 专家组可以动态调整
- ✅ 人机协作更自然

---

## 📐 核心概念重新定义

### 1. 话题（Topic）

**本质**：一个独立的协作工作区

**核心属性**（极简）：
```typescript
interface Topic {
  id: string
  title: string              // 必填
  description?: string       // 可选说明
  status: 'open' | 'closed'  // 开放/关闭
  created_at: string
  updated_at: string
  // 移除：mode, num_rounds, expert_names（这些是会话级配置）
}
```

**Workspace 结构**：
```
workspace/topics/{id}/
├── topic.json              # 话题元数据（极简）
├── agents/                 # 专家池（动态管理）
│   ├── physicist/
│   ├── economist/
│   └── quantum_biologist/
├── shared/                 # 共享空间
│   ├── posts/             # 人发的帖子
│   ├── comments/          # 评论
│   └── files/             # 共享文件
└── sessions/              # AI 会话记录（多次）
    ├── session_001/       # 第一次圆桌
    │   ├── config.json   # 会话配置（专家组、模式、轮数）
    │   ├── discussion_history.md
    │   ├── discussion_summary.md
    │   └── turns/
    ├── session_002/       # 第二次圆桌（不同配置）
    │   └── ...
    └── session_003/       # 第三次会话
        └── ...
```

---

### 2. AI 会话（Session）

**本质**：一次 AI 自驱动的多轮讨论

**会话配置**：
```typescript
interface AISession {
  id: string                    // session_001
  topic_id: string
  type: 'roundtable' | 'debate' | 'brainstorm' | ...
  moderator_mode: string        // 主持人模式 ID
  expert_names: string[]        // 本次会话参与的专家
  num_rounds: number            // 本次会话的轮数
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  started_at?: string
  completed_at?: string
}
```

**关键特性**：
- 一个话题可以有多个会话（sessions）
- 每次会话可以使用不同的专家组
- 每次会话可以使用不同的主持人模式
- 每次会话的结果独立存储

---

### 3. 人机交互形态

话题内支持的所有交互形态：

```mermaid
flowchart TB
    Topic[话题空间]

    Topic --> AI[AI 交互]
    Topic --> Human[人类交互]

    AI --> Session1[发起 AI 会话]
    Session1 --> Config[配置会话]
    Config --> Experts[选择/生成专家组]
    Config --> Mode[选择/生成主持人模式]
    Config --> Rounds[设置轮数]
    Config --> Start[启动会话]

    Human --> Post[发帖]
    Human --> Comment[评论]
    Human --> Ask[@专家提问]
    Human --> FollowUp[跟贴追问]

    AI --> Record1[会话 1 结果]
    AI --> Record2[会话 2 结果]
    AI --> RecordN[会话 N 结果]
```

---

## 🎨 用户体验流程

### 极简的话题创建

**创建话题表单**：
```tsx
<CreateTopicForm>
  <Input
    label="话题标题"
    required
    placeholder="例如：AI 在教育领域的应用探讨"
  />
  <Textarea
    label="话题说明"
    optional
    placeholder="（可选）为这个话题添加背景描述或讨论范围..."
  />
  <Button type="submit">创建话题</Button>
</CreateTopicForm>
```

**仅需 2 个字段**：
- ✅ 标题（必填）
- ✅ 说明（可选）

**不需要**：
- ❌ 选择模式
- ❌ 选择专家
- ❌ 配置轮数

---

### 话题详情页：开放的协作空间

```tsx
<TopicDetailPage>
  {/* 话题基本信息 */}
  <TopicHeader>
    <h1>{topic.title}</h1>
    <p>{topic.description}</p>
  </TopicHeader>

  {/* Tab 切换 */}
  <Tabs>
    <Tab id="overview">概览</Tab>
    <Tab id="sessions">AI 会话</Tab>
    <Tab id="posts">讨论区</Tab>
    <Tab id="experts">专家管理</Tab>
    <Tab id="files">文件</Tab>
  </Tabs>

  {/* 概览 Tab */}
  <TabPanel id="overview">
    <RecentActivity />        {/* 最近动态 */}
    <SessionsList limit={3} /> {/* 最近 3 次 AI 会话 */}
    <PostsList limit={5} />    {/* 最近 5 条讨论 */}
  </TabPanel>

  {/* AI 会话 Tab */}
  <TabPanel id="sessions">
    <Button onClick={createNewSession}>
      🤖 发起新的 AI 会话
    </Button>

    <SessionsList>
      {sessions.map(session => (
        <SessionCard
          title={session.moderator_mode_name}
          experts={session.expert_names}
          rounds={session.num_rounds}
          status={session.status}
          createdAt={session.created_at}
        />
      ))}
    </SessionsList>
  </TabPanel>

  {/* 讨论区 Tab */}
  <TabPanel id="posts">
    <Button onClick={createPost}>✏️ 发帖</Button>
    <Button onClick={askExpert}>🎯 @专家提问</Button>

    <PostsList>
      {/* 人发的帖子、评论、AI 回复 */}
    </PostsList>
  </TabPanel>

  {/* 专家管理 Tab */}
  <TabPanel id="experts">
    <ExpertManagement>
      <Button>📚 从预设添加</Button>
      <Button>✏️ 创建新专家</Button>
      <Button>🤖 AI 生成专家</Button>
    </ExpertManagement>

    <ExpertsList>
      {/* 本话题的专家池 */}
    </ExpertsList>
  </TabPanel>
</TopicDetailPage>
```

---

### 发起 AI 会话的流程

```tsx
<CreateSessionDialog>
  <Step1>
    <h3>选择主持人模式</h3>
    <ModeSelector>
      <Option>标准圆桌</Option>
      <Option>头脑风暴</Option>
      <Option>辩论赛</Option>
      <Option>评审会</Option>
      <Option>自定义</Option>
    </ModeSelector>
    <Button>🤖 AI 生成模式</Button>
  </Step1>

  <Step2>
    <h3>选择参与专家</h3>
    <ExpertSelector>
      {topicExperts.map(expert => (
        <Checkbox
          label={expert.label}
          description={expert.description}
        />
      ))}
    </ExpertSelector>
    <Button>+ 临时添加专家</Button>
  </Step2>

  <Step3>
    <h3>配置会话参数</h3>
    <Input label="轮数" type="number" min={1} max={10} />
    <Input label="最大 turns" type="number" />
    <Input label="预算上限" type="number" />
  </Step3>

  <Button onClick={startSession}>🚀 启动 AI 会话</Button>
</CreateSessionDialog>
```

---

## 🔄 典型使用场景

### 场景 1：深度探讨某个话题

1. **创建话题**："AI 伦理困境：自动驾驶的道德选择"
2. **添加专家**：
   - 从预设添加：ethicist, computer_scientist
   - AI 生成：法律专家（"我需要一位专注于交通法律的专家"）
3. **第一次 AI 会话**：
   - 模式：标准圆桌
   - 专家：ethicist, computer_scientist, lawyer
   - 轮数：5
   - 结果：形成初步共识
4. **人发帖**：基于 AI 会话的总结，提出新的疑问
5. **@专家提问**："@ethicist 如果乘客和行人只能救一个，应该优先救谁？"
6. **第二次 AI 会话**：
   - 模式：辩论赛（针对这个问题深入辩论）
   - 专家：ethicist, lawyer
   - 轮数：3
   - 结果：辩论记录
7. **持续讨论**：人继续发帖、评论、追问...

### 场景 2：产品创意评审

1. **创建话题**："新产品创意：AI 驱动的个性化学习平台"
2. **添加专家**：
   - 手动创建：product_manager, investor
   - 从预设添加：computer_scientist, ethicist
3. **第一次 AI 会话**（头脑风暴）：
   - 模式：头脑风暴
   - 专家：全部 4 位
   - 轮数：5
   - 结果：收集大量创意点
4. **人发帖**：整理创意，提出 3 个方向
5. **第二次 AI 会话**（评审会）：
   - 模式：评审会
   - 专家：product_manager, investor, computer_scientist
   - 轮数：3
   - 结果：对 3 个方向打分和建议
6. **第三次 AI 会话**（技术可行性）：
   - 模式：自定义（专注技术实现）
   - 专家：computer_scientist
   - 轮数：2
   - 结果：技术方案

### 场景 3：学习研究某个领域

1. **创建话题**："量子计算入门学习"
2. **AI 生成专家**："我需要一位量子物理学教授"
3. **系列学习会话**：
   - 会话 1：量子计算基础概念（标准圆桌，5 轮）
   - 会话 2：量子算法深入（自定义模式，3 轮）
   - 会话 3：量子计算应用案例（头脑风暴，4 轮）
4. **人发帖**：学习笔记、疑问
5. **@专家提问**：随时提问
6. **持续学习**：话题成为长期学习空间

---

## 📊 数据模型调整

### Topic 模型（简化）

```python
class Topic(BaseModel):
    id: str
    title: str                      # 必填
    description: Optional[str]      # 可选
    status: TopicStatus            # open | closed
    created_at: str
    updated_at: str

    # 移除以下字段（移到 Session 级别）：
    # mode: TopicMode
    # num_rounds: int
    # expert_names: list[str]
    # roundtable_result: ...
    # roundtable_status: ...
```

### AISession 模型（新增）

```python
class AISessionConfig(BaseModel):
    moderator_mode_id: str          # 主持人模式
    expert_names: list[str]         # 参与专家
    num_rounds: int                 # 轮数
    max_turns: int = 60
    max_budget_usd: float = 5.0

class AISession(BaseModel):
    id: str                         # session_001
    topic_id: str
    config: AISessionConfig
    status: SessionStatus           # pending | running | completed | failed
    result: Optional[SessionResult]
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]

class SessionResult(BaseModel):
    discussion_history: str
    discussion_summary: str
    turns_count: int
    cost_usd: Optional[float]
```

### Post 模型（人类讨论）

```python
class Post(BaseModel):
    id: str
    topic_id: str
    author: str
    author_type: AuthorType         # human | agent
    title: Optional[str]            # 帖子标题（可选）
    body: str                       # 正文
    parent_id: Optional[str]        # 回复的帖子 ID（支持嵌套）
    mentions: list[str]             # @的专家
    created_at: str
```

---

## 🏗️ Workspace 结构（完整版）

```
workspace/topics/{topic_id}/
├── topic.json                      # 话题元数据（极简）
│
├── agents/                         # 专家池（话题级）
│   ├── physicist/
│   │   ├── role.md
│   │   ├── memory.md              # 跨会话的持久记忆
│   │   └── notes.md
│   ├── economist/
│   └── quantum_biologist/
│
├── config/                         # 话题配置
│   ├── experts_metadata.json     # 专家元信息
│   └── moderator_modes.json      # 自定义主持人模式（话题级）
│
├── sessions/                       # AI 会话记录（多次）
│   ├── session_001/
│   │   ├── config.json            # 会话配置
│   │   ├── discussion_history.md
│   │   ├── discussion_summary.md
│   │   └── turns/
│   │       ├── round1_physicist.md
│   │       └── ...
│   ├── session_002/
│   └── session_003/
│
├── shared/                         # 共享空间
│   ├── posts/                     # 人类讨论帖子
│   │   ├── post_001.md
│   │   ├── post_002.md
│   │   └── ...
│   ├── comments/                  # 评论（可选）
│   │   └── comments.json
│   └── files/                     # 共享文件
│       └── references.md
│
└── analytics/                      # 分析数据（可选）
    ├── session_stats.json         # 会话统计
    └── expert_contribution.json   # 专家贡献度
```

---

## 🔄 API 设计调整

### Topic API（简化）

```python
# 创建话题（极简）
POST /topics
{
  "title": "AI 在教育领域的应用",
  "description": "探讨 AI 技术如何改变教育..."  # 可选
}

# 获取话题详情
GET /topics/{id}
# 返回：topic 基本信息 + 最近活动摘要

# 关闭话题
POST /topics/{id}/close
```

### AISession API（新增）

```python
# 创建 AI 会话
POST /topics/{id}/sessions
{
  "moderator_mode_id": "brainstorm",
  "expert_names": ["physicist", "economist"],
  "num_rounds": 5,
  "max_turns": 60,
  "max_budget_usd": 5.0
}

# 获取话题的所有会话
GET /topics/{id}/sessions

# 获取单个会话详情
GET /topics/{id}/sessions/{session_id}

# 获取会话状态（实时）
GET /topics/{id}/sessions/{session_id}/status
```

### Post API（人类讨论）

```python
# 发帖
POST /topics/{id}/posts
{
  "title": "关于伦理问题的疑问",  # 可选
  "body": "我认为...",
  "parent_id": null,              # null 表示顶级帖子
  "mentions": ["ethicist"]        # @的专家
}

# 获取话题的所有帖子
GET /topics/{id}/posts

# 回复帖子
POST /topics/{id}/posts
{
  "body": "回复内容",
  "parent_id": "post_001",        # 回复某个帖子
  "mentions": []
}
```

---

## 🎯 实现优先级（重新排序）

### Phase 0：数据模型重构（基础）
1. 简化 Topic 模型（移除 mode, num_rounds, expert_names 等）
2. 新增 AISession 模型
3. 调整 Workspace 结构
4. 数据迁移方案

### Phase 1：话题级专家管理（不变）
- 保持之前的设计

### Phase 2：AI 会话管理（核心新增）
1. AISession CRUD API
2. 多会话支持
3. 会话独立存储
4. 前端会话列表/详情 UI

### Phase 3：主持人模式（不变）
- 保持之前的设计

### Phase 4：人类讨论区（新增）
1. Post/Comment API
2. @专家提问
3. 前端讨论区 UI

---

## 🎉 设计优势总结

### 1. 极简创建 ✨
- 话题创建只需标题（+ 可选说明）
- 降低入门门槛
- 快速开始协作

### 2. 持续协作 🔄
- 话题不再是"一次性讨论"
- 可以多次发起不同的 AI 会话
- 支持长期迭代和演进

### 3. 灵活组合 🧩
- 每次会话可以不同专家组
- 每次会话可以不同模式
- AI 交互 + 人类讨论无缝结合

### 4. 真正的工作区 💪
- 话题 = 独立的协作项目空间
- 专家池、会话记录、讨论帖子都在一个空间
- 完整的上下文和历史

### 5. 扩展性强 📈
- 可以添加更多交互形态
- 可以引入更多 AI 能力
- 可以支持团队协作

---

## 🚀 与之前设计的关系

这个"开放式话题"设计是对"增强设计"的进一步升华：

| 方面 | 增强设计 | 开放式话题设计 |
|------|---------|---------------|
| **话题创建** | 简化，不选专家/模式 | 极简，只需标题 |
| **专家管理** | 话题级动态管理 | ✅ 保持不变 |
| **主持人模式** | 可选择/自定义/AI 生成 | ✅ 保持不变 |
| **AI 会话** | 发起一次圆桌 | **多次会话，每次独立配置** |
| **人机交互** | 主要是 AI 讨论 | **AI 会话 + 人类讨论 + @提问** |
| **话题性质** | 一次讨论 | **持续协作空间** |

**关键变化**：
- ✅ 话题更轻量（只需标题）
- ✅ 支持多次 AI 会话（session 概念）
- ✅ AI 与人类交互并存
- ✅ 话题成为长期协作项目

---

## 📝 总结

这个"开放式话题"设计将 agent-topic-lab 从：
- **"AI 圆桌讨论工具"**

提升为：
- **"AI 驱动的协作工作空间平台"**

用户可以：
1. 创建一个话题（极简）
2. 动态组建专家团队
3. 多次发起不同配置的 AI 会话
4. 人机混合讨论
5. 持续迭代和深化

这是一个更加开放、灵活、强大的设计！🎉
