import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpHubApi, skillHubApi } from '../../api/client'
import MCPHubPage from '../MCPHubPage'
import MCPHubDetailPage from '../MCPHubDetailPage'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    mcpHubApi: {
      getMeta: vi.fn(),
      getCategories: vi.fn(),
      list: vi.fn(),
      streamScienceMcps: vi.fn(),
      get: vi.fn(),
      getContent: vi.fn(),
      listReviews: vi.fn(),
      getEvidenceAssetUrl: vi.fn((mcpId: string) => `/api/v1/mcp-hub/assets/${mcpId}`),
    },
    skillHubApi: {
      ...actual.skillHubApi,
      getCriticCapabilities: vi.fn(),
    },
  }
})

const mockedGetMeta = vi.mocked(mcpHubApi.getMeta)
const mockedGetCategories = vi.mocked(mcpHubApi.getCategories)
const mockedList = vi.mocked(mcpHubApi.list)
const mockedStreamScienceMcps = vi.mocked(mcpHubApi.streamScienceMcps)
const mockedGet = vi.mocked(mcpHubApi.get)
const mockedGetContent = vi.mocked(mcpHubApi.getContent)
const mockedListReviews = vi.mocked(mcpHubApi.listReviews)
const mockedGetCriticCapabilities = vi.mocked(skillHubApi.getCriticCapabilities)

afterEach(cleanup)

describe('MCPHubPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetMeta.mockResolvedValue({
      data: {
        schema: 'science_mcp_catalog_v1',
        total: 5643,
        active_catalog_count: 5643,
        retired_archive_excluded: true,
        dimensions: {
          domains: ['生命科学'],
          subdomains: ['蛋白与结构生物学'],
          stages: ['执行采集'],
          functions: ['数据采集'],
        },
        hub_index: { domain_coverage: { covered: 42, total: 42, status: 'long_tail' } },
        product_surface: { download_status: 'safe_placeholder_unavailable' },
        source: {},
      },
    } as any)
    mockedGetCategories.mockResolvedValue({ data: { dimensions: {}, counts: {}, hub_index: {} } } as any)
    mockedList.mockResolvedValue({
      data: {
        list: [{
          id: 'protein-mcp',
          name: 'Protein MCP',
          summary: '蛋白质结构数据分析。',
          domain: '生命科学',
          subdomain: '蛋白与结构生物学',
          stage: '执行采集',
          function: '数据采集',
          task: '蛋白质结构数据分析',
          capabilities: ['protein_search', 'predict_structure'],
          capability_evidence: { tool_names: ['protein_search', 'predict_structure'], tool_count: 2, tool_names_source: 'canonical_source', capability_mode: 'tool_list', task_description: '蛋白质结构数据分析' },
          quality_score: 90,
          readiness: 'trusted',
          status: 'verified_source',
          source_url: 'https://github.com/example/protein-mcp',
          framework: 'MCP',
          license: 'MIT',
          license_status: 'identified',
          license_source: 'readme',
          license_evidence: { license: 'MIT', license_status: 'identified', license_source: 'readme', source_url: 'https://github.com/example/protein-mcp', final_url: 'https://raw.githubusercontent.com/example/protein-mcp/main/LICENSE', http_status: 200 },
          evidence: 'README 明确 MCP 身份与蛋白质数据动作。',
          overlap_difference: '独立工具面。',
          classification_rationale: '对象与动作明确。',
          reviewed_at: '2026-08-02T00:00:00Z',
          evidence_scope: 'source_reviewed',
        }],
        total: 1,
        limit: 24,
        offset: 0,
      },
    } as any)
    mockedStreamScienceMcps.mockImplementation(async (_payload, handlers) => {
      handlers.onStatus?.({ message: '正在匹配科研 MCP' })
      handlers.onRoute?.({ domain: null, stage: null, function: null, search_terms: ['蛋白质'], rationale: '按研究对象与科研动作匹配 MCP。' })
      const result = {
        id: 'protein-mcp',
        name: 'Protein MCP',
        summary: '蛋白质结构数据分析。',
        domain: '生命科学',
        subdomain: '蛋白与结构生物学',
        stage: '执行采集',
        function: '数据采集',
        task: '蛋白质结构数据分析',
        capabilities: ['protein_search', 'predict_structure'],
        capability_evidence: { tool_names: ['protein_search', 'predict_structure'], tool_count: 2, tool_names_source: 'canonical_source', capability_mode: 'tool_list', task_description: '蛋白质结构数据分析' },
        quality_score: 90,
        readiness: 'trusted',
        status: 'verified_source',
        source_url: 'https://github.com/example/protein-mcp',
        framework: 'MCP',
        license: 'MIT',
        license_status: 'identified',
        license_source: 'readme',
        license_raw: 'MIT License',
        license_evidence: { license: 'MIT', license_status: 'identified', license_source: 'readme', source_url: 'https://github.com/example/protein-mcp', final_url: 'https://raw.githubusercontent.com/example/protein-mcp/main/LICENSE', http_status: 200 },
        source_verification: { fetch_status: 'fetched', final_url: 'https://raw.githubusercontent.com/example/protein-mcp/main/README.md', http_status: 200, fetched_at: '2026-08-05T12:00:00Z', content_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', content_bytes: 2048 },
        evidence: 'README 明确 MCP 身份与蛋白质数据动作。',
        overlap_difference: '独立工具面。',
        classification_rationale: '对象与动作明确。',
        evidence_scope: 'source_reviewed',
        rank: 1,
      }
      handlers.onResult?.(result)
      handlers.onDone?.({
        query: '蛋白质',
        route: { domain: null, stage: null, function: null, search_terms: ['蛋白质'], rationale: '按研究对象与科研动作匹配 MCP。' },
        total: 1,
        ranking: { criteria: [{ key: 'catalog_match', label: '目录匹配' }] },
        driver: { orchestrator: 'AgentScope', provider: 'SCNet', model: 'GLM-5.2', mode: 'local_fallback', configured: false, message: '本地三维路由已完成' },
      })
    })
    mockedGet.mockResolvedValue({
      data: {
        id: 'protein-mcp',
        name: 'Protein MCP',
        summary: '蛋白质结构数据分析。',
        domain: '生命科学',
        subdomain: '蛋白与结构生物学',
        stage: '执行采集',
        function: '数据采集',
        task: '蛋白质结构数据分析',
        capabilities: ['protein_search', 'predict_structure'],
        capability_evidence: { tool_names: ['protein_search', 'predict_structure'], tool_count: 2, tool_names_source: 'canonical_source', capability_mode: 'tool_list', task_description: '蛋白质结构数据分析' },
        quality_score: 90,
        readiness: 'trusted',
        status: 'verified_source',
        source_url: 'https://github.com/example/protein-mcp',
        framework: 'MCP',
        license: 'MIT',
        license_status: 'identified',
        license_source: 'readme',
        license_raw: 'MIT License',
        license_evidence: { license: 'MIT', license_status: 'identified', license_source: 'readme', source_url: 'https://github.com/example/protein-mcp', final_url: 'https://raw.githubusercontent.com/example/protein-mcp/main/LICENSE', http_status: 200 },
        source_verification: { fetch_status: 'fetched', final_url: 'https://raw.githubusercontent.com/example/protein-mcp/main/README.md', http_status: 200, fetched_at: '2026-08-05T12:00:00Z', content_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', content_bytes: 2048 },
        evidence: 'README 明确 MCP 身份与蛋白质数据动作。',
        overlap_difference: '独立工具面。',
        classification_rationale: '对象与动作明确。',
        reviewed_at: '2026-08-02T00:00:00Z',
        evidence_scope: 'source_reviewed',
      },
    } as any)
    mockedGetContent.mockResolvedValue({
      data: { mcp: {} as any, content_type: 'text/markdown', format: 'mcp_catalog_record', content: '# Protein MCP\n\n完整一手证据记录。' },
    } as any)
    mockedListReviews.mockResolvedValue({ data: { mcp_id: 'protein-mcp', list: [] } } as any)
    mockedGetCriticCapabilities.mockResolvedValue({
      data: {
        worker_available: true,
        supported_kinds: ['skill', 'mcp'],
        supported_depths: ['standard'],
        message: '评测服务已连接',
      },
    } as any)
  })

  it('renders the SkillHub-shaped catalog and selected evidence detail', async () => {
    render(
      <MemoryRouter initialEntries={['/mcphub']}>
        <Routes>
          <Route path="/mcphub" element={<MCPHubPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('科研 MCP Hub')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '科研 Skill / MCP' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '科研 Skill' })).toHaveAttribute('href', '/skillhub')
    expect(screen.getByRole('link', { name: '科研 MCP' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(screen.getAllByText('Protein MCP').length).toBeGreaterThan(0))
    expect(screen.getByText('科研 MCP 目录')).toBeInTheDocument()
    expect(screen.getByText('评测 Skill 与 MCP')).toBeInTheDocument()
    expect(screen.getByText(/收录科研 MCP，按领域、研究阶段与功能分工搜索与浏览/)).toBeInTheDocument()
    expect(screen.getByText(/输入研究对象、数据类型或预期产物/)).toBeInTheDocument()
    expect(screen.queryByText(/AgentScope|SCNet|本地目录/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '我的 MCP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '贡献榜' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '提交候选' })).not.toBeInTheDocument()
    expect(screen.queryByText(/结构性缺口/)).not.toBeInTheDocument()
    expect(screen.queryByText('收录状态')).not.toBeInTheDocument()
    expect(screen.queryByText('二级领域')).not.toBeInTheDocument()
    expect(screen.queryByText(/工具说明 \d+ 项/)).not.toBeInTheDocument()
    expect(screen.queryByText(/一手资料 \d+ 项/)).not.toBeInTheDocument()
    expect(screen.queryByText('清除筛选')).not.toBeInTheDocument()
    expect(screen.queryByText('verified_source')).not.toBeInTheDocument()
    expect(screen.queryByText('质量分')).not.toBeInTheDocument()
    expect(screen.queryByText('资料状态')).not.toBeInTheDocument()
    expect(screen.getAllByText('可信').length).toBeGreaterThan(0)
    expect(screen.getAllByText('工具：protein_search、predict_structure').length).toBeGreaterThan(0)
    expect(screen.queryByText(/能力依据|canonical README/)).not.toBeInTheDocument()
    expect(screen.getByText('可用能力')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开完整详情' })).toHaveAttribute('href', '/mcphub/protein-mcp')
    expect(screen.getByLabelText('目录排列方式')).toHaveValue('organized')
    expect(screen.getAllByText(/许可证/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('框架').length).toBeGreaterThan(0)
    expect(screen.getAllByText('MCP', { exact: true }).length).toBeGreaterThan(0)
    expect(screen.getByText(/适用说明：/)).toBeInTheDocument()
    expect(screen.getByText('对象与动作明确。')).toBeInTheDocument()
    expect(screen.getAllByText('资料完整度').length).toBeGreaterThan(0)
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ limit: 24, offset: 0 }))
  })

  it('loads the canonical MCP detail endpoint', async () => {
    render(
      <MemoryRouter initialEntries={['/mcphub/protein-mcp']}>
        <Routes>
          <Route path="/mcphub/:mcpId" element={<MCPHubDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getAllByText('Protein MCP').length).toBeGreaterThan(0))
    expect(mockedGet).toHaveBeenCalledWith('protein-mcp')
    expect(screen.getByRole('link', { name: '科研 MCP Hub' })).toHaveAttribute('href', '/mcphub')
    expect(screen.getByText('README 明确 MCP 身份与蛋白质数据动作。')).toBeInTheDocument()
    expect(screen.getByText(/许可证：已识别/)).toBeInTheDocument()
    expect(screen.getByText('许可证原文：MIT License')).toBeInTheDocument()
    expect(screen.queryByText(/已保存一手资料|SHA-256|页面响应|资料大小/)).not.toBeInTheDocument()
    expect(screen.getByText('版本')).toBeInTheDocument()
    expect(screen.getByText('安装提示')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看详细说明' }))
    await waitFor(() => expect(mockedGetContent).toHaveBeenCalledWith('protein-mcp'))
    expect(screen.getByText('详细说明')).toBeInTheDocument()
  })

  it('shows an explicit retry state when community reviews cannot load', async () => {
    mockedListReviews.mockRejectedValueOnce(new Error('reviews unavailable'))
    render(
      <MemoryRouter initialEntries={['/mcphub/protein-mcp']}>
        <Routes>
          <Route path="/mcphub/:mcpId" element={<MCPHubDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('社区评议暂时无法加载，请稍后重试。')).toBeInTheDocument()
    expect(screen.queryByText(/还没有评议/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(mockedListReviews).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/还没有评议/)).toBeInTheDocument()
  })

  it('uses the SkillHub-shaped streaming search path', async () => {
    render(
      <MemoryRouter initialEntries={['/mcphub']}>
        <Routes>
          <Route path="/mcphub" element={<MCPHubPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const input = await screen.findByLabelText('描述科研需求')
    fireEvent.change(input, { target: { value: '蛋白质' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索科研 MCP' }))
    await waitFor(() => expect(screen.getByText(/推荐结果 1 项/)).toBeInTheDocument())
    expect(mockedStreamScienceMcps).toHaveBeenCalledWith(expect.objectContaining({ query: '蛋白质', limit: 5 }), expect.any(Object), expect.any(AbortSignal))
    expect(screen.getByText('按研究对象与科研动作匹配 MCP。')).toBeInTheDocument()
    expect(screen.getByText('当前结果来自目录匹配。')).toBeInTheDocument()
  })
})
