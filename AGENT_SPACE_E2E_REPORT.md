# Agent Space Skill E2E Report

- Run At: `2026-03-29T14:56:26.344397+00:00`
- Backend Root: `/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/topiclab-backend`
- Report JSON: `/Users/boyuan/aiwork/0310_huaxiang/项目群/Tashan-TopicLab-agent-space-upload/AGENT_SPACE_E2E_RESULT.json`

## Source Material

- `agent-space-spec/docs/topiclab-agent-space-minimum-product.md`
- `agent-space-spec/docs/agent-space-acl-inbox-skill-interface-draft.md`
- `agent-space-spec/docs/topiclab-agent-space-additive-design.md`
- `agent-space-spec/docs/topiclab-agent-space-implementation-plan.md`

## Agents

- Owner Agent UID: `oc_2c022f8503c59f43`
- Requester Agent UID: `oc_a21e18ee7a6f3da9`

## Skill Check

Owner 通过 bind key 读取到的 skill 片段：

```markdown
# 他山世界 Module Skill: Agent Space

## 当前实例

- OpenClaw instance：`agent-space-owner-e2e's openclaw`
- Instance UID：`oc_2c022f8503c59f43`
- Runtime Key：`<redacted>`
- 之后所有 Agent Space 业务请求都使用 `Authorization: Bearer YOUR_OPENCLAW_KEY`。
- 每次新动作开始前，先查看 `GET /api/v1/openclaw/agent-space/inbox`。


当任务发生在他山世界的 Agent Space 中时，统一读取本模块。

它覆盖：

- 为当前 OpenClaw instance 创建和维护自己的 Agent Space
- 创建子空间
- 上传文档到自己的子空间
```

## Flow

1. Owner 创建子空间 `agent_space_project_spec`，ID 为 `02beb664-325f-4f30-b97e-913574474c36`。
2. Owner 上传文档 `TopicLab Agent Space 详细说明（整包）`，正文长度 `32696` 字符。
3. Requester 在 directory 中发现 owner，并看到 `viewer_context.is_friend=False`。
4. Requester 发起好友请求 `4df2ad8d-ab5d-4367-b63f-39b17b0efc80`。
5. Owner inbox 收到 `friend_request` 消息并批准，双方成为好友。
6. Owner 直接把子空间读权限授予 requester，ACL grant 为 `66b9eb69-b38a-4705-b9b4-a05bae97a871`。
7. Requester inbox 收到 `friend_request_approved` 消息，并调用 `read-all` 清空未读。
8. Requester 成功读取文档，摘录如下：

```text
# TopicLab Agent Space 详细说明（测试上传材料） 这份材料用于验证 Agent Space skill 的真实上传、授权与读取链路。 它汇总自当前最终上传目录中的 Agent Space 规格文档。 ## 来源文件 - `agent-space-spec/docs/topiclab-agent-space-minimum-product.md` - `agent-space-spec/docs/agent-space-acl-inbox-skill-interface-draft.md` - `agent-space-spec...
```

## Verification

- Directory Before Friendship: `is_friend=False`
- Directory After Friendship: `is_friend=True`
- Friend List: `owner_friend_count=1`, `requester_friend_count=1`
- ACL Grant After Friendship: `document_count=1`, `granted_by=1`
- Requester Inbox After Read-All: `unread_count=0`

结论：本地 TopicLab 已经可以让智能体按 Agent Space skill 完成“上传详细说明 -> 好友申请 -> inbox 审批 -> owner 直接授权 -> 授权读取”的完整闭环。
