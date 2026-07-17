import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inspirationApi, InspirationDemand, topicsApi, TopicListItem } from '../../api/client'
import { refreshCurrentUserProfile, tokenManager } from '../../api/auth'
import TopicLinkPage from '../TopicLinkPage'
import {
  getOpcCandidateMatchProfile,
  TopicLinkOpcCandidate,
} from '../../topicLink/TopicLinkOpc'
import { useTopicLinkRecommendations } from '../../topicLink/useTopicLinkRecommendations'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    topicsApi: {
      ...actual.topicsApi,
      list: vi.fn(),
      getTopicLinkProfile: vi.fn(),
      getTopicLinkPresence: vi.fn(),
      setTopicLinkPresence: vi.fn(),
      scoreTopicLinkRecommendations: vi.fn(),
      dispatchOpcDiligence: vi.fn(),
      getTopicLinkDispatch: vi.fn(),
      answerTopicLinkKnowledge: vi.fn(),
      like: vi.fn(),
      favorite: vi.fn(),
      share: vi.fn(),
      delete: vi.fn(),
    },
    inspirationApi: {
      ...actual.inspirationApi,
      listDemands: vi.fn(),
    },
  }
})

vi.mock('../../topicLink/useTopicLinkRecommendations', () => ({
  useTopicLinkRecommendations: vi.fn(),
}))

vi.mock('../../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../api/auth')>('../../api/auth')
  return {
    ...actual,
    refreshCurrentUserProfile: vi.fn(),
  }
})

const mockedTopicsApiList = vi.mocked(topicsApi.list)
const mockedGetTopicLinkProfile = vi.mocked(topicsApi.getTopicLinkProfile)
const mockedPresence = vi.mocked(topicsApi.getTopicLinkPresence)
const mockedSetPresence = vi.mocked(topicsApi.setTopicLinkPresence)
const mockedScoreTopicLinkRecommendations = vi.mocked(topicsApi.scoreTopicLinkRecommendations)
const mockedDispatchOpcDiligence = vi.mocked(topicsApi.dispatchOpcDiligence)
const mockedGetTopicLinkDispatch = vi.mocked(topicsApi.getTopicLinkDispatch)
const mockedKnowledgeAnswer = vi.mocked(topicsApi.answerTopicLinkKnowledge)
const mockedListDemands = vi.mocked(inspirationApi.listDemands)
const mockedUseTopicLinkRecommendations = vi.mocked(useTopicLinkRecommendations)
const mockedRefreshCurrentUserProfile = vi.mocked(refreshCurrentUserProfile)
let hookSimulation: any = null
let hookSimulate = vi.fn()

function topic(overrides: Partial<TopicListItem> = {}): TopicListItem {
  return {
    id: 'topic-skill',
    session_id: 'topic-skill',
    category: 'research',
    title: '关于「Skill 的质量信号缺失」',
    body: '这里有人在聊 Skill 怎么判断好坏。',
    status: 'open',
    discussion_status: 'pending',
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    posts_count: 7,
    metadata: {
      topic_link: {
        table_state: 'seeking',
        participants: [
          { name: '发起人', role: '提线索', status: 'starter' },
          { name: '我这边', role: '先听听', status: 'reading' },
        ],
        wanted: [{ title: '等人接一句', description: '需要有人把实际经验补上' }],
      },
    },
    ...overrides,
  }
}

function demand(overrides: Partial<InspirationDemand> = {}): InspirationDemand {
  return {
    id: 'demand-1',
    slug: 'need-ai-workflow',
    clue_number: 19,
    status: 'published',
    allow_public: true,
    stage: '模糊想法',
    title: '用 GitHub 工作流管理知识库',
    summary: '把个人知识库纳入 GitHub 工作流，形成可追踪、可复盘、可持续迭代的知识管理方式。',
    tags: ['生活效率 / 个人工作流', 'Demo 反馈'],
    stuck: '需要判断最小可交付结果。',
    created_at: '2026-05-15T09:40:24Z',
    updated_at: '2026-05-15T09:40:24Z',
    latest_update_at: '2026-05-15T09:40:24Z',
    assistant: {
      status: 'ready',
      snapshot: {
        summary: '共创队分身已经判断：先把知识库工作流拆成最小可验证路径。',
        next_step: '先列出 3 个真实文件夹和一次 diff 演示',
        follow_up_questions: ['当前知识库是否已经在 GitHub 里？'],
      },
      version: 1,
      latest_run_id: 'run-1',
      updated_at: '2026-05-15T09:50:24Z',
      error_message: null,
    },
    path_progress: [
      { key: 'submitted', label: '留下线索', status: 'done', summary: '已提交' },
      { key: 'defined', label: '问题定义', status: 'current', summary: '需要定义最小验证路径' },
    ],
    ...overrides,
  }
}

function opcCandidate(overrides: Partial<TopicLinkOpcCandidate> = {}): TopicLinkOpcCandidate {
  return {
    id: 'inspiration:need-ai-workflow',
    source: 'inspiration',
    source_slug: 'need-ai-workflow',
    source_path: '/inspiration-co-creation/needs/need-ai-workflow',
    clue_number: 19,
    title: '用 GitHub 工作流管理知识库',
    summary: '把个人知识库纳入 GitHub 工作流，形成可追踪、可复盘、可持续迭代的知识管理方式。',
    stage: '问题定义',
    tags: ['生活效率 / 个人工作流', 'Demo 反馈'],
    blocker: '需要判断最小可交付结果。',
    fit_score: 82,
    fit_reasons: ['有明确卡点，适合先做尽调'],
    suggested_next_action: '先让分身尽调，再决定是否转成 OPC 挂牌。',
    assistant: {
      status: 'ready',
      snapshot: {
        summary: '共创队分身已经判断：先把知识库工作流拆成最小可验证路径。',
        next_step: '先列出 3 个真实文件夹和一次 diff 演示',
        follow_up_questions: ['当前知识库是否已经在 GitHub 里？'],
      },
      version: 1,
      latest_run_id: 'run-1',
      updated_at: '2026-05-15T09:50:24Z',
      error_message: null,
    },
    ...overrides,
  }
}

const skillTopic = topic()
const kalmanTopic = topic({
  id: 'topic-kalman',
  session_id: 'topic-kalman',
  category: 'research',
  title: '守岸虾的 AI-aided Kalman Filter 研究笔记',
  body: 'Kalman filter 相关笔记，适合科研工具链讨论。',
  posts_count: 2,
})
const arcadeTopic = topic({
  id: 'topic-arcade',
  session_id: 'topic-arcade',
  category: 'arcade',
  title: '103-瞬变源异常监测接力',
  body: '等人接一句。',
  posts_count: 18,
})
const smokeTopic = topic({
  id: 'topic-smoke',
  session_id: 'topic-smoke',
  category: 'test',
  title: 'OpenClaw live smoke 20260522',
  body: 'connection test',
  posts_count: 1,
})

describe('TopicLinkPage', () => {
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    HTMLElement.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
    } as any)
    mockedTopicsApiList.mockResolvedValue({
      data: {
        items: [skillTopic, kalmanTopic, arcadeTopic, smokeTopic],
        next_cursor: null,
      },
    } as any)
    mockedPresence.mockResolvedValue({
      data: {
        topic_id: 'topic-skill',
        persona_name: '先看看',
        resident: false,
        status: 'reading',
      },
    } as any)
    mockedSetPresence.mockResolvedValue({
      data: {
        topic_id: 'topic-skill',
        persona_name: '先看看',
        resident: true,
        status: 'reading',
      },
    } as any)
    mockedScoreTopicLinkRecommendations.mockResolvedValue({
      data: {
        vector_status: 'ready',
        embedding_model: 'Qwen3-Embedding-8B',
        items: [
          {
            topic_id: 'inspiration:need-ai-workflow',
            recommendation_score: 92,
            reasons: ['与当前公司画像接近'],
            next_action: '适合先做尽调。',
          },
          {
            topic_id: 'inspiration:need-ansys',
            recommendation_score: 72,
            reasons: ['工程方向接近'],
            next_action: '可以先看一轮。',
          },
        ],
      },
    } as any)
    mockedDispatchOpcDiligence.mockResolvedValue({
      data: {
        task: {
          id: 'dispatch-1',
          task_type: 'diligence',
          status: 'pending',
          source: {
            type: 'inspiration_demand',
            id: 'need-ai-workflow',
            title: '用 GitHub 工作流管理知识库',
            path: '/inspiration-co-creation/needs/need-ai-workflow',
          },
          target_agent: { agent_uid: 'oc-test', handle: 'research-builder-openclaw' },
          input: {
            discussion_topic_id: 'topic-opc-ai-workflow',
            discussion_path: '/topiclink/topic-opc-ai-workflow',
            dispatch_post_id: 'post-opc-dispatch',
          },
          output: {},
          error_message: null,
          created_at: '2026-07-14T00:00:00Z',
          updated_at: '2026-07-14T00:00:00Z',
          claimed_at: null,
          completed_at: null,
        },
      },
    } as any)
    mockedGetTopicLinkDispatch.mockResolvedValue({
      data: {
        task: {
          id: 'dispatch-1',
          task_type: 'diligence',
          status: 'replied',
          source: {
            type: 'inspiration_demand',
            id: 'need-ai-workflow',
            title: '用 GitHub 工作流管理知识库',
            path: '/inspiration-co-creation/needs/need-ai-workflow',
          },
          target_agent: { agent_uid: 'oc-test', handle: 'research-builder-openclaw' },
          input: {
            discussion_topic_id: 'topic-opc-ai-workflow',
            discussion_path: '/topiclink/topic-opc-ai-workflow',
            dispatch_post_id: 'post-opc-dispatch',
          },
          output: {
            summary: '这单值得继续核验，但不应自动承接。',
            risk_notes: ['验收边界尚未确认', '缺少失败样本'],
            next_step: '主人确认后再打开原线索沟通。',
          },
          error_message: null,
          created_at: '2026-07-14T00:00:00Z',
          updated_at: '2026-07-14T00:00:02Z',
          claimed_at: '2026-07-14T00:00:01Z',
          completed_at: '2026-07-14T00:00:02Z',
        },
      },
    } as any)
    mockedKnowledgeAnswer.mockResolvedValue({
      data: {
        provider_status: 'ready',
        vector_status: 'ready',
        embedding_model: 'Qwen3-Embedding-8B',
        answer: '可以先看 Kalman 那桌，那里已经有人把问题拆开了。',
        topic_ids: ['topic-kalman'],
      },
    } as any)
    mockedListDemands.mockResolvedValue({
      data: {
        list: [
          demand(),
          demand({
            id: 'demand-2',
            slug: 'need-ansys',
            clue_number: 20,
            title: '文字驱动 ANSYS 仿真',
            summary: '通过自然语言和 Codex 协作，完成动力学仿真、静力分析和模态分析。',
            tags: ['科研 / AI for Science', '工程仿真'],
            stuck: '需要判断自动化链路的可靠性。',
            assistant: undefined,
          }),
        ],
        limit: 24,
        offset: 0,
        total: 2,
        has_more: false,
        next_offset: null,
      },
    } as any)
    mockedRefreshCurrentUserProfile.mockResolvedValue(null)
    hookSimulation = null
    hookSimulate = vi.fn()
    mockedUseTopicLinkRecommendations.mockImplementation(({ skillQuery }: any) => {
      const recommendations = skillQuery
        ? {
            'topic-kalman': {
              topic_id: 'topic-kalman',
              semantic_similarity: 0.86,
              profile_similarity: 0.8,
              recommendation_score: 0.88,
              confidence: 'high',
              reasons: ['和搜索内容接近'],
              next_action: '打开这一桌',
            },
          }
        : {
            'topic-skill': {
              topic_id: 'topic-skill',
              semantic_similarity: 0.9,
              profile_similarity: 0.82,
              recommendation_score: 0.91,
              confidence: 'high',
              reasons: ['和你有关'],
              next_action: '先看看',
            },
          }
      return {
        recommendations: recommendations as any,
        runtimeStatus: { vectorStatus: 'ready', embeddingModel: 'Qwen3-Embedding-8B' },
        loading: false,
        simulation: hookSimulation,
        simulationLoading: false,
        simulate: hookSimulate as any,
      }
    })
  })

  it('renders the plaza map without falling back to the old topic list', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('关于「Skill 的质量信号缺失」')).toBeInTheDocument()
    expect(screen.getByText('他山知识库')).toBeInTheDocument()
    expect(screen.queryByText('OpenClaw live smoke 20260522')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '进入讨论' }).some((link) => link.getAttribute('href') === '/topiclink/topic-skill')).toBe(true)
    expect(screen.queryByPlaceholderText('搜索话题')).not.toBeInTheDocument()
    const modeSwitch = screen.getByRole('group', { name: '切换 TopicLink 模式' })
    expect(within(modeSwitch).getByRole('button', { name: '科研' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(modeSwitch).queryByRole('button', { name: '社交' })).not.toBeInTheDocument()
  })

  it('keeps specialist categories visible in the warm TopicLink plaza', async () => {
    mockedTopicsApiList.mockResolvedValue({
      data: {
        items: [topic({
          id: 'topic-2050',
          session_id: 'topic-2050',
          category: '2050',
          title: '2050 会议议程专题讨论帖',
          body: '讨论会议议程、活动选择和现场协作机会。',
        })],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mockedTopicsApiList).toHaveBeenCalled())
    expect(screen.getByText('关于「2050 会议议程专题讨论帖」')).toBeInTheDocument()
    expect(screen.queryByText('当前暂无公开话题')).not.toBeInTheDocument()
  })

  it('does not present reply counts as live viewer counts', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('关于「Skill 的质量信号缺失」')).toBeInTheDocument()
    expect(screen.getAllByText('7 条回应').length).toBeGreaterThan(0)
    expect(screen.queryByText('7 人在看')).not.toBeInTheDocument()
  })

  it('shows real public topic facts instead of guest profile scores', async () => {
    mockedTopicsApiList.mockResolvedValue({
      data: {
        items: [topic({
          id: 'topic-empty',
          session_id: 'topic-empty',
          title: '等待第一条科研回应',
          body: '正文已经公开，但目前还没有真实回应。',
          creator_name: 'TopicLab',
          posts_count: 0,
          metadata: {
            topic_link: {
              table_state: 'seeking',
              wanted: [{ title: '等人接一句', description: '需要有人补充实际经验' }],
            },
          },
        })],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    const publicSummary = await screen.findByTestId('topiclink-public-topic-summary')
    expect(publicSummary).toHaveTextContent('正文已经公开，但目前还没有真实回应。')
    expect(publicSummary).toHaveTextContent('0 条回应')
    expect(screen.queryByText('这桌正在被讨论')).not.toBeInTheDocument()
    expect(screen.queryByText('聊的事')).not.toBeInTheDocument()
    expect(screen.queryByText('1 个相关人')).not.toBeInTheDocument()
  })

  it('renders OPC mode directly from public inspiration demands', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('项目关系预挂牌')).length).toBeGreaterThan(0)
    expect(screen.getByTestId('opc-candidate-map')).toBeInTheDocument()
    expect(screen.getByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    expect(screen.getAllByText('已连接灵感共创队 · 语义匹配').length).toBeGreaterThan(0)
    expect(screen.getAllByText('92 尽调匹配').length).toBeGreaterThan(0)
    expect(screen.getAllByText('共创队分身已读').length).toBeGreaterThan(0)
    const activityFeed = screen.getByTestId('opc-activity-feed')
    expect(activityFeed).toHaveTextContent('园区动态')
    expect(activityFeed).toHaveTextContent('灵感共创队')
    expect(activityFeed).toHaveTextContent('发布了「用 GitHub 工作流管理知识库」')
    expect(screen.queryByText('登录并绑定分身后，可以派它去调研')).not.toBeInTheDocument()
    const projectBrief = screen.getByTestId('opc-need-summary-panel')
    expect(projectBrief).toHaveTextContent('项目简报')
    expect(projectBrief).toHaveTextContent('把个人知识库纳入 GitHub 工作流')
    expect(projectBrief).toHaveTextContent('需要判断最小可交付结果')
    expect(screen.getByTestId('opc-focus-source-link')).toHaveAttribute('href', '/inspiration-co-creation/needs/need-ai-workflow')
    expect(screen.getByTestId('opc-focus-diligence-button')).toHaveTextContent('分身调研')
    expect(screen.getByRole('link', { name: '打开线索' })).toHaveAttribute('href', '/inspiration-co-creation/needs/need-ai-workflow')
    expect(screen.getAllByText('公开线索来自灵感共创队').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: '去灵感共创队发布' })[0]).toHaveAttribute(
      'href',
      '/inspiration-co-creation/submit?from=topiclink&intent=demand&topic_title=OPC+Link+%E4%B8%80%E4%BA%BA%E5%85%AC%E5%8F%B8%E9%A2%84%E6%8C%82%E7%89%8C&problem=%E6%88%91%E6%83%B3%E6%8A%8A%E4%B8%80%E4%B8%AA%E4%BB%BB%E5%8A%A1%E5%9C%A8+OPC+Link+%E4%B8%AD%E9%A2%84%E6%8C%82%E7%89%8C%EF%BC%8C%E5%85%88%E6%89%BE%E5%90%88%E9%80%82%E7%9A%84%E4%B8%80%E4%BA%BA%E5%85%AC%E5%8F%B8%E6%89%BF%E6%8E%A5%EF%BC%8C%E6%88%96%E8%AE%A9%E5%88%86%E8%BA%AB%E5%85%88%E5%81%9A%E4%B8%80%E7%89%88%E5%B0%BD%E8%B0%83%E5%8F%8D%E9%A6%88%E3%80%82&category=%E5%B7%A5%E4%BD%9C%E6%95%88%E7%8E%87&category_extra=%E4%B8%80%E4%BA%BA%E5%85%AC%E5%8F%B8%E9%A2%84%E6%8C%82%E7%89%8C&current_blockers=%E6%83%B3%E6%89%BE%E5%85%B1%E5%88%9B%E4%BC%99%E4%BC%B4&note=%E6%9D%A5%E8%87%AA+OPC+Link+%E9%A2%84%E6%8C%82%E7%89%8C',
    )
    expect(mockedListDemands).toHaveBeenCalledWith({ includeInterest: false, includeOverview: false, limit: 24, offset: 0 })
  })

  it('loads every public demand page before searching OPC listings', async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) => demand({
      id: `demand-page-one-${index + 1}`,
      slug: index === 0 ? 'need-ai-workflow' : `need-page-one-${index + 1}`,
      clue_number: index + 1,
      title: index === 0 ? '用 GitHub 工作流管理知识库' : `第一页公开需求 ${index + 1}`,
    }))
    const lastDemand = demand({
      id: 'demand-last',
      slug: 'need-last-public',
      clue_number: 25,
      title: '最后一条公开需求',
      summary: '这条需求位于公开列表的下一页。',
    })
    mockedListDemands
      .mockResolvedValueOnce({
        data: {
          list: firstPage,
          limit: 24,
          offset: 0,
          total: 25,
          has_more: true,
          next_offset: 24,
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          list: [lastDemand],
          limit: 24,
          offset: 24,
          total: 25,
          has_more: false,
          next_offset: null,
        },
      } as any)

    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mockedListDemands).toHaveBeenNthCalledWith(2, {
      includeInterest: false,
      includeOverview: false,
      limit: 24,
      offset: 24,
    }))
    expect(mockedListDemands).toHaveBeenNthCalledWith(1, {
      includeInterest: false,
      includeOverview: false,
      limit: 24,
      offset: 0,
    })
    expect(mockedListDemands).toHaveBeenCalledTimes(2)
    const scoredTopics = mockedScoreTopicLinkRecommendations.mock.calls[0][0].topics
    expect(scoredTopics).toHaveLength(25)
    expect(scoredTopics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'inspiration:need-ai-workflow' }),
      expect.objectContaining({ id: 'inspiration:need-last-public' }),
    ]))
    fireEvent.change(screen.getAllByPlaceholderText('按技能或关键词筛单，比如 AI for Science')[0], {
      target: { value: '最后一条公开需求' },
    })
    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('最后一条公开需求')
    expect(screen.getAllByText('25').length).toBeGreaterThan(0)
  })

  it('uses the OPC park map and a professional capybara founder avatar', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    const mapImage = screen.getByTestId('opc-candidate-map').querySelector('img')
    const founderAvatar = screen.getByTestId('opc-founder-avatar')

    expect(mapImage?.getAttribute('src')).toMatch(/opc-park-map.*\.webp$/)
    expect(mapImage?.getAttribute('src')).not.toMatch(/topic-plaza-map/)
    expect(founderAvatar.getAttribute('style')).toContain('opc-professional-capybara-mascots')
    expect(founderAvatar.getAttribute('style')).toContain('background-size: 900% 600%')
  })

  it('explains adjacent OPC project relationships before matching people', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    const relationPanel = screen.getByTestId('opc-relation-panel')

    expect(relationPanel).toHaveTextContent('相似项目')
    expect(relationPanel).toHaveTextContent('文字驱动 ANSYS 仿真')
    expect(relationPanel).toHaveTextContent('都有明确卡点')
    expect(relationPanel).toHaveTextContent('可以对照着看')
  })

  it('lets users click adjacent OPC project cards to change the focus project', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')

    fireEvent.click(screen.getAllByText('文字驱动 ANSYS 仿真')[0])

    await waitFor(() => {
      expect(screen.getByTestId('opc-focus-candidate')).toHaveTextContent('文字驱动 ANSYS 仿真')
    })
    const projectBrief = screen.getByTestId('opc-need-summary-panel')
    expect(projectBrief.parentElement).toHaveClass('top-20', 'right-6')
    expect(projectBrief).toHaveTextContent('文字驱动 ANSYS 仿真')
    expect(projectBrief).toHaveTextContent('完成动力学仿真、静力分析和模态分析')
    expect(projectBrief).toHaveTextContent('需要判断自动化链路的可靠性')
    expect(screen.getByRole('link', { name: '打开线索' })).toHaveAttribute('href', '/inspiration-co-creation/needs/need-ansys')
  })

  it('keeps OPC project relationship reasons available in the mobile list', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    const mobileList = screen.getByTestId('opc-mobile-candidate-list')

    expect(mobileList).toHaveTextContent('项目关联')
    expect(mobileList).toHaveTextContent('中心项目')
    expect(mobileList).toHaveTextContent('都有明确卡点')
  })

  it('refocuses the OPC candidate map from keyword search', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')

    fireEvent.change(screen.getAllByPlaceholderText('按技能或关键词筛单，比如 AI for Science')[0], {
      target: { value: 'ANSYS' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('opc-focus-candidate')).toHaveTextContent('文字驱动 ANSYS 仿真')
    })
    expect(screen.getAllByText('1 个命中').length).toBeGreaterThan(0)
    expect(screen.getByText('先核验技术路径，再找科研公司')).toBeInTheDocument()
    expect(screen.getByText('实验复现')).toBeInTheDocument()
  })

  it('ranks public inspiration demands through the shared TopicLink vector scorer', async () => {
    mockedScoreTopicLinkRecommendations.mockResolvedValueOnce({
      data: {
        vector_status: 'ready',
        embedding_model: 'Qwen3-Embedding-8B',
        items: [
          {
            topic_id: 'inspiration:need-ansys',
            recommendation_score: 91,
            reasons: ['与当前公司画像高度接近'],
            next_action: '适合先做尽调。',
          },
          {
            topic_id: 'inspiration:need-ai-workflow',
            recommendation_score: 61,
            reasons: ['方向有部分交集'],
            next_action: '可以先看一轮。',
          },
        ],
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('opc-focus-candidate')).toHaveTextContent('文字驱动 ANSYS 仿真')
    })
    expect(mockedScoreTopicLinkRecommendations).toHaveBeenCalledWith(expect.objectContaining({
      topics: expect.arrayContaining([
        expect.objectContaining({ id: 'inspiration:need-ai-workflow', category: 'request' }),
        expect.objectContaining({ id: 'inspiration:need-ansys', category: 'request' }),
      ]),
    }))
  })

  it('dispatches the bound agent and renders its diligence receipt', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')

    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))

    const drawer = await screen.findByTestId('opc-diligence-drawer')
    expect(drawer.parentElement).toHaveClass('fixed', 'right-6', 'top-24')
    await waitFor(() => {
      expect(mockedDispatchOpcDiligence).toHaveBeenCalledWith('need-ai-workflow')
      expect(mockedGetTopicLinkDispatch).toHaveBeenCalledWith('dispatch-1')
      expect(drawer).toHaveTextContent('分身已回复')
    })
    expect(drawer).toHaveTextContent('这单值得继续核验，但不应自动承接')
    expect(drawer).toHaveTextContent('验收边界尚未确认')
    expect(drawer).toHaveTextContent('缺少失败样本')
    expect(drawer).toHaveTextContent('主人确认后再打开原线索沟通')
    expect(drawer).not.toHaveTextContent('预演')
    expect(drawer).not.toHaveTextContent('未实际派出')
    expect(within(drawer).getByRole('link', { name: '进入讨论' })).toBeInTheDocument()
    expect(within(drawer).getByTestId('opc-diligence-discussion-link')).toHaveAttribute('href', '/topiclink/topic-opc-ai-workflow')
    expect(within(drawer).getByRole('link', { name: '打开原线索' })).toBeInTheDocument()
    expect(within(drawer).getByTestId('opc-diligence-source-link')).toHaveAttribute('href', '/inspiration-co-creation/needs/need-ai-workflow')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByTestId('opc-diligence-drawer')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))
    const reopenedDrawer = await screen.findByTestId('opc-diligence-drawer')
    fireEvent.click(within(reopenedDrawer).getByRole('button', { name: '关闭' }))
    await waitFor(() => {
      expect(screen.queryByTestId('opc-diligence-drawer')).not.toBeInTheDocument()
    })
  })

  it('explains OPC login protection without exposing backend terms', async () => {
    mockedDispatchOpcDiligence.mockRejectedValueOnce({
      response: { data: { detail: '登录后才能派出绑定的 OpenClaw 分身' } },
    })
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))

    const drawer = await screen.findByTestId('opc-diligence-drawer')
    await waitFor(() => expect(drawer).toHaveTextContent('登录后才能派出你的分身'))
    expect(drawer).not.toHaveTextContent('OpenClaw')
  })

  it.each([
    ['请先绑定 OpenClaw 分身，再执行调研', '请先绑定你的分身，再开始调研。'],
    ['当前绑定的 OpenClaw 分身未处于 active 状态', '当前分身尚未启用，请先启用后再调研。'],
    ['OpenClaw 分身暂时不可用', '调研任务未能派出，请稍后再试。'],
  ])('explains OPC dispatch setup errors as a clear next step', async (detail, expected) => {
    mockedDispatchOpcDiligence.mockRejectedValueOnce({ response: { data: { detail } } })
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))

    const drawer = await screen.findByTestId('opc-diligence-drawer')
    await waitFor(() => expect(drawer).toHaveTextContent(expected))
    expect(drawer).not.toHaveTextContent(/OpenClaw|active|分身 分身/)
  })

  it('keeps polling until a slow diligence task replies', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    const pendingTask = {
      id: 'dispatch-1',
      task_type: 'diligence',
      status: 'pending',
      source: {
        type: 'inspiration_demand',
        id: 'need-ai-workflow',
        title: '用 GitHub 工作流管理知识库',
        path: '/inspiration-co-creation/needs/need-ai-workflow',
      },
      target_agent: { agent_uid: 'oc-test', handle: 'research-builder-openclaw' },
      input: {},
      output: {},
      error_message: null,
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
      claimed_at: null,
      completed_at: null,
    }
    mockedGetTopicLinkDispatch.mockResolvedValue({ data: { task: pendingTask } } as any)
    vi.useFakeTimers()

    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(62_000)
    })
    expect(mockedGetTopicLinkDispatch.mock.calls.length).toBeGreaterThan(31)

    mockedGetTopicLinkDispatch.mockResolvedValue({
      data: {
        task: {
          ...pendingTask,
          status: 'replied',
          output: {
            summary: '慢任务也已把真实回执送回页面。',
            risk_notes: ['仍需主人确认'],
            next_step: '确认后再进入原线索。',
          },
        },
      },
    } as any)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(screen.getByTestId('opc-diligence-receipt')).toHaveTextContent('慢任务也已把真实回执送回页面。')
  })

  it('dispatches real diligence even when the public demand has no assistant snapshot', async () => {
    mockedListDemands.mockResolvedValueOnce({
      data: {
        list: [demand({ assistant: undefined })],
        limit: 24,
        offset: 0,
        total: 1,
        has_more: false,
        next_offset: null,
      },
    } as any)
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')
    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))

    const drawer = await screen.findByTestId('opc-diligence-drawer')
    await waitFor(() => expect(mockedDispatchOpcDiligence).toHaveBeenCalledWith('need-ai-workflow'))
    expect(drawer).toHaveTextContent('分身已回复')
    expect(drawer).not.toHaveTextContent('预演')
    expect(within(drawer).getByRole('link', { name: '打开原线索' })).toBeInTheDocument()
  })

  it('links self-claim directly to the source inspiration need', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('opc-focus-candidate')).toHaveTextContent('用 GitHub 工作流管理知识库')

    expect(screen.getByTestId('opc-focus-source-link')).toHaveAttribute('href', '/inspiration-co-creation/needs/need-ai-workflow')
    expect(screen.queryByTestId('opc-project-brief')).not.toBeInTheDocument()
  })

  it('classifies OPC candidate match profiles for recommendation copy', () => {
    const profile = getOpcCandidateMatchProfile(opcCandidate({
      title: '品牌 logo 提案三选一',
      summary: '需要做基础 VI 和品牌视觉判断。',
      tags: ['设计', '品牌'],
    }))

    expect(profile.headline).toBe('先对齐审美边界，再找设计公司')
    expect(profile.people).toContain('设计承接')
    expect(profile.reasons[0]).toContain('适合先做尽调')
  })

  it('uses the authenticated TopicLink profile while dispatching OPC diligence', async () => {
    tokenManager.set('test-token')
    mockedRefreshCurrentUserProfile.mockResolvedValue({
      id: 777,
      phone: 'local-test',
      username: 'research-builder',
      created_at: '2026-07-09T00:00:00Z',
    })
    mockedGetTopicLinkProfile.mockResolvedValue({
      data: {
        username: 'research-builder',
        display_name: '研究工作流承接方',
        agent_name: '我的科研分身',
        handle: 'research-builder-agent',
        title: '知识工程一人公司',
        subtitle: '科研工作流与知识管理',
        summary: '先核对公开证据和交付边界，再决定是否承接。',
        cards: [
          { label: '常看的事', value: 'GitHub 工作流', detail: '关注可追踪的协作流程' },
          { label: '擅长交付', value: '个人知识库', detail: '整理可复用的知识资产' },
        ],
        source_parts_count: 2,
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    const activityFeed = await screen.findByTestId('opc-activity-feed')
    expect(activityFeed).toHaveTextContent('灵感共创队发布了「用 GitHub 工作流管理知识库」')
    expect(activityFeed).not.toHaveTextContent('入驻了项目园区')
    fireEvent.click(screen.getByTestId('opc-focus-diligence-button'))

    const drawer = await screen.findByTestId('opc-diligence-drawer')
    await waitFor(() => expect(mockedDispatchOpcDiligence).toHaveBeenCalledWith('need-ai-workflow'))
    expect(drawer).toHaveTextContent('分身已回复')
    expect(drawer).toHaveTextContent('主人确认后执行')
    expect(screen.getByTestId('opc-activity-feed')).toHaveTextContent('知识工程一人公司交回了「用 GitHub 工作流管理知识库」调研')
  })

  it('uses the authenticated TopicLink profile without running a social preview', async () => {
    tokenManager.set('test-token')
    mockedRefreshCurrentUserProfile.mockResolvedValue({
      id: 778,
      phone: 'local-social-test',
      username: 'social-researcher',
      created_at: '2026-07-09T00:00:00Z',
    })
    mockedGetTopicLinkProfile.mockResolvedValue({
      data: {
        username: 'social-researcher',
        display_name: '科研协作用户',
        agent_name: '我的科研分身',
        handle: 'social-researcher-agent',
        title: '科研协作分身',
        subtitle: '先读上下文，再补真实证据',
        summary: '关注 Skill 质量、科研工作流和可复现验证。',
        cards: [
          { label: '常看的事', value: 'Skill 质量', detail: '关注真实运行证据' },
        ],
        source_parts_count: 1,
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('关于「Skill 的质量信号缺失」')).toBeInTheDocument()
    await waitFor(() => {
      expect(mockedUseTopicLinkRecommendations).toHaveBeenCalledWith(expect.objectContaining({
        viewerProfile: expect.objectContaining({
          title: '科研协作分身',
          agentName: '我这边',
        }),
      }))
    })

    const focusCard = document.querySelector('.topiclink-focus-card')
    expect(focusCard).not.toBeNull()
    expect(hookSimulate).not.toHaveBeenCalled()
    expect(within(focusCard as HTMLElement).getByRole('button', { name: '外派虾' })).toBeInTheDocument()
    expect(mockedSetPresence).not.toHaveBeenCalled()
  })

  it('does not render social preview output', async () => {
    hookSimulation = {
      provider_status: 'local',
      model: 'local-preview',
      summary: '先看大家已经聊到哪一步。',
      turns: [{ speaker: '我这边', role: '补充资料', message: '先核对材料，再决定是否回应。' }],
      suggested_action: '先看清楚，再回应。',
    }

    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('关于「Skill 的质量信号缺失」')).toBeInTheDocument()
    expect(screen.queryByTestId('topiclink-simulation-source')).not.toBeInTheDocument()
    expect(screen.queryByText('先核对材料，再决定是否回应。')).not.toBeInTheDocument()
  })

  it('lets users switch from OPC mode back to the social plaza', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink?mode=opc']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('项目关系预挂牌')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: '科研' })[0])

    expect(await screen.findByText('关于「Skill 的质量信号缺失」')).toBeInTheDocument()
  })

  it('loads the plaza map from a bundled webp asset', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    await screen.findByText('关于「Skill 的质量信号缺失」')

    const mapImage = document.querySelector('.topiclink-plaza-surface img')
    expect(mapImage).not.toBeNull()
    expect(mapImage?.getAttribute('src')).toMatch(/topic-plaza-map.*\.webp$/)
    expect(mapImage?.getAttribute('src')).not.toBe('/media/topic-plaza-map.png')
  })

  it('shows knowledge search results without replacing the selected table until clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('关于「Skill 的质量信号缺失」')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('搜索话题、文章、人物'), {
      target: { value: 'Kalman' },
    })

    const resultTitles = await screen.findAllByText(/AI-aided Kalman/)
    const resultTitle = resultTitles.find((element) => element.closest('button')?.textContent?.includes('打开这一桌'))
    expect(resultTitle).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '进入讨论' }).some((link) => link.getAttribute('href') === '/topiclink/topic-skill')).toBe(true)

    const resultButton = resultTitle!.closest('button')
    expect(resultButton).not.toBeNull()
    fireEvent.click(resultButton!)

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: '进入讨论' }).some((link) => link.getAttribute('href') === '/topiclink/topic-kalman')).toBe(true)
    })
  })

  it('dispatches the bound OpenClaw without a preview step', async () => {
    hookSimulation = {
      provider_status: 'ready',
      model: 'MiniMax-M2.5',
      summary: '先看几条真实回应。',
      turns: [{ speaker: '我这边', role: '整理资料', message: '先看大家说到哪里。' }],
      suggested_action: '看完再接一句。',
    }
    mockedSetPresence.mockResolvedValueOnce({
      data: {
        topic_id: 'topic-skill',
        persona_name: '先看看',
        resident: true,
        status: 'dispatched',
      },
    } as any)
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findAllByText('公开话题')).not.toHaveLength(0)

    const dispatchButton = screen.getAllByRole('button', { name: '外派虾' })[0]
    fireEvent.click(dispatchButton)

    await waitFor(() => {
      expect(mockedSetPresence).toHaveBeenCalledWith('topic-skill', { persona_name: undefined })
    })
    expect(hookSimulate).not.toHaveBeenCalled()
    expect(within(document.body).getAllByText(/已派出/).length).toBeGreaterThan(0)
  })

  it('does not claim dispatch succeeded when the inbox task fails', async () => {
    hookSimulation = {
      provider_status: 'ready',
      model: 'MiniMax-M2.5',
      summary: '先看几条真实回应。',
      turns: [{ speaker: '我这边', role: '整理资料', message: '先看大家说到哪里。' }],
      suggested_action: '看完再接一句。',
    }
    mockedSetPresence.mockRejectedValueOnce({
      response: { data: { detail: '登录后才能外派绑定的 OpenClaw 分身' } },
    })
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    const dispatchButton = (await screen.findAllByRole('button', { name: '外派虾' }))[0]
    fireEvent.click(dispatchButton)

    await waitFor(() => expect(mockedSetPresence).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('button', { name: '外派虾' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('已派出，等待领取：')).not.toBeInTheDocument()
    expect(screen.getByText('登录后才能外派你的分身。')).toBeInTheDocument()
    expect(screen.queryByText(/OpenClaw/)).not.toBeInTheDocument()
  })

  it.each([
    ['请先绑定 OpenClaw 分身，再执行外派', '请先绑定你的分身，再执行外派。'],
    ['当前绑定的 OpenClaw 分身未处于 active 状态', '当前分身尚未启用，请先启用后再外派。'],
    ['OpenClaw 分身暂时不可用', '外派失败，请稍后再试。'],
  ])('explains research dispatch setup errors as a clear next step', async (detail, expected) => {
    mockedSetPresence.mockRejectedValueOnce({ response: { data: { detail } } })
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    const dispatchButton = (await screen.findAllByRole('button', { name: '外派虾' }))[0]
    fireEvent.click(dispatchButton)

    await waitFor(() => expect(mockedSetPresence).toHaveBeenCalledTimes(1))
    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(/OpenClaw|active|分身 分身/)).not.toBeInTheDocument()
  })
})
