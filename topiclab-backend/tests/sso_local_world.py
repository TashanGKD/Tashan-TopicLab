"""Local integration fixture: production auth/admin/SSO routes, isolated SQLite.
Never imported by main.py. Does not contact SMS or Watcha providers.
"""
import os
from pathlib import Path
import json
import secrets
import bcrypt
from fastapi import FastAPI
from sqlalchemy import text

if os.environ.get('TOPICLAB_TESTING') != '1' or not os.environ.get('DATABASE_URL','').startswith('sqlite:'):
    raise RuntimeError('Local fixture requires explicit test mode and isolated SQLite')
os.environ['JWT_SECRET'] = 'local-fixture-only-' + secrets.token_hex(32)
os.environ['ADMIN_PANEL_PASSWORD'] = 'local-sso-admin-only'
from app.api import auth, sso, admin
from app.services import sso_service as svc
from app.storage.database.postgres_client import init_auth_tables, get_db_session

init_auth_tables()
with get_db_session() as db:
    uid=db.execute(text('''INSERT INTO users (phone,password,username,handle,is_guest)
        VALUES (:phone,:password,:username,:handle,false) ON CONFLICT (phone) DO UPDATE SET username=excluded.username RETURNING id'''),dict(phone='13800000000',
        password=bcrypt.hashpw(b'local-demo-only',bcrypt.gensalt()).decode(),username='本地联调用户',handle='sso-local-fixture')).scalar_one()

app=FastAPI()
app.include_router(auth.router,prefix='/auth')
app.include_router(sso.router,prefix='/auth')
app.include_router(admin.router)
app.include_router(sso.admin_router)
config={'version':2,'demo':True,'provider':{'loginUrl':'http://127.0.0.1:14400/login','apiBase':'http://127.0.0.1:14403'},'clients':[]}
existing = Path(os.environ['SSO_FIXTURE_CONFIG'])
if existing.exists(): config=json.loads(existing.read_text())
for name,host,port in ([] if config['clients'] else [('网站 A','127.0.0.1',14401),('网站 B','localhost',14402)]):
    c=svc.create_client(name,'https://'+secrets.token_hex(8)+'.example')
    origin=f'http://{host}:{port}'
    # Only this test fixture changes registrations to loopback HTTP. Production API rejects HTTP.
    with get_db_session() as db:
        db.execute(text('UPDATE sso_clients_v2 SET origin=:o,redirect_uri=:r WHERE client_id=:id'),dict(o=origin,r=origin+'/auth/callback',id=c['client_id']))
    config['clients'].append(dict(clientId=c['client_id'],clientSecret=c['client_secret'],sessionSecret=c['session_secret'],name=name,origin=origin))
path=Path(os.environ['SSO_FIXTURE_CONFIG']);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(config));path.chmod(0o600)
