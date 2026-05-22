import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { topicsApi, TopicListItem } from '../../api/client'
import { useTopicLinkRecommendations } from '../useTopicLinkRecommendations'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    topicsApi: {
      ...actual.topicsApi,
      getTopicLinkRecommendations: vi.fn(),
      scoreTopicLinkRecommendations: vi.fn(),
      simulateTopicLink: vi.fn(),
    },
  }
})

const mockedGetRecommendations = vi.mocked(topicsApi.getTopicLinkRecommendations)
const mockedScoreRecommendations = vi.mocked(topicsApi.scoreTopicLinkRecommendations)
const mockedSimulateTopicLink = vi.mocked(topicsApi.simulateTopicLink)

function topic(overrides: Partial<TopicListItem> = {}): TopicListItem {
  return {
    id: 'topic-1',
    session_id: 'topic-1',
    category: 'research',
    title: '关于「Skill 的质量信号缺失」',
    body: '大家在讨论 Skill 质量如何判断。',
    status: 'open',
    discussion_status: 'pending',
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    posts_count: 3,
    metadata: {
      topic_link: {
        participants: [{ name: '发起人', role: '提线索' }],
        wanted: [{ title: '等人接一句', description: '需要有人补充真实经验' }],
      },
    },
    ...overrides,
  }
}

function Harness({
  selectedTopic,
  candidateTopics = [],
  skillQuery,
}: {
  selectedTopic: TopicListItem | null
  candidateTopics?: TopicListItem[]
  skillQuery?: string
}) {
  const state = useTopicLinkRecommendations({ selectedTopic, candidateTopics, skillQuery })
  return (
    <div>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="vector-status">{state.runtimeStatus.vectorStatus}</span>
      <span data-testid="recommendation-count">{Object.keys(state.recommendations).length}</span>
      <button type="button" onClick={() => selectedTopic && void state.simulate(selectedTopic)}>
        simulate
      </button>
      <span data-testid="simulation-summary">{state.simulation?.summary ?? ''}</span>
    </div>
  )
}

describe('useTopicLinkRecommendations', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetRecommendations.mockResolvedValue({
      data: {
        vector_status: 'ready',
        embedding_model: 'Qwen3-Embedding-8B',
        items: [
          {
            topic_id: 'topic-1',
            semantic_similarity: 0.82,
            profile_similarity: 0.79,
            recommendation_score: 0.84,
            confidence: 'high',
            reasons: ['同一批人会关心'],
            next_action: '先看看大家说到哪一步',
          },
        ],
      },
    } as any)
    mockedScoreRecommendations.mockResolvedValue({
      data: {
        vector_status: 'ready',
        embedding_model: 'Qwen3-Embedding-8B',
        items: [
          {
            topic_id: 'topic-2',
            semantic_similarity: 0.76,
            profile_similarity: 0.7,
            recommendation_score: 0.74,
            confidence: 'medium',
            reasons: ['关键词接近'],
            next_action: '打开这一桌',
          },
        ],
      },
    } as any)
    mockedSimulateTopicLink.mockResolvedValue({
      data: {
        provider_status: 'ready',
        model: 'MiniMax-M2.5',
        summary: '先看几条真实回应。',
        turns: [{ speaker: '我这边', role: '补充资料', message: '先看看大家已经说了什么。' }],
        suggested_action: '看完再接一句。',
      },
    } as any)
  })

  it('loads recommendations for the selected topic without touching the search scorer', async () => {
    render(<Harness selectedTopic={topic()} candidateTopics={[topic()]} />)

    await waitFor(() => {
      expect(screen.getByTestId('vector-status')).toHaveTextContent('ready')
    })

    expect(mockedGetRecommendations).toHaveBeenCalledWith({ topicId: 'topic-1', limit: 32 })
    expect(mockedScoreRecommendations).not.toHaveBeenCalled()
    expect(screen.getByTestId('recommendation-count')).toHaveTextContent('1')
  })

  it('uses the vector scorer for knowledge-search style queries', async () => {
    render(
      <Harness
        selectedTopic={null}
        candidateTopics={[topic({ id: 'topic-2', session_id: 'topic-2', title: 'AI-aided Kalman Filter 研究笔记' })]}
        skillQuery="Kalman"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('vector-status')).toHaveTextContent('ready')
    })

    expect(mockedScoreRecommendations).toHaveBeenCalledTimes(1)
    expect(mockedGetRecommendations).not.toHaveBeenCalled()
    expect(screen.getByTestId('recommendation-count')).toHaveTextContent('1')
  })

  it('falls back to a local preview before replacing it with the remote simulation', async () => {
    let resolveSimulation: (value: unknown) => void = () => {}
    mockedSimulateTopicLink.mockReturnValue(new Promise((resolve) => {
      resolveSimulation = resolve
    }) as any)
    render(<Harness selectedTopic={topic()} candidateTopics={[topic()]} />)

    await act(async () => {
      screen.getByRole('button', { name: 'simulate' }).click()
    })

    expect(screen.getByTestId('simulation-summary')).toHaveTextContent('先看大家已经聊到哪一步')

    await act(async () => {
      resolveSimulation({
        data: {
          provider_status: 'ready',
          model: 'MiniMax-M2.5',
          summary: '先看几条真实回应。',
          turns: [{ speaker: '我这边', role: '补充资料', message: '先看看大家已经说了什么。' }],
          suggested_action: '看完再接一句。',
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('simulation-summary')).toHaveTextContent('先看几条真实回应')
    })
  })
})
