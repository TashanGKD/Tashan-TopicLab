import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG_PATHS = [
  'nginx.conf.template',
  'nginx.root.conf',
  'nginx.conf',
] as const

const WORLDWEAVE_DOCKERFILE_PATH = join(process.cwd(), '..', 'docker', 'worldweave.Dockerfile')
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
    expect(config).toContain('worldweave:3020')
    expect(config).toContain('proxy_set_header Host $http_host;')
    expect(config).not.toContain('host.docker.internal:5000')
    expect(config).not.toContain('host.docker.internal:3020')
  })

  it('seeds reviewed WorldWeave ASEAN model artifacts into the cache volume', () => {
    const dockerfile = readFileSync(WORLDWEAVE_DOCKERFILE_PATH, 'utf-8')

    expect(dockerfile).toContain('COPY --from=builder /app/.cache/asean-training ./.seed-cache/asean-training')
    expect(dockerfile).toContain('cp -an /app/.seed-cache/. /app/.cache/')
    expect(dockerfile).toContain('node scripts/world-start.mjs')
  })

  it('runs WorldWeave scene freshness checks during deploy', () => {
    const workflow = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8')

    expect(workflow).toContain('WORLD_HEALTH_BASE_URL=http://127.0.0.1:3020')
    expect(workflow).toContain('WORLD_HEALTH_CHECK_SCENES=tech-ai,geo-politics-daily')
    expect(workflow).toContain('node scripts/health-world.mjs')
    expect(workflow).toContain('worldweave-refresh logs')
  })
})
