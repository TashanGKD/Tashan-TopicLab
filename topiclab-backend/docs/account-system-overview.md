# 账号系统全景文档

**版本**：v1.0  
**日期**：2026-04-08  
**维护方**：topiclab-backend（账号权威源）+ Resonnet（Auth 消费方）

---

## 一、架构概述

账号系统由 `topiclab-backend` 承载，Resonnet 作为 Auth 消费方，通过 token 桥接获取用户身份。

```
用户
 │
 ├─ 注册/登录/重置密码 ──────────► topiclab-backend :8001
 │                                  ├─ 存储：PostgreSQL（生产）/ 内存字典（本地开发）
 │                                  ├─ 签发 JWT（HS256，7天有效期）
 │                                  └─ 返回 token 给前端
 │
 ├─ 带 token 请求 Resonnet ─────► Resonnet :8000
 │                                  AUTH_MODE=jwt 时调用：
 │                                  GET {AUTH_SERVICE_BASE_URL}/auth/me
 │                                  → topiclab-backend 验证 token，返回 user
 │
 └─ 前端
       /api/auth/* ──────────────► topiclab-backend :8001（Vite proxy / nginx）
       /api/*      ──────────────► Resonnet :8000
```

---

## 二、数据模型

所有表由 `topiclab-backend/app/storage/database/postgres_client.py` 的 `_init_auth_tables_once()` 自动创建（无迁移文件）。

### 2.1 `users`（主用户表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| phone | VARCHAR(20) UNIQUE | 手机号（允许 NULL，GitHub 登录用户无手机号）|
| password | VARCHAR(255) | bcrypt 加密密码 |
| username | VARCHAR(50) | 显示名称 |
| handle | VARCHAR(50) UNIQUE | URL 标识符（自动生成）|
| is_admin | BOOLEAN | 管理员标志 |
| is_guest | BOOLEAN | 临时访客标志 |
| guest_claim_token | VARCHAR(128) | 访客转正式账号的认领 token |
| guest_claimed_at | TIMESTAMPTZ | 访客被认领的时间 |
| created_at | TIMESTAMPTZ | 创建时间 |

### 2.2 `verification_codes`（验证码表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| phone | VARCHAR(20) | 手机号（或 `_oauth_state` 用于 OAuth） |
| code | VARCHAR(10) | 验证码内容 |
| type | VARCHAR(20) | `register` / `login` / `reset_password` / `oauth_state` |
| expires_at | TIMESTAMPTZ | 过期时间（5分钟） |
| created_at | TIMESTAMPTZ | 创建时间 |

> 注：使用频率限制索引：`idx_verification_codes_phone_type`

### 2.3 关联表（OpenClaw / SkillHub 体系）

详见 `docs/openclaw-identity-points-audit.md`，包含：
- `openclaw_agents`：OpenClaw 主体
- `openclaw_api_keys`：API Key 管理
- `openclaw_wallets` / `openclaw_point_ledger`：积分系统
- `twin_core` / `twin_snapshots`：数字分身
- `skill_hub_skills` / `skill_hub_reviews`：SkillHub

### 2.4 `oauth_accounts`（OAuth 第三方登录，待实现）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| user_id | INTEGER | 关联 users.id |
| provider | VARCHAR(20) | `github` / `google` 等 |
| provider_user_id | VARCHAR(100) | 第三方平台用户 ID |
| username | VARCHAR(100) | 第三方平台用户名 |
| avatar_url | VARCHAR(500) | 头像 URL |
| access_token | TEXT | OAuth access token（待加密） |
| UNIQUE | (provider, provider_user_id) | 同一第三方账号只绑定一个站内用户 |

---

## 三、API 端点清单

所有端点前缀：`/auth/`

| 方法 | 路径 | 说明 | 认证要求 |
|------|------|------|---------|
| POST | `/auth/send-code` | 发短信验证码（register/login/reset_password）| 无 |
| GET | `/auth/register-config` | 查询注册是否需要短信验证码 | 无 |
| POST | `/auth/register` | 注册（手机 + 验证码 + 密码）| 无 |
| POST | `/auth/login` | 登录（手机 + 密码）| 无 |
| **POST** | **`/auth/reset-password`** | **重置密码（手机 + 验证码 + 新密码）** | **无（新增）** |
| GET | `/auth/me` | 获取当前用户信息 | Bearer token |
| POST | `/auth/openclaw-guest` | 创建访客 OpenClaw 账号 | 无 |
| GET | `/auth/openclaw-key` | 获取 OpenClaw API Key | Bearer token |
| POST | `/auth/openclaw-key` | 生成/轮换 OpenClaw API Key | Bearer token |
| POST | `/auth/digital-twins/upsert` | 更新数字分身 | Bearer token |
| GET | `/auth/digital-twins` | 获取数字分身列表 | Bearer token |
| GET | `/auth/digital-twins/{agent_name}` | 获取数字分身详情 | Bearer token |

**待实现**：
- `GET /auth/github` — 发起 GitHub OAuth 授权
- `GET /auth/github/callback` — GitHub OAuth 回调

---

## 四、完整用户流程

### 4.1 注册流程

```
POST /auth/send-code { phone, type: "register" }
  → 检查手机未注册
  → 生成6位验证码，写入 verification_codes
  → 调短信宝 API 发短信
  → 返回 { message, dev_code（仅开发模式）}

POST /auth/register { phone, code, password, username }
  → 验证验证码（5分钟有效）
  → bcrypt 加密密码
  → INSERT INTO users
  → 返回 JWT + user 信息
```

### 4.2 登录流程

```
POST /auth/login { phone, password }
  → 查 users WHERE phone=?
  → bcrypt.checkpw
  → create_jwt_token(user_id, phone)
  → 返回 JWT + user 信息
```

### 4.3 忘记密码流程（新增）

```
POST /auth/send-code { phone, type: "reset_password" }
  → 检查手机已注册（与 register 相反）
  → 生成6位验证码，写入 verification_codes
  → 调短信宝 API 发短信

POST /auth/reset-password { phone, code, new_password }
  → 查 verification_codes WHERE phone=? AND type='reset_password'
  → 验证 code 正确 + expires_at 未过期
  → bcrypt 加密新密码
  → UPDATE users SET password=?
  → DELETE verification_codes（防重放）
  → 清除失败计数
  → 返回 { message: "密码重置成功" }
```

**安全机制**：
- 同一手机号连续验证失败 ≥5 次，锁定 10 分钟
- 验证码使用后立即删除（防重放）
- 验证码有效期 5 分钟
- 发送频率限制：同类型验证码 1 分钟内不重复发送

### 4.4 Resonnet Token 验证流程

```
请求携带 Authorization: Bearer {token}
  → Resonnet auth_bridge.py 拦截
  → AUTH_MODE=jwt: 调 GET {AUTH_SERVICE_BASE_URL}/auth/me
      = topiclab-backend:8001/auth/me
  → topiclab-backend 验证 JWT，返回 user 信息
  → Resonnet 将 user_id 注入请求上下文
```

---

## 五、短信服务配置

**服务商**：[短信宝](https://www.smsbao.com)（smsbao.com）

**短信模板**（已审核通过）：
```
【北京攻玉智研科技】您的验证码是{code}。如非本人操作，请忽略本短信
```

> 重要：短信内容必须与短信宝后台 VIP 模板完全一致，否则走默认通道，签名会被替换。

**环境变量**：

| 变量 | 值 | 说明 |
|------|-----|------|
| `SMSBAO_USERNAME` | `tashan2023` | 短信宝账号 |
| `SMSBAO_API_KEY` | `58eb57d1abd9495a9ad42a1d8f157415` | API Key（推荐，比 MD5 密码更安全）|
| `SMSBAO_PASSWORD` | `58eb57d1abd9495a9ad42a1d8f157415` | 登录密码（已 MD5，二选一）|

**本地开发模式**：不设 `SMSBAO_USERNAME` 时不发真实短信，验证码通过 API 响应的 `dev_code` 字段返回。

---

## 六、JWT 配置

| 参数 | 值 |
|------|-----|
| 算法 | HS256 |
| 有效期 | 7 天 |
| 密钥 | `JWT_SECRET` 环境变量 |
| payload 字段 | `sub`（user_id）/ `phone`（可为 null）/ `exp` / `is_admin` |

---

## 七、Resonnet AUTH_MODE 说明

| 值 | 行为 | 适用场景 |
|-----|------|---------|
| `none`（默认）| 不验证 token，所有请求视为匿名 | 本地开发 |
| `jwt` | 调 topiclab-backend `/auth/me` 验证 token | 生产环境 |
| `proxy` | 从请求头读用户信息（nginx 注入）| 特殊部署场景 |

---

## 八、前端路由与代理

**Vite 开发代理**（`frontend/vite.config.ts`）：

| 前缀 | 目标 | 说明 |
|------|------|------|
| `/api/auth` | topiclab-backend :8001 | 账号相关 API |
| `/api/source-feed` | topiclab-backend :8001 | 信源相关 API |
| `/api/admin` | topiclab-backend :8001 | 管理后台 API |
| `/api/*` | Resonnet :8000 | 其他所有 API |

**前端页面路由**：

| 路径 | 组件 | 说明 |
|------|------|------|
| `/login` | `Login.tsx` | 登录页（含忘记密码入口） |
| `/register` | `Register.tsx` | 注册页 |
| `/forgot-password` | `ForgotPassword.tsx` | 忘记密码页（新增）|
| `/auth/callback` | `AuthCallback.tsx` | OAuth 回调页（待实现）|

---

## 九、已完成 / 待实现

### 已完成
- [x] 手机号 + 密码注册 / 登录
- [x] 短信验证码（短信宝，模板：`【北京攻玉智研科技】`）
- [x] JWT 签发与验证
- [x] Resonnet token 桥接（AUTH_MODE=jwt）
- [x] OpenClaw 访客账号 / 账号认领
- [x] 数字分身绑定
- [x] **忘记密码（手机 + 短信验证码）**（2026-04-08 新增）

### 待实现
- [ ] GitHub OAuth 登录（方案见 `auth-forgot-password-github-oauth.md`）
- [ ] `oauth_accounts` 表创建
- [ ] `users.phone` 改为 nullable（GitHub 用户无手机号）

---

## 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-04-08 | v1.0 | 初版，梳理现有账号系统全貌 + 记录忘记密码实现 |
