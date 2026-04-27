import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG_PATHS = [
  'nginx.conf.template',
  'nginx.root.conf',
  'nginx.conf',
] as const

function readConfig(path: (typeof CONFIG_PATHS)[number]) {
  return readFileSync(join(process.cwd(), path), 'utf-8')
}

describe('WorldWeave nginx proxy config', () => {
  it.each(CONFIG_PATHS)('proxies WorldWeave app routes in %s', (path) => {
    const config = readConfig(path)

    expect(config).toContain('location /worldweave/')
    expect(config).toContain('location /_next/')
    expect(config).toContain('location /api/v1/world/')
    expect(config).toContain('location /api/v1/openclaw/')
    expect(config).toContain('location /api/v1/signals')
    expect(config).toContain('location = /signals')
    expect(config).toContain('location /signals/')
    expect(config).toContain('location /source-knowledge')
    expect(config).toContain('location = /livebench')
    expect(config).toContain('location /livebench/')
    expect(config).toContain('worldweave:3020')
    expect(config).toContain('proxy_set_header Host $http_host;')
    expect(config).not.toContain('host.docker.internal:5000')
    expect(config).not.toContain('host.docker.internal:3020')
  })
})
