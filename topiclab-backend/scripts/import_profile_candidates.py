"""One-off aggregation of basic profile fields from existing activity sites.

Read-only by design: the camp adapter opens PostgreSQL in a read-only transaction,
the forum adapter opens SQLite read-only with WAL visibility, and neither writes source records.

Only four fields are collected. Passwords, codes, sessions, identity documents,
attachments, submissions, review notes and admin flags are never read.

Examples
--------
    # inspect first, nothing is written
    python scripts/import_profile_candidates.py --source camp-postgres \
        --dsn "$CAMP_READONLY_DSN" --dry-run

    # then apply (idempotent; re-running does not duplicate rows)
    python scripts/import_profile_candidates.py --source camp-postgres \
        --dsn "$CAMP_READONLY_DSN" --apply
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.services import profile_hub_service as hub  # noqa: E402
from app.storage.database.postgres_client import get_db_session  # noqa: E402

FIELD_LABELS = hub.FIELD_LABELS


def iso(value) -> str | None:
    """Return an ISO timestamp, or None when the source has no usable time."""
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.isoformat().replace('+00:00', 'Z')
    text_value = str(value).strip()
    if not text_value:
        return None
    try:
        parsed = datetime.fromisoformat(text_value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed.isoformat().replace('+00:00', 'Z')


def masked(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:10]


# --------------------------------------------------------------------------- adapters


def read_camp_postgres(dsn: str, limit: int | None) -> list[dict]:
    from sqlalchemy import create_engine

    engine = create_engine(dsn, pool_pre_ping=True)
    rows: list[dict] = []
    with engine.connect() as connection:
        # Read-only transaction: the source database cannot be modified by this tool.
        connection.execute(text('SET TRANSACTION READ ONLY'))
        query = '''
            SELECT u.id::text AS source_user_id,
                   u.phone_normalized AS phone,
                   p.name, p.organization, p.major_research_direction,
                   p.updated_at,
                   a.core_fields->>'name' AS application_name,
                   a.core_fields->>'organization' AS application_organization,
                   a.core_fields->>'major' AS major,
                   a.core_fields->>'researchDirection' AS research_direction,
                   a.core_fields->>'majorResearchDirection' AS application_combined,
                   a.updated_at AS application_updated_at,
                   l.subject
              FROM users u
              LEFT JOIN user_profiles p ON u.id = p.user_id
              LEFT JOIN applications a ON a.user_id = u.id
              LEFT JOIN tashan_identity_links l ON l.user_id = u.id
             WHERE u.disabled_at IS NULL
             ORDER BY p.updated_at DESC NULLS LAST
        '''
        if limit:
            query += f' LIMIT {int(limit)}'
        for row in connection.execute(text(query)).mappings():
            record = dict(row)
            # Preserve both the profile and the application version when they differ.
            record['historical_profiles'] = [{
                'name': record.pop('application_name'), 'organization': record.pop('application_organization'),
                'major': record.pop('major'), 'research_direction': record.pop('research_direction'),
                'major_research_direction': record.pop('application_combined'),
                'updated_at': record.pop('application_updated_at'), 'note': 'application_snapshot'}]
            rows.append(record)
    engine.dispose()
    return rows


def read_camp_export(path: str) -> list[dict]:
    payload = json.loads(Path(path).read_text(encoding='utf-8'))
    records = payload.get('records') if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise SystemExit('导出文件格式不正确：需要数组或 {"records": [...]}')
    return [dict(item) for item in records]


def read_forum_sqlite(path: str, phone_map: str | None) -> list[dict]:
    phones: dict[str, str] = {}
    if phone_map:
        phones = json.loads(Path(phone_map).read_text(encoding='utf-8'))
    # immutable=1 ignores committed WAL rows. mode=ro reads the live snapshot.
    uri = Path(path).resolve().as_uri() + '?mode=ro'
    connection = sqlite3.connect(uri, uri=True)
    try:
        rows = connection.execute(
            "SELECT owner, data FROM objects WHERE kind='registration' ORDER BY rowid").fetchall()
    finally:
        connection.close()
    records = []
    for owner, raw in rows:
        record = json.loads(raw)
        data = record.get('data') or {}
        records.append({
            'source_user_id': owner,
            'phone': phones.get(owner),
            'name': data.get('name'),
            'organization': data.get('organization'),
            'major': data.get('major'),
            'research_direction': data.get('researchDirection'),
            # The forum keeps the timestamp inside the serialized record.
            'updated_at': record.get('updatedAt'),
        })
    return records


# --------------------------------------------------------------------------- mapping


def candidates_for(source_system: str, record: dict) -> list[dict]:
    """Map one source record to candidate field rows, keeping raw combined values."""
    items = []
    if source_system == 'panshi-camp':
        # The camp stores major and research direction in one combined column.
        mapping = (('real_name', record.get('name'), None),
                   ('organization', record.get('organization'), None),
                   ('major', record.get('major'), None),
                   ('research_direction', record.get('research_direction'), None),
                   ('research_direction', record.get('major_research_direction'), 'combined_field'))
    else:
        mapping = (('real_name', record.get('name'), None),
                   ('organization', record.get('organization'), None),
                   ('major', record.get('major'), None),
                   ('research_direction', record.get('research_direction'), None))
    for field, value, note in mapping:
        if isinstance(value, str) and value.strip():
            items.append({'field': field, 'value': value.strip()[:hub.FIELD_LIMITS[field]], 'note': note})
    return items


def run(source: str, *, dsn=None, export=None, sqlite=None, phone_map=None, source_system=None,
        limit=None, apply=False) -> dict:
    if source == 'camp-postgres':
        records = read_camp_postgres(dsn, limit)
    elif source in ('camp-export', 'profile-export'):
        records = read_camp_export(export)
    elif source == 'forum-sqlite':
        records = read_forum_sqlite(sqlite, phone_map)
    else:
        raise SystemExit(f'未知来源 {source}')

    if source == 'profile-export':
        if source_system not in hub.SOURCE_SYSTEMS:
            raise ValueError('Explicit approved source_system required for profile-export')
    else:
        source_system = {'camp-postgres': 'panshi-camp', 'camp-export': 'panshi-camp',
                         'forum-sqlite': 'panshi-forum'}[source]
    report = {
        'source_system': source_system,
        'mode': 'apply' if apply else 'dry-run',
        'records_read': len(records),
        'records_without_phone': 0,
        'records_without_central_account': 0,
        'records_matched_by_binding': 0,
        'records_matched_by_phone': 0,
        'candidate_rows': 0,
        'candidate_rows_new': 0,
        'candidate_rows_duplicate': 0,
        'missing_fields': {field: 0 for field in hub.CANDIDATE_FIELDS},
        'unknown_source_time': 0,
        'conflicts': 0,
        'conflict_fields': {},
    }
    seen: dict[tuple[int, str], set[str]] = {}

    with get_db_session() as db:
        # Load indexes once rather than querying remotely for every source field.
        users={str(r['id']):dict(r) for r in db.execute(text('SELECT id,phone FROM users WHERE is_guest=false')).mappings()}
        by_phone={r['phone']:r['id'] for r in users.values() if r['phone']}
        current_by_phone={}
        for row in db.execute(text('SELECT u.phone,p.real_name,p.organization,p.major,p.research_direction FROM user_profiles p JOIN users u ON u.id=p.user_id')).mappings():
            current_by_phone[row['phone']]=dict(row)
        for row in db.execute(text('SELECT phone,real_name,organization,major,research_direction FROM profile_hub_external_profiles')).mappings():
            current_by_phone[row['phone']]=dict(row)
        stored_values={}
        for row in db.execute(text('SELECT phone,field,value FROM profile_hub_candidates')).mappings():
            stored_values.setdefault((row['phone'],row['field']),set()).add(row['value'])
        bulk = apply and db.bind.dialect.name == 'postgresql'
        people_rows={};candidate_rows={}
        known_candidates=set(tuple(r) for r in db.execute(text('SELECT source_system,source_user_id,field,value_hash FROM profile_hub_candidates'))) if bulk else set()
        batch_id = hub.record_import_batch(db, source_system, 'apply', {}) if apply else None
        for record in records:
            phone = hub.normalize_phone(record.get('phone'))
            subject = record.get('subject')
            subject = str(subject).strip() if subject else None
            if subject and subject.startswith('topiclab:'):
                subject = subject.split(':', 1)[1]
            if not phone and not subject:
                report['records_without_phone'] += 1
            user_id = users.get(subject, {}).get('id') if subject else None
            matched_by = 'binding' if user_id else 'phone'
            user_id = user_id or by_phone.get(phone)
            if not user_id:
                report['records_without_central_account'] += 1
            else:
                report['records_matched_by_binding' if matched_by == 'binding' else 'records_matched_by_phone'] += 1
            if not phone and user_id:
                phone = users[str(user_id)]['phone']
            source_user_id = str(record.get('source_user_id') or '').strip()
            if not source_user_id or len(source_user_id) > 256:
                raise ValueError('Every source record needs a stable source_user_id of at most 256 characters')
            verified = record.get('phone_verified') if isinstance(record.get('phone_verified'), bool) else None
            if bulk:
                people_rows[source_user_id]=(source_system,source_user_id,phone,verified,user_id,iso(record.get('updated_at')),hub._now(),batch_id)
            elif apply:
                db.execute(text('''INSERT INTO profile_hub_source_people
                    (source_system,source_user_id,phone,phone_verified,central_user_id,source_updated_at,imported_at,batch_id)
                    VALUES (:source,:id,:phone,:verified,:uid,:updated,:now,:batch)
                    ON CONFLICT(source_system,source_user_id) DO UPDATE SET
                    phone=:phone,phone_verified=:verified,central_user_id=:uid,
                    source_updated_at=:updated,imported_at=:now,batch_id=:batch'''),
                    {'source': source_system, 'id': source_user_id, 'phone': phone, 'verified': verified,
                     'uid': user_id, 'updated': iso(record.get('updated_at')), 'now': hub._now(), 'batch': batch_id})
            items = [{**item, 'stamp': iso(record.get('updated_at'))} for item in candidates_for(source_system, record)]
            for historical in record.get('historical_profiles', []):
                if not isinstance(historical, dict):
                    raise ValueError('historical_profiles must contain profile objects')
                items.extend({**item, 'stamp': iso(historical.get('updated_at'))}
                             for item in candidates_for(source_system, historical))
            present = {item['field'] for item in items}
            for field in hub.CANDIDATE_FIELDS:
                if field not in present:
                    report['missing_fields'][field] += 1
            stamp = iso(record.get('updated_at'))
            if stamp is None:
                report['unknown_source_time'] += 1
            for item in items:
                report['candidate_rows'] += 1
                identity = phone or source_system + ':' + source_user_id
                slot = (identity, item['field'])
                if slot not in seen:
                    seen[slot] = set(stored_values.get((phone,item['field']),set()))
                    current = current_by_phone.get(phone) or {}
                    if current.get(item['field']):seen[slot].add(current[item['field']])
                values = seen[slot]
                if values and item['value'] not in values:
                    report['conflicts'] += 1
                    report['conflict_fields'][item['field']] = report['conflict_fields'].get(item['field'], 0) + 1
                values.add(item['value'])
                if bulk:
                    value=item['value'][:hub.FIELD_LIMITS[item['field']]]
                    key=(source_system,source_user_id,item['field'],hub.digest(value))
                    created=key not in known_candidates;known_candidates.add(key)
                    report['candidate_rows_new' if created else 'candidate_rows_duplicate']+=1
                    row=(hub.secrets.token_hex(16),user_id,phone,verified,source_system,source_user_id,item['field'],value,key[3],item['stamp'],item['note'],hub._now(),batch_id)
                    if key not in candidate_rows or hub.source_timestamp(row[9])>hub.source_timestamp(candidate_rows[key][9]):candidate_rows[key]=row
                elif apply:
                    created = hub.upsert_candidate(
                        db, user_id=user_id, source_system=source_system,
                        source_user_id=source_user_id, phone=phone,
                        phone_verified=record.get('phone_verified') if isinstance(record.get('phone_verified'), bool) else None,
                        field=item['field'], value=item['value'], source_updated_at=item['stamp'],
                        batch_id=batch_id, field_note=item['note'])
                    report['candidate_rows_new' if created else 'candidate_rows_duplicate'] += 1
        if bulk:
            from psycopg2.extras import execute_values
            cursor=db.connection().connection.cursor()
            try:
                execute_values(cursor,"""INSERT INTO profile_hub_source_people
                    (source_system,source_user_id,phone,phone_verified,central_user_id,source_updated_at,imported_at,batch_id) VALUES %s
                    ON CONFLICT(source_system,source_user_id) DO UPDATE SET phone=EXCLUDED.phone,phone_verified=EXCLUDED.phone_verified,
                    central_user_id=EXCLUDED.central_user_id,source_updated_at=EXCLUDED.source_updated_at,imported_at=EXCLUDED.imported_at,batch_id=EXCLUDED.batch_id""",list(people_rows.values()),page_size=500)
                execute_values(cursor,"""INSERT INTO profile_hub_candidates
                    (id,user_id,phone,phone_verified,source_system,source_user_id,field,value,value_hash,source_updated_at,field_note,imported_at,batch_id) VALUES %s
                    ON CONFLICT(source_system,source_user_id,field,value_hash) DO UPDATE SET
                    source_updated_at=EXCLUDED.source_updated_at,imported_at=EXCLUDED.imported_at,batch_id=EXCLUDED.batch_id
                    WHERE EXCLUDED.source_updated_at IS NOT NULL AND
                    (profile_hub_candidates.source_updated_at IS NULL OR EXCLUDED.source_updated_at::timestamptz>profile_hub_candidates.source_updated_at::timestamptz)""",list(candidate_rows.values()),page_size=500)
            finally:cursor.close()
        report['batch_id'] = batch_id
        if apply:
            db.execute(text('UPDATE profile_import_batches SET finished_at=:now, summary=:summary WHERE id=:id'),
                       {'id': batch_id, 'now': int(__import__('time').time()),
                        'summary': json.dumps(report, ensure_ascii=False)})
    report['stored_candidates'] = None
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description='Aggregate basic profile fields from activity sites')
    parser.add_argument('--source', required=True, choices=['camp-postgres', 'camp-export', 'forum-sqlite', 'profile-export'])
    parser.add_argument('--source-system', choices=hub.SOURCE_SYSTEMS)
    parser.add_argument('--dsn', help='read-only PostgreSQL DSN for the camp database')
    parser.add_argument('--export', help='camp export JSON file')
    parser.add_argument('--sqlite', help='forum recovery.sqlite path')
    parser.add_argument('--phone-map', help='owner -> phone JSON map for the forum source')
    parser.add_argument('--limit', type=int, default=None)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true')
    group.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.source == 'camp-postgres' and not args.dsn:
        parser.error('--dsn is required for camp-postgres')
    if args.source in ('camp-export', 'profile-export') and not args.export:
        parser.error('--export is required for camp-export')
    if args.source == 'forum-sqlite' and not args.sqlite:
        parser.error('--sqlite is required for forum-sqlite')
    report = run(args.source, dsn=args.dsn, export=args.export, sqlite=args.sqlite, source_system=args.source_system,
                 phone_map=args.phone_map, limit=args.limit, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.apply:
        with get_db_session() as db:
            print(json.dumps({'stored': hub.import_summary(db, report['source_system'])},
                             ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
