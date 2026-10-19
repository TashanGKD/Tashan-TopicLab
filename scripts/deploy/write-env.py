#!/usr/bin/env python3
"""Install DEPLOY_ENV atomically, retaining server-managed auth keys absent from it."""
import os
from pathlib import Path
import tempfile


def merge(incoming: str, existing: str) -> str:
    def key(line):
        return line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
    provided = {key(line) for line in incoming.splitlines()}
    retained = [line for line in existing.splitlines()
                if (key(line).startswith(('ALIYUN_SMS_', 'ALIYUN_CAPTCHA_')) or key(line) == 'SMS_PROVIDER')
                and key(line) not in provided]
    result = incoming.rstrip() + '\n' + '\n'.join(retained) + '\n'
    if any(key(line) == 'SMS_PROVIDER' and line.split('=', 1)[1].strip().strip("\"'") == 'aliyun' for line in result.splitlines()):
        result = '\n'.join(line for line in result.splitlines() if not key(line).startswith('SMSBAO_')) + '\n'
    return result


if __name__ == '__main__':
    target = Path('.env')
    incoming = os.environ.get('DEPLOY_ENV', '')
    if not incoming.strip():
        raise SystemExit('DEPLOY_ENV is missing')
    content = merge(incoming, target.read_text() if target.exists() else '')
    fd, path = tempfile.mkstemp(prefix='.env-', dir='.')
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
        os.chmod(path, 0o600)
        os.replace(path, target)
    finally:
        Path(path).unlink(missing_ok=True)
