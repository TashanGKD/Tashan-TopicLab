import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG_PATHS = [
  'nginx.conf.template',
  'nginx.root.conf',
  'nginx.conf',
] as const

const FRONTEND_DOCKERFILE_PATH = join(process.cwd(), 'Dockerfile')
const COMPOSE_PATH = join(process.cwd(), '..', 'docker-compose.yml')
const DEPLOY_WORKFLOW_PATH = join(process.cwd(), '..', '.github', 'workflows', 'deploy.yml')
const ENV_EXAMPLE_PATHS = [
  join(process.cwd(), '..', '.env.example'),
  join(process.cwd(), '..', '.env.deploy.example'),
] as const

function readConfig(path: (typeof CONFIG_PATHS)[number]) {
  return readFileSync(join(process.cwd(), path), 'utf-8')
}

describe('WorldWeave nginx proxy config', () => {
  it.each(CONFIG_PATHS)('proxies WorldWeave app routes in %s', (path) => {
    const config = readConfig(path)

    expect(config).toContain('location = /worldweave')
    expect(config).toContain('location /worldweave/')
    expect(config).toContain('location /_next/')
    expect(config).toContain('location /api/v1/world/')
    expect(config).toContain('location /api/v1/openclaw/')
    expect(config).toContain('location /api/v1/signals')
    expect(config).toContain('location = /signals')
    expect(config).toContain('location /signals/')
    expect(config).toContain('location /source-knowledge')
    expect(config).toContain('location /demo/')
    expect(config).toContain('location = /daily')
    expect(config).toContain('location /daily/')
    expect(config).toContain('location = /livebench')
    expect(config).toContain('location /livebench/')
    expect(config).toContain('${WORLDWEAVE_UPSTREAM}')
    expect(config).toContain('proxy_ssl_server_name on;')
    expect(config).toContain('proxy_set_header Host $proxy_host;')
    expect(config).toContain('proxy_set_header Host $http_host;')
    expect(config).not.toContain('worldweave:3020')
  })

  it('injects the standalone WorldWeave upstream when the frontend container starts', () => {
    const dockerfile = readFileSync(FRONTEND_DOCKERFILE_PATH, 'utf-8')

    expect(dockerfile).toContain('ENV WORLDWEAVE_UPSTREAM=http://host.docker.internal:3020')
    expect(dockerfile).toContain('ENV NGINX_ENVSUBST_FILTER=^WORLDWEAVE_UPSTREAM$')
    expect(dockerfile).toContain('/etc/nginx/templates/nginx.conf.template')
  })

  it.each(ENV_EXAMPLE_PATHS)('documents the same-host port in %s', (path) => {
    const envExample = readFileSync(path, 'utf-8')

    expect(envExample).toContain('WORLDWEAVE_BASE_URL=http://host.docker.internal:3020')
    expect(envExample).toContain('WORLDWEAVE_UPSTREAM=http://host.docker.internal:3020')
    expect(envExample).not.toContain('WORLDWEAVE_BASE_URL=http://host.docker.internal:5000')
    expect(envExample).not.toContain('WORLDWEAVE_UPSTREAM=http://host.docker.internal:5000')
  })

  it('keeps WorldWeave runtime deployment outside the TopicLab stack', () => {
    const compose = readFileSync(COMPOSE_PATH, 'utf-8')
    const workflow = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8')

    expect(compose).not.toMatch(/^  worldweave:/m)
    expect(compose).not.toMatch(/^  worldweave-refresh:/m)
    expect(compose).toContain('WORLDWEAVE_BASE_URL=${WORLDWEAVE_BASE_URL:-http://host.docker.internal:3020}')
    expect(compose).toContain('WORLDWEAVE_UPSTREAM=${WORLDWEAVE_UPSTREAM:-http://host.docker.internal:3020}')
    expect(workflow).toContain('Migrating legacy same-host WorldWeave port 5000 to 3020')
    expect(workflow).toContain('WORLDWEAVE_BASE_URL=http://host\\.docker\\.internal')
    expect(workflow).toContain('WORLDWEAVE_UPSTREAM=http://host\\.docker\\.internal')
    expect(workflow).toContain('http://127.0.0.1/worldweave/')
    expect(workflow).toContain('http://127.0.0.1/info/source')
    expect(workflow).toContain('export COMPOSE_FILE="$REPO_DIR/docker-compose.yml"')
    expect(workflow).toContain('docker compose down --remove-orphans')
    expect(workflow).toContain('docker compose up -d --remove-orphans')
    expect(workflow).not.toContain('docker compose exec -T worldweave')
    expect(workflow).not.toContain('worldweave-refresh logs')
    expect(workflow).not.toContain('set_submodule_url worldweave')
  })
})
