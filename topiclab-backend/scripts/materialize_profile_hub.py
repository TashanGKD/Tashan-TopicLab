"""Private real-data import. Output aggregate counts only, never row values."""
import json,os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import text,inspect
from app.storage.database.postgres_client import get_db_session
from app.services import profile_hub_service as hub
from scripts import import_profile_candidates as importer

def main():
    if os.environ.get('PROFILE_HUB_ENVIRONMENT')!='production':raise RuntimeError('Production import requires explicit environment')
    if '--backup' in sys.argv:
        with get_db_session() as db:
            rows=[dict(r) for r in db.execute(text('SELECT user_id,version,real_name,organization,major,research_direction FROM user_profiles')).mappings()]
        path=Path('/backup/user-profiles-before.json')
        with path.open('x') as file:json.dump(rows,file,ensure_ascii=False,default=str)
        path.chmod(0o600)
        print(json.dumps({'profileBackupRows':len(rows)}));return
    apply='--apply' in sys.argv
    summaries=[]
    for source in hub.SOURCE_SYSTEMS:
        result=importer.run('profile-export',source_system=source,export='/imports/'+source+'.json',apply=apply)
        summaries.append(result)
    print(json.dumps({'imports':summaries},ensure_ascii=False))
    if not apply:return
    with get_db_session() as db:
        phones=db.execute(text('SELECT DISTINCT phone FROM profile_hub_source_people WHERE phone IS NOT NULL')).scalars().all()
    count=0
    for phone in phones:
        result=hub.sync_by_identity(phone,'panshi-forum',{})
        count+=int(result['found'])
    with get_db_session() as db:
        sources=[dict(r) for r in db.execute(text('SELECT source_system,count(*) AS records,count(DISTINCT phone) AS phones FROM profile_hub_source_people GROUP BY source_system')).mappings()]
        candidates=db.execute(text('SELECT count(*) FROM profile_hub_candidates')).scalar()
    print(json.dumps({'materializedProfiles':count,'distinctPhones':len(phones),'sources':sources,'candidateFields':candidates}))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        # SQLAlchemy errors can include personal fields/DSNs. Keep details private.
        print(json.dumps({'failed':True,'errorType':type(exc).__name__}));sys.exit(1)
