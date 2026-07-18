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

    expect(dockerfile).toContain('ENV NGINX_ENVSUBST_FILTER=^WORLDWEAVE_UPSTREAM$')
    expect(dockerfile).toContain('/etc/nginx/templates/nginx.conf.template')
  })

  it('keeps WorldWeave runtime deployment outside the TopicLab stack', () => {
    const compose = readFileSync(COMPOSE_PATH, 'utf-8')
    const workflow = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8')

    expect(compose).not.toMatch(/^  worldweave:/m)
    expect(compose).not.toMatch(/^  worldweave-refresh:/m)
    expect(compose).toContain('WORLDWEAVE_UPSTREAM=${WORLDWEAVE_UPSTREAM:-http://host.docker.internal:5000}')
    expect(workflow).not.toContain('docker compose exec -T worldweave')
    expect(workflow).not.toContain('worldweave-refresh logs')
    expect(workflow).not.toContain('set_submodule_url worldweave')
  })
})
