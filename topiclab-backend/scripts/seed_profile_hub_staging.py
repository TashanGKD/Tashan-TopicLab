"""Seed only the designated synthetic acceptance user, never a real account."""
import json,os,re,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.import_profile_candidates import run

assert os.environ.get('PROFILE_HUB_ENVIRONMENT') == 'staging'
assert os.environ['DATABASE_URL'].endswith('/tashan_profile_hub_staging')
phone = sys.stdin.read().strip()
assert re.fullmatch(r'19900001\d{3}', phone), 'Only the pre-existing synthetic test account range is allowed'
with tempfile.TemporaryDirectory() as directory:
    for source, label in [('panshi-camp','Camp'),('tashan-community','Community'),('tashan-world','World')]:
        record = {'source_user_id':'synthetic-'+source, 'phone':phone, 'phone_verified':True,
            'name':'TEST Profile Hub', 'organization':'TEST '+label+' Institute',
            'major':'TEST Computer Science','research_direction':'TEST Materials AI',
            'updated_at':'2026-09-01T00:00:00Z'}
        file=Path(directory)/'fixture.json'
        file.write_text(json.dumps([record]),encoding='utf-8')
        result=run('profile-export',source_system=source,export=str(file),apply=True)
        print(json.dumps({'synthetic_source':source,'records':result['records_read']}))
