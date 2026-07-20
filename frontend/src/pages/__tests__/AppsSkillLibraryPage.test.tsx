import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { skillHubApi } from '../../api/client'
import AppsSkillLibraryPage from '../AppsSkillLibraryPage'
import AppsSkillDetailPage from '../AppsSkillDetailPage'
import AppsSkillProfilePage from '../AppsSkillProfilePage'
import LibraryPage from '../LibraryPage'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    skillHubApi: {
      ...actual.skillHubApi,
      listSkills: vi.fn(),
      listCategories: vi.fn(),
      listLeaderboard: vi.fn(),
      getScienceCatalogMeta: vi.fn(),
      listScienceCatalog: vi.fn(),
      getScienceFinderCapabilities: vi.fn(),
      findScienceSkills: vi.fn(),
      streamScienceSkills: vi.fn(),
      getCriticCapabilities: vi.fn(),
      submitCriticEvaluation: vi.fn(),
      getCriticEvaluation: vi.fn(),
      streamCriticEvaluation: vi.fn(),
      getProfile: vi.fn(),
      getSkill: vi.fn(),
      getSkillContent: vi.fn(),
    },
  }
})

vi.mock('../SkillLibrary', () => ({
  SkillLibraryContent: () => <div>旧 Resonnet Skill Library</div>,
}))

const mockedListSkills = vi.mocked(skillHubApi.listSkills)
const mockedListCategories = vi.mocked(skillHubApi.listCategories)
const mockedListLeaderboard = vi.mocked(skillHubApi.listLeaderboard)
const mockedGetScienceCatalogMeta = vi.mocked(skillHubApi.getScienceCatalogMeta)
const mockedListScienceCatalog = vi.mocked(skillHubApi.listScienceCatalog)
const mockedGetScienceFinderCapabilities = vi.mocked(skillHubApi.getScienceFinderCapabilities)
const mockedFindScienceSkills = vi.mocked(skillHubApi.findScienceSkills)
const mockedStreamScienceSkills = vi.mocked(skillHubApi.streamScienceSkills)
const mockedGetCriticCapabilities = vi.mocked(skillHubApi.getCriticCapabilities)
const mockedSubmitCriticEvaluation = vi.mocked(skillHubApi.submitCriticEvaluation)
const mockedGetCriticEvaluation = vi.mocked(skillHubApi.getCriticEvaluation)
const mockedStreamCriticEvaluation = vi.mocked(skillHubApi.streamCriticEvaluation)
const mockedGetProfile = vi.mocked(skillHubApi.getProfile)
const mockedGetSkill = vi.mocked(skillHubApi.getSkill)
const mockedGetSkillContent = vi.mocked(skillHubApi.getSkillContent)

afterEach(cleanup)

function renderSkillHubHome() {
  return render(
    <MemoryRouter initialEntries={['/skillhub']}>
      <Routes>
        <Route path="/skillhub" element={<AppsSkillLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SkillHub pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    mockedListSkills.mockResolvedValue({
      data: {
        list: [
          {
            id: 1,
            slug: 'literature-map',
            name: 'Literature Map',
            summary: 'Build a paper graph',
            tagline: 'map papers fast',
            category_key: '07',
            category_name: '信息科学',
            cluster_key: 'literature',
            cluster_name: '文献检索',
            compatibility_level: 'install',
            openclaw_ready: true,
            tags: ['papers', 'graph'],
            capabilities: ['search'],
            avg_rating: 4.7,
            total_reviews: 8,
            total_downloads: 33,
            total_favorites: 4,
            weekly_downloads: 11,
            price_points: 0,
          },
        ],
        total: 1,
        limit: 12,
        offset: 0,
      },
    } as any)

    mockedListCategories.mockResolvedValue({
      data: {
        disciplines: [{ key: '07', name: '信息科学', description: 'Info' }],
        clusters: [{ key: 'literature', title: '文献检索', summary: 'Find papers' }],
      },
    } as any)

    mockedListLeaderboard.mockResolvedValue({
      data: {
        users: [{ id: 9, display_name: 'Alice', balance: 42, total_skills: 2, total_reviews: 3, total_downloads: 12 }],
        skills: [],
        weekly: [],
      },
    } as any)

    mockedGetScienceCatalogMeta.mockResolvedValue({
      data: {
        total: 1391,
        dimensions: {
          domains: ['生命科学'],
          subdomains: ['蛋白与结构生物学'],
          stages: ['发现获取', '构思设计', '执行采集', '分析验证', '表达发表'],
          functions: ['检索获取', '模拟建模'],
        },
        source: { repository: 'TashanGKD/tashan-research-skills', sha256: 'a'.repeat(64) },
      },
    } as any)
    mockedListScienceCatalog.mockResolvedValue({
      data: {
        list: [{
          id: 'alphafold2',
          name: 'AlphaFold2',
          summary: '蛋白质结构预测。',
          domain: '生命科学',
          subdomain: '蛋白与结构生物学',
          stage: '执行采集',
          function: '模拟建模',
          task: '蛋白质结构预测',
          quality_score: 88,
          readiness: 'trusted',
          review_status: 'model_assisted_full_source_review',
          source_repository: 'example/science-skills',
          source_path: 'skills/alphafold2/SKILL.md',
          source_verification: {
            status: 'baseline_established',
            checked_at: '2026-07-16T19:03:18Z',
            observed_path: 'skills/alphafold2/SKILL.md',
            evidence_report_sha256: 'b'.repeat(64),
            review_required: false,
          },
        }],
        total: 1,
        limit: 24,
        offset: 0,
      },
    } as any)
    mockedGetScienceFinderCapabilities.mockResolvedValue({
      data: {
        orchestrator: 'AgentScope',
        orchestrator_version: '2.0.1',
        provider: 'SCNet',
        model: 'glm5.2',
        configured: true,
        desktop_config: true,
        fallback_available: true,
      },
    } as any)
    mockedFindScienceSkills.mockResolvedValue({
      data: {
        query: '我想预测蛋白质三维结构',
        route: {
          domain: '生命科学',
          stage: '执行采集',
          function: '模拟建模',
          search_terms: ['蛋白质', '结构预测'],
          rationale: '主要产物是蛋白质三维结构模型。',
        },
        results: [{
          id: 'alphafold2',
          name: 'AlphaFold2',
          summary: '蛋白质结构预测。',
          domain: '生命科学',
          subdomain: '蛋白与结构生物学',
          stage: '执行采集',
          function: '模拟建模',
          task: '蛋白质结构预测',
          quality_score: 88,
          readiness: 'trusted',
          review_status: 'model_assisted_full_source_review',
          source_repository: 'example/science-skills',
          source_path: 'skills/alphafold2/SKILL.md',
          rank: 1,
          ranking_signals: {
            semantic_match: 1,
            task_match: 18,
            readiness: 'trusted',
            source_review: 'model_assisted_full_source_review',
            quality_score: 88,
          },
          recommendation_reason: '研究对象和预期产物都与蛋白质结构预测直接匹配。',
        }],
        total: 1,
        ranking: {
          criteria: [
            { key: 'semantic_match', label: '需求语义匹配' },
            { key: 'task_match', label: '任务匹配' },
            { key: 'function_match', label: '功能偏好' },
            { key: 'quality_score', label: '质量分' },
          ],
        },
        driver: {
          orchestrator: 'AgentScope',
          provider: 'SCNet',
          model: 'glm5.2',
          mode: 'model',
          configured: true,
          message: 'AgentScope 已完成三维路由',
        },
      },
    } as any)
    mockedGetCriticCapabilities.mockResolvedValue({
      data: {
        worker_available: false,
        supported_kinds: ['skill', 'mcp'],
        supported_depths: ['quick', 'full'],
        message: '评测 Worker 尚未配置',
      },
    } as any)
    mockedSubmitCriticEvaluation.mockResolvedValue({
      data: { job_id: 'critic-job-1', status: 'queued', kind: 'skill', depth: 'quick' },
    } as any)
    mockedGetCriticEvaluation.mockResolvedValue({
      data: { job_id: 'critic-job-1', status: 'running', kind: 'skill', depth: 'quick' },
    } as any)
    mockedStreamCriticEvaluation.mockResolvedValue(undefined)

    mockedGetSkill.mockResolvedValue({
      data: {
        id: 1,
        slug: 'literature-map',
        name: 'Literature Map',
        summary: 'Build a paper graph',
        tagline: 'map papers fast',
        description: 'Build and inspect a literature graph for research discovery.',
        category_key: '07',
        category_name: '信息科学',
        cluster_key: 'literature',
        cluster_name: '文献检索',
        compatibility_level: 'install',
        openclaw_ready: true,
        tags: ['papers', 'graph'],
        capabilities: ['search'],
        avg_rating: 4.7,
        total_reviews: 8,
        total_downloads: 33,
        total_favorites: 4,
        weekly_downloads: 11,
        price_points: 0,
        viewer_favorited: false,
        versions: [{ id: 1, version: '1.0.0', changelog: 'init', install_command: 'topiclab skills install literature-map', is_latest: true }],
        reviews: [],
        related_skills: [],
      },
    } as any)

    mockedGetSkillContent.mockResolvedValue({
      data: {
        content: '# Literature Map',
        version: { id: 1, version: '1.0.0', changelog: 'init', install_command: 'topiclab skills install literature-map', is_latest: true },
      },
    } as any)
  })

  it('renders the new SkillHub home with real API data', async () => {
    renderSkillHubHome()

    expect((await screen.findAllByText('AlphaFold2')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Skill 仓库地址')).toBeInTheDocument()
    expect(screen.getByLabelText('MCP 仓库地址或包名')).toBeInTheDocument()
    expect(screen.getByText(/收录上千项科研技能/)).toBeInTheDocument()
    expect(screen.queryByText(/1391/)).not.toBeInTheDocument()
    expect(screen.getByText(/默认示例：生命科学 → 执行采集 → 模拟建模/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '知识图领域：生命科学' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '知识图研究阶段：执行采集' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '知识图功能分工：模拟建模' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '社区应用' })).not.toBeInTheDocument()
    expect(mockedListSkills).not.toHaveBeenCalled()
    expect(screen.getByText('评测服务暂不可用')).toBeInTheDocument()
    expect(screen.queryByText(/Critic Worker|隔离环境|执行第三方代码/)).not.toBeInTheDocument()
    await waitFor(() => expect(mockedListScienceCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ domain: '生命科学', stage: '执行采集', function: '模拟建模' }),
    ))
    const catalogResults = screen.getByRole('region', { name: '科研技能目录结果' })
    const detail = within(catalogResults).getByRole('region', { name: '技能详情：AlphaFold2' })
    expect(within(detail).getAllByText('模拟建模').some((element) => element.classList.contains('text-base'))).toBe(true)
    expect(within(detail).getByText('技能详情')).toBeInTheDocument()
    expect(within(detail).queryByText(/证据状态|model_assisted_full_source_review|manual_confirmed/)).not.toBeInTheDocument()
    expect(within(detail).queryByText(/Critic|目录证据/)).not.toBeInTheDocument()
  })

  it('renders as an independent module without an application breadcrumb', async () => {
    renderSkillHubHome()

    expect(await screen.findByRole('heading', { name: '科研 SkillHub' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '应用' })).not.toBeInTheDocument()
  })

  it('prefills one Skill and Context7 without showing example choices or submitting', async () => {
    mockedGetCriticCapabilities.mockResolvedValue({
      data: {
        worker_available: true,
        supported_kinds: ['skill', 'mcp'],
        supported_depths: ['standard'],
        message: '评测服务已连接',
      },
    } as any)

    renderSkillHubHome()
    await screen.findByText('评测服务可用')
    expect(screen.getByText(/无需登录/)).toBeInTheDocument()

    expect(screen.getByLabelText('Skill 仓库地址')).toHaveValue(
      'https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring',
    )
    expect(screen.getByRole('button', { name: '开始 Skill 评测' })).toBeEnabled()
    expect(screen.getByLabelText('MCP 仓库地址或包名')).toHaveValue('https://github.com/upstash/context7')
    expect(screen.getByRole('button', { name: '开始 MCP 评测' })).toBeEnabled()
    expect(screen.queryByText('试用示例')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /使用 (Skill|MCP) 示例/ })).not.toBeInTheDocument()
    expect(mockedSubmitCriticEvaluation).not.toHaveBeenCalled()
  })

  it('submits a CriticAgent evaluation and renders auditable completed evidence', async () => {
    mockedGetCriticCapabilities.mockResolvedValue({
      data: {
        worker_available: true,
        supported_kinds: ['skill', 'mcp'],
        supported_depths: ['standard'],
        message: '评测服务已连接',
      },
    } as any)
    mockedSubmitCriticEvaluation.mockResolvedValue({
      data: {
        job_id: 'critic-job-complete',
        status: 'completed',
        kind: 'skill',
        depth: 'standard',
        verdict: '建议安装',
        score: 91,
        progress: { current_step: 'verdict', completed_steps: ['validation', 'behavior', 'triggers', 'verdict'], total_steps: 4 },
        dimensions: [
          { key: 'compliance', label: '规范与安全', status: 'passed', summary: '规范检查通过，未发现密钥。' },
          { key: 'quality', label: '内容质量', status: 'passed', summary: '说明清晰，操作边界完整。' },
        ],
        trace: [
          { sequence: 1, step: 'validation', kind: 'status', title: '来源检查', summary: '来源已封存', details: [] },
          { sequence: 2, step: 'behavior', kind: 'reasoning', title: '使用方式判断', summary: '已设计代表任务', details: ['任务依据：覆盖主要使用方式'] },
          { sequence: 3, step: 'behavior', kind: 'execution', title: '代表任务执行', summary: '实际帮助明显', details: ['执行结果：产物符合要求'] },
          { sequence: 4, step: 'triggers', kind: 'evidence', title: '触发边界核验', summary: '8 条请求判断完成', details: ['应触发 4 条，不应触发 4 条'] },
          { sequence: 5, step: 'verdict', kind: 'result', title: '最终裁决', summary: '建议安装，得分 91', details: ['结论依据：质量与边界均通过'] },
        ],
        evidence: { provider_calls: 4, behavior_cases: 1, trigger_queries: 8, final_adjudications: 1 },
        limitations: ['标准评测未执行带与不带 Skill 的增益对照'],
        report_url: '/api/v1/skill-hub/evaluations/critic-job-complete/report',
      },
    } as any)
    renderSkillHubHome()
    await screen.findByText('评测服务可用')
    expect(screen.getByLabelText('Skill 仓库地址')).toBeInTheDocument()
    expect(screen.getByLabelText('MCP 仓库地址或包名')).toBeInTheDocument()
    expect(screen.queryByLabelText('评测深度')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Skill 仓库地址'), { target: { value: 'https://github.com/example/research-skill' } })
    fireEvent.click(screen.getByRole('button', { name: '开始 Skill 评测' }))

    expect(await screen.findByText('已完成 · 建议安装')).toBeInTheDocument()
    expect(screen.getByText('说明清晰，操作边界完整。')).toBeInTheDocument()
    expect(screen.getByText(/标准评测未执行带与不带 Skill 的增益对照/)).toBeInTheDocument()
    expect(screen.getByText('SKILL · 标准评测 · 得分 91')).toBeInTheDocument()
    expect(screen.queryByText('评测状态')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('评测证据摘要')).not.toBeInTheDocument()
    const process = screen.getByRole('log', { name: '四步评测过程' })
    expect(within(process).getAllByRole('listitem')).toHaveLength(4)
    expect(within(process).getByText('使用方式与任务设计')).toBeInTheDocument()
    expect(within(process).getByText('代表任务执行')).toBeInTheDocument()
    expect(within(process).getByText('触发边界核验')).toBeInTheDocument()
    expect(within(process).getByText('CriticAgent 结论')).toBeInTheDocument()
    expect(screen.getByText('已完成 4 / 4 次评测调用')).toBeInTheDocument()
    expect(within(process).getByText('来源已封存')).toBeInTheDocument()
    expect(within(process).getByText('任务依据：覆盖主要使用方式')).toBeInTheDocument()
    expect(screen.queryByText(/来源与运行记录/)).not.toBeInTheDocument()
    expect(mockedSubmitCriticEvaluation).toHaveBeenCalledWith({
      kind: 'skill',
      target: 'https://github.com/example/research-skill',
    })
  })

  it('submits MCP evaluation from its always-visible entry without a depth option', async () => {
    mockedGetCriticCapabilities.mockResolvedValue({
      data: {
        worker_available: true,
        supported_kinds: ['skill', 'mcp'],
        supported_depths: ['standard'],
        message: '评测服务已连接',
      },
    } as any)
    mockedSubmitCriticEvaluation.mockResolvedValue({
      data: {
        job_id: 'critic-job-mcp',
        status: 'queued',
        kind: 'mcp',
        depth: 'standard',
        progress: {
          current_step: 'validation',
          completed_steps: [],
          total_steps: 4,
          message: '正在封存来源并核验规范与安全',
        },
      },
    } as any)
    mockedStreamCriticEvaluation.mockImplementation(async (_jobId, handlers) => {
      handlers.onJob?.({
        job_id: 'critic-job-mcp',
        status: 'running',
        kind: 'mcp',
        depth: 'standard',
        progress: {
          current_step: 'validation',
          completed_steps: [],
          total_steps: 4,
          message: '来源已封存，正在执行规范与安全检查',
        },
        trace: [
          {
            sequence: 1,
            step: 'validation',
            kind: 'status',
            title: '来源检查',
            summary: '来源已封存，正在执行规范与安全检查',
            details: [],
          },
          {
            sequence: 2,
            step: 'validation',
            kind: 'status',
            title: '来源检查',
            summary: '来源已封存，正在执行规范与安全检查',
            details: [],
          },
          {
            sequence: 3,
            step: 'behavior',
            kind: 'reasoning',
            title: '使用方式判断',
            summary: '已确定 guidance，并设计一项代表任务',
            details: ['代表任务：撰写一份研究计划'],
          },
        ],
      })
    })

    renderSkillHubHome()
    await screen.findByText('评测服务可用')
    fireEvent.change(screen.getByLabelText('MCP 仓库地址或包名'), { target: { value: '@scope/mcp-server' } })
    fireEvent.click(screen.getByRole('button', { name: '开始 MCP 评测' }))

    await waitFor(() => expect(mockedSubmitCriticEvaluation).toHaveBeenCalledWith({
      kind: 'mcp',
      target: '@scope/mcp-server',
    }))
    await waitFor(() => expect(mockedStreamCriticEvaluation).toHaveBeenCalledWith(
      'critic-job-mcp',
      expect.any(Object),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(screen.getByRole('status', { name: '评测实时进度' })).toHaveTextContent('来源已封存，正在执行规范与安全检查'))
    const trace = screen.getByRole('log', { name: '四步评测过程' })
    expect(within(trace).getAllByRole('listitem')).toHaveLength(4)
    expect(within(trace).getByText('使用方式与任务设计')).toBeInTheDocument()
    expect(within(trace).getByText('已确定 guidance，并设计一项代表任务')).toBeInTheDocument()
    expect(within(trace).getByText('等待代表任务执行完成')).toBeInTheDocument()
    expect(screen.getAllByText('已完成 1 / 4 次评测调用')).toHaveLength(1)
    expect(within(trace).getAllByText('来源已封存，正在执行规范与安全检查')).toHaveLength(1)
    expect(within(trace).queryByText('处理中')).not.toBeInTheDocument()
    const evidenceDisclosure = within(trace).getByText('查看详细证据').closest('details')
    expect(evidenceDisclosure).toBeInTheDocument()
    expect(evidenceDisclosure).not.toHaveAttribute('open')
    expect(within(evidenceDisclosure as HTMLElement).getByText('代表任务：撰写一份研究计划')).toBeInTheDocument()
    expect(screen.queryByText(/来源与运行记录/)).not.toBeInTheDocument()
  })

  it('shows a terminal provider failure on the affected evaluation call', async () => {
    mockedGetCriticCapabilities.mockResolvedValue({
      data: {
        worker_available: true,
        supported_kinds: ['skill', 'mcp'],
        supported_depths: ['standard'],
        message: '评测服务已连接',
      },
    } as any)
    mockedSubmitCriticEvaluation.mockResolvedValue({
      data: {
        job_id: 'critic-job-blocked',
        status: 'blocked',
        kind: 'skill',
        depth: 'standard',
        message: '标准评测未能形成有效结论',
        progress: {
          current_step: 'behavior',
          completed_steps: ['validation'],
          total_steps: 4,
          message: '当前阶段返回无效结果，已停止后续判断',
        },
        trace: [
          { sequence: 1, step: 'validation', kind: 'status', title: '来源检查', summary: '来源已封存', details: [] },
          { sequence: 2, step: 'behavior', kind: 'error', title: '评测未形成结论', summary: '当前阶段返回无效结果，已停止后续判断', details: ['未形成可验证的任务设计'] },
        ],
      },
    } as any)

    renderSkillHubHome()
    await screen.findByText('评测服务可用')
    fireEvent.change(screen.getByLabelText('Skill 仓库地址'), { target: { value: 'https://github.com/example/research-skill' } })
    fireEvent.click(screen.getByRole('button', { name: '开始 Skill 评测' }))

    const process = await screen.findByRole('log', { name: '四步评测过程' })
    expect(within(process).getAllByRole('listitem')).toHaveLength(4)
    expect(within(process).getByText('当前阶段返回无效结果，已停止后续判断')).toBeInTheDocument()
    expect(within(process).getByText('未完成')).toBeInTheDocument()
    expect(within(process).queryByText('正在执行本次评测调用')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '评测实时进度' })).toHaveTextContent('已完成 0 / 4 次评测调用')
    expect(screen.getByRole('button', { name: '评测其他项目' })).toBeInTheDocument()
  })

  it('filters the built-in catalog by domain stage and function', async () => {
    renderSkillHubHome()
    await screen.findAllByText('AlphaFold2')
    const finder = (await screen.findByRole('heading', { name: '科研技能 Wiki' })).closest('section')
    expect(finder).toBeTruthy()
    const graph = within(finder as HTMLElement).getByRole('group', { name: '科研能力沙漏图' })
    const activePath = within(finder as HTMLElement).getByRole('status', { name: '当前筛选路径' })
    expect(within(activePath).getByText('生命科学')).toBeInTheDocument()
    expect(within(activePath).getByText('执行采集')).toBeInTheDocument()
    expect(within(activePath).getByText('模拟建模')).toBeInTheDocument()
    expect(within(activePath).getByText('3 / 3')).toBeInTheDocument()
    expect(within(graph).getByRole('button', { name: '知识图领域：生命科学' })).toHaveAttribute('data-route-state', 'selected')
    expect(within(graph).getByRole('button', { name: '知识图功能分工：检索获取' })).toHaveAttribute('data-route-state', 'dimmed')
    await waitFor(() => {
      expect(mockedListScienceCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ domain: '生命科学', stage: '执行采集', function: '模拟建模' }),
      )
    })
    expect(await within(graph).findByRole('group', { name: 'Skill 叶节点' })).toBeInTheDocument()
    fireEvent.click(within(finder as HTMLElement).getByRole('button', { name: '查看 1 项匹配技能' }))
    expect(within(finder as HTMLElement).getByRole('region', { name: '科研技能筛选结果' })).toHaveFocus()
    fireEvent.click(within(graph).getByRole('button', { name: '查看技能：AlphaFold2' }))
    expect(within(graph).getByText('排序：功能偏好 → 可信状态 → 质量分 → 名称')).toBeInTheDocument()
    expect(within(graph).queryByText(/来源核验|上游已核验|上游新鲜度/)).not.toBeInTheDocument()
    expect(screen.queryByText('来源核验')).not.toBeInTheDocument()
    expect(within(graph).getByTestId('stage-mobile-connector')).toHaveClass('lg:hidden')
  })

  it('keeps the wiki graph stable while search updates only the lower recommendation list', async () => {
    const streamedPayload = {
        query: '我想分析单细胞转录组细胞类型',
        route: {
          domain: '生命科学',
          stage: '分析验证',
          function: '分析推断',
          search_terms: ['单细胞', '细胞类型'],
          rationale: '主要产物是带有细胞类型标签的单细胞表达数据。',
        },
        results: [{
          id: 'single-cell-annotation',
          name: 'Single Cell Annotation',
          summary: '为单细胞转录组数据标注细胞类型。',
          domain: '生命科学',
          subdomain: '生物信息学',
          stage: '分析验证',
          function: '分析推断',
          task: '单细胞类型注释',
          quality_score: 86,
          readiness: 'trusted',
          review_status: 'model_assisted_full_source_review',
          source_repository: 'example/science-skills',
          source_path: 'skills/single-cell-annotation/SKILL.md',
          rank: 1,
          ranking_signals: {
            semantic_match: 1,
            task_match: 16,
            readiness: 'trusted',
            source_review: 'model_assisted_full_source_review',
            quality_score: 86,
          },
          recommendation_reason: '研究对象、分析动作和细胞类型标签产物直接匹配。',
        }],
        total: 1,
        ranking: {
          criteria: [
            { key: 'semantic_match', label: '需求语义匹配' },
            { key: 'task_match', label: '任务匹配' },
            { key: 'function_match', label: '功能偏好' },
            { key: 'quality_score', label: '质量分' },
          ],
        },
        driver: {
          orchestrator: 'AgentScope',
          provider: 'SCNet',
          model: 'glm5.2',
          mode: 'model',
          configured: true,
          message: 'AgentScope 已完成三维路由与候选推荐',
        },
    } as any
    let releaseFirstResult: (() => void) | undefined
    let finishStream: (() => void) | undefined
    mockedStreamScienceSkills.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onStatus?.({ message: '正在理解科研需求' })
      await new Promise<void>((resolve) => { releaseFirstResult = resolve })
      handlers.onRoute?.(streamedPayload.route)
      handlers.onStatus?.({ message: '正在复核候选技能' })
      handlers.onResult?.(streamedPayload.results[0])
      await new Promise<void>((resolve) => { finishStream = resolve })
      const { results: _results, ...done } = streamedPayload
      handlers.onDone?.(done)
    })
    renderSkillHubHome()
    const finder = (await screen.findByRole('heading', { name: '科研技能 Wiki' })).closest('section')
    expect(finder).toBeTruthy()
    const graph = within(finder as HTMLElement).getByRole('group', { name: '科研能力沙漏图' })
    expect(within(graph).getByTestId('science-graph-connections')).toBeInTheDocument()
    expect(within(graph).getByRole('group', { name: '领域星簇' })).toBeInTheDocument()
    expect(within(graph).getByRole('group', { name: '研究阶段星簇' })).toBeInTheDocument()
    expect(within(graph).getByRole('group', { name: '功能分工星簇' })).toBeInTheDocument()
    expect(within(graph).getByText('科研需求')).toBeInTheDocument()
    expect(within(graph).getByRole('heading', { name: '领域' })).toBeInTheDocument()
    expect(within(graph).getByRole('heading', { name: '研究阶段' })).toBeInTheDocument()
    expect(within(graph).getByRole('heading', { name: '功能分工' })).toBeInTheDocument()
    expect(within(finder as HTMLElement).queryByText(/AgentScope|SCNet|降级|配置已发现/)).not.toBeInTheDocument()
    expect(within(finder as HTMLElement).queryByLabelText('描述科研需求')).not.toBeInTheDocument()
    await within(graph).findByRole('group', { name: 'Skill 叶节点' })

    const searchInput = screen.getByLabelText('描述科研需求')
    const functionAll = screen.getByRole('button', { name: '功能：全部' })
    expect(functionAll.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(searchInput, { target: { value: '我想分析单细胞转录组细胞类型' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索科研技能' }))

    const catalogResults = await screen.findByRole('region', { name: '科研技能目录结果' })
    expect(screen.getByRole('button', { name: '领域：全部' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '阶段：全部' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '功能：全部' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('正在等待首条推荐')).toBeInTheDocument()
    expect(screen.queryByText(/没有找到可靠匹配/)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '推荐进度' })).toHaveTextContent('理解需求')
    expect(screen.getByRole('status', { name: '推荐进度' })).toHaveTextContent('匹配技能')
    expect(screen.getByRole('status', { name: '推荐进度' })).toHaveTextContent('生成推荐')
    expect(screen.getByRole('status', { name: '推荐进度' })).toHaveTextContent('已找到 0 项')
    await act(async () => releaseFirstResult?.())
    expect(await screen.findByRole('status', { name: '推荐进度' })).toHaveTextContent('已找到 1 项')
    expect(await screen.findByText('正在推荐 · 已找到 1 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正在推荐…' })).toBeDisabled()
    expect(within(catalogResults).getAllByText('Single Cell Annotation')).toHaveLength(2)
    expect(within(catalogResults).getAllByText('研究对象、分析动作和细胞类型标签产物直接匹配。')).toHaveLength(2)
    expect(within(catalogResults).getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('主要产物是带有细胞类型标签的单细胞表达数据。')).toBeInTheDocument()
    await act(async () => finishStream?.())
    expect(await screen.findByText('推荐结果 1 项')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '技能详情：Single Cell Annotation' })).toBeInTheDocument()
    expect(within(finder as HTMLElement).getByRole('button', { name: '知识图领域：生命科学' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(finder as HTMLElement).getByRole('button', { name: '知识图研究阶段：执行采集' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(finder as HTMLElement).getByRole('button', { name: '知识图功能分工：模拟建模' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(graph).getByRole('group', { name: 'Skill 叶节点' })).toBeInTheDocument()
    expect(graph.querySelector('[data-edge-id="domain:生命科学"]')).toHaveAttribute('data-active', 'true')
    expect(graph.querySelector('[data-edge-id="stage:执行采集"]')).toHaveAttribute('data-active', 'true')
    expect(graph.querySelector('[data-edge-id="function:模拟建模"]')).toHaveAttribute('data-active', 'true')
    fireEvent.mouseEnter(within(finder as HTMLElement).getByRole('button', { name: '知识图功能分工：检索获取' }))
    await waitFor(() => {
      expect(graph.querySelector('[data-edge-id="function:检索获取"]')).toHaveAttribute('data-hot', 'true')
    })
    fireEvent.mouseLeave(within(finder as HTMLElement).getByRole('button', { name: '知识图功能分工：检索获取' }))
    expect(within(finder as HTMLElement).queryByText('Single Cell Annotation')).not.toBeInTheDocument()
    expect(within(finder as HTMLElement).getAllByText('AlphaFold2')).toHaveLength(2)
    expect(within(finder as HTMLElement).getByRole('button', { name: '查看技能：AlphaFold2' })).toHaveAttribute('aria-pressed', 'true')
    const skillDetail = within(finder as HTMLElement).getByRole('region', { name: '技能详情：AlphaFold2' })
    expect(within(skillDetail).getByText('蛋白质结构预测。')).toBeInTheDocument()
    expect(within(skillDetail).getByText('生命科学 / 蛋白与结构生物学')).toBeInTheDocument()
    expect(within(skillDetail).getByText(/已复核原文/)).toBeInTheDocument()
    expect(within(skillDetail).getByRole('link', { name: '查看来源' })).toHaveAttribute('href', 'https://github.com/example/science-skills')
    await waitFor(() => {
      expect(mockedListScienceCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ domain: undefined, stage: undefined, function: undefined }),
      )
    })
  })

  it('returns from a browsed path to the whole graph without coupling that action to search', async () => {
    renderSkillHubHome()
    const finder = (await screen.findByRole('heading', { name: '科研技能 Wiki' })).closest('section')
    expect(finder).toBeTruthy()
    const resultRegion = within(finder as HTMLElement).getByRole('region', { name: '科研技能筛选结果' })
    fireEvent.click(within(resultRegion).getByRole('button', { name: '返回全图' }))

    expect(within(finder as HTMLElement).queryByRole('region', { name: '科研技能筛选结果' })).not.toBeInTheDocument()
    expect(within(finder as HTMLElement).getByRole('button', { name: '知识图领域：生命科学' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(finder as HTMLElement).getByRole('button', { name: '知识图研究阶段：执行采集' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(finder as HTMLElement).getByRole('button', { name: '知识图功能分工：模拟建模' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(finder as HTMLElement).queryByLabelText('描述科研需求')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('描述科研需求')).toHaveLength(1)
    await waitFor(() => {
      expect(mockedListScienceCatalog).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ domain: expect.anything(), stage: expect.anything(), function: expect.anything() }),
      )
    })
  })

  it('distinguishes no reliable match from a search service failure', async () => {
    const noMatchRoute = {
      domain: null,
      stage: null,
      function: null,
      search_terms: [],
      rationale: '当前描述不足以形成可靠路径，请补充研究对象、所处阶段与预期产物。',
    }
    mockedStreamScienceSkills.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onRoute?.(noMatchRoute)
      handlers.onDone?.({ query: 'zzqvorn blxkpt', route: noMatchRoute, total: 0, driver: {} } as any)
    })
    renderSkillHubHome()
    fireEvent.change(screen.getByLabelText('描述科研需求'), { target: { value: 'zzqvorn blxkpt' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索科研技能' }))
    const catalogResults = await screen.findByRole('region', { name: '科研技能目录结果' })
    expect(await within(catalogResults).findByText(/没有找到可靠匹配/)).toBeInTheDocument()
    expect(within(catalogResults).getByText(/请补充研究对象、当前阶段或期望产物后再搜索/)).toBeInTheDocument()

    mockedStreamScienceSkills.mockRejectedValueOnce(new Error('network unavailable'))
    fireEvent.change(screen.getByLabelText('描述科研需求'), { target: { value: '蛋白质结构预测' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索科研技能' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('搜索暂时不可用，请稍后重试。')
    expect(screen.getByLabelText('描述科研需求')).toHaveValue('蛋白质结构预测')

    const proteinRoute = {
      domain: '生命科学',
      stage: '执行采集',
      function: '模拟建模',
      search_terms: ['蛋白质结构'],
      rationale: '主要产物是蛋白质三维结构模型。',
    }
    mockedStreamScienceSkills.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onRoute?.(proteinRoute)
      handlers.onDone?.({ query: '蛋白质结构预测', route: proteinRoute, total: 0, driver: {} } as any)
    })
    fireEvent.click(screen.getByRole('button', { name: '重新搜索' }))
    await waitFor(() => {
      expect(mockedStreamScienceSkills).toHaveBeenLastCalledWith(
        { query: '蛋白质结构预测', limit: 5 },
        expect.any(Object),
        expect.any(AbortSignal),
      )
    })
    expect(await screen.findByText('主要产物是蛋白质三维结构模型。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders detail page with application-first framing and dual naming', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/skills/literature-map']}>
        <Routes>
          <Route path="/apps/skills/:slug" element={<AppsSkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('该对象在前台按应用展示；其底层能力形态仍然是 Skill，因此会保留版本、安装命令、全文说明，以及按“几他山石”展示的售价信息。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载 / 安装应用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 Skill 全文说明' })).toBeInTheDocument()
  })

  it('shows a login prompt in profile when user is not authenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/skills/profile']}>
        <Routes>
          <Route path="/apps/skills/profile" element={<AppsSkillProfilePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '登录后再进入绑定中心' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去登录' })).toBeInTheDocument()
    expect(mockedGetProfile).not.toHaveBeenCalled()
  })

  it('keeps the legacy Resonnet skill library under /library/skills', async () => {
    render(
      <MemoryRouter initialEntries={['/library/skills']}>
        <Routes>
          <Route path="/library/:section" element={<LibraryPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('保留 Resonnet 原有的讨论技能库，供 AI 话题讨论与主持流程使用。')).toBeInTheDocument()
    expect(screen.getByText('旧 Resonnet Skill Library')).toBeInTheDocument()
  })
})
