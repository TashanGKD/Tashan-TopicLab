"""One-off aggregation of basic profile fields from existing activity sites.

Read-only by design: the camp adapter opens PostgreSQL in a read-only transaction,
the forum adapter opens the SQLite file immutably, and neither touches the source.

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
                   l.subject
              FROM user_profiles p
              JOIN users u ON u.id = p.user_id
              LEFT JOIN tashan_identity_links l ON l.user_id = u.id
             WHERE u.disabled_at IS NULL
             ORDER BY p.updated_at DESC NULLS LAST
        '''
        if limit:
            query += f' LIMIT {int(limit)}'
        for row in connection.execute(text(query)).mappings():
            rows.append(dict(row))
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
    # Immutable read-only open: never creates WAL files next to the live database.
    uri = f'file:{Path(path).as_posix()}?mode=ro&immutable=1'
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


def run(source: str, *, dsn=None, export=None, sqlite=None, phone_map=None,
        limit=None, apply=False) -> dict:
    if source == 'camp-postgres':
        records = read_camp_postgres(dsn, limit)
    elif source == 'camp-export':
        records = read_camp_export(export)
    elif source == 'forum-sqlite':
        records = read_forum_sqlite(sqlite, phone_map)
    else:
        raise SystemExit(f'未知来源 {source}')

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
        batch_id = hub.record_import_batch(db, source_system, 'apply' if apply else 'dry-run', {})
        for record in records:
            phone = hub.normalize_phone(record.get('phone'))
            subject = record.get('subject')
            subject = str(subject).strip() if subject else None
            if subject and subject.startswith('topiclab:'):
                subject = subject.split(':', 1)[1]
            if not phone and not subject:
                report['records_without_phone'] += 1
                continue
            user_id, matched_by = hub.find_user_for_import(db, phone=phone, subject=subject)
            if not user_id:
                report['records_without_central_account'] += 1
                continue
            report['records_matched_by_binding' if matched_by == 'binding' else 'records_matched_by_phone'] += 1
            items = candidates_for(source_system, record)
            present = {item['field'] for item in items}
            for field in hub.CANDIDATE_FIELDS:
                if field not in present:
                    report['missing_fields'][field] += 1
            stamp = iso(record.get('updated_at'))
            if stamp is None:
                report['unknown_source_time'] += 1
            for item in items:
                report['candidate_rows'] += 1
                values = seen.setdefault((user_id, item['field']), set())
                if values and item['value'] not in values:
                    report['conflicts'] += 1
                    report['conflict_fields'][item['field']] = report['conflict_fields'].get(item['field'], 0) + 1
                values.add(item['value'])
                if apply:
                    created = hub.upsert_candidate(
                        db, user_id=user_id, source_system=source_system,
                        source_user_id=str(record.get('source_user_id') or '')[:64],
                        field=item['field'], value=item['value'], source_updated_at=stamp,
                        batch_id=batch_id, field_note=item['note'])
                    report['candidate_rows_new' if created else 'candidate_rows_duplicate'] += 1
        report['batch_id'] = batch_id
        db.execute(text('UPDATE profile_import_batches SET finished_at=:now, summary=:summary WHERE id=:id'),
                   {'id': batch_id, 'now': int(__import__('time').time()),
                    'summary': json.dumps(report, ensure_ascii=False)})
    report['stored_candidates'] = None
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description='Aggregate basic profile fields from activity sites')
    parser.add_argument('--source', required=True, choices=['camp-postgres', 'camp-export', 'forum-sqlite'])
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
    if args.source == 'camp-export' and not args.export:
        parser.error('--export is required for camp-export')
    if args.source == 'forum-sqlite' and not args.sqlite:
        parser.error('--sqlite is required for forum-sqlite')
    report = run(args.source, dsn=args.dsn, export=args.export, sqlite=args.sqlite,
                 phone_map=args.phone_map, limit=args.limit, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.apply:
        with get_db_session() as db:
            print(json.dumps({'stored': hub.import_summary(db, report['source_system'])},
                             ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
