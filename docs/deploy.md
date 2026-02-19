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

`DEPLOY_ENV` is the entire contents of the `.env` file. Create it locally, then paste into the secret.

**Steps:**

1. 复制 `.env.deploy.example` 为 `.env.deploy`，按实际环境填写（含 API 密钥等）：
   ```bash
   cp .env.deploy.example .env.deploy
   # 编辑 .env.deploy，填写 ANTHROPIC_API_KEY、AI_GENERATION_API_KEY 等
   ```

2. 在 GitHub：**Settings → Secrets and variables → Actions → New repository secret**
3. 名称填 `DEPLOY_ENV`，值粘贴 `.env.deploy` 的完整内容（多行）

### Server Requirements

- Docker and Docker Compose
- SSH access for the deploy user
- Nginx (optional; the workflow writes `/etc/nginx/snippets/topic-lab.conf`)
