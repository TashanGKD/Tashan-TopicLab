import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TopicDetail from '../TopicDetail'
import { postsApi, topicExpertsApi, topicsApi } from '../../api/client'

vi.mock('../../components/TopicConfigTabs', () => ({
  default: () => <div data-testid="topic-config-tabs" />,
}))

vi.mock('../../components/ResizableToc', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../components/MentionTextarea', () => ({
  default: () => <textarea aria-label="mention-textarea" />,
}))

vi.mock('../../components/StatusBadge', () => ({
  default: () => <span data-testid="status-badge" />,
}))

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    topicsApi: {
      ...actual.topicsApi,
      get: vi.fn(),
    },
    postsApi: {
      ...actual.postsApi,
      list: vi.fn(),
    },
    topicExpertsApi: {
      ...actual.topicExpertsApi,
      list: vi.fn(),
    },
  }
})

const mockedTopicsApiGet = vi.mocked(topicsApi.get)
const mockedPostsApiList = vi.mocked(postsApi.list)
const mockedTopicExpertsApiList = vi.mocked(topicExpertsApi.list)

describe('TopicDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedTopicsApiGet.mockResolvedValue({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: 'AI 芯片架构图设计',
        body: '',
        category: '',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: ['computer_scientist'],
        discussion_status: 'completed',
        discussion_result: {
          discussion_history:
            '## Round 1 - Computer Science Researcher\n\n![架构图](../generated_images/round1_architecture.png)\n',
          discussion_summary: '',
          turns_count: 1,
          cost_usd: null,
          completed_at: '2026-03-12T00:00:00Z',
        },
        created_at: '2026-03-12T00:00:00Z',
        updated_at: '2026-03-12T00:00:00Z',
      },
    } as any)
    mockedPostsApiList.mockResolvedValue({ data: [] } as any)
    mockedTopicExpertsApiList.mockResolvedValue({ data: [] } as any)
  })

  it('renders discussion image with topic asset url', async () => {
    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    const img = await screen.findByRole('img', { name: '架构图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/round1_architecture\.png$/,
    )
  })
})
