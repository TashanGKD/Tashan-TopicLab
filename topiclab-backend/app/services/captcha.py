"""Server-enforced Alibaba Cloud CAPTCHA 2.0 for account entry points."""
from __future__ import annotations

import json
import logging
import os
from typing import Literal

from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)
Purpose = Literal["sms", "login"]


def enabled() -> bool:
    return os.getenv("ALIYUN_CAPTCHA_ENABLED", "false").lower() == "true"


def scene_id(purpose: Purpose) -> str:
    return os.getenv(f"ALIYUN_CAPTCHA_{purpose.upper()}_SCENE_ID", "").strip()


def public_config() -> dict:
    if not enabled():
        return {"enabled": False}
    return {
        "enabled": True,
        "prefix": os.getenv("ALIYUN_CAPTCHA_PREFIX", "").strip(),
        "region": os.getenv("ALIYUN_CAPTCHA_REGION", "cn").strip(),
        "scenes": {purpose: scene_id(purpose) for purpose in ("sms", "login")},
    }


def _verify(purpose: Purpose, token: str) -> None:
    key = os.getenv("ALIYUN_CAPTCHA_ACCESS_KEY_ID", "").strip()
    secret = os.getenv("ALIYUN_CAPTCHA_ACCESS_KEY_SECRET", "").strip()
    region = os.getenv("ALIYUN_CAPTCHA_REGION", "cn").strip()
    scene = scene_id(purpose)
    if not all((key, secret, scene)) or region not in ("cn", "sgp"):
        raise HTTPException(503, "安全验证暂不可用，请稍后重试")
    request = CommonRequest()
    request.set_domain("captcha.cn-shanghai.aliyuncs.com" if region == "cn" else "captcha.ap-southeast-1.aliyuncs.com")
    request.set_version("2023-03-05")
    request.set_action_name("VerifyIntelligentCaptcha")
    request.set_method("POST")
    request.set_protocol_type("https")
    request.set_accept_format("json")
    request.add_body_params("SceneId", scene)
    request.add_body_params("CaptchaVerifyParam", token)
    try:
        client = AcsClient(key, secret, region_id="cn-shanghai" if region == "cn" else "ap-southeast-1",
                           auto_retry=False, connect_timeout=3, timeout=10)
        response = json.loads(client.do_action_with_exception(request))
    except Exception:
        # SDK errors can contain credentials or verification payloads. Never log them.
        logger.warning("CAPTCHA provider request failed")
        raise HTTPException(503, "安全验证暂不可用，请稍后重试") from None
    result = response.get("Result") or {}
    if response.get("Success") is not True:
        raise HTTPException(503, "安全验证暂不可用，请稍后重试")
    # Reject forced-pass test policies as well as replay, expiry and scene mismatch.
    if result.get("VerifyResult") is not True or result.get("VerifyCode") != "T001":
        raise HTTPException(428, "安全验证未通过，请重新验证")


async def require_captcha(purpose: Purpose, token: str | None) -> None:
    if not enabled():
        return
    if not token or not token.strip():
        raise HTTPException(428, "请先完成安全验证")
    await run_in_threadpool(_verify, purpose, token)
