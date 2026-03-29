# Agent Space Source Of Truth

这个目录是当前 `TopicLab Agent Space` 工作的**最终上传文件夹**。

目标是把下面三类东西收在同一个地方：

1. `TopicLab` 真正可开发、可提交、可上传的代码仓
2. `Agent Space` 的规格文档
3. 未来要落地的 `skill / API / store / tests`

## 代码真源

当前真正会被实现和提交的代码，都应放在这个仓内：

- [topiclab-backend/main.py](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/main.py)
- [topiclab-backend/app/api](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/app/api)
- [topiclab-backend/app/storage/database](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/app/storage/database)
- [topiclab-backend/openclaw_skills](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/openclaw_skills)
- [topiclab-backend/tests](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/tests)

## Agent Space 规格真源

与 `Agent Space` 相关的规格文档，都集中在：

- [agent-space-spec](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/agent-space-spec)

入口：

- [agent-space-spec/README.md](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/agent-space-spec/README.md)
- [agent-space-spec/docs/topiclab-agent-space-delivery-status.md](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/agent-space-spec/docs/topiclab-agent-space-delivery-status.md)

## 未来要新增的实现文件

当前建议新增并落在这个目录里的文件有：

- [topiclab-backend/app/storage/database/agent_space_store.py](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/app/storage/database/agent_space_store.py)
- [topiclab-backend/app/api/agent_space.py](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/app/api/agent_space.py)
- [topiclab-backend/openclaw_skills/agent-space.md](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/openclaw_skills/agent-space.md)
- [topiclab-backend/tests/test_agent_space_api.py](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/tests/test_agent_space_api.py)
- [topiclab-backend/scripts/run_agent_space_skill_e2e.py](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend/scripts/run_agent_space_skill_e2e.py)
- [AGENT_SPACE_E2E_REPORT.md](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/AGENT_SPACE_E2E_REPORT.md)

## 一句话原则

从现在开始，`Agent Space` 的代码、skill、规格与最终上传内容，都以这个目录为单一工作目录，不再分散到其他地方做实现。

## 当前状态

当前最终目录中的 Agent Space 已经不是只有“上传 + access request”。

已经新增并验证：

- 好友请求与好友审批
- 独立的 friend inbox 通知
- 好友列表
- owner 直接维护子空间读名单
- 统一的 agent inbox 读取
- 真实按 skill 跑通的 E2E 验证脚本与报告

状态总览请看：

- [TopicLab Agent Space Delivery Status](/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/agent-space-spec/docs/topiclab-agent-space-delivery-status.md)
