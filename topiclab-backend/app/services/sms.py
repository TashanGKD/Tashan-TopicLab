"""Unified account verification messages through Alibaba Cloud SMS."""
from __future__ import annotations

import json
import logging
import os

# aliyun-python-sdk-core is provided by the existing oss2 dependency.
from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)


def development_sms_enabled() -> bool:
    # Explicit opt-in, limited to the in-memory local development backend.
    return os.getenv("SMS_PROVIDER") == "development" and not os.getenv("DATABASE_URL")


def _send_aliyun_sms(phone: str, code: str) -> tuple[bool, str]:
    access_key = (os.getenv("ALIYUN_SMS_ACCESS_KEY_ID") or "").strip()
    secret = (os.getenv("ALIYUN_SMS_ACCESS_KEY_SECRET") or "").strip()
    sign = (os.getenv("ALIYUN_SMS_SIGN_NAME") or "他山青年").strip()
    template = (os.getenv("ALIYUN_SMS_TEMPLATE_CODE") or "").strip()
    param_key = (os.getenv("ALIYUN_SMS_TEMPLATE_PARAM_KEY") or "code").strip()
    if not all((access_key, secret, sign, template, param_key)):
        logger.error("Alibaba Cloud verification SMS configuration is incomplete")
        return False, "短信服务暂不可用，请稍后重试"

    request = CommonRequest()
    request.set_domain("dysmsapi.aliyuncs.com")
    request.set_version("2017-05-25")
    request.set_action_name("SendSms")
    request.set_method("POST")
    request.set_protocol_type("https")
    request.set_accept_format("json")
    for key, value in {
        "PhoneNumbers": phone,
        "SignName": sign,
        "TemplateCode": template,
        "TemplateParam": json.dumps({param_key: code}, ensure_ascii=False),
    }.items():
        request.add_body_params(key, value)

    try:
        client = AcsClient(
            access_key, secret,
            region_id=os.getenv("ALIYUN_SMS_REGION_ID") or "cn-hangzhou",
            auto_retry=False, connect_timeout=3, timeout=10,
        )
        result = json.loads(client.do_action_with_exception(request))
        if result.get("Code") == "OK":
            return True, "验证码发送成功"
        # Do not log raw SDK errors, request parameters, phone numbers or codes.
        logger.warning("Alibaba Cloud verification SMS request rejected")
        if result.get("Code") == "isv.BUSINESS_LIMIT_CONTROL":
            return False, "验证码发送过于频繁，请稍后再试"
        if result.get("Code") == "isv.MOBILE_NUMBER_ILLEGAL":
            return False, "手机号码不正确"
        return False, "短信发送失败，请稍后重试"
    except Exception:
        # SendSms is not idempotent: never retry or fall back to another provider.
        logger.warning("Alibaba Cloud verification SMS request failed")
        return False, "短信发送失败，请稍后重试"


async def send_verification_sms(phone: str, code: str) -> tuple[bool, str]:
    if development_sms_enabled():
        return True, "开发模式：未发送短信"
    if (os.getenv("SMS_PROVIDER") or "aliyun") != "aliyun":
        logger.error("Unsupported verification SMS provider")
        return False, "短信服务暂不可用，请稍后重试"
    return await run_in_threadpool(_send_aliyun_sms, phone, code)
