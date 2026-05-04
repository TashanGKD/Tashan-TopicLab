# Deploy Guide

## GitHub Actions Deploy

The deploy workflow (`.github/workflows/deploy.yml`) runs on push to `main`. It SSHs to the server, pulls the repo, builds Docker images (topiclab-backend, backend, frontend), and starts services.

### Required Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | SSH host (IP or hostname) |
| `DEPLOY_USER` | SSH username |
| `SSH_PRIVATE_KEY` | SSH private key for authentication |
| `DEPLOY_ENV` | **Full `.env` content** (see below) |
| `SUBMODULE_TOKEN` | GitHub token used for nested private submodules (fallback: `GITHUB_TOKEN`) |
| `DEPLOY_PATH` | (Optional) Base path on server, default `/var/www/github-actions/repos` |

`SUBMODULE_TOKEN` should have read access to all nested skill repositories used by `backend/libs/assignable_skills/_submodules/`, including `K-Dense-AI/claude-scientific-skills`.

### Configuring `DEPLOY_ENV`

`DEPLOY_ENV` is the full `.env` content for production. Create it locally and paste into the GitHub Secret.

**Steps:**

1. Copy `.env.deploy.example` to `.env.deploy` and fill in for production (including API keys):
   ```bash
   cp .env.deploy.example .env.deploy
   # Edit .env.deploy and fill in ANTHROPIC_API_KEY, AI_GENERATION_API_KEY, etc.
   ```

2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
3. Set name to `DEPLOY_ENV`, paste the full content of `.env.deploy` as value (including newlines)

**Note:** `.env.deploy.example` is the production template; its structure matches local `.env.example`. Use real API keys in production; do not use the `test` placeholder.

**Frontend base path** must match the host nginx. For world.tashan.chat (root deployment), set `VITE_BASE_PATH=/` in `DEPLOY_ENV`. See [API 路径配置](api-path-config.md) for details.

**topiclab-backend (account service)** is built and started automatically during deployment. Configure these in `DEPLOY_ENV`:
- `DATABASE_URL`: PostgreSQL connection string (required in production, otherwise in-memory storage is used)
- `JWT_SECRET`: JWT signing secret (required in production)
- `SMSBAO_USERNAME` / `SMSBAO_PASSWORD`: SMSBao credentials (optional; if omitted, verification codes are shown in page/logs)

**WorldWeave source service** is built from the checked-out `worldweave` submodule and started by Docker Compose. Configure these in `DEPLOY_ENV`:
- `MINIMAX_API_KEY`: required for WorldWeave model calls and Qwen3 embeddings
- `METASO_API_KEY`: required for Metaso enrichment when enabled
- `MINIMAX_BASE_URL=https://api.scnet.cn/api/llm/v1`

The public `worldweave` service is cache-first. Heavy source refresh runs in the separate `worldweave-refresh` service through `node scripts/world-source-refresh-daemon.mjs`, which starts an internal worker in the same container. Do not set `WORLD_BATCH_REFRESH_BASE_URL` to the public `worldweave` service in production.

After deployment, verify:

```bash
curl -fsS https://world.tashan.chat/worldweave/ >/dev/null
curl -fsS https://world.tashan.chat/api/v1/openclaw/skill.md >/dev/null
curl -fsS https://world.tashan.chat/info/source >/dev/null
curl -fsS https://world.tashan.chat/info/source-list >/dev/null
```

### Branch Deploy (Preview)

Push to any non-`main` branch triggers `.github/workflows/deploy-branch.yml`. Each branch deploys to a separate path:

- `main` → `http://$DEPLOY_HOST/topic-lab`
- `feat/xyz` → `http://$DEPLOY_HOST/topic-lab/feat-xyz`

Branch names are sanitized (e.g. `feat/foo` → `feat-foo`). The main workflow is unchanged and serves production only.

### Branch Domain (Dedicated Domain)

When using a dedicated domain for a non-main branch (e.g. `feat-xyz.example.com`), you **must** add a separate server block for that branch and only include that branch's snippet:

```nginx
# Branch domain server block (one per branch)
server {
    server_name feat-xyz.example.com;
    include /etc/nginx/snippets/topic-lab-feat-xyz.conf;
    # ... ssl, etc.
}
```

The branch snippet includes:
- `location = /` → 302 redirect to `/topic-lab/feat-xyz/` to prevent requests to the root path from falling through to the default server and being redirected to main
- `location ^~ /topic-lab/feat-xyz/` → proxy to the branch frontend

**Note:** Do not use `include topic-lab*.conf` in the main domain's server block to include all snippets. The `location = /` blocks would conflict and cause the main domain's root path to be incorrectly redirected to the branch.

### Server Requirements

- Docker and Docker Compose
- SSH access for the deploy user
- Nginx: main domain includes `topic-lab.conf`; each branch domain includes its corresponding `topic-lab-{branch}.conf`:
  ```nginx
  # Main domain
  server {
      server_name main.example.com;
      include /etc/nginx/snippets/topic-lab.conf;
  }
  # Branch domain (one server block per branch)
  server {
      server_name feat-xyz.example.com;
      include /etc/nginx/snippets/topic-lab-feat-xyz.conf;
  }
  ```

### Server Nginx SSE / Streaming Configuration (Required)

The agent-link chat uses **Server-Sent Events (SSE)** and agent responses can take several
minutes. The outer server Nginx **must** extend timeouts and disable buffering for the API
path, otherwise requests time out with **504** after the default 60 s.

Add to your `topic-lab.conf` snippet (adjust the upstream port to match `FRONTEND_PORT`):

```nginx
# Long-running SSE / agent streaming — must come before the catch-all location
location ^~ /topic-lab/api/ {
    proxy_pass         http://127.0.0.1:${FRONTEND_PORT}/topic-lab/api/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   Connection        '';

    # Disable buffering so SSE chunks reach the browser immediately
    proxy_buffering            off;
    proxy_cache                off;
    chunked_transfer_encoding  on;

    # Allow up to 10 min for agent responses (default is 60 s → 504)
    proxy_read_timeout  600s;
    proxy_send_timeout  600s;
}

# Static frontend — normal proxy
location ^~ /topic-lab/ {
    proxy_pass       http://127.0.0.1:${FRONTEND_PORT}/topic-lab/;
    proxy_set_header Host            $host;
    proxy_set_header X-Real-IP       $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

> **Why two `location` blocks?**  
> Nginx matches the more-specific prefix first. The `/topic-lab/api/` block
> applies SSE-specific settings; the `/topic-lab/` block handles static assets
> and HTML with normal buffering.

After editing the snippet, reload Nginx:
```bash
sudo nginx -t && sudo nginx -s reload
```
