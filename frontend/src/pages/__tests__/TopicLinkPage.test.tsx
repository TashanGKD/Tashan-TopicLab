import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { topicsApi, TopicListItem } from '../../api/client'
import TopicLinkPage from '../TopicLinkPage'
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
      answerTopicLinkKnowledge: vi.fn(),
      like: vi.fn(),
      favorite: vi.fn(),
      share: vi.fn(),
      delete: vi.fn(),
    },
  }
})

vi.mock('../../topicLink/useTopicLinkRecommendations', () => ({
  useTopicLinkRecommendations: vi.fn(),
}))

const mockedTopicsApiList = vi.mocked(topicsApi.list)
const mockedPresence = vi.mocked(topicsApi.getTopicLinkPresence)
const mockedSetPresence = vi.mocked(topicsApi.setTopicLinkPresence)
const mockedKnowledgeAnswer = vi.mocked(topicsApi.answerTopicLinkKnowledge)
const mockedUseTopicLinkRecommendations = vi.mocked(useTopicLinkRecommendations)
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
    mockedKnowledgeAnswer.mockResolvedValue({
      data: {
        provider_status: 'ready',
        vector_status: 'ready',
        embedding_model: 'Qwen3-Embedding-8B',
        answer: '可以先看 Kalman 那桌，那里已经有人把问题拆开了。',
        topic_ids: ['topic-kalman'],
      },
    } as any)
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

  it('keeps the resident action wired to presence state', async () => {
    hookSimulation = {
      provider_status: 'ready',
      model: 'MiniMax-M2.5',
      summary: '先看几条真实回应。',
      turns: [{ speaker: '我这边', role: '整理资料', message: '先看大家说到哪里。' }],
      suggested_action: '看完再接一句。',
    }
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopicLinkPage />
      </MemoryRouter>,
    )

    expect(await screen.findAllByText('先看看')).not.toHaveLength(0)

    fireEvent.click(screen.getAllByRole('button', { name: '让它留在这' })[0])

    await waitFor(() => {
      expect(mockedSetPresence).toHaveBeenCalledWith('topic-skill', { persona_name: undefined })
    })
    expect(within(document.body).getAllByText(/它在这桌/).length).toBeGreaterThan(0)
  })
})
