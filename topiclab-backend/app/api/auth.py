"""User authentication API: send-code, register, login. Uses PostgreSQL (DATABASE_URL)."""

import hashlib
import os
import random
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import bcrypt
import httpx
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from sqlalchemy import text

from app.storage.database.postgres_client import get_db_session

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

# SMS Bao Configuration (https://www.smsbao.com/)
SMSBAO_API = "https://api.smsbao.com/sms"

security = HTTPBearer(auto_error=False)


# Request Models
class SendCodeRequest(BaseModel):
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    type: str = Field(default="register", description="验证码类型: register/login/reset_password")


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50, description="用户名")
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    code: str = Field(..., min_length=6, max_length=6, description="验证码")
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
    session_id: str | None = Field(default=None, description="来源 session_id")
    source: str = Field(default="profile_twin", description="记录来源")
    role_content: str | None = Field(default=None, description="分身角色详情内容")


class OpenClawKeyResponse(BaseModel):
    has_key: bool
    key: str | None = None
    masked_key: str | None = None
    created_at: str | None = None
    last_used_at: str | None = None
    skill_path: str | None = None


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


# Helper Functions
def generate_code() -> str:
    return str(random.randint(100000, 999999))


async def send_sms(phone: str, code: str) -> tuple[bool, str]:
    """Send SMS via SMS Bao API. Password must be MD5 of login password."""
    username = os.getenv("SMSBAO_USERNAME")
    password = os.getenv("SMSBAO_PASSWORD")
    if not username or not password:
        logger.info(f"[DEV] Verification code for {phone}: {code}")
        return True, f"开发模式：验证码 {code}"

    content = f"【短信宝】您的验证码是{code}"
    p_md5 = hashlib.md5(password.encode("utf-8")).hexdigest()
    c_encoded = quote(content, safe="")
    url = f"{SMSBAO_API}?u={username}&p={p_md5}&m={phone}&c={c_encoded}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            result = response.text
            if result == "0":
                return True, "验证码发送成功"
            error_messages = {
                "30": "密码错误", "40": "账号不存在", "41": "余额不足",
                "43": "IP地址限制", "50": "内容含有敏感词", "51": "手机号码不正确",
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


def generate_openclaw_key() -> str:
    return f"tloc_{secrets.token_urlsafe(24).rstrip('=')}"


def get_openclaw_key_record(user_id: int) -> dict | None:
    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text(
                    """
                    SELECT token_prefix, created_at, last_used_at
                    FROM openclaw_api_keys
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": user_id},
            ).fetchone()
        if not row:
            return None
        return {
            "masked_key": row[0],
            "created_at": row[1].isoformat() if row[1] else None,
            "last_used_at": row[2].isoformat() if row[2] else None,
        }

    record = _dev_openclaw_keys.get(user_id)
    if not record:
        return None
    return {
        "masked_key": record["token_prefix"],
        "created_at": record["created_at"],
        "last_used_at": record.get("last_used_at"),
    }


def create_or_rotate_openclaw_key(user_id: int) -> dict:
    raw_key = generate_openclaw_key()
    token_hash = _hash_openclaw_key(raw_key)
    token_prefix = _mask_openclaw_key(raw_key)
    now = datetime.now(timezone.utc)

    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            session.execute(
                text(
                    """
                    INSERT INTO openclaw_api_keys (
                        user_id, token_hash, token_prefix, created_at, updated_at, last_used_at
                    ) VALUES (
                        :user_id, :token_hash, :token_prefix, :created_at, :updated_at, NULL
                    )
                    ON CONFLICT(user_id)
                    DO UPDATE SET
                        token_hash = EXCLUDED.token_hash,
                        token_prefix = EXCLUDED.token_prefix,
                        updated_at = EXCLUDED.updated_at,
                        created_at = EXCLUDED.created_at,
                        last_used_at = NULL
                    """
                ),
                {
                    "user_id": user_id,
                    "token_hash": token_hash,
                    "token_prefix": token_prefix,
                    "created_at": now,
                    "updated_at": now,
                },
            )
    else:
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
    }


def verify_openclaw_api_key(token: str) -> Optional[dict]:
    if not token.startswith("tloc_"):
        return None
    token_hash = _hash_openclaw_key(token)
    now = datetime.now(timezone.utc)

    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text(
                    """
                    SELECT u.id, u.phone, u.username
                        , u.is_admin
                    FROM openclaw_api_keys k
                    JOIN users u ON u.id = k.user_id
                    WHERE k.token_hash = :token_hash
                    """
                ),
                {"token_hash": token_hash},
            ).fetchone()
            if not row:
                return None
            session.execute(
                text(
                    """
                    UPDATE openclaw_api_keys
                    SET last_used_at = :last_used_at, updated_at = :updated_at
                    WHERE token_hash = :token_hash
                    """
                ),
                {"token_hash": token_hash, "last_used_at": now, "updated_at": now},
            )
        return {
            "sub": str(row[0]),
            "phone": row[1],
            "username": row[2],
            "auth_type": "openclaw_key",
            "is_admin": _is_admin_identity(int(row[0]), row[1], bool(row[3])),
        }

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
        raise HTTPException(status_code=401, detail="Invalid or expired OpenClaw key")
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


@router.post("/register")
async def register(req: RegisterRequest):
    if DATABASE_CONFIGURED:
        with get_db_session() as session:
            row = session.execute(
                text("""
                    SELECT code, expires_at FROM verification_codes
                    WHERE phone = :phone AND type = 'register'
                    ORDER BY created_at DESC LIMIT 1
                """),
                {"phone": req.phone}
            ).fetchone()
            if not row or row[0] != req.code:
                raise HTTPException(status_code=400, detail="验证码错误")
            expires_at = row[1]
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="验证码已过期")

            row = session.execute(
                text("SELECT id FROM users WHERE phone = :phone"),
                {"phone": req.phone}
            ).fetchone()
            if row:
                raise HTTPException(status_code=400, detail="该手机号已注册")

            hashed_password = bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            result = session.execute(
                text("""
                    INSERT INTO users (phone, password, username, is_admin)
                    VALUES (:phone, :password, :username, :is_admin)
                    RETURNING id, phone, username, is_admin, created_at
                """),
                {
                    "phone": req.phone,
                    "password": hashed_password,
                    "username": req.username,
                    "is_admin": _is_admin_identity(None, req.phone),
                }
            )
            row = result.fetchone()
            user = {"id": row[0], "phone": row[1], "username": row[2], "is_admin": bool(row[3]), "created_at": row[4].isoformat()}
    else:
        if not _verify_dev_code(req.phone, req.code, "register"):
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
            user = {"id": row[0], "phone": row[1], "password": row[2], "username": row[3], "is_admin": bool(row[4]), "created_at": row[5].isoformat()}
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
            user_data = {"id": row[0], "phone": row[1], "username": row[2], "is_admin": _is_admin_identity(row[0], row[1], bool(row[3])), "created_at": row[4].isoformat()}
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
        masked_key=record.get("masked_key"),
        created_at=record.get("created_at"),
        last_used_at=record.get("last_used_at"),
        skill_path=None,
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

    return {"ok": True, "agent_name": req.agent_name}


@router.get("/digital-twins")
async def list_digital_twins(user: dict = Depends(get_current_user)):
    user_id = int(user["sub"])

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
                    "created_at": row[7].isoformat() if row[7] else None,
                    "updated_at": row[8].isoformat() if row[8] else None,
                    "has_role_content": bool(row[9]),
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
                }
            )
        twins.sort(key=lambda item: item.get("updated_at") or "", reverse=True)

    return {"digital_twins": twins}


@router.get("/digital-twins/{agent_name}")
async def get_digital_twin_detail(agent_name: str, user: dict = Depends(get_current_user)):
    user_id = int(user["sub"])

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
                "created_at": row[7].isoformat() if row[7] else None,
                "updated_at": row[8].isoformat() if row[8] else None,
                "role_content": row[9],
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
        }

    return {"digital_twin": twin}
