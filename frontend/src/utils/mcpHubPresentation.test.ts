import { describe, expect, it } from 'vitest'

import { formatMcpLicense, formatMcpNarrative, formatMcpSourceName, formatSummarySource, getMcpPurpose } from './mcpHubPresentation'

describe('formatMcpNarrative', () => {
  it('keeps user-facing evidence while removing internal batch review details', () => {
    const value = [
      '软件包说明明确其为 MCP server，并提供蛋白质结构数据检索。',
      '本轮只做包元数据来源复核，不含安装、运行、安全或科研正确性审计。',
      'First-party package metadata batch review (mcp-hub-package-batch-20260803): internal payload',
    ].join(' ')

    expect(formatMcpNarrative(value)).toBe('软件包说明明确其为 MCP server，并提供蛋白质结构数据检索。')
  })

  it('turns source-review wording into a reader-facing project description', () => {
    const value = '本轮查看 canonical README 后，确认其统一检索 PubMed 与 arXiv。'

    expect(formatMcpNarrative(value)).toBe('项目说明显示其统一检索 PubMed 与 arXiv。')
  })

  it('removes markdown links and keeps the actual research task', () => {
    const value = '**Public Hosted Server:** [https://example.com/mcp](https://example.com/mcp) 研究任务：检索天文巡天目录。研究路径：物理天文 / 天文学'

    expect(getMcpPurpose({ description: value })).toBe('检索天文巡天目录。')
  })

  it('presents repository source names without catalog terminology', () => {
    expect(formatMcpSourceName('GitHub canonical repository')).toBe('GitHub 项目仓库')
  })

  it('presents generated summaries without internal fallback terminology', () => {
    expect(formatSummarySource('taxonomy_fallback')).toBe('依据所属研究方向整理')
    expect(formatSummarySource('unknown')).toBe('根据项目资料整理')
  })
})

describe('formatMcpLicense', () => {
  it('shows the captured first-party wording when no normalized license exists', () => {
    expect(formatMcpLicense({
      license: null,
      license_status: 'referenced',
      license_raw: 'No license file is included. All rights reserved.',
    })).toBe('原文：No license file is included. All rights reserved.')
  })
})
