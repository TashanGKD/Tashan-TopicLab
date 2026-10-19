import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('write_env', Path(__file__).with_name('write-env.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class EnvironmentTests(unittest.TestCase):
    def test_preserves_auth_only_and_allows_explicit_override(self):
        old = "DATABASE_URL=old\nALIYUN_CAPTCHA_ENABLED=true\nALIYUN_CAPTCHA_PREFIX=old\nSMS_PROVIDER='aliyun'\nALIYUN_SMS_TEMPLATE_CODE=approved\n"
        new = 'DATABASE_URL=new\nALIYUN_CAPTCHA_PREFIX=new\nSMSBAO_PASSWORD=legacy\n'
        result = module.merge(new, old)
        self.assertIn('DATABASE_URL=new', result)
        self.assertNotIn('DATABASE_URL=old', result)
        self.assertIn('ALIYUN_CAPTCHA_ENABLED=true', result)
        self.assertIn('ALIYUN_CAPTCHA_PREFIX=new', result)
        self.assertNotIn('ALIYUN_CAPTCHA_PREFIX=old', result)
        self.assertNotIn('SMSBAO_PASSWORD', result)
        self.assertIn('ALIYUN_SMS_TEMPLATE_CODE=approved', result)

    def test_explicit_disable_is_not_ignored(self):
        self.assertEqual(module.merge('ALIYUN_CAPTCHA_ENABLED=false', 'ALIYUN_CAPTCHA_ENABLED=true').strip(), 'ALIYUN_CAPTCHA_ENABLED=false')

if __name__ == '__main__': unittest.main()
