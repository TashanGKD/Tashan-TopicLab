import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readFrontendFile(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf-8')
}

describe('nginx OpenClaw proxy ownership', () => {
  it.each(['nginx.conf', 'nginx.root.conf'])(
    'does not serve the canonical OpenClaw skill from WorldWeave in %s',
    (path) => {
      const config = readFrontendFile(path)

      expect(config).not.toContain('location = /api/v1/openclaw/skill.md')
      expect(config).not.toContain('proxy_pass http://worldweave:3020/api/v1/openclaw/skill.md')
      expect(config).not.toContain('location /api/v1/openclaw/ {\n            proxy_pass http://worldweave:3020/api/v1/openclaw/')
    },
  )

  it.each(['nginx.conf', 'nginx.root.conf'])(
    'routes the canonical OpenClaw endpoints to topiclab-backend in %s',
    (path) => {
      const config = readFrontendFile(path)

      expect(config).toContain('location /api/v1/openclaw/')
      expect(config).toContain('proxy_pass http://topiclab-backend:8000/api/v1/openclaw/')
    },
  )
})
