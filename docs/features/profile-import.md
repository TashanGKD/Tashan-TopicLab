# 从已有活动导入个人资料

用户用他山账号登录后，可以自愿从已关联的旧活动账号读取姓名、单位、专业、研究方向，核对后保存到统一资料；接入网站再按授权范围预填。各活动继续保存自己的报名、投稿、附件与审核记录。

## 范围

本期只做四件事：来源授权、本人资料预览、逐项确认保存、授权与来源记录。不做后台持续同步、不做统计后台、不做用户画像、不合并账号、不改写历史报名。

导入字段固定为四项，均写入既有 `user_profiles` 列，不新增资料列：

| 统一字段 | 含义 | 上限 |
| --- | --- | --- |
| `real_name` | 姓名 | 80 |
| `organization` | 单位 | 160 |
| `major` | 专业 | 300 |
| `research_direction` | 研究方向 | 2000 |

## 身份与归属

- 身份只来自登录会话：服务端用 `get_current_user` 取 `user_id`，不接受前端传入的手机号、`source_user_id` 或 `user_id`。
- 来源归属只来自来源站既有的绑定（实训营 `tashan_identity_links`、论坛 `tashan_links`），按 `topiclab:<user_id>` 查询。没有绑定就返回“尚未关联”，不会按手机号、姓名或邮箱合并。
- 手机号在整条链路中不参与匹配，也不从来源读取。

## 流程

1. `GET /api/v1/profile-import/sources`：可用来源与授权文案版本。
2. `POST /api/v1/profile-import/authorizations`：用户同意后生成授权记录（10 分钟有效，范围固定为四项，记录文案版本与用途）。
3. `POST /api/v1/profile-import/previews`：服务端带签名访问来源，返回当前值、来源值、来源时间、来源活动。**预览不修改个人资料**。
4. `POST /api/v1/profile-import/commits`：携带 `preview_id`、`preview_token`、`expected_version`、`idempotency_key`、逐项 `selections` 与 `origin`，服务端校验后单条条件更新。
5. `POST /api/v1/profile-import/authorizations/{id}/cancel`：取消未完成的授权，之后的预览与提交都被拒绝。
6. `GET /api/v1/profile-import/history`：授权记录、状态、范围、文案版本、已采用字段（不含资料值）。

### 服务端校验

- 预览与提交绑定同一用户、同一来源、同一次授权；令牌只保存哈希。
- 提交要求授权仍为 `granted` 且未过期、预览未过期未使用、`expected_version` 与当前版本一致，否则 `409` 并要求重新核对。
- 幂等：`(user_id, idempotency_key)` 唯一，相同请求重复提交返回首次结果；同一键不同内容返回 `409 IDEMPOTENCY_CONFLICT`。
- 空值不覆盖：空白选择直接跳过，从不写入空字符串覆盖已有值。
- 字段白名单在服务端执行，`phone`、`password`、角色、管理员权限等一律拒绝。
- 版本检查使用 `UPDATE ... WHERE version=:expected RETURNING version`，并发冲突不静默覆盖。

### 来源记录

`profile_field_sources` 按字段记录 `source`（来源系统或 `user`）、`source_updated_at`、`adopted_at`。来源没有提供时间时存 `NULL`，界面显示“来源未提供时间”，不编造最新时间。

实训营把专业与研究方向存为同一个 `major_research_direction` 字段，来源接口原样返回并标注 `combined_field`，界面提示“来源为组合字段，保留原文”，不拆分。

### 审计

`profile_import_events` 只记录动作、字段名、来源、授权 ID、文案版本与结果，不记录资料值；请求体在访问日志中被排除（`main.py` 的敏感路径列表包含 `/api/v1/profile-import/`）。

## 来源连接器

中央按来源配置 `PROFILE_SOURCE_<SOURCE>_URL` 与 `PROFILE_SOURCE_<SOURCE>_SECRET`，未配置时该来源显示为不可用，不会回退到模拟数据。请求为 `POST` + HMAC-SHA256（`timestamp.nonce.rawBody`，±300 秒），不跟随重定向，超时 8 秒；来源不可用返回 `503`，用户可重试或跳过。

来源实现见实训营 `docs/profile-source.md` 与论坛 `docs/profile-source.md`。

## 测试环境

| 项 | 值 |
| --- | --- |
| 域名 | `tashan-auth-staging.tashan.ac.cn` |
| 目录 | `/data/tashan-auth-staging`（compose 项目 `tashan-auth-staging`） |
| 端口 | 仅 `127.0.0.1:18984` |
| 数据库 | `tashan_auth_staging`，卷 `tashan-auth-staging-database` |
| 工作流 | `Deploy unified login staging`（`deploy-auth-staging.yml`） |

`AUTH_STAGING_ENV` 至少包含：`DATABASE_URL`（指向上面的测试库）、`POSTGRES_PASSWORD`、`JWT_SECRET`、`PROFILE_SOURCE_CAMP_URL/SECRET`、`PROFILE_SOURCE_FORUM_URL/SECRET`。来源地址必须是测试域名，禁止指向正式站。

### 回退

停止 `tashan-auth-staging` 项目即可回到未启用状态；`profile_import_*` 与 `profile_field_sources` 为新增表，回退镜像不删除，用户资料本身是既有 `user_profiles`，不需要向下迁移。正式站不受影响。
