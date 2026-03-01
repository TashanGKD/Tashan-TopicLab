# Deploy Guide

## GitHub Actions Deploy

The deploy workflow (`.github/workflows/deploy.yml`) runs on push to `main`. It SSHs to the server, pulls the repo, builds Docker images, and starts services.

### Required Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | SSH host (IP or hostname) |
| `DEPLOY_USER` | SSH username |
| `SSH_PRIVATE_KEY` | SSH private key for authentication |
| `DEPLOY_ENV` | **Full `.env` content** (see below) |
| `DEPLOY_PATH` | (Optional) Base path on server, default `/var/www/github-actions/repos` |

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
