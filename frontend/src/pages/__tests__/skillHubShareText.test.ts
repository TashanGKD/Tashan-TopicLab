import { describe, expect, it } from 'vitest'

import { formatSkillHubShareClipboard } from '../../components/apps/appsShared'

describe('formatSkillHubShareClipboard', () => {
  it('outputs title line, short line, and absolute skill URL line', () => {
    const text = formatSkillHubShareClipboard(
      { name: 'Literature Map', summary: '整合 arXiv 与 PubMed。', tagline: null },
      'literature-map',
    )
    expect(text.startsWith('【他山世界应用 / skill 分享】Literature Map，\n')).toBe(true)
    expect(text).toContain('整合 arXiv 与 PubMed。')
    expect(text).toMatch(/\/apps\/skills\/literature-map\s*$/m)
  })

  it('prefers tagline over summary', () => {
    const text = formatSkillHubShareClipboard(
      { name: 'X', summary: 'long summary', tagline: 'short tag' },
      'x',
    )
    expect(text).toContain('short tag')
    expect(text).not.toContain('long summary')
  })
})
