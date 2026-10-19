# Unified account CAPTCHA

Password login and all SMS-code sends share Alibaba Cloud CAPTCHA 2.0. The browser dynamically loads the official Web/H5 V2 SDK. It posts the opaque proof alongside the business request; the server calls VerifyIntelligentCaptcha with its own configured scene before looking up credentials or creating/sending an SMS code. Existing authenticated SSO handoffs do not require a new challenge.

## Configuration

Set these in the backend server environment (never in frontend build variables):

- ALIYUN_CAPTCHA_ENABLED=true
- ALIYUN_CAPTCHA_PREFIX: instance identity prefix
- ALIYUN_CAPTCHA_REGION=cn (or sgp with the matching instance)
- ALIYUN_CAPTCHA_SMS_SCENE_ID: formal Web/H5 SMS scene
- ALIYUN_CAPTCHA_LOGIN_SCENE_ID: separate formal Web/H5 login scene
- ALIYUN_CAPTCHA_ACCESS_KEY_ID and ALIYUN_CAPTCHA_ACCESS_KEY_SECRET: server-only credentials authorized for VerifyIntelligentCaptcha

This uses online RPC verification, not local ekey decryption. Never publish an ekey. The public `/auth/captcha-config` endpoint returns only enablement, prefix, region and scene IDs. Request auditing redacts CAPTCHA proofs.

When enabled, missing proof returns 428; invalid/risky/expired/replayed/wrong-scene proof returns 428; unavailable or incomplete provider configuration returns 503. Only formal T001 results pass. Provider forced-pass test policy T005 is rejected. No retry or provider-outage bypass is used. A failed invisible check can trigger the provider's secondary challenge. Business failures such as a wrong password remain distinct from CAPTCHA failures.

## Deployment and rollback

Use the existing auth-only deployment with an `[auth-only]` commit. It updates only the account backend and frontend. Back up `.env` before configuration changes; image rollback does not restore configuration. Explicitly setting ALIYUN_CAPTCHA_ENABLED=false rolls back the new guard if needed, and must be an intentional operator decision.

The full deployment installs DEPLOY_ENV atomically with mode 600 and retains existing SMS_PROVIDER, ALIYUN_SMS_* and ALIYUN_CAPTCHA_* keys when absent from that secret. Explicit values in DEPLOY_ENV override retained values. Update the authoritative secret when rotating an explicitly configured credential. No database migration or account data changes are required.

## Verification

Run backend test_aliyun_captcha.py and test_aliyun_sms.py; frontend useCaptcha.test.tsx, SsoFlow.test.tsx and layoutChrome.test.ts; scripts/deploy/test_write_env.py; frontend production build. Provider test doubles exercise failure branches only and are not live-provider acceptance.

On the deployed site verify missing/invalid proof rejection, desktop/mobile SDK initialization and interactive challenge behavior. Actual successful login requires an authorized account; actual SMS sending requires separate authorization. Do not report either as tested from unit tests or HTTP health alone.
