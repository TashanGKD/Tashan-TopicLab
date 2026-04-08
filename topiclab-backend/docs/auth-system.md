# Authentication System

**Version**: v1.0  
**Last updated**: 2026-04-08  
**Owner**: `topiclab-backend` (auth authority) + `Resonnet` (auth consumer)

---

## Architecture Overview

The auth system lives entirely in `topiclab-backend`. Resonnet consumes identity via JWT token bridge.

```
User
 │
 ├─ Register / Login / Reset Password ──► topiclab-backend :8001
 │                                         ├─ Storage: PostgreSQL (prod) / in-memory dict (local dev)
 │                                         ├─ Issues JWT (HS256, 7-day expiry)
 │                                         └─ Returns token to frontend
 │
 ├─ Authenticated request to Resonnet ──► Resonnet :8000
 │                                         AUTH_MODE=jwt → calls:
 │                                         GET {AUTH_SERVICE_BASE_URL}/auth/me
 │                                         → topiclab-backend verifies token, returns user
 │
 └─ Frontend
       /api/auth/*  ───────────────────► topiclab-backend :8001  (Vite proxy / nginx)
       /api/*       ───────────────────► Resonnet :8000
```

---

## Database Tables

All tables are created automatically by `_init_auth_tables_once()` in `postgres_client.py`. No migration files needed.

### `users`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL | Primary key |
| phone | VARCHAR(20) UNIQUE | Phone number. Nullable — GitHub OAuth users have no phone |
| password | VARCHAR(255) | bcrypt-hashed password |
| username | VARCHAR(50) | Display name |
| handle | VARCHAR(50) UNIQUE | URL-safe identifier (auto-generated) |
| is_admin | BOOLEAN | Admin flag |
| is_guest | BOOLEAN | Guest/temporary account flag |
| guest_claim_token | VARCHAR(128) | Token for guest→registered account claim |
| guest_claimed_at | TIMESTAMPTZ | When the guest account was claimed |
| created_at | TIMESTAMPTZ | Creation timestamp |

### `verification_codes`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL | Primary key |
| phone | VARCHAR(20) | Phone number (or `_oauth_state` for OAuth CSRF tokens) |
| code | VARCHAR(10) | The code value |
| type | VARCHAR(20) | `register` / `login` / `reset_password` / `oauth_state` |
| expires_at | TIMESTAMPTZ | Expires 5 minutes after creation |
| created_at | TIMESTAMPTZ | Creation timestamp |

Index: `idx_verification_codes_phone_type`

### `oauth_accounts` _(planned — not yet implemented)_

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL | Primary key |
| user_id | INTEGER | FK → users.id (CASCADE DELETE) |
| provider | VARCHAR(20) | `github` / `google` / etc. |
| provider_user_id | VARCHAR(100) | Provider's user ID |
| username | VARCHAR(100) | Provider's username |
| avatar_url | VARCHAR(500) | Avatar URL |
| access_token | TEXT | OAuth access token (encrypt in future) |
| created_at | TIMESTAMPTZ | |
| UNIQUE | (provider, provider_user_id) | One provider account per site user |

### Other tables (OpenClaw / SkillHub)

See `docs/openclaw-identity-points-audit.md` for: `openclaw_agents`, `openclaw_api_keys`, `openclaw_wallets`, `openclaw_point_ledger`, `twin_core`, `twin_snapshots`, `skill_hub_skills`, `skill_hub_reviews`.

---

## API Endpoints

All endpoints are prefixed with `/auth/`.

| Method | Path | Description | Auth required |
|--------|------|-------------|---------------|
| POST | `/auth/send-code` | Send SMS verification code (`register` / `login` / `reset_password`) | No |
| GET | `/auth/register-config` | Check whether SMS is required for registration | No |
| POST | `/auth/register` | Register with phone + SMS code + password | No |
| POST | `/auth/login` | Login with phone + password | No |
| **POST** | **`/auth/reset-password`** | **Reset password with phone + SMS code + new password** | **No** |
| GET | `/auth/me` | Get current user info | Bearer token |
| POST | `/auth/openclaw-guest` | Create a guest OpenClaw account | No |
| GET | `/auth/openclaw-key` | Get OpenClaw API key | Bearer token |
| POST | `/auth/openclaw-key` | Generate / rotate OpenClaw API key | Bearer token |
| POST | `/auth/digital-twins/upsert` | Upsert digital twin record | Bearer token |
| GET | `/auth/digital-twins` | List digital twins | Bearer token |
| GET | `/auth/digital-twins/{agent_name}` | Get digital twin detail | Bearer token |

**Planned (GitHub OAuth)**:
- `GET /auth/github` — Start GitHub OAuth authorization
- `GET /auth/github/callback` — Handle GitHub OAuth callback

---

## User Flows

### Registration

```
POST /auth/send-code { phone, type: "register" }
  → verify phone is NOT already registered
  → generate 6-digit code, insert into verification_codes
  → send SMS via SmsBao
  → return { message, dev_code (dev mode only) }

POST /auth/register { phone, code, password, username }
  → verify code (valid for 5 min)
  → bcrypt-hash password
  → INSERT INTO users
  → return JWT + user object
```

### Login

```
POST /auth/login { phone, password }
  → SELECT user WHERE phone=?
  → bcrypt.checkpw(password, stored_hash)
  → create_jwt_token(user_id, phone)
  → return JWT + user object
```

### Password Reset _(implemented 2026-04-08)_

```
POST /auth/send-code { phone, type: "reset_password" }
  → verify phone IS registered (opposite of register check)
  → rate-limit: max 1 send per minute per phone+type
  → generate 6-digit code, insert into verification_codes
  → send SMS

POST /auth/reset-password { phone, code, new_password }
  → check brute-force lockout (≥5 failures in 10 min → 429)
  → SELECT latest code WHERE phone=? AND type='reset_password'
  → verify code matches + not expired
  → bcrypt-hash new_password
  → UPDATE users SET password=?
  → DELETE used code from verification_codes  ← prevents code reuse
  → clear failure counter
  → return { message: "password reset successful" }
```

**Security measures**:
- 6-digit code, 5-minute expiry
- Code deleted immediately after use (prevents replay)
- Max 5 failed attempts per 10 minutes per phone (brute-force protection)
- Rate limit: 1 code send per minute per phone+type

### Resonnet Token Validation

```
Request: Authorization: Bearer {token}
  → Resonnet auth_bridge.py intercepts
  → AUTH_MODE=jwt: GET {AUTH_SERVICE_BASE_URL}/auth/me
      = topiclab-backend:8001/auth/me
  → topiclab-backend verifies JWT, returns user info
  → Resonnet injects user_id into request context
```

---

## SMS Service

**Provider**: [SmsBao](https://www.smsbao.com)  
**API endpoint**: `https://api.smsbao.com/sms`

**Approved SMS template** (must match exactly for VIP channel routing):
```
【北京攻玉智研科技】您的验证码是{code}。如非本人操作，请忽略本短信
```
> Important: The SMS content in code must match the approved VIP template in the SmsBao dashboard exactly. Any mismatch causes the platform to fall back to the default shared channel with a different sender name.

**Environment variables**:

| Variable | Value | Notes |
|----------|-------|-------|
| `SMSBAO_USERNAME` | `tashan2023` | SmsBao account username |
| `SMSBAO_API_KEY` | `58eb57d1abd9495a9ad42a1d8f157415` | API key (preferred over password) |
| `SMSBAO_PASSWORD` | `58eb57d1abd9495a9ad42a1d8f157415` | MD5-hashed login password (fallback) |

**Local dev mode**: If `SMSBAO_USERNAME` is not set, no real SMS is sent. The verification code is returned in the API response as `dev_code`.

---

## JWT Configuration

| Setting | Value |
|---------|-------|
| Algorithm | HS256 |
| Expiry | 7 days |
| Secret | `JWT_SECRET` env var (shared across all Tashan projects) |
| Payload fields | `sub` (user_id), `phone` (nullable), `exp`, `is_admin` |

The `JWT_SECRET` is shared across TopicLab, tashan-world, ai-org-builder, and other Tashan products. Changing it invalidates all active sessions across all platforms.

---

## Resonnet `AUTH_MODE` Settings

| Value | Behavior | Use case |
|-------|----------|----------|
| `none` (default) | No token validation; all requests treated as anonymous | Local development |
| `jwt` | Validates token by calling topiclab-backend `/auth/me` | Production |
| `proxy` | Reads user identity from request headers (injected by nginx) | Special deployments |

---

## Frontend Routing & Proxy

**Vite dev proxy** (`frontend/vite.config.ts`):

| Prefix | Target | Notes |
|--------|--------|-------|
| `/api/auth` | topiclab-backend :8001 | Auth endpoints |
| `/api/source-feed` | topiclab-backend :8001 | Source feed endpoints |
| `/api/admin` | topiclab-backend :8001 | Admin dashboard |
| `/api/*` | Resonnet :8000 | All other endpoints |

**Frontend routes**:

| Path | Component | Notes |
|------|-----------|-------|
| `/login` | `Login.tsx` | Login page (includes forgot-password link) |
| `/register` | `Register.tsx` | Registration page |
| `/forgot-password` | `ForgotPassword.tsx` | Password reset page _(new)_ |
| `/auth/callback` | `AuthCallback.tsx` | OAuth callback page _(planned)_ |

---

## Environment Variables Summary

### topiclab-backend

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes (prod) | `postgresql://user:pass@host/db` | Not set → in-memory mode (local dev only) |
| `JWT_SECRET` | Yes | `97c24...` (see deployment docs) | Shared across all Tashan products |
| `SMSBAO_USERNAME` | Yes (prod) | `tashan2023` | Not set → dev mode (no real SMS) |
| `SMSBAO_API_KEY` | Yes (prod) | `58eb5...` | Preferred over SMSBAO_PASSWORD |
| `SMSBAO_PASSWORD` | Optional | same value | MD5 fallback |
| `REGISTER_SKIP_SMS_UNTIL` | No | `2026-03-22T12:00:00+08:00` | Default expired; empty string = always require SMS |
| `AUTH_REQUIRED` | No | `false` | `false` = anonymous browsing allowed |

### Resonnet (auth consumer)

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `AUTH_MODE` | No | `jwt` | `none` = dev, `jwt` = prod |
| `AUTH_SERVICE_BASE_URL` | Yes (jwt mode) | `http://topiclab-backend:8000` | topiclab-backend address inside container network |
| `AUTH_REQUIRED` | No | `false` | Whether to reject unauthenticated requests |

---

## Roadmap

### Completed

- [x] Phone + password registration / login
- [x] SMS verification code (SmsBao, template: `【北京攻玉智研科技】`)
- [x] JWT issuance and validation
- [x] Resonnet token bridge (`AUTH_MODE=jwt`)
- [x] OpenClaw guest account / account claiming
- [x] Digital twin binding
- [x] **Forgot password** (phone + SMS code) — _2026-04-08_

### Planned

- [ ] **GitHub OAuth login**
  - New `oauth_accounts` table
  - `users.phone` → nullable
  - `GET /auth/github` + `GET /auth/github/callback` endpoints
  - Frontend: GitHub login button + `/auth/callback` page
  - Security: OAuth state stored in `verification_codes` table (not in-memory)
  - See design spec: `docs/auth-github-oauth-design.md` _(to be created)_

---

## Changelog

| Date | Version | Notes |
|------|---------|-------|
| 2026-04-08 | v1.0 | Initial document. Covers existing auth system + forgot password implementation + SMS template fix |
