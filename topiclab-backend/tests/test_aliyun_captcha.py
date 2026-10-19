import json

import pytest
from fastapi import HTTPException
from app.services import captcha
import app.api.auth as auth


@pytest.fixture(autouse=True)
def config(monkeypatch):
    for key, value in {'ENABLED': 'true', 'ACCESS_KEY_ID': 'unit-key', 'ACCESS_KEY_SECRET': 'unit-secret',
                       'PREFIX': 'unit-prefix', 'REGION': 'cn', 'SMS_SCENE_ID': 'sms-scene', 'LOGIN_SCENE_ID': 'login-scene'}.items():
        monkeypatch.setenv('ALIYUN_CAPTCHA_' + key, value)
    monkeypatch.setattr(captcha, 'AcsClient', lambda *a, **kw: pytest.fail('Unexpected provider call'))


def provider(monkeypatch, result, error=None):
    calls = []
    class Client:
        def __init__(self, *args, **kwargs):
            assert kwargs['auto_retry'] is False
        def do_action_with_exception(self, request):
            calls.append(request)
            if error: raise error
            return json.dumps(result).encode()
    monkeypatch.setattr(captcha, 'AcsClient', Client)
    return calls


@pytest.mark.asyncio
@pytest.mark.parametrize('purpose', ['sms', 'login'])
async def test_trusted_scene_and_opaque_token(monkeypatch, purpose):
    calls = provider(monkeypatch, {'Success': True, 'Result': {'VerifyResult': True, 'VerifyCode': 'T001'}})
    await captcha.require_captcha(purpose, 'opaque-token')
    assert calls[0].get_body_params() == {'SceneId': purpose + '-scene', 'CaptchaVerifyParam': 'opaque-token'}
    assert calls[0].get_protocol_type() == 'https'
    assert calls[0].get_action_name() == 'VerifyIntelligentCaptcha'


@pytest.mark.asyncio
@pytest.mark.parametrize('code', ['F001', 'F008', 'F012', 'F014', 'F018', 'T005'])
async def test_risk_replay_expiry_scene_and_test_policy_rejected(monkeypatch, code):
    provider(monkeypatch, {'Success': True, 'Result': {'VerifyResult': code == 'T005', 'VerifyCode': code}})
    with pytest.raises(HTTPException) as exc: await captcha.require_captcha('sms', 'opaque-token')
    assert exc.value.status_code == 428


@pytest.mark.asyncio
async def test_missing_proof_stops_before_password_or_sms_work(monkeypatch):
    monkeypatch.setattr(auth, 'get_db_session', lambda: pytest.fail('Database accessed before CAPTCHA'))
    monkeypatch.setattr(auth, 'generate_code', lambda: pytest.fail('SMS code created before CAPTCHA'))
    monkeypatch.setattr(auth, 'DATABASE_CONFIGURED', True)
    for handler, request in [(auth.login, auth.LoginRequest(phone='13800000000', password='abcdef')),
                             (auth.send_verification_code, auth.SendCodeRequest(phone='13800000000'))]:
        with pytest.raises(HTTPException) as exc: await handler(request)
        assert exc.value.status_code == 428


@pytest.mark.asyncio
async def test_timeout_fails_closed_without_sensitive_logging(monkeypatch, caplog):
    provider(monkeypatch, None, TimeoutError('unit-secret opaque-token'))
    with pytest.raises(HTTPException) as exc: await captcha.require_captcha('login', 'opaque-token')
    assert exc.value.status_code == 503
    assert 'unit-secret' not in caplog.text and 'opaque-token' not in caplog.text


@pytest.mark.asyncio
async def test_missing_credentials_cannot_disable_protection(monkeypatch):
    monkeypatch.delenv('ALIYUN_CAPTCHA_ACCESS_KEY_SECRET')
    with pytest.raises(HTTPException) as exc: await captcha.require_captcha('login', 'opaque-token')
    assert exc.value.status_code == 503


def test_public_config_contains_no_credentials():
    config = captcha.public_config()
    assert config['scenes'] == {'sms': 'sms-scene', 'login': 'login-scene'}
    assert 'unit-secret' not in json.dumps(config) and 'unit-key' not in json.dumps(config)


@pytest.mark.asyncio
async def test_disabled_rollout_preserves_existing_flow(monkeypatch):
    monkeypatch.setenv('ALIYUN_CAPTCHA_ENABLED', 'false')
    await captcha.require_captcha('login', None)
    assert captcha.public_config() == {'enabled': False}


def test_audit_redacts_captcha_proof():
    from app.services.request_audit import summarize_request_body
    result = summarize_request_body(json.dumps({"captcha_verify_param": "private-proof"}).encode(), "application/json")
    assert "private-proof" not in str(result)
