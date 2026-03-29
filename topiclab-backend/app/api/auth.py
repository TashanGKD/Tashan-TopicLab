"""User authentication API: send-code, register, login. Uses PostgreSQL (DATABASE_URL)."""

from __future__ import annotations

import hashlib
import os
import random
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo
from urllib.parse import quote, urlencode

import bcrypt
import httpx
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.storage.database.postgres_client import get_db_session
from app.services.openclaw_runtime import (
    create_or_rotate_openclaw_key_for_user,
    ensure_active_openclaw_key_for_user,
    ensure_primary_openclaw_agent,
    get_openclaw_key_record as get_openclaw_key_record_db,
    verify_openclaw_api_key as verify_openclaw_api_key_db,
)
from app.services.twin_runtime import create_or_update_active_twin_for_user, get_or_backfill_active_twin_for_user

logger = logging.getLogger(__name__)
router = APIRouter()

DATABASE_URL = os.getenv("DATABASE_URL")
DATABASE_CONFIGURED = bool(DATABASE_URL)

if DATABASE_CONFIGURED:
    logger.info("PostgreSQL configured for auth")
else:
    logger.warning("DATABASE_URL not set, using in-memory storage for development")
    _dev_users: dict[str, dict] = {}
    _dev_codes: dict[str, dict] = {}
    _dev_twins: dict[int, dict[str, dict]] = {}
    _dev_openclaw_keys: dict[int, dict] = {}
    _dev_user_counter = [0]

    def _get_dev_user(phone: str) -> Optional[dict]:
        return _dev_users.get(phone)

    def _create_dev_user(phone: str, password: str, username: str) -> dict:
        _dev_user_counter[0] += 1
        user = {
            "id": _dev_user_counter[0],
            "phone": phone,
            "password": password,
            "username": username,
            "is_admin": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _dev_users[phone] = user
        return user

    def _save_dev_code(phone: str, code: str, code_type: str) -> None:
        key = f"{phone}:{code_type}"
        _dev_codes[key] = {
            "code": code,
            "created_at": datetime.now(timezone.utc),
        }

    def _verify_dev_code(phone: str, code: str, code_type: str) -> bool:
        key = f"{phone}:{code_type}"
        stored = _dev_codes.get(key)
        if not stored:
            return False
        if stored["code"] != code:
            return False
        if datetime.now(timezone.utc) - stored["created_at"] > timedelta(minutes=5):
            return False
        return True

# JWT Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days
OPENCLAW_AUTH_RECOVERY_ACTION = "reload_skill_url"

# 限时免短信注册：截止时间（中国时间）。可通过 REGISTER_SKIP_SMS_UNTIL 覆盖；设为空字符串则关闭。
_DEFAULT_REGISTER_SKIP_SMS_UNTIL = datetime(2026, 3, 22, 12, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def _parsed_register_skip_sms_until() -> Optional[datetime]:
    raw = os.getenv("REGISTER_SKIP_SMS_UNTIL")
    if raw == "":
        return None
    if raw:
        try:
            s = raw.strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            logger.warning("Invalid REGISTER_SKIP_SMS_UNTIL=%r; SMS bypass disabled", raw)
            return None
    return _DEFAULT_REGISTER_SKIP_SMS_UNTIL


def register_sms_bypass_active() -> bool:
    end = _parsed_register_skip_sms_until()
    if end is None:
        return False
    return datetime.now(timezone.utc) < end.astimezone(timezone.utc)


# SMS Bao Configuration (https://www.smsbao.com/openapi/213.html)
SMSBAO_API = "https://api.smsbao.com/sms"

security = HTTPBearer(auto_error=False)
# Request Models
class SendCodeRequest(BaseModel):
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    type: str = Field(default="register", description="验证码类型: register/login/reset_password")


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50, description="用户名")
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    code: str = Field(default="", max_length=6, description="验证码；限时免验证期间可留空")
    password: str = Field(..., min_length=6, description="密码")


class LoginRequest(BaseModel):
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    password: str = Field(..., min_length=6, description="密码")


class TwinUpsertRequest(BaseModel):
    agent_name: str = Field(default="my_twin", min_length=1, max_length=100, description="分身内部标识")
    display_name: str = Field(default="我的数字分身", min_length=1, max_length=100, description="分身展示名称")
    expert_name: str = Field(default="my_twin", min_length=1, max_length=100, description="导入角色库名称")
    visibility: str = Field(default="private", description="private/public")
    exposure: str = Field(default="brief", description="brief/full")
    session_id: Optional[str] = Field(default=None, description="来源 session_id")
    source: str = Field(default="profile_twin", description="记录来源")
    role_content: Optional[str] = Field(default=None, description="分身角色详情内容")
    twin_id: Optional[str] = Field(default=None, description="稳定 twin id（预留）")


class OpenClawKeyResponse(BaseModel):
    has_key: bool
    key_id: Optional[int] = None
    key: Optional[str] = None
    masked_key: Optional[str] = None
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None
    skill_path: Optional[str] = None
    bind_key: Optional[str] = None
    bootstrap_path: Optional[str] = None
    agent_uid: Optional[str] = None
    openclaw_agent: Optional[dict] = None


def _split_csv_env(name: str) -> set[str]:
    raw = os.getenv(name, "")
    return {item.strip() for item in raw.split(",") if item.strip()}


def _is_admin_identity(user_id: int | None, phone: str | None, db_is_admin: bool = False) -> bool:
    if db_is_admin:
        return True
    admin_ids = _split_csv_env("ADMIN_USER_IDS")
    admin_phones = _split_csv_env("ADMIN_PHONE_NUMBERS")
    if user_id is not None and str(user_id) in admin_ids:
        return True
    if phone and phone in admin_phones:
        return True
    return False


def _load_user_admin_flag(user_id: int | None, phone: str | None) -> bool:
    if DATABASE_CONFIGURED and user_id is not None:
        with get_db_session() as session:
            row = session.execute(
                text("SELECT is_admin, phone FROM users WHERE id = :id"),
                {"id": user_id},
            ).fetchone()
        if row:
            return _is_admin_identity(user_id, row[1], bool(row[0]))
    if phone:
        user = _get_dev_user(phone) if not DATABASE_CONFIGURED else None
        if user:
            return _is_admin_identity(user.get("id"), phone, bool(user.get("is_admin")))
    return _is_admin_identity(user_id, phone)


def _is_phone_unique_violation(exc: IntegrityError) -> bool:
    """Return True only when IntegrityError is clearly caused by duplicate users.phone."""
    message = str(getattr(exc, "orig", exc)).lower()
    unique_markers = (
        "unique constraint",
        "duplicate key value",
        "not unique",
        "unique failed",
    )
    phone_markers = (
        "users.phone",
        "users_phone_key",
        "uq_users_phone",
        "key (phone)",
        "(phone)=",
    )
    return any(marker in message for marker in unique_markers) and any(
        marker in message for marker in phone_markers
    )


def _slugify_handle_seed(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", value.strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized[:32]


def _generate_user_handle(session, phone: str, username: str | None) -> str:
    base = _slugify_handle_seed(username or "") or f"user_{phone[-4:]}"
    for _ in range(10):
        suffix = secrets.token_hex(3)
        candidate = f"{base}_{suffix}"[:50]
        row = session.execute(
            text("SELECT 1 FROM users WHERE handle = :handle LIMIT 1"),
            {"handle": candidate},
        ).fetchone()
        if not row:
            return candidate
    raise RuntimeError("failed to generate unique user handle")


# Helper Functions
def generate_code() -> str:
    return str(random.randint(100000, 999999))


def _normalize_expires_at(value) -> datetime:
    """Coerce verification_codes.expires_at from DB/driver to timezone-aware UTC."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise TypeError(f"unexpected expires_at type: {type(value)}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _to_iso_datetime(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


def _resolve_smsbao_p_value(password: str | None, api_key: str | None) -> str:
    """Use API key directly; otherwise MD5 plaintext password unless already pre-hashed."""
    if api_key and api_key.strip():
        return api_key.strip()
    raw = (password or "").strip()
    if not raw:
        return ""
    if re.fullmatch(r"[0-9a-fA-F]{32}", raw):
        return raw
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


async def send_sms(phone: str, code: str) -> tuple[bool, str]:
    """Send SMS via SMS Bao production API."""
    username = os.getenv("SMSBAO_USERNAME")
    password = os.getenv("SMSBAO_PASSWORD")
    api_key = os.getenv("SMSBAO_API_KEY")
    goods_id = (os.getenv("SMSBAO_GOODSID") or "").strip()
    credential = (api_key or password or "").strip()
    if not username or not credential:
        logger.info(f"[DEV] Verification code for {phone}: {code}")
        return True, f"开发模式：验证码 {code}"

    content = f"【他山世界】您的验证码是{code}"
    # SMSBao accepts either an API key directly or the MD5 of the login password.
    p_value = _resolve_smsbao_p_value(password, api_key)
    params = {
        "u": username,
        "p": p_value,
        "m": phone,
        "c": content,
    }
    if goods_id:
        params["g"] = goods_id
    url = f"{SMSBAO_API}?{urlencode(params, quote_via=quote)}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            result = response.text.strip()
            if result == "0":
                return True, "验证码发送成功"
            error_messages = {
                "30": "短信宝凭证错误",
                "40": "短信宝账号不存在",
                "41": "短信宝余额不足",
                "43": "短信宝 IP 地址受限",
                "50": "短信内容未通过审核或含敏感词",
                "51": "手机号码不正确",
            }
            return False, error_messages.get(result, f"发送失败：{result}")
        except Exception as e:
            logger.error(f"SMS sending error: {e}")
            return False, "短信发送失败，请稍后重试"


def create_jwt_token(user_id: int, phone: str, *, is_admin: bool = False) -> str:
    expiration = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {"sub": str(user_id), "phone": phone, "exp": expiration, "is_admin": is_admin}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


def _hash_openclaw_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _mask_openclaw_key(raw_key: str) -> str:
    if len(raw_key) <= 10:
        return raw_key
    return f"{raw_key[:8]}...{raw_key[-4:]}"


def _build_openclaw_skill_path(raw_key: str) -> str:
    return f"/api/v1/openclaw/skill.md?key={raw_key}"


def _build_openclaw_bootstrap_path(raw_key: str) -> str:
    return f"/api/v1/openclaw/bootstrap?key={raw_key}"


def create_openclaw_skill_token(
    user_id: int,
    *,
    phone: str | None = None,
    username: str | None = None,
    agent_uid: str | None = None,
) -> str:
    agent = ensure_primary_openclaw_agent(user_id, username=username, phone=phone)
    if agent_uid and agent.get("agent_uid") != agent_uid:
        return agent.get("skill_token") or ""
    return agent.get("skill_token") or ""


def build_openclaw_key_invalid_detail(prefix: str = "Invalid or expired OpenClaw key") -> str:
    return prefix


def build_openclaw_key_invalid_headers() -> dict[str, str]:
    return {
        "X-OpenClaw-Auth-Error": "key_invalid_or_expired",
        "X-OpenClaw-Auth-Recovery": OPENCLAW_AUTH_RECOVERY_ACTION,
    }


def generate_openclaw_key() -> str:
    return f"tloc_{secrets.token_urlsafe(24).rstrip('=')}"


def get_openclaw_key_record(user_id: int) -> dict | None:
    if DATABASE_CONFIGURED:
        return get_openclaw_key_record_db(user_id)

    record = _dev_openclaw_keys.get(user_id)
    if not record:
        return None
    return {
        "masked_key": record["token_prefix"],
        "created_at": record["created_at"],
        "last_used_at": record.get("last_used_at"),
    }


def create_or_rotate_openclaw_key(user_id: int) -> dict:
    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text("SELECT username, phone FROM users WHERE id = :id"),
                {"id": user_id},
            ).fetchone()
        username = row[0] if row else None
        phone = row[1] if row else None
        record = ensure_active_openclaw_key_for_user(user_id, username=username, phone=phone)
        record["skill_path"] = _build_openclaw_skill_path(
            create_openclaw_skill_token(
                user_id,
                phone=phone,
                username=username,
                agent_uid=record.get("agent_uid"),
            )
        )
        record["bind_key"] = create_openclaw_skill_token(
            user_id,
            phone=phone,
            username=username,
            agent_uid=record.get("agent_uid"),
        )
        record["bootstrap_path"] = _build_openclaw_bootstrap_path(record["bind_key"])
        return record
    else:
        raw_key = generate_openclaw_key()
        token_hash = _hash_openclaw_key(raw_key)
        token_prefix = _mask_openclaw_key(raw_key)
        now = datetime.now(timezone.utc)
        _dev_openclaw_keys[user_id] = {
            "token_hash": token_hash,
            "token_prefix": token_prefix,
            "created_at": now.isoformat(),
            "last_used_at": None,
        }

        return {
            "has_key": True,
            "key": raw_key,
            "masked_key": token_prefix,
            "created_at": now.isoformat(),
            "last_used_at": None,
            "skill_path": _build_openclaw_skill_path(raw_key),
            "bind_key": raw_key,
            "bootstrap_path": _build_openclaw_bootstrap_path(raw_key),
        }


def verify_openclaw_api_key(token: str) -> Optional[dict]:
    if DATABASE_CONFIGURED:
        payload = verify_openclaw_api_key_db(token)
        if not payload:
            return None
        payload["is_admin"] = _is_admin_identity(
            int(payload["sub"]) if payload.get("sub") is not None else None,
            payload.get("phone"),
            bool(payload.get("is_admin")),
        )
        return payload

    if not token.startswith("tloc_"):
        return None
    token_hash = _hash_openclaw_key(token)
    now = datetime.now(timezone.utc)
    for user in _dev_users.values():
        user_id = int(user["id"])
        record = _dev_openclaw_keys.get(user_id)
        if record and record["token_hash"] == token_hash:
            record["last_used_at"] = now.isoformat()
            return {
                "sub": str(user_id),
                "phone": user["phone"],
                "username": user.get("username"),
                "auth_type": "openclaw_key",
                "is_admin": _is_admin_identity(user_id, user["phone"], bool(user.get("is_admin"))),
            }
    return None


def verify_access_token(token: str) -> Optional[dict]:
    jwt_payload = verify_jwt_token(token)
    if jwt_payload:
        jwt_payload.setdefault("auth_type", "jwt")
        user_id = int(jwt_payload["sub"]) if jwt_payload.get("sub") is not None else None
        jwt_payload["is_admin"] = _load_user_admin_flag(user_id, jwt_payload.get("phone"))
        return jwt_payload
    return verify_openclaw_api_key(token)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from JWT token."""
    if not credentials:
        raise HTTPException(status_code=401, detail="未登录")
    payload = verify_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已过期")
    return payload


async def require_openclaw_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Require OpenClaw key only; reject JWT. For OpenClaw-dedicated routes."""
    if not credentials:
        raise HTTPException(status_code=401, detail="OpenClaw key required")
    token = credentials.credentials
    if not token.startswith("tloc_"):
        raise HTTPException(status_code=401, detail="OpenClaw key required; JWT not accepted")
    user = verify_openclaw_api_key(token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail=build_openclaw_key_invalid_detail(),
            headers=build_openclaw_key_invalid_headers(),
        )
    return user


# API Endpoints
@router.post("/send-code")
async def send_verification_code(req: SendCodeRequest):
    code = generate_code()

    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            if req.type == "register":
                row = session.execute(
                    text("SELECT id FROM users WHERE phone = :phone"),
                    {"phone": req.phone}
                ).fetchone()
                if row:
                    raise HTTPException(status_code=400, detail="该手机号已注册")

            one_minute_ago = datetime.now(timezone.utc) - timedelta(minutes=1)
            row = session.execute(
                text("""
                    SELECT id FROM verification_codes
                    WHERE phone = :phone AND type = :type AND created_at > :since
                    ORDER BY created_at DESC LIMIT 1
                """),
                {"phone": req.phone, "type": req.type, "since": one_minute_ago}
            ).fetchone()
            if row:
                raise HTTPException(status_code=400, detail="验证码发送过于频繁，请稍后再试")

            expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
            session.execute(
                text("""
                    INSERT INTO verification_codes (phone, code, type, expires_at)
                    VALUES (:phone, :code, :type, :expires_at)
                """),
                {"phone": req.phone, "code": code, "type": req.type, "expires_at": expires_at}
            )
    else:
        if req.type == "register" and _get_dev_user(req.phone):
            raise HTTPException(status_code=400, detail="该手机号已注册")
        _save_dev_code(req.phone, code, req.type)

    success, message = await send_sms(req.phone, code)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {"message": "验证码发送成功", "dev_code": code if not os.getenv("SMSBAO_USERNAME") else None}


@router.get("/register-config")
async def register_config():
    until = _parsed_register_skip_sms_until()
    return {
        "registration_requires_sms": not register_sms_bypass_active(),
        "skip_sms_until": until.isoformat() if until else None,
    }


@router.post("/register")
async def register(req: RegisterRequest):
    skip_sms = register_sms_bypass_active()
    if not skip_sms:
        c = (req.code or "").strip()
        if len(c) != 6 or not c.isdigit():
            raise HTTPException(status_code=400, detail="请输入6位短信验证码")

    if DATABASE_CONFIGURED:
        try:
            with get_db_session() as session:
                if not skip_sms:
                    row = session.execute(
                        text("""
                            SELECT code, expires_at FROM verification_codes
                            WHERE phone = :phone AND type = 'register'
                            ORDER BY created_at DESC LIMIT 1
                        """),
                        {"phone": req.phone}
                    ).fetchone()
                    if not row or str(row[0]).strip() != str(req.code).strip():
                        raise HTTPException(status_code=400, detail="验证码错误")
                    try:
                        expires_at = _normalize_expires_at(row[1])
                    except (TypeError, ValueError) as e:
                        logger.warning("Invalid expires_at for phone=%s: %s", req.phone, e)
                        raise HTTPException(status_code=400, detail="验证码无效，请重新获取") from e
                    if expires_at < datetime.now(timezone.utc):
                        raise HTTPException(status_code=400, detail="验证码已过期")

                row = session.execute(
                    text("SELECT id FROM users WHERE phone = :phone"),
                    {"phone": req.phone}
                ).fetchone()
                if row:
                    raise HTTPException(status_code=400, detail="该手机号已注册")

                hashed_password = bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                handle = _generate_user_handle(session, req.phone, req.username)
                result = session.execute(
                    text("""
                        INSERT INTO users (phone, password, username, is_admin, handle)
                        VALUES (:phone, :password, :username, :is_admin, :handle)
                        RETURNING id, phone, username, is_admin, created_at
                    """),
                    {
                        "phone": req.phone,
                        "password": hashed_password,
                        "username": req.username,
                        "is_admin": _is_admin_identity(None, req.phone),
                        "handle": handle,
                    }
                )
                row = result.fetchone()
                user = {"id": row[0], "phone": row[1], "username": row[2], "is_admin": bool(row[3]), "created_at": _to_iso_datetime(row[4])}
        except IntegrityError as exc:
            if _is_phone_unique_violation(exc):
                raise HTTPException(status_code=400, detail="该手机号已注册") from None
            logger.exception("Register failed due to unexpected database integrity error for phone=%s", req.phone)
            raise HTTPException(status_code=500, detail="注册失败，请稍后重试") from None
    else:
        if not skip_sms and not _verify_dev_code(req.phone, req.code, "register"):
            raise HTTPException(status_code=400, detail="验证码错误或已过期")
        if _get_dev_user(req.phone):
            raise HTTPException(status_code=400, detail="该手机号已注册")
        hashed_password = bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = _create_dev_user(req.phone, hashed_password, req.username)
        user["is_admin"] = _is_admin_identity(user["id"], req.phone)
        user["created_at"] = user["created_at"]

    token = create_jwt_token(user["id"], user["phone"], is_admin=bool(user.get("is_admin")))
    return {
        "message": "注册成功",
        "token": token,
        "user": {"id": user["id"], "phone": user["phone"], "username": user.get("username"), "is_admin": bool(user.get("is_admin")), "created_at": user["created_at"]},
    }


@router.post("/login")
async def login(req: LoginRequest):
    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text("SELECT id, phone, password, username, is_admin, created_at FROM users WHERE phone = :phone"),
                {"phone": req.phone}
            ).fetchone()
            if not row:
                raise HTTPException(status_code=400, detail="手机号或密码错误")
            user = {"id": row[0], "phone": row[1], "password": row[2], "username": row[3], "is_admin": bool(row[4]), "created_at": _to_iso_datetime(row[5])}
    else:
        user = _get_dev_user(req.phone)
        if not user:
            raise HTTPException(status_code=400, detail="手机号或密码错误")

    try:
        password_valid = bcrypt.checkpw(req.password.encode("utf-8"), user["password"].encode("utf-8"))
    except Exception:
        password_valid = False
    if not password_valid:
        raise HTTPException(status_code=400, detail="手机号或密码错误")

    user["is_admin"] = _is_admin_identity(user["id"], user["phone"], bool(user.get("is_admin")))
    token = create_jwt_token(user["id"], user["phone"], is_admin=bool(user.get("is_admin")))
    return {
        "message": "登录成功",
        "token": token,
        "user": {"id": user["id"], "phone": user["phone"], "username": user.get("username"), "is_admin": bool(user.get("is_admin")), "created_at": user["created_at"]},
    }


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text("SELECT id, phone, username, is_admin, created_at FROM users WHERE id = :id"),
                {"id": int(user["sub"])}
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="用户不存在")
            user_data = {"id": row[0], "phone": row[1], "username": row[2], "is_admin": _is_admin_identity(row[0], row[1], bool(row[3])), "created_at": _to_iso_datetime(row[4])}
    else:
        u = _get_dev_user(user["phone"])
        if not u:
            raise HTTPException(status_code=404, detail="用户不存在")
        user_data = {"id": u["id"], "phone": u["phone"], "username": u.get("username"), "is_admin": _is_admin_identity(u["id"], u["phone"], bool(u.get("is_admin"))), "created_at": u["created_at"]}

    return {"user": user_data, "auth_type": user.get("auth_type", "jwt")}


@router.get("/openclaw-key", response_model=OpenClawKeyResponse)
async def get_openclaw_key(user: dict = Depends(get_current_user)):
    user_id = int(user["sub"])
    record = get_openclaw_key_record(user_id)
    if not record:
        return OpenClawKeyResponse(has_key=False)
    return OpenClawKeyResponse(
        has_key=True,
        key_id=record.get("key_id"),
        masked_key=record.get("masked_key"),
        created_at=record.get("created_at"),
        last_used_at=record.get("last_used_at"),
        skill_path=_build_openclaw_skill_path(
            create_openclaw_skill_token(
                user_id,
                phone=user.get("phone"),
                username=user.get("username"),
                agent_uid=record.get("agent_uid"),
            )
        ),
        bind_key=create_openclaw_skill_token(
            user_id,
            phone=user.get("phone"),
            username=user.get("username"),
            agent_uid=record.get("agent_uid"),
        ),
        bootstrap_path=_build_openclaw_bootstrap_path(
            create_openclaw_skill_token(
                user_id,
                phone=user.get("phone"),
                username=user.get("username"),
                agent_uid=record.get("agent_uid"),
            )
        ),
        agent_uid=record.get("agent_uid"),
        openclaw_agent=record.get("openclaw_agent"),
    )


@router.post("/openclaw-key", response_model=OpenClawKeyResponse)
async def create_openclaw_key(user: dict = Depends(get_current_user)):
    user_id = int(user["sub"])
    record = create_or_rotate_openclaw_key(user_id)
    return OpenClawKeyResponse(**record)


@router.post("/digital-twins/upsert")
async def upsert_digital_twin(req: TwinUpsertRequest, user: dict = Depends(get_current_user)):
    if req.visibility not in ("private", "public"):
        raise HTTPException(status_code=400, detail="visibility 必须是 private 或 public")
    if req.exposure not in ("brief", "full"):
        raise HTTPException(status_code=400, detail="exposure 必须是 brief 或 full")

    user_id = int(user["sub"])
    now = datetime.now(timezone.utc)
    payload = {
        "agent_name": req.agent_name,
        "display_name": req.display_name,
        "expert_name": req.expert_name,
        "visibility": req.visibility,
        "exposure": req.exposure,
        "session_id": req.session_id,
        "source": req.source,
        "role_content": req.role_content,
    }

    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            session.execute(
                text(
                    """
                    INSERT INTO digital_twins (
                        user_id, agent_name, display_name, expert_name,
                        visibility, exposure, session_id, source, role_content, updated_at
                    ) VALUES (
                        :user_id, :agent_name, :display_name, :expert_name,
                        :visibility, :exposure, :session_id, :source, :role_content, :updated_at
                    )
                    ON CONFLICT (user_id, agent_name)
                    DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        expert_name = EXCLUDED.expert_name,
                        visibility = EXCLUDED.visibility,
                        exposure = EXCLUDED.exposure,
                        session_id = EXCLUDED.session_id,
                        source = EXCLUDED.source,
                        role_content = EXCLUDED.role_content,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"user_id": user_id, "updated_at": now, **payload},
            )
    else:
        user_twins = _dev_twins.setdefault(user_id, {})
        user_twins[req.agent_name] = {
            **payload,
            "updated_at": now.isoformat(),
        }
    twin = (
        create_or_update_active_twin_for_user(
            user_id,
            source_agent_name=req.agent_name,
            display_name=req.display_name,
            expert_name=req.expert_name,
            visibility=req.visibility,
            exposure=req.exposure,
            base_profile_markdown=req.role_content or "",
            source=req.source,
        )
        if DATABASE_CONFIGURED
        else {}
    )

    return {
        "ok": True,
        "agent_name": req.agent_name,
        "twin_id": twin.get("twin_id"),
        "twin_version": twin.get("version"),
    }


@router.get("/digital-twins")
async def list_digital_twins(user: dict = Depends(get_current_user)):
    user_id = int(user["sub"])
    active_twin = get_or_backfill_active_twin_for_user(user_id) if DATABASE_CONFIGURED else None
    active_twin_id = active_twin.get("twin_id") if active_twin else None

    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            rows = session.execute(
                text(
                    """
                    SELECT
                        agent_name, display_name, expert_name,
                        visibility, exposure, session_id, source,
                        created_at, updated_at,
                        role_content
                    FROM digital_twins
                    WHERE user_id = :user_id
                    ORDER BY updated_at DESC
                    """
                ),
                {"user_id": user_id},
            ).fetchall()
            twins = [
                {
                    "agent_name": row[0],
                    "display_name": row[1],
                    "expert_name": row[2],
                    "visibility": row[3],
                    "exposure": row[4],
                    "session_id": row[5],
                    "source": row[6],
                    "created_at": _to_iso_datetime(row[7]),
                    "updated_at": _to_iso_datetime(row[8]),
                    "has_role_content": bool(row[9]),
                    "twin_id": active_twin_id,
                }
                for row in rows
            ]
    else:
        user_twins = _dev_twins.get(user_id, {})
        twins = []
        for twin in user_twins.values():
            twins.append(
                {
                    "agent_name": twin.get("agent_name"),
                    "display_name": twin.get("display_name"),
                    "expert_name": twin.get("expert_name"),
                    "visibility": twin.get("visibility", "private"),
                    "exposure": twin.get("exposure", "brief"),
                    "session_id": twin.get("session_id"),
                    "source": twin.get("source", "profile_twin"),
                    "created_at": twin.get("updated_at"),
                    "updated_at": twin.get("updated_at"),
                    "has_role_content": bool(twin.get("role_content")),
                    "twin_id": active_twin_id,
                }
            )
        twins.sort(key=lambda item: item.get("updated_at") or "", reverse=True)

    return {"digital_twins": twins}


@router.get("/digital-twins/{agent_name}")
async def get_digital_twin_detail(agent_name: str, user: dict = Depends(get_current_user)):
    user_id = int(user["sub"])
    active_twin = get_or_backfill_active_twin_for_user(user_id) if DATABASE_CONFIGURED else None

    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text(
                    """
                    SELECT
                        agent_name, display_name, expert_name,
                        visibility, exposure, session_id, source,
                        created_at, updated_at, role_content
                    FROM digital_twins
                    WHERE user_id = :user_id AND agent_name = :agent_name
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "agent_name": agent_name},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="分身记录不存在")
            twin = {
                "agent_name": row[0],
                "display_name": row[1],
                "expert_name": row[2],
                "visibility": row[3],
                "exposure": row[4],
                "session_id": row[5],
                "source": row[6],
                "created_at": _to_iso_datetime(row[7]),
                "updated_at": _to_iso_datetime(row[8]),
                "role_content": row[9],
                "twin_id": active_twin.get("twin_id") if active_twin else None,
            }
    else:
        user_twins = _dev_twins.get(user_id, {})
        twin = user_twins.get(agent_name)
        if not twin:
            raise HTTPException(status_code=404, detail="分身记录不存在")
        twin = {
            "agent_name": twin.get("agent_name"),
            "display_name": twin.get("display_name"),
            "expert_name": twin.get("expert_name"),
            "visibility": twin.get("visibility", "private"),
            "exposure": twin.get("exposure", "brief"),
            "session_id": twin.get("session_id"),
            "source": twin.get("source", "profile_twin"),
            "created_at": twin.get("updated_at"),
            "updated_at": twin.get("updated_at"),
            "role_content": twin.get("role_content"),
            "twin_id": active_twin.get("twin_id") if active_twin else None,
        }

    return {"digital_twin": twin}
