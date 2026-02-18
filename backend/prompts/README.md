# AI 生成提示词管理

本目录存放所有用于 AI 生成功能的系统提示词（System Prompts）。

## 文件结构

```
skills/prompts/
├── README.md                    # 本文件
├── expert_generation.md         # 专家角色生成提示词
└── moderator_generation.md      # 主持人模式生成提示词
```

## 提示词文件

### expert_generation.md

**用途**：生成专家角色定义

**触发场景**：用户在"创建新专家"时输入名称、标签和简介后，点击"AI 生成角色定义"

**输入**：
- 专家名称（英文，如 `quantum_biologist`）
- 专家标签（中文，如 `量子生物学家`）
- 专家简介（描述性文本）

**输出**：完整的专家角色定义（Markdown 格式），包括：
- `EXPERT_NAME:` 元数据行
- `EXPERT_LABEL:` 元数据行
- 身份
- 专长领域
- 思维特点
- 讨论风格

### moderator_generation.md

**用途**：生成主持人模式提示词

**触发场景**：用户在"编辑自定义主持人提示词"对话框中输入描述后，点击"AI 生成提示词"

**输入**：用户对讨论模式的描述（如"评估 AI 风险，深入讨论潜在问题"）

**输出**：完整的主持人 prompt 模板，包含：
- 角色定位
- 每轮讨论的重点和引导要求
- 收敛策略
- 最终产出要求
- 占位符（`{topic}`, `{ws_abs}`, `{expert_names_str}` 等）

## 提示词设计原则

1. **明确性**：清晰说明 AI 需要生成什么样的内容
2. **格式规范**：定义严格的输出格式，便于代码解析
3. **示例驱动**：提供具体示例，帮助 AI 理解期望的输出
4. **可扩展性**：不限制生成内容的长度，允许 AI 充分发挥
5. **占位符保留**：对于模板类提示词，明确要求保留占位符不替换

## 修改提示词

修改提示词文件后，后端会在下次调用时自动加载新内容（无需重启）。

## 调用链路

```
前端 UI
  ↓
API 调用 (topicExpertsApi.generate / moderatorModesApi.generate)
  ↓
后端 API 端点 (topic_experts.py / moderator_modes.py)
  ↓
生成函数 (generation.py)
  ↓
加载提示词 (load_prompt())
  ↓
调用 AI API (httpx → ZhipuAI)
  ↓
解析响应
  ↓
返回前端
```

## 注意事项

- 提示词文件使用 UTF-8 编码
- 使用 Markdown 格式便于阅读和维护
- 系统会从 `backend/skills/prompts/` 目录加载提示词
- 提示词独立于业务代码，便于非技术人员调整优化
