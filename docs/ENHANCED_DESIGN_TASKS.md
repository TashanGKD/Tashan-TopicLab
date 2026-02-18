# 增强设计实现任务清单

**创建时间**：2026-02-17
**最后更新**：2026-02-17（改进为渐进式演进策略）
**设计文档**：[ENHANCED_DESIGN_PROPOSAL.md](./ENHANCED_DESIGN_PROPOSAL.md)

---

## ⚠️ 重要说明：渐进式演进，非重构

本任务清单采用**渐进式增强**策略，而非破坏性重构：

### ✅ 保留现有功能
- Topic 模型保留 `expert_names` 和 `num_rounds` 字段
- 创建话题时可以选择初始专家（现有流程继续工作）
- 所有已创建的话题无需迁移，继续正常使用

### 🔄 增量增强
- 在现有基础上**增加**动态专家管理能力
- **增加**主持人模式选择功能
- **增加**AI 生成辅助功能
- 每个功能都是独立的增强，而非依赖链

### 🎯 权威来源迁移
- **创建时**：`topic.expert_names` 用于快速初始化 workspace
- **运行时**：圆桌从 `workspace/agents/` 动态读取（权威来源）
- **结果**：用户可以创建后调整专家，发起圆桌时使用实际配置

### 📊 影响评估
- **零破坏性变更**：所有现有代码和话题继续工作
- **新功能可选**：用户可以选择使用或继续旧流程
- **平滑过渡**：逐步迁移，无需大规模数据迁移

---

## 📋 任务概览（渐进式）

| Sprint | 任务数 | 优先级 | 预计时间 | 状态 |
|--------|--------|--------|---------|------|
| Sprint 1：基础专家管理 | 6 | 🔥 必做 | 2-3 天 | 📋 待开始 |
| Sprint 2：AI 生成专家 | 2 | ⭐ 推荐 | 1-2 天 | 📋 待开始 |
| Sprint 3：预设主持人模式 | 4 | ⭐ 推荐 | 2-3 天 | 📋 待开始 |
| Sprint 4：AI 生成模式 | 3 | 💡 可选 | 1-2 天 | 📋 待开始 |
| Sprint 5：测试与文档 | 3 | 🔥 必做 | 1-2 天 | 📋 待开始 |
| Sprint 6：生态扩展 | 4 | 💡 长期 | 2-3 天 | 📋 待开始 |

**MVP**（最小可行实现）：Sprint 1 + Sprint 3 + Sprint 5 = **5-7 天**

---

## 🔥 Phase 1：话题级专家管理（核心功能）

### 后端任务

#### Task 1.1：专家元数据管理
- [ ] **新增数据模型**
  - `TopicExpert` schema（name, label, description, source）
  - `AddExpertRequest` schema（支持 preset/custom/ai_generated）
  - `GenerateExpertRequest` schema
- [ ] **工作区结构扩展**
  - 创建 `workspace/topics/{id}/config/` 目录
  - 创建 `experts_metadata.json` 文件
  - 实现 `load_experts_metadata()` 函数
  - 实现 `save_experts_metadata()` 函数
- **涉及文件**：
  - `backend/app/models/schemas.py`
  - `backend/app/agent/workspace.py`
  - `backend/app/models/store.py`（可选）

#### Task 1.2：话题专家 CRUD API
- [ ] **GET /topics/{id}/agents**
  - 从 `agents/` 目录动态读取专家列表
  - 合并 `experts_metadata.json` 的元信息
  - 返回完整的专家列表（含 source, label 等）
- [ ] **POST /topics/{id}/agents - 从预设添加**
  - 验证 preset_name 有效性
  - 从 `backend/skills/` 拷贝到 `workspace/topics/{id}/agents/{name}/`
  - 更新 `experts_metadata.json`
- [ ] **POST /topics/{id}/agents - 手动创建**
  - 验证 name 唯一性
  - 创建 `agents/{name}/role.md` 文件
  - 更新 `experts_metadata.json`
- [ ] **PUT /topics/{id}/agents/{name}**
  - 更新 `agents/{name}/role.md` 内容
  - 更新 `experts_metadata.json`（如果需要）
- [ ] **DELETE /topics/{id}/agents/{name}**
  - 删除 `agents/{name}/` 目录
  - 从 `experts_metadata.json` 移除
  - 验证至少保留 1 位专家（可选）
- **涉及文件**：
  - `backend/app/api/experts.py`（新增或扩展）
  - 或新建 `backend/app/api/topic_experts.py`

#### Task 1.3：AI 生成专家功能
- [ ] **POST /topics/{id}/agents/generate**
  - 设计专家生成的 system prompt
  - 调用 Claude SDK 生成 role.md 内容
  - 从生成结果中提取专家名称
  - 创建 `agents/{name}/role.md`
  - 更新 `experts_metadata.json`（source="ai_generated"）
- [ ] **生成质量优化**
  - Prompt 设计：确保输出格式统一
  - 提取专家名称：从 markdown 标题提取
  - 验证生成内容：包含必要章节
  - 添加标准章节：工作区说明、讨论规则、安全约束
- **涉及文件**：
  - `backend/app/api/topic_experts.py`
  - `backend/app/agent/generation.py`（新建）

#### Task 1.4：增强话题创建流程（保持向后兼容）
- [ ] **保留 Topic 模型字段，增加元数据层**
  - 保留 `TopicCreate` 中的 `expert_names`（允许空数组）
  - 保留 `Topic` 中的 `expert_names`（用于记录初始选择）
  - 新增 `is_from_topic_creation` 标记（区分初始专家和后续添加）
  - 数据迁移：现有话题无需修改
- [ ] **增强 ensure_topic_workspace**
  - 创建 `config/` 目录
  - 根据 expert_names 初始化 `experts_metadata.json`
  - 如果 expert_names 为空，创建空的 metadata
  - agents/ 目录根据 expert_names 初始化（保持现有逻辑）
- [ ] **修改圆桌启动逻辑**
  - 优先从 `workspace/agents/` 动态读取专家（权威来源）
  - topic.expert_names 仅用于初始化参考
  - 记录日志：使用了哪些专家（来自 workspace）
- **涉及文件**：
  - `backend/app/models/schemas.py`
  - `backend/app/models/store.py`
  - `backend/app/agent/workspace.py`
  - `backend/app/agent/roundtable.py`

**设计说明**：
- **不破坏现有功能**：创建时选择专家的流程继续工作
- **增加灵活性**：创建后可以动态修改专家列表
- **权威来源迁移**：从 topic.expert_names → workspace/agents/ 目录

### 前端任务

#### Task 1.5：创建话题页面增强（保持现有功能）
- [ ] **保留现有专家选择，标记为"可选"**
  - 保持 `CreateTopic.tsx` 中的 expert_names 表单
  - 将专家选择区域标题改为"初始专家（可选）"
  - 添加说明文字："可以现在选择，也可以创建后在话题内添加"
  - 允许不选择任何专家（空数组）
  - 更新表单验证：不再要求至少选 1 位
- [ ] **添加"快速模板"建议（可选）**
  - 提供快速选项："标准配置（4 位）"、"小型讨论（2 位）"、"稍后配置（0 位）"
  - 用户可选择模板或自定义
- **涉及文件**：
  - `frontend/src/pages/CreateTopic.tsx`
  - `frontend/src/api/client.ts`（无需修改，已兼容）

**设计说明**：
- **不移除功能**：快速创建流程继续可用
- **降低门槛**：允许创建"空"话题，后续配置
- **引导用户**：通过 UI 提示两种使用方式

#### Task 1.6：话题详情页 - 专家管理 UI
- [ ] **专家列表展示**
  - 新增 `ExpertList` 组件
  - 显示专家名称、标签、来源
  - 添加编辑、删除按钮
- [ ] **从预设添加专家**
  - 新增 `PresetExpertDialog` 组件
  - 调用 GET /experts 获取全局预设
  - 调用 POST /topics/{id}/agents 添加
- [ ] **手动创建专家**
  - 新增 `CreateExpertDialog` 组件
  - 表单：name, label, description, role_content
  - 调用 POST /topics/{id}/agents 创建
- [ ] **编辑专家**
  - 新增 `EditExpertDialog` 组件
  - 加载现有 role.md 内容
  - 调用 PUT /topics/{id}/agents/{name} 更新
- [ ] **删除专家**
  - 确认对话框
  - 调用 DELETE /topics/{id}/agents/{name}
- **涉及文件**：
  - `frontend/src/pages/TopicDetail.tsx`
  - `frontend/src/components/ExpertManagement.tsx`（新建）
  - `frontend/src/api/client.ts`

#### Task 1.7：AI 生成专家 UI
- [ ] **AI 生成对话框**
  - 新增 `AIGenerateExpertDialog` 组件
  - Textarea 输入用户描述
  - Loading 状态（生成中）
  - 预览生成结果
  - 允许用户编辑后确认
  - 调用 POST /topics/{id}/agents/generate
- [ ] **用户体验优化**
  - 示例 prompt 提示
  - 生成失败处理
  - 生成内容预览（markdown 渲染）
- **涉及文件**：
  - `frontend/src/components/AIGenerateExpertDialog.tsx`（新建）
  - `frontend/src/api/client.ts`

#### Task 1.8：发起圆桌前验证与准备
- [ ] **动态验证专家列表**
  - 调用 `GET /topics/{id}/agents` 获取当前专家（不是 topic.expert_names）
  - 如果专家数量 < 1，禁用"发起圆桌"按钮
  - 显示提示："请至少添加 1 位专家后再发起圆桌"
  - 如果专家数量 >= 1，显示当前专家列表预览
- [ ] **主持人模式选择（可选）**
  - 如果未配置模式，使用默认"标准圆桌"
  - 显示当前使用的模式名称
  - 提供"配置模式"快捷链接
- [ ] **圆桌启动 API 调用**
  - 保持现有 API 调用方式
  - 后端从 workspace/agents/ 自动读取专家
  - 前端仅传递轮数、budget 等运行参数
- [ ] **启动前确认对话框（可选）**
  - 显示即将使用的专家列表
  - 显示主持人模式
  - 显示轮数和预算
  - 用户确认后启动
- **涉及文件**：
  - `frontend/src/pages/TopicDetail.tsx`
  - `frontend/src/api/client.ts`

**设计说明**：
- **动态验证**：基于 workspace 实际状态，而非 topic.expert_names
- **用户友好**：清晰展示即将使用的配置
- **灵活启动**：可以随时调整专家和模式后重新发起

---

## ⭐ Phase 2：主持人模式（增强功能）

### 后端任务

#### Task 2.1：预设主持人模式库
- [ ] **定义预设模式数据结构**
  - `ModeratorMode` schema
  - `TopicModeratorConfig` schema
  - `SetModeratorModeRequest` schema
  - `GenerateModeratorModeRequest` schema
- [ ] **实现预设模式**
  - 标准圆桌模式
  - 头脑风暴模式
  - 辩论赛模式
  - 评审会模式
  - （可选）更多模式
- [ ] **模式存储机制**
  - `workspace/topics/{id}/config/moderator_mode.json`
  - `load_moderator_mode()` 函数
  - `save_moderator_mode()` 函数
- **涉及文件**：
  - `backend/app/models/schemas.py`
  - `backend/app/agent/moderator_modes.py`（新建）
  - `backend/app/agent/workspace.py`

#### Task 2.2：主持人模式 API
- [ ] **GET /moderator-modes**
  - 返回所有预设模式列表
  - 包含 id, name, description, num_rounds 等
- [ ] **GET /topics/{id}/moderator-mode**
  - 读取 `config/moderator_mode.json`
  - 如果不存在，返回默认模式
- [ ] **PUT /topics/{id}/moderator-mode**
  - 支持选择预设模式
  - 支持自定义模式（custom_prompt）
  - 保存到 `config/moderator_mode.json`
- **涉及文件**：
  - `backend/app/api/moderator_modes.py`（新建）

#### Task 2.3：AI 生成主持人模式
- [ ] **POST /topics/{id}/moderator-mode/generate**
  - 设计主持人模式生成的 system prompt
  - 调用 Claude SDK 生成主持人 prompt
  - 验证生成内容格式
  - 保存为自定义模式
- [ ] **生成质量优化**
  - Prompt 设计：明确输出格式要求
  - 提取关键元素：流程、收敛策略、产出要求
  - 验证生成内容：包含必要部分
- **涉及文件**：
  - `backend/app/api/moderator_modes.py`
  - `backend/app/agent/generation.py`

#### Task 2.4：修改圆桌执行逻辑
- [ ] **使用话题配置的主持人模式**
  - `run_roundtable_for_topic()` 读取 moderator_mode.json
  - 根据 mode_id 选择对应的 prompt 模板
  - 如果是自定义模式，使用 custom_prompt
  - 替换 `build_moderator_prompt()` 调用
- [ ] **向后兼容**
  - 旧话题没有 moderator_mode.json 时使用默认
- **涉及文件**：
  - `backend/app/agent/roundtable.py`
  - `backend/app/api/roundtable.py`

### 前端任务

#### Task 2.5：主持人模式选择 UI
- [ ] **模式选择器**
  - 新增 `ModeratorModeSelector` 组件
  - 下拉菜单：显示预设模式列表
  - 调用 GET /moderator-modes 获取预设
  - 选择后调用 PUT /topics/{id}/moderator-mode
- [ ] **当前模式展示**
  - 显示模式名称、描述
  - 显示收敛策略（可选）
  - 显示轮数配置
- [ ] **轮数配置**
  - Number input（1-10）
  - 绑定到模式配置
- **涉及文件**：
  - `frontend/src/pages/TopicDetail.tsx`
  - `frontend/src/components/ModeratorModeConfig.tsx`（新建）
  - `frontend/src/api/client.ts`

#### Task 2.6：自定义主持人模式 UI
- [ ] **自定义模式编辑**
  - 新增 `CustomModeratorModeDialog` 组件
  - Textarea 编辑主持人 prompt
  - 提供模板参考
  - 调用 PUT /topics/{id}/moderator-mode（mode_id="custom"）
- [ ] **用户体验优化**
  - Prompt 模板提示
  - 语法高亮（可选）
  - 预览效果（可选）
- **涉及文件**：
  - `frontend/src/components/CustomModeratorModeDialog.tsx`（新建）

#### Task 2.7：AI 生成主持人模式 UI
- [ ] **AI 生成对话框**
  - 新增 `AIGenerateModeratorModeDialog` 组件
  - Textarea 输入用户需求描述
  - Loading 状态
  - 预览生成的 prompt
  - 允许编辑后确认
  - 调用 POST /topics/{id}/moderator-mode/generate
- [ ] **用户体验优化**
  - 示例需求提示
  - 生成失败处理
  - 生成内容预览
- **涉及文件**：
  - `frontend/src/components/AIGenerateModeratorModeDialog.tsx`（新建）
  - `frontend/src/api/client.ts`

---

## 💡 Phase 3：优化扩展（低优先级）

#### Task 3.1：专家模板库扩展
- [ ] 添加更多预设专家（10-20 个）
  - 不同学科领域
  - 不同视角（如批判性、建设性）
  - 行业专家（如产品经理、投资人）
- [ ] 专家分类标签
- [ ] 专家搜索功能

#### Task 3.2：主持人模式模板库扩展
- [ ] 添加更多预设模式（10+ 个）
  - 不同讨论场景
  - 不同收敛策略
  - 行业定制模式
- [ ] 模式分类标签
- [ ] 模式预览功能

#### Task 3.3：专家/模式分享功能
- [ ] 导出专家定义（JSON/Markdown）
- [ ] 导入专家定义
- [ ] 导出主持人模式
- [ ] 导入主持人模式
- [ ] 社区模板市场（可选）

#### Task 3.4：跨话题配置复用
- [ ] 从其他话题导入专家
- [ ] 从其他话题导入主持人模式
- [ ] 话题模板功能（保存整个配置）

---

## 🔄 数据迁移任务

### Task M1：旧话题兼容处理
- [ ] **识别旧话题**
  - 检查是否有 expert_names 字段
  - 检查 agents/ 目录是否为空
- [ ] **迁移专家数据**
  - 从 expert_names 读取专家列表
  - 如果 agents/ 为空，从全局预设拷贝
  - 生成 experts_metadata.json
- [ ] **迁移模式数据**
  - 创建 config/moderator_mode.json
  - 使用默认模式（standard）
- [ ] **迁移脚本**
  - 实现一次性迁移脚本
  - 或在 initialize_store_from_workspace() 中自动迁移
- **涉及文件**：
  - `backend/app/models/store.py`
  - `backend/scripts/migrate_topics.py`（新建）

---

## 📝 文档更新任务

#### Task D1：API 文档更新
- [ ] 更新 OpenAPI/Swagger 文档
- [ ] 添加新增 API 的示例
- [ ] 更新现有 API 的说明（移除 expert_names）

#### Task D2：用户文档
- [ ] 创建用户指南：如何管理专家
- [ ] 创建用户指南：如何选择/定制主持人模式
- [ ] 创建用户指南：如何使用 AI 生成功能
- [ ] 更新 README.md

#### Task D3：开发文档
- [ ] 更新架构设计文档
- [ ] 更新数据模型文档
- [ ] 添加 AI 生成功能的技术说明
- [ ] 更新 TASK_STATUS.md

---

## 🧪 测试任务

### 单元测试

#### Task T1：后端单元测试
- [ ] 专家 CRUD API 测试
- [ ] AI 生成专家测试（mock Claude SDK）
- [ ] 主持人模式 API 测试
- [ ] AI 生成模式测试（mock Claude SDK）
- [ ] 数据迁移测试

### 集成测试

#### Task T2：端到端测试
- [ ] 创建话题 → 添加专家 → 发起圆桌 → 验证流程
- [ ] AI 生成专家 → 使用专家参与讨论
- [ ] 选择主持人模式 → 验证讨论流程符合模式
- [ ] AI 生成模式 → 使用模式主持讨论
- [ ] 旧话题兼容性测试

### 前端测试

#### Task T3：UI 测试
- [ ] 专家管理 UI 交互测试
- [ ] 主持人模式选择 UI 测试
- [ ] AI 生成对话框测试
- [ ] 表单验证测试

---

## 🎯 渐进式实现顺序（向后兼容）

### 🔥 Sprint 1：基础专家管理（核心 - 必做）

**目标**：在现有基础上增加动态专家管理，不破坏现有流程

#### 后端（串行）
1. Task 1.1 - 专家元数据管理（新增 config/experts_metadata.json）
2. Task 1.2 - 专家 CRUD API（GET/POST/PUT/DELETE）
3. Task 1.4 - 增强话题创建流程（保持 expert_names，增加元数据）

#### 前端（串行）
4. Task 1.5 - 创建话题页面增强（标记为"可选"，允许空）
5. Task 1.6 - 专家管理 UI（话题详情页新增面板）
6. Task 1.8 - 发起圆桌验证（动态检查 workspace/agents/）

**验收标准**：
- ✅ 现有话题和流程继续工作
- ✅ 可以在话题内添加/删除/编辑预设专家
- ✅ 发起圆桌时使用 workspace 中的实际专家

**预计时间**：2-3 天

---

### ⭐ Sprint 2：AI 生成专家（增强 - 推荐）

**目标**：增加 AI 辅助生成专家能力

#### 后端（串行）
7. Task 1.3 - AI 生成专家功能（新建 generation.py，设计 prompt）

#### 前端（串行）
8. Task 1.7 - AI 生成专家 UI（对话框 + 预览）

**验收标准**：
- ✅ 用户可以通过自然语言生成专家
- ✅ 支持预览和编辑生成结果

**预计时间**：1-2 天

---

### 🎨 Sprint 3：预设主持人模式（增强 - 推荐）

**目标**：提供多种讨论模式选择

#### 后端（串行）
9. Task 2.1 - 预设主持人模式库（定义 4-5 种模式）
10. Task 2.2 - 主持人模式 API（GET/PUT）
11. Task 2.4 - 修改圆桌执行逻辑（集成模式配置）

#### 前端（串行）
12. Task 2.5 - 主持人模式选择 UI

**验收标准**：
- ✅ 用户可以选择预设讨论模式
- ✅ 圆桌讨论按照选定模式执行

**预计时间**：2-3 天

---

### 🤖 Sprint 4：AI 生成模式（扩展 - 可选）

**目标**：完全自定义主持人行为

#### 后端（串行）
13. Task 2.3 - AI 生成主持人模式

#### 前端（串行）
14. Task 2.6 - 自定义主持人模式 UI
15. Task 2.7 - AI 生成模式 UI

**验收标准**：
- ✅ 用户可以编写/生成自定义主持人 prompt

**预计时间**：1-2 天

---

### 🧪 Sprint 5：测试与文档（必做）

**并行任务**：
16. Task T1 → Task T2 → Task T3（测试）
17. Task D1 → Task D2 → Task D3（文档更新）
18. Task M1（数据迁移脚本 - 可选，因为已兼容）

**预计时间**：1-2 天

---

### 💡 Sprint 6：生态扩展（长期 - 可选）

19. Task 3.1 → Task 3.2 → Task 3.3 → Task 3.4（模板库、分享、复用）

**预计时间**：2-3 天（可持续扩展）

---

## 📋 最小可行实现（MVP）

如果时间有限，建议先完成：

1. **Sprint 1**（必做）：基础专家管理
2. **Sprint 3**（高价值）：预设主持人模式
3. **Sprint 5**（必做）：测试与文档

**总时间**：5-7 天

后续可以根据用户反馈决定是否实现 AI 生成功能（Sprint 2 + 4）。

---

## 🔄 并行开发建议

如果有多人协作，可以并行：

- **前端开发**：在后端 API 完成前，先用 mock 数据开发 UI
- **AI 功能**：Sprint 2（AI 生成专家）可以在 Sprint 1 后独立开发
- **文档**：Sprint 5 可以在各 Sprint 完成后持续更新

---

## 📊 进度跟踪

### Phase 1 进度
- [ ] Task 1.1 - 专家元数据管理
- [ ] Task 1.2 - 专家 CRUD API
- [ ] Task 1.3 - AI 生成专家功能
- [ ] Task 1.4 - 修改话题创建流程
- [ ] Task 1.5 - 创建话题页面简化
- [ ] Task 1.6 - 专家管理 UI
- [ ] Task 1.7 - AI 生成专家 UI
- [ ] Task 1.8 - 发起圆桌验证

**进度**：0/8 (0%)

### Phase 2 进度
- [ ] Task 2.1 - 预设主持人模式库
- [ ] Task 2.2 - 主持人模式 API
- [ ] Task 2.3 - AI 生成主持人模式
- [ ] Task 2.4 - 修改圆桌执行逻辑
- [ ] Task 2.5 - 主持人模式选择 UI
- [ ] Task 2.6 - 自定义主持人模式 UI
- [ ] Task 2.7 - AI 生成主持人模式 UI

**进度**：0/7 (0%)

### Phase 3 进度
- [ ] Task 3.1 - 专家模板库扩展
- [ ] Task 3.2 - 主持人模式模板库扩展
- [ ] Task 3.3 - 专家/模式分享功能
- [ ] Task 3.4 - 跨话题配置复用

**进度**：0/4 (0%)

---

## 🎉 完成标准

### Phase 1 完成标准
- ✅ 可以在话题内动态添加/删除专家
- ✅ 可以从预设添加专家
- ✅ 可以手动创建专家
- ✅ 可以 AI 生成专家
- ✅ 创建话题时不需要选择专家
- ✅ 发起圆桌前验证至少有 1 位专家
- ✅ 旧话题兼容正常

### Phase 2 完成标准
- ✅ 可以选择预设主持人模式
- ✅ 可以自定义主持人 prompt
- ✅ 可以 AI 生成主持人模式
- ✅ 圆桌讨论按照选定模式执行
- ✅ 不同模式有明显区别（收敛策略）

### Phase 3 完成标准
- ✅ 有丰富的专家模板库
- ✅ 有丰富的主持人模式库
- ✅ 可以导入/导出配置
- ✅ 可以跨话题复用配置

---

## 📅 时间估算

| Phase | 预计工作量 | 备注 |
|-------|-----------|------|
| Phase 1 | 3-5 天 | 核心功能，包含 AI 生成 |
| Phase 2 | 2-3 天 | 增强功能 |
| Phase 3 | 1-2 天 | 扩展功能（可选） |
| 测试 + 文档 | 1-2 天 | 测试和文档完善 |
| **总计** | **7-12 天** | 视具体实现深度而定 |

---

## 🚀 快速启动

要开始实现，建议按以下顺序：

1. **阅读设计文档**：[ENHANCED_DESIGN_PROPOSAL.md](./ENHANCED_DESIGN_PROPOSAL.md)
2. **选择起点**：
   - 如果从后端开始：Task 1.1 → 1.2 → 1.3
   - 如果从前端开始：Task 1.5 → 1.6
   - 如果并行开发：同时进行后端和前端任务
3. **创建任务跟踪**：在 TASK_STATUS.md 中更新进度
4. **提交变更**：每完成一个 Task 提交一次

---

**文档版本**：v1.0
**最后更新**：2026-02-17
**维护者**：开发团队
