import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readViteConfig() {
  return readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf-8')
}

describe('Vite WorldWeave proxy config', () => {
  it('defaults the local WorldWeave runtime proxy to port 5000', () => {
    const config = readViteConfig()

    expect(config).toContain("env.WORLDWEAVE_PORT || '5000'")
    expect(config).toContain("target: worldWeaveTarget")
    expect(config).toContain("'/worldweave'")
    expect(config).toContain("'/api/v1/world'")
    expect(config).toContain("'/api/v1/livebench'")
    expect(config).toContain("'/api/v1/source-knowledge'")
    expect(config).toContain("'/signals'")
    expect(config).toContain("'/source-knowledge'")
    expect(config).toContain("'/livebench'")
  })

  it('strips only the WorldWeave mount prefix before proxying app routes', () => {
    const config = readViteConfig()

    expect(config).toContain("rewrite: (path) => path.replace(/^\\/worldweave/, '')")
  })

  it('keeps the canonical OpenClaw skill and bootstrap on topiclab-backend', () => {
    const config = readViteConfig()

    expect(config).toContain("'/api/v1/openclaw': {\n          target: 'http://127.0.0.1:8001'")
    expect(config).not.toContain("'/api/v1/openclaw': {\n          target: worldWeaveTarget")
    expect(config).not.toContain("'^/api/v1/openclaw/skill\\\\.md'")
  })
})
