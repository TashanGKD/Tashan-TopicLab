import json

import pytest

from app.services import sms
import app.api.auth as auth


@pytest.fixture(autouse=True)
def sms_environment(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "aliyun")
    monkeypatch.setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-access-key")
    monkeypatch.setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
    monkeypatch.setenv("ALIYUN_SMS_SIGN_NAME", "他山青年")
    monkeypatch.setenv("ALIYUN_SMS_TEMPLATE_CODE", "SMS_511755207")
    monkeypatch.setenv("ALIYUN_SMS_TEMPLATE_PARAM_KEY", "code")
    monkeypatch.delenv("SMSBAO_USERNAME", raising=False)
    monkeypatch.setattr(sms, "AcsClient", lambda *a, **kw: pytest.fail("Unexpected network client"))


def capture_client(monkeypatch, result=None, error=None):
    calls = []
    class Client:
        def __init__(self, *args, **kwargs):
            self.options = kwargs
        def do_action_with_exception(self, request):
            calls.append((request, self.options))
            if error:
                raise error
            return json.dumps(result).encode()
    monkeypatch.setattr(sms, "AcsClient", Client)
    return calls


@pytest.mark.asyncio
async def test_sends_approved_sign_and_template_over_https_without_retry(monkeypatch):
    calls = capture_client(monkeypatch, {"Code": "OK"})
    assert await auth.send_sms("13800138000", "654321") == (True, "验证码发送成功")
    assert len(calls) == 1
    request, options = calls[0]
    assert request.get_domain() == "dysmsapi.aliyuncs.com"
    assert request.get_protocol_type() == "https"
    assert request.get_method() == "POST"
    assert request.get_action_name() == "SendSms"
    params = request.get_body_params()
    assert params["PhoneNumbers"] == "13800138000"
    assert params["SignName"] == "他山青年"
    assert params["TemplateCode"] == "SMS_511755207"
    assert json.loads(params["TemplateParam"]) == {"code": "654321"}
    assert options["auto_retry"] is False
    assert options["timeout"] == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["ALIYUN_SMS_ACCESS_KEY_ID", "ALIYUN_SMS_ACCESS_KEY_SECRET", "ALIYUN_SMS_TEMPLATE_CODE"])
async def test_missing_config_fails_closed_even_with_smsbao_credentials(monkeypatch, key):
    monkeypatch.delenv(key)
    monkeypatch.setenv("SMSBAO_USERNAME", "legacy-user")
    monkeypatch.setenv("SMSBAO_PASSWORD", "legacy-password")
    assert (await auth.send_sms("13800138000", "654321"))[0] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("code,message", [
    ("isv.BUSINESS_LIMIT_CONTROL", "验证码发送过于频繁，请稍后再试"),
    ("isv.MOBILE_NUMBER_ILLEGAL", "手机号码不正确"),
    ("isv.SMS_SIGN_NAME_ILLEGAL", "短信发送失败，请稍后重试"),
])
async def test_provider_rejection_is_not_success(monkeypatch, code, message):
    capture_client(monkeypatch, {"Code": code})
    assert await auth.send_sms("13800138000", "654321") == (False, message)


@pytest.mark.asyncio
async def test_timeout_never_retries_and_does_not_log_sensitive_request(monkeypatch, caplog):
    calls = capture_client(monkeypatch, error=TimeoutError("test-secret 13800138000 654321"))
    assert (await auth.send_sms("13800138000", "654321"))[0] is False
    assert len(calls) == 1
    assert "test-secret" not in caplog.text
    assert "13800138000" not in caplog.text
    assert "654321" not in caplog.text


@pytest.mark.asyncio
async def test_send_code_does_not_return_code_when_smsbao_is_unset(monkeypatch):
    capture_client(monkeypatch, {"Code": "OK"})
    monkeypatch.setattr(auth, "DATABASE_CONFIGURED", False)
    monkeypatch.setattr(auth, "_get_dev_user", lambda phone: None, raising=False)
    monkeypatch.setattr(auth, "_save_dev_code", lambda *args: None, raising=False)
    result = await auth.send_verification_code(auth.SendCodeRequest(phone="13800138000", type="register"))
    assert result["dev_code"] is None


@pytest.mark.asyncio
async def test_development_requires_explicit_opt_in_and_no_database(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "development")
    assert (await auth.send_sms("13800138000", "654321"))[0] is False
    monkeypatch.delenv("DATABASE_URL")
    assert await auth.send_sms("13800138000", "654321") == (True, "开发模式：未发送短信")
