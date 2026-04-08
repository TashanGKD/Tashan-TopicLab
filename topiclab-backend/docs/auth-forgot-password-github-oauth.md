# 账号系统扩展：忘记密码 + GitHub OAuth 登录

**版本**：v1.0  
**日期**：2026-04-08  
**状态**：待实现

---

## 目标

在现有手机号+密码账号体系基础上，增加两项能力：

1. **忘记密码**：通过手机号 + 短信验证码重置密码
2. **GitHub OAuth 登录**：允许用户通过 GitHub 授权登录，无需手机号注册

---

## 一、忘记密码

### 1.1 设计原则

- 复用现有 `verification_codes` 表（`type` 字段已预留 `reset_password`）
- 复用现有 `send_sms` 短信基础设施
- 复用现有 `POST /auth/send-code` 端点（后端补充 `reset_password` 的前置校验）
- 前端新增一个独立页面 `/forgot-password`

### 1.2 数据模型变更

**无需新增表**。`verification_codes` 表已支持 `type=reset_password`：

```sql
-- 现有表，无需修改
verification_codes (
  phone   VARCHAR(20),
  code    VARCHAR(10),
  type    VARCHAR(20),   -- 'register' | 'login' | 'reset_password'
  expires_at ...
)
```

### 1.3 后端接口

#### 现有接口补丁：`POST /auth/send-code`

当前代码：`type=register` 时检查手机号**未注册**。

需补充：`type=reset_password` 时检查手机号**已注册**，未注册返回 400。

```python
if req.type == "reset_password":
    row = session.execute(
        text("SELECT id FROM users WHERE phone = :phone"),
        {"phone": req.phone}
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="该手机号未注册")
```

#### 新增接口：`POST /auth/reset-password`

```
请求体：
  phone:        str   手机号
  code:         str   6位短信验证码
  new_password: str   新密码（>=8位）

成功响应：200
  { "message": "密码重置成功" }

失败响应：
  400  验证码错误或已过期
  400  该手机号未注册
  400  新密码不符合要求
```

逻辑：

```
1. 查 verification_codes WHERE phone=? AND type='reset_password' ORDER BY created_at DESC LIMIT 1
2. 验证 code 匹配 + expires_at 未过期
3. bcrypt.hashpw(new_password)
4. UPDATE users SET password=hashed WHERE phone=?
5. **删除已使用的验证码**（必须，防止同一验证码在5分钟内被重复使用）
6. 返回 200
```

开发模式（无 DATABASE_URL）：对应操作内存字典 `_dev_users`。

### 1.4 前端改动

**`Login.tsx`** — 加入口链接：

```tsx
// 在提交按钮下方
<div className="text-right">
  <Link to="/forgot-password" className="text-sm text-gray-500 hover:text-black">
    忘记密码？
  </Link>
</div>
```

**新增 `pages/ForgotPassword.tsx`**：

两个阶段，用 `step` state 控制：

```
step=1（填手机号）:
  - 手机号输入框
  - 「发送验证码」按钮 → authApi.sendCode(phone, 'reset_password')
  - 发送成功后切换到 step=2

step=2（重置密码）:
  - 验证码输入框（6位）
  - 新密码输入框
  - 确认密码输入框
  - 「重置密码」按钮 → POST /auth/reset-password
  - 成功后跳转 /login
```

**`App.tsx`** — 注册路由：

```tsx
<Route path="/forgot-password" element={<ForgotPassword />} />
```

**`api/auth.ts`** — 新增方法：

```typescript
resetPassword: async (phone: string, code: string, newPassword: string): Promise<{ message: string }> => {
  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code, new_password: newPassword }),
  });
  if (!res.ok) throw new Error(await readApiError(res, '密码重置失败'));
  return res.json();
},
```

---

## 二、GitHub OAuth 登录

### 2.1 设计原则

- GitHub 用户无手机号，`users.phone` 改为 **nullable**（需 ALTER TABLE）
- 账号绑定关系存入新表 `oauth_accounts`（允许未来扩展 Google / 微信等）
- OAuth 流程全部在后端完成，前端只负责跳转和接收 token
- 使用 `state` 参数防 CSRF（后端生成，前端透传，回调验证）

### 2.2 数据模型变更

#### `users` 表：`phone` 改为 nullable

```sql
-- PostgreSQL
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- SQLite（需重建表，或在代码层允许 NULL）
-- 在 _init_auth_tables_once 中改为 phone VARCHAR(20) UNIQUE（不加 NOT NULL）
```

业务影响：
- `phone` 为 NULL 的用户是 GitHub 登录用户，不能用手机号登录/找回密码
- `GET /auth/me` 返回的 `phone` 可能为 null，前端需处理

#### 新增 `oauth_accounts` 表

```sql
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id               SERIAL PRIMARY KEY,                                      -- SQLite: INTEGER PRIMARY KEY AUTOINCREMENT
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         VARCHAR(20) NOT NULL,        -- 'github' | 'google' | ...
  provider_user_id VARCHAR(100) NOT NULL,       -- GitHub user id (integer as string)
  username         VARCHAR(100),               -- GitHub login name
  avatar_url       VARCHAR(500),
  access_token     TEXT,                        -- 加密存储（可选，首期明文即可）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)            -- 同一 GitHub 账号只能绑定一个站内用户
);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
```

### 2.3 环境变量

```bash
GITHUB_CLIENT_ID=<GitHub OAuth App Client ID>
GITHUB_CLIENT_SECRET=<GitHub OAuth App Client Secret>
GITHUB_REDIRECT_URI=https://tashan.chat/api/auth/github/callback
# 本地开发：http://localhost:8001/api/auth/github/callback（需在 GitHub App 设置中额外添加）
```

### 2.4 后端接口

#### `GET /auth/github` — 发起 GitHub 授权

```
响应：200
{
  "authorization_url": "https://github.com/login/oauth/authorize?client_id=...&redirect_uri=...&state=...&scope=read:user,user:email"
}
```

state 生成：`secrets.token_urlsafe(16)`，**必须持久化存储**（存入 `verification_codes` 表，type='oauth_state'，expires_at=5分钟后），不能用进程内存（多实例部署时内存不共享）。

```python
# state 存储（复用 verification_codes 表）
INSERT INTO verification_codes (phone, code, type, expires_at)
VALUES ('_oauth_state', :state_value, 'oauth_state', :expires_at)
# phone 字段用 '_oauth_state' 占位（state 无手机号概念）
```

scope：`read:user user:email`（读取用户基本信息 + 邮箱）

**频率限制**：`/auth/github/callback` 对同一 IP 限制 5次/分钟（防止攻击者用无效 code 耗尽 GitHub API 速率限制）。

#### `GET /auth/github/callback` — GitHub 回调处理

```
查询参数：code（GitHub 授权码）, state（CSRF 验证）

完整逻辑：
1. 验证 state 有效性
2. 用 code 换 access_token
   POST https://github.com/login/oauth/access_token
   → 返回 access_token
3. 用 access_token 获取用户信息
   GET https://api.github.com/user（Authorization: Bearer {token}）
   → 返回 { id, login, avatar_url, email, ... }
   如果 email 为 null，调 GET https://api.github.com/user/emails 取主邮箱
4. 查 oauth_accounts WHERE provider='github' AND provider_user_id=str(github_id)
   → 找到：取 user_id，更新 username/avatar_url/access_token
   → 未找到：
     a. INSERT INTO users(phone=NULL, password='', username=github_login, handle=...)
     b. INSERT INTO oauth_accounts(user_id, provider='github', provider_user_id=str(github_id), ...)
5. create_jwt_token(user_id, phone=None)
6. 重定向到前端：
   {FRONTEND_BASE_URL}/auth/callback?token={jwt}
```

`create_jwt_token` 需调整：`phone` 参数类型改为 `str | None`（Optional），JWT payload 中 phone 字段允许为 null。`/auth/me` 返回的 `User` 对象和前端 `User` interface 需同步更新 `phone: str | None`。

**安全边界**：
- `password` 字段对 OAuth 用户存空字符串（不能通过密码登录，GitHub 用户找回密码路径另行设计）
- access_token 可选加密（首期明文存储，后期用 `OAUTH_TOKEN_KEY` 加密）

### 2.5 前端改动

**`Login.tsx`** — 加 GitHub 登录按钮：

```tsx
const handleGithubLogin = async () => {
  const res = await fetch('/api/auth/github');
  const { authorization_url } = await res.json();
  window.location.href = authorization_url;
};

// 在登录表单下方
<button type="button" onClick={handleGithubLogin} className="w-full border border-gray-200 ...">
  <svg>/* GitHub icon */</svg>
  使用 GitHub 登录
</button>
```

**新增 `pages/AuthCallback.tsx`**（或在 App.tsx 里处理 `/auth/callback` 路由）：

```tsx
// URL: /auth/callback?token=...
const params = new URLSearchParams(location.search);
const token = params.get('token');
if (token) {
  tokenManager.set(token);
  // 调 /auth/me 获取用户信息存入 localStorage
  navigate('/');
}
```

**`App.tsx`** — 注册路由：

```tsx
<Route path="/auth/callback" element={<AuthCallback />} />
<Route path="/forgot-password" element={<ForgotPassword />} />
```

**`api/auth.ts`** — `User` 接口更新：

```typescript
export interface User {
  id: number;
  phone: string | null;   // GitHub 用户可能为 null
  username: string | null;
  is_admin?: boolean;
  is_guest?: boolean;
  created_at: string;
}
```

---

## 三、改动范围总结

### 后端（`topiclab-backend`）

| 文件 | 改动 |
|------|------|
| `app/storage/database/postgres_client.py` | 新增 `oauth_accounts` 表；`users.phone` 改为 nullable；`_init_auth_tables_once` 更新 |
| `app/api/auth.py` | `send-code` 补 `reset_password` 前置校验；新增 `reset-password` 端点；新增 `github`、`github/callback` 端点；`create_jwt_token` phone 参数改为 optional |
| `app/models/schemas.py` | 更新 `User` schema，phone 改为 Optional[str] |
| `main.py` 或路由注册 | 确认 `/auth/github` 和 `/auth/github/callback` 已注册（当前 auth.py 使用 router，应自动注册）|

新增依赖（`pyproject.toml`）：
- `httpx`（已有，用于 GitHub API 调用）
- 无需新增

### 前端（`Tashan-TopicLab/frontend`）

| 文件 | 改动 |
|------|------|
| `src/api/auth.ts` | `User.phone` 改为 nullable；新增 `resetPassword` 方法 |
| `src/pages/Login.tsx` | 加「忘记密码」链接 + GitHub 登录按钮 |
| `src/pages/ForgotPassword.tsx` | 新增页面 |
| `src/pages/AuthCallback.tsx` | 新增页面 |
| `src/App.tsx` | 注册两个新路由 |

---

## 四、开发顺序建议

1. **忘记密码**（1-2天）：纯后端逻辑 + 简单前端页面，无外部依赖
2. **GitHub OAuth**（2-3天）：需先在 GitHub 注册 OAuth App 拿到 credentials，再做后端 + 前端

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-04-08 | v1.0 初版，确认方案：手机找回密码、GitHub OAuth、phone 改 nullable |
| 2026-04-08 | v1.1 关卡B审核修复：state 存 verification_codes 表、验证码用后必须删除、create_jwt_token phone 改 Optional、callback 频率限制 |
| 2026-04-08 | v1.2 实现完成（忘记密码）：后端 send-code 补丁 + reset-password 端点 + 前端 ForgotPassword 页面 + Login 入口 + vite.config.ts proxy 修复 |
| 2026-04-08 | v1.3 短信模板修正：内容从「【他山世界】」改为「【北京攻玉智研科技】您的验证码是{code}。如非本人操作，请忽略本短信」（与短信宝后台VIP模板完全一致，走优质通道） |
