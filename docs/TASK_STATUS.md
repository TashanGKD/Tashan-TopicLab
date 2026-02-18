# agent-topic-lab 任务完成状态

本文档跟踪 REQUIREMENTS_MODE2_AND_FEATURES.md 中定义的所有任务的完成状态。

---

## 📊 总体进度

- ✅ **P1 优先级**：5/5 任务完成（100%）
- ✅ **P2 优先级**：3/3 任务完成（100%）
- 📋 **P3 优先级**：0/4 任务完成（可选功能）

---

## ✅ P1：话题配置与前端展示（已完成）

### Task 1: 话题创建：多轮数可配置
- **需求**：R1, I7 部分
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **实现内容**：
  - `schemas.py`: TopicCreate 和 Topic 增加 `num_rounds: int = Field(default=5, ge=1, le=10)`
  - `store.py`: create_topic 保存 num_rounds
  - `CreateTopic.tsx`: 添加轮数输入框（1-10 范围）
  - `client.ts`: 前端类型定义同步

### Task 2: 话题创建：专家多选
- **需求**：R2, I7 部分
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **实现内容**：
  - `schemas.py`: TopicCreate 和 Topic 增加 `expert_names: list[str] = Field(default_factory=list)`
  - `store.py`: create_topic 保存 expert_names
  - `CreateTopic.tsx`: 添加专家多选复选框，默认全选，验证至少选 1 位
  - `api/experts.py`: 提供专家列表 API

### Task 3: 发起圆桌使用话题配置的轮数与专家
- **需求**：I8
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **依赖**：Task 1, Task 2
- **实现内容**：
  - `api/roundtable.py`: start_roundtable_endpoint 使用 topic.num_rounds 和 topic.expert_names
  - `agent/roundtable.py`:
    - run_roundtable_for_topic 接受 expert_names 参数
    - build_moderator_prompt 动态生成专家列表和数量
    - 仅对选中的专家进行 Task 调用

### Task 4: 前端：帖子 Markdown 渲染
- **需求**：R3, I11
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **实现内容**：
  - 安装 `react-markdown` 包
  - `TopicDetail.tsx`: 使用 ReactMarkdown 渲染话题正文、讨论发言、讨论总结、评论
  - `index.css`: 添加 .markdown-content 样式（h1-h6, code, table, blockquote 等）

### Task 5: 前端：目录导航讨论总结置顶
- **需求**：R4, I12
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **实现内容**：
  - `TopicDetail.tsx`: getNavigationItems 先添加讨论总结，再添加轮次
  - 目录顺序现为：讨论总结 → 第1轮 → 第N轮

---

## ✅ P2：Workspace 角色与专家（已完成）

### Task 6: Workspace：创建 agents/ 与默认 role
- **需求**：I1
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **依赖**：无
- **实现内容**：
  - 在 `workspace.py` 中新增 `_ensure_agents_structure()` 函数
  - `ensure_topic_workspace()` 调用该函数创建 agents 目录结构
  - 为每个专家（physicist, biologist, computer_scientist, ethicist）创建 `agents/<name>/` 目录
  - 如果 `role.md` 不存在，从全局 `skills/researcher_*.md` 拷贝
  - 幂等性保护：已存在的 role.md 不会被覆盖
- **涉及文件**：
  - `backend/app/agent/workspace.py`

### Task 7: 专家构建：build_experts_from_workspace
- **需求**：I2
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **依赖**：无
- **实现内容**：
  - 在 `experts.py` 中新增 `build_experts_from_workspace(workspace_dir, skills_dir, expert_names)` 函数
  - 优先从 workspace `agents/<name>/role.md` 读取角色定义
  - 不存在时回退到全局 `skills/` 目录
  - 仅构建 `expert_names` 列表中指定的专家
  - 所有 prompt 都添加 EXPERT_SECURITY_SUFFIX
  - 添加详细日志记录使用的角色来源
- **涉及文件**：
  - `backend/app/agent/experts.py`

### Task 8: 圆桌仅使用话题专家且从 workspace 构建
- **需求**：I3
- **状态**：✅ 完成
- **完成时间**：2026-02-17
- **依赖**：Task 2, Task 6, Task 7
- **实现内容**：
  - `roundtable.py` 导入 `build_experts_from_workspace`
  - `run_roundtable()` 根据 expert_names 判断使用 workspace 构建还是全局构建
  - 传入 expert_names 时使用 `build_experts_from_workspace()`
  - 未传入时回退到 `build_experts()`（向后兼容）
  - 添加日志记录选中的专家和构建来源
- **涉及文件**：
  - `backend/app/agent/roundtable.py`

---

## 📋 P3：单次问与跟贴（可选）

### Task 9: 主持人 prompt 分支与协作指南
- **需求**：I6
- **状态**：📋 未开始（可选）
- **依赖**：无
- **验收标准**：
  - 根据任务类型（roundtable / ask / follow_up）注入不同说明
  - 提供当前可用专家列表（名称 + description）

### Task 10: 单次问某专家 API（ask）
- **需求**：I4
- **状态**：📋 未开始（可选）
- **依赖**：Task 9
- **验收标准**：
  - 新增 POST /topics/:id/ask API
  - 接受 question、mentions
  - 单次 Task 调用指定专家

### Task 11: 跟贴追问 API（follow_up）
- **需求**：I5
- **状态**：📋 未开始（可选）
- **依赖**：Task 9
- **验收标准**：
  - 新增 POST /topics/:id/follow-up API
  - 注入完整讨论历史和评论
  - 主持人决定派发专家

### Task 12: 前端 @ 与单条回复展示
- **需求**：I13
- **状态**：📋 未开始（可选）
- **依赖**：Task 10, Task 11
- **验收标准**：
  - 发问/跟贴时可选择 @ 某专家
  - 展示单条 AI 回复

---

## 📝 变更记录

| 日期 | 内容 |
|------|------|
| 2026-02-17 | P1 全部完成：多轮数配置、专家多选、Markdown 渲染、目录顺序修复 |
| 2026-02-17 | 创建本任务状态跟踪文档 |
| 2026-02-17 | P2 全部完成：agents/ 目录结构、workspace 专家构建、圆桌集成 |

---

## 🎯 下一步计划

根据优先级，建议按以下顺序推进：

1. ✅ **P1 完成**：多轮数配置、专家多选、Markdown 渲染、目录顺序修复
2. ✅ **P2 完成**：Workspace 角色定制（agents/ 目录、专家构建、圆桌集成）
3. **验收测试**：测试 P1 + P2 功能的端到端流程
4. **评估 P3**：根据产品需求决定是否实现单次提问和跟贴功能
