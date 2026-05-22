import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { postsApi, sourceFeedApi, topicExpertsApi, topicsApi } from '../../api/client'
import TopicLinkDetailPage from '../TopicLinkDetailPage'

vi.mock('../../components/MentionTextarea', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="topiclink-composer"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('../../components/TopicConfigTabs', () => ({
  default: () => <div data-testid="topic-config-tabs" />,
}))

vi.mock('../../api/auth', async () => {
  const user = {
    id: 1,
    phone: 'test',
    username: 'liyuyang',
    created_at: '2026-05-21T00:00:00Z',
  }
  return {
    tokenManager: {
      get: vi.fn(() => 'token'),
      set: vi.fn(),
      remove: vi.fn(),
      getUser: vi.fn(() => user),
      setUser: vi.fn(),
      clearUser: vi.fn(),
    },
    refreshCurrentUserProfile: vi.fn(async () => user),
  }
})

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    topicsApi: {
      ...actual.topicsApi,
      get: vi.fn(),
      scoreTopicLinkRecommendations: vi.fn(),
      getTopicLinkPosts: vi.fn(),
      getTopicLinkPresence: vi.fn(),
      setTopicLinkPresence: vi.fn(),
      simulateTopicLink: vi.fn(),
      like: vi.fn(),
      favorite: vi.fn(),
      share: vi.fn(),
    },
    postsApi: {
      ...actual.postsApi,
      create: vi.fn(),
      list: vi.fn(),
      getThread: vi.fn(),
      getReplyStatus: vi.fn(),
      listReplies: vi.fn(),
      like: vi.fn(),
      share: vi.fn(),
      delete: vi.fn(),
      mention: vi.fn(),
    },
    topicExpertsApi: {
      ...actual.topicExpertsApi,
      list: vi.fn(),
    },
    sourceFeedApi: {
      ...actual.sourceFeedApi,
      detail: vi.fn(),
    },
  }
})

const mockedTopicGet = vi.mocked(topicsApi.get)
const mockedTopicLinkPosts = vi.mocked(topicsApi.getTopicLinkPosts)
const mockedPresence = vi.mocked(topicsApi.getTopicLinkPresence)
const mockedSetPresence = vi.mocked(topicsApi.setTopicLinkPresence)
const mockedSimulate = vi.mocked(topicsApi.simulateTopicLink)
const mockedPostsCreate = vi.mocked(postsApi.create)
const mockedTopicExperts = vi.mocked(topicExpertsApi.list)
const mockedSourceDetail = vi.mocked(sourceFeedApi.detail)

const topic = {
  id: 'topic-1',
  session_id: 'topic-1',
  title: '“龙虾军团” 裸奔进生产环境，您睡得着吗？',
  body: '背景：企业在探索 AI 数字员工应用时，普通面临开源方案带来的架构脆弱、安全风险。',
  category: 'research',
  status: 'open',
  mode: 'discussion',
  num_rounds: 5,
  expert_names: ['computer_scientist'],
  discussion_status: 'completed',
  discussion_result: null,
  created_at: '2026-03-15T17:13:00Z',
  updated_at: '2026-03-15T17:13:00Z',
  posts_count: 2,
  interaction: { likes_count: 8, favorites_count: 4, shares_count: 1, liked: false, favorited: false },
  metadata: {
    topic_link: {
      table_state: 'active',
      participants: [
        { name: '发起人', role: '有人一起想想', status: 'starter' },
        { name: '我这边', role: '整理资料与共识', status: 'reading' },
      ],
      wanted: [{ title: '有人一起想想', description: '先看几条真实回应' }],
    },
  },
}

const post = {
  id: 'post-1',
  topic_id: 'topic-1',
  author: "来访者 cfa5's openclaw",
  author_type: 'human',
  delete_token: null,
  owner_user_id: null,
  owner_auth_type: null,
  expert_name: null,
  expert_label: null,
  body: '这个问题不是技术问题，是产品哲学问题。',
  mentions: [],
  in_reply_to_id: null,
  root_post_id: 'post-1',
  depth: 0,
  reply_count: 0,
  status: 'completed',
  created_at: '2026-04-25T07:27:00Z',
  interaction: { likes_count: 0, shares_count: 0, liked: false },
}

describe('TopicLinkDetailPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
    HTMLElement.prototype.scrollIntoView = vi.fn()
    mockedTopicGet.mockResolvedValue({ data: topic } as any)
    mockedTopicLinkPosts.mockResolvedValue({ data: { items: [post], next_cursor: null } } as any)
    mockedPresence.mockResolvedValue({
      data: {
        topic_id: 'topic-1',
        persona_name: '先看看',
        resident: false,
        status: 'reading',
      },
    } as any)
    mockedSetPresence.mockResolvedValue({
      data: {
        topic_id: 'topic-1',
        persona_name: '先看看',
        resident: true,
        status: 'reading',
      },
    } as any)
    mockedSimulate.mockResolvedValue({
      data: {
        provider_status: 'ready',
        model: 'MiniMax-M2.5',
        summary: '先看几条真实回应。',
        turns: [{ speaker: '我这边', role: '整理资料', message: '先看大家说到哪里。' }],
        suggested_action: '看完再接一句。',
      },
    } as any)
    mockedPostsCreate.mockResolvedValue({
      data: {
        post: {
          ...post,
          id: 'post-new',
          author: 'liyuyang',
          owner_user_id: 1,
          body: '我先补一条资料。',
        },
      },
    } as any)
    mockedTopicExperts.mockResolvedValue({ data: [] } as any)
    mockedSourceDetail.mockRejectedValue(new Error('no source'))
  })

  function renderPage(initialEntry = '/topiclink/topic-1?debug_user=liyuyang') {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/topiclink/:id" element={<TopicLinkDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('loads TopicLink posts and keeps the original topic settings hidden', async () => {
    renderPage()

    expect(await screen.findByText('“龙虾军团” 裸奔进生产环境，您睡得着吗？')).toBeInTheDocument()
    expect(await screen.findByText('大家怎么说')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-config-tabs')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockedTopicLinkPosts).toHaveBeenCalledWith('topic-1', { limit: 100 })
    })
  })

  it('turns the first preview click into resident presence on the second click', async () => {
    renderPage()

    const previewButton = await screen.findByRole('button', { name: '先替我看看' })
    fireEvent.click(previewButton)

    await waitFor(() => {
      expect(mockedSimulate).toHaveBeenCalledWith('topic-1', expect.objectContaining({ persona_name: '我这边' }))
    })
    expect(await screen.findByText('先看大家说到哪里。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '留在群里' }))

    await waitFor(() => {
      expect(mockedSetPresence).toHaveBeenCalledWith('topic-1', { persona_name: '我这边' })
    })
  })

  it('posts as the debug user through the TopicLink composer', async () => {
    renderPage()

    const composer = await screen.findByLabelText('topiclink-composer')
    fireEvent.change(composer, { target: { value: '我先补一条资料。' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(mockedPostsCreate).toHaveBeenCalledWith('topic-1', {
        author: 'liyuyang',
        body: '我先补一条资料。',
        in_reply_to_id: null,
      })
    })
  })
})
