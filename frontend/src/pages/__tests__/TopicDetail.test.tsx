import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AxiosError } from 'axios'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TopicDetail from '../TopicDetail'
import { postsApi, sourceFeedApi, topicExpertsApi, topicsApi } from '../../api/client'

vi.mock('../../components/TopicConfigTabs', () => ({
  default: ({ linkedSourceArticle, viewportWidth }: any) => {
    const showSideBySide = !!linkedSourceArticle && (viewportWidth ?? 0) >= 1200
    const showHorizontal = !!linkedSourceArticle && (viewportWidth ?? 0) < 1200
    return (
      <div data-testid="topic-config-tabs">
        {showSideBySide && <div data-testid="source-article-vertical-card" />}
        {showHorizontal && <div data-testid="source-article-horizontal-card" />}
      </div>
    )
  },
}))

vi.mock('../../components/ResizableToc', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

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
      aria-label="mention-textarea"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
      create: vi.fn(),
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

const mockedTopicsApiGet = vi.mocked(topicsApi.get)
const mockedPostsApiList = vi.mocked(postsApi.list)
const mockedPostsApiCreate = vi.mocked(postsApi.create)
const mockedTopicExpertsApiList = vi.mocked(topicExpertsApi.list)
const mockedSourceFeedApiDetail = vi.mocked(sourceFeedApi.detail)

describe('TopicDetail', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
    class MockIntersectionObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as any)

    mockedTopicsApiGet.mockResolvedValue({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: 'AI 芯片架构图设计',
        body: '',
        category: 'research',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: ['computer_scientist'],
        discussion_status: 'completed',
        creator_name: 'openclaw-user',
        creator_auth_type: 'openclaw_key',
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
    mockedPostsApiList.mockResolvedValue({ data: { items: [], next_cursor: null } } as any)
    mockedPostsApiCreate.mockResolvedValue({ data: {} } as any)
    mockedTopicExpertsApiList.mockResolvedValue({ data: [] } as any)
    mockedSourceFeedApiDetail.mockResolvedValue({
      data: {
        id: 258,
        title: '远端入库文章',
        source_feed_name: '信息采集库',
        source_type: 'we-mp-rss',
        url: 'https://example.com/article',
        pic_url: 'https://mmbiz.qpic.cn/example.jpg',
        description: '用于验证话题详情中的信源预览卡片。',
        publish_time: '2026-03-12 16:25:00',
        created_at: '2026-03-12T10:09:13.216155',
        content_md: 'full content',
      },
    } as any)
  })

  it('renders discussion image with topic asset url', async () => {
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: 'AI 芯片架构图设计',
        body: '## 背景\n测试\n\n## 原文信息\n- article_id: 258\n- 原文链接：https://example.com/article',
        category: 'research',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: ['computer_scientist'],
        discussion_status: 'completed',
        creator_name: 'openclaw-user',
        creator_auth_type: 'openclaw_key',
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
    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    const img = await screen.findByRole('img', { name: '架构图' })
    expect(screen.getByText('板块 科研')).toBeInTheDocument()
    expect(screen.getByText('发起人 openclaw-user · OpenClaw')).toBeInTheDocument()
    expect(screen.getAllByText('AI 话题讨论')).toHaveLength(2)
    expect(screen.queryByTestId('status-badge')).not.toBeInTheDocument()
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/round1_architecture\.png\?q=82&fm=webp$/,
    )
  })

  it('shows the 2050 logo on the agenda discussion topic', async () => {
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'topic_2050_agenda_discussion',
        session_id: 'topic_2050_agenda_discussion',
        title: '2050 会议议程专题讨论帖',
        body: '',
        category: '2050',
        status: 'open',
        mode: 'discussion',
        num_rounds: 3,
        expert_names: [],
        discussion_status: 'pending',
        creator_name: 'system',
        creator_auth_type: 'openclaw_key',
        discussion_result: null,
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z',
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/topics/topic_2050_agenda_discussion']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('img', { name: '2050' })).toBeInTheDocument()
    expect(screen.getByTestId('topic-detail-2050-logo')).toBeInTheDocument()
    expect(screen.getByText('板块 2050')).toBeInTheDocument()
  })

  it('redirects non-arcade topics away from the arcade detail route', async () => {
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: '普通话题',
        body: '',
        category: 'research',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: [],
        discussion_status: 'pending',
        discussion_result: null,
        created_at: '2026-03-12T00:00:00Z',
        updated_at: '2026-03-12T00:00:00Z',
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/arcade/topics/topic-1']}>
        <Routes>
          <Route path="/" element={<div>Home Route</div>} />
          <Route path="/arcade/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Home Route')).toBeInTheDocument()
    expect(screen.queryByText('普通话题')).not.toBeInTheDocument()
  })

  it('allows arcade topics on the arcade detail route', async () => {
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'arcade-topic-1',
        session_id: 'arcade-topic-1',
        title: 'Arcade Sample',
        body: '',
        category: 'arcade',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: [],
        discussion_status: 'pending',
        discussion_result: null,
        metadata: { scene: 'arcade', arcade: { prompt: 'Win the benchmark' } },
        created_at: '2026-03-12T00:00:00Z',
        updated_at: '2026-03-12T00:00:00Z',
      },
    } as any)

    render(
      <MemoryRouter initialEntries={['/arcade/topics/arcade-topic-1']}>
        <Routes>
          <Route path="/arcade/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Arcade Sample')).toBeInTheDocument()
    expect(screen.getByText('Win the benchmark')).toBeInTheDocument()
  })

  it('shows side-by-side source preview card on wide screens', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
    window.dispatchEvent(new Event('resize'))
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: 'AI 芯片架构图设计',
        body: '## 背景\n测试\n\n## 原文信息\n- article_id: 258\n- 原文链接：https://example.com/article',
        category: 'research',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: ['computer_scientist'],
        discussion_status: 'completed',
        creator_name: 'openclaw-user',
        creator_auth_type: 'openclaw_key',
        discussion_result: { discussion_history: '', discussion_summary: '', turns_count: 0, cost_usd: null, completed_at: '2026-03-12T00:00:00Z' },
        created_at: '2026-03-12T00:00:00Z',
        updated_at: '2026-03-12T00:00:00Z',
      },
    } as any)
    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('source-article-vertical-card')).toBeInTheDocument()
  })

  it('shows horizontal source preview card on narrow screens', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 960 })
    window.dispatchEvent(new Event('resize'))
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: 'AI 芯片架构图设计',
        body: '## 背景\n测试\n\n## 原文信息\n- article_id: 258\n- 原文链接：https://example.com/article',
        category: 'research',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: ['computer_scientist'],
        discussion_status: 'completed',
        creator_name: 'openclaw-user',
        creator_auth_type: 'openclaw_key',
        discussion_result: { discussion_history: '', discussion_summary: '', turns_count: 0, cost_usd: null, completed_at: '2026-03-12T00:00:00Z' },
        created_at: '2026-03-12T00:00:00Z',
        updated_at: '2026-03-12T00:00:00Z',
      },
    } as any)
    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('source-article-horizontal-card')).toBeInTheDocument()
  })

  it('shows login prompt in fixed composer when user is not authenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('登录后即可发帖和回帖')).toBeInTheDocument()
    const loginLinks = screen.getAllByRole('link', { name: '登录后回帖' })
    expect(loginLinks[0]).toHaveAttribute('href', '/login')
  })

  it('hides mention guidance before AI discussion has finished', async () => {
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedTopicsApiGet.mockResolvedValueOnce({
      data: {
        id: 'topic-1',
        session_id: 'topic-1',
        title: 'AI 芯片架构图设计',
        body: '',
        category: 'research',
        status: 'open',
        mode: 'discussion',
        num_rounds: 5,
        expert_names: ['physicist'],
        discussion_status: 'pending',
        creator_name: 'openclaw-user',
        creator_auth_type: 'openclaw_key',
        discussion_result: null,
        created_at: '2026-03-12T00:00:00Z',
        updated_at: '2026-03-12T00:00:00Z',
      },
    } as any)
    mockedTopicExpertsApiList.mockResolvedValue({
      data: [
        {
          name: 'physicist',
          label: '物理学家',
          description: 'test',
          source: 'preset',
          role_file: 'agents/physicist/role.md',
          added_at: '2026-03-12T00:00:00Z',
        },
      ],
    } as any)

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('输入内容后即可发布跟贴；完成一次 AI 讨论后才开放 @追问角色。')).toBeInTheDocument()
    expect(screen.getByLabelText('mention-textarea')).toHaveAttribute(
      'placeholder',
      '在这里继续讨论… 先完成一次 AI 讨论后才能 @ 追问角色',
    )
  })

  it('prefills @mention when replying to an agent post', async () => {
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedPostsApiList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'post-1',
            topic_id: 'topic-1',
            author: 'agent_a',
            author_type: 'agent',
            expert_name: 'agent_a',
            expert_label: 'Agent A',
            body: '这是角色回复',
            mentions: [],
            in_reply_to_id: null,
            status: 'completed',
            created_at: '2026-03-12T01:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)
    mockedTopicExpertsApiList.mockResolvedValue({
      data: [
        {
          name: 'agent_a',
          label: 'Agent A',
          description: 'test',
          source: 'preset',
          role_file: 'agents/agent_a/role.md',
          added_at: '2026-03-12T00:00:00Z',
        },
      ],
    } as any)

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '回复 Agent A' }))
    expect(screen.getByLabelText('mention-textarea')).toHaveValue('@agent_a ')
  })

  it('renders inline reply composer on desktop instead of bottom-dock hint', async () => {
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedPostsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'post-1',
            topic_id: 'topic-1',
            author: 'agent_a',
            author_type: 'agent',
            expert_name: 'agent_a',
            expert_label: 'Agent A',
            body: '这是角色回复',
            mentions: [],
            in_reply_to_id: null,
            status: 'completed',
            created_at: '2026-03-12T01:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)
    mockedTopicExpertsApiList.mockResolvedValueOnce({
      data: [
        {
          name: 'agent_a',
          label: 'Agent A',
          description: 'test',
          source: 'preset',
          role_file: 'agents/agent_a/role.md',
          added_at: '2026-03-12T00:00:00Z',
        },
      ],
    } as any)

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '回复 Agent A' }))

    expect(screen.getByText('正在回复：Agent A')).toBeInTheDocument()
    expect(screen.queryByText('输入框已从底部弹出')).not.toBeInTheDocument()
  })

  it('keeps bottom-dock hint on narrow screens when replying', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 768 })
    window.dispatchEvent(new Event('resize'))
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedPostsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'post-1',
            topic_id: 'topic-1',
            author: 'agent_a',
            author_type: 'agent',
            expert_name: 'agent_a',
            expert_label: 'Agent A',
            body: '这是角色回复',
            mentions: [],
            in_reply_to_id: null,
            status: 'completed',
            created_at: '2026-03-12T01:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)
    mockedTopicExpertsApiList.mockResolvedValueOnce({
      data: [
        {
          name: 'agent_a',
          label: 'Agent A',
          description: 'test',
          source: 'preset',
          role_file: 'agents/agent_a/role.md',
          added_at: '2026-03-12T00:00:00Z',
        },
      ],
    } as any)

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '回复 Agent A' }))

    expect(screen.getByText('输入框已从底部弹出')).toBeInTheDocument()
    expect(screen.getByText('正在回复：Agent A')).toBeInTheDocument()
  })

  it('shows moderation rejection under the composer', async () => {
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedPostsApiCreate.mockRejectedValue(
      new AxiosError(
        'Request failed',
        '400',
        undefined,
        undefined,
        {
          data: {
            detail: {
              code: 'content_moderation_rejected',
              message: '内容审核未通过，请调整后再发布',
              review_message: '包含攻击性表达',
              suggestion: '请改为就事论事',
            },
          },
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: { headers: {} } as any,
        },
      ),
    )

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText('mention-textarea'), { target: { value: '你太蠢了' } })
    fireEvent.click(screen.getAllByRole('button', { name: '发送' }).find((button) => !button.hasAttribute('disabled'))!)

    expect(
      (await screen.findAllByText('内容审核未通过，请调整后再发布：包含攻击性表达；请改为就事论事')).length,
    ).toBeGreaterThan(0)
  })

  it('shows optimistic user reply body instead of pending spinner while request is in flight', async () => {
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedPostsApiCreate.mockImplementationOnce(
      () => new Promise(() => {}) as any,
    )

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText('mention-textarea'), { target: { value: '这是我的真实回复' } })
    fireEvent.click(screen.getAllByRole('button', { name: '发送' }).find((button) => !button.hasAttribute('disabled'))!)

    expect(screen.getByLabelText('mention-textarea')).toHaveValue('')
    expect((await screen.findAllByText('这是我的真实回复')).length).toBe(1)
    expect(screen.queryByText('思考中...')).not.toBeInTheDocument()
  })

  it('restores input text after send failure', async () => {
    localStorage.setItem('auth_token', 'token-1')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 7,
      phone: '13800138000',
      username: '测试用户',
      created_at: '2026-03-12T00:00:00Z',
    }))
    mockedPostsApiCreate.mockRejectedValueOnce(new Error('network failed'))

    render(
      <MemoryRouter initialEntries={['/topics/topic-1']}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByLabelText('mention-textarea'), { target: { value: '发送失败后应恢复' } })
    fireEvent.click(screen.getAllByRole('button', { name: '发送' }).find((button) => !button.hasAttribute('disabled'))!)

    expect(await screen.findByLabelText('mention-textarea')).toHaveValue('发送失败后应恢复')
  })
})
