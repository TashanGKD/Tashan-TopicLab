---
name: wechat-group-qr-updater
description: Use when updating TopicLab's Footer WeChat group QR code without a frontend release. Converts a new WeChat QR screenshot/photo to WebP and writes it to the site_assets database row used by /api/v1/site/wechat-group-qr.webp.
---

# WeChat Group QR Updater

Use this skill when the user provides a new "他山世界交流群" WeChat QR image and wants the website Footer QR code updated without rebuilding or redeploying the frontend.

## What This Updates

- Database table: `site_assets`
- Asset key: `wechat-group-qr`
- Public endpoint: `/api/v1/site/wechat-group-qr.webp`
- Frontend consumer: `frontend/src/components/Footer.tsx`

The frontend URL is stable. Updating the database row is enough once the backend schema/API has been deployed.

## Inputs

Required:
- A local image path for the new WeChat group QR screenshot/photo.

Optional:
- `--expires-at` as an ISO timestamp, for example `2026-05-26T00:00:00+08:00`.
- `--database-url` if `DATABASE_URL` is not already set in the shell or repo `.env`.

## Procedure

1. Confirm the image exists and is the intended current WeChat group QR.
2. Run the bundled updater through the backend `uv` environment so Pillow and SQLAlchemy are available:

```bash
cd topiclab-backend
uv run python ../.codex/skills/wechat-group-qr-updater/scripts/update_wechat_group_qr.py \
  --image /absolute/path/to/new-wechat-qr.jpg \
  --expires-at 2026-05-26T00:00:00+08:00
```

3. The script converts the source image to WebP, upserts `site_assets.key='wechat-group-qr'`, and prints a compact JSON result.
4. Verify the public endpoint on the target environment:

```bash
curl -I "$TOPICLAB_BASE_URL/api/v1/site/wechat-group-qr.webp"
```

Expected:
- HTTP `200`
- `content-type: image/webp`
- `cache-control: public, max-age=60`

## Notes

- Do not commit a new QR image for regular weekly updates; use this skill to write the database asset.
- If updating a local dev database, set `DATABASE_URL` to the local SQLite/Postgres database before running.
- If updating production, load the production `.env` or pass `--database-url` explicitly.
