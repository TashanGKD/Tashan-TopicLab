import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TopicList from '../TopicList'
import { topicsApi } from '../../api/client'

vi.mock('../../components/OpenClawSkillCard', () => ({
  default: () => <section data-testid="openclaw-skill-card" />,
}))

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    topicsApi: {
      ...actual.topicsApi,
      list: vi.fn(),
      delete: vi.fn(),
    },
  }
})

const mockedTopicsApiList = vi.mocked(topicsApi.list)
const mockedTopicsApiDelete = vi.mocked(topicsApi.delete)

describe('TopicList', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    HTMLElement.prototype.scrollIntoView = vi.fn()
    class MockIntersectionObserver {
      root = null
      rootMargin = ''
      thresholds: number[] = []
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
    }
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
    mockedTopicsApiList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'research',
            title: '带图片的话题',
            body: '正文中没有图片',
            status: 'open',
            discussion_status: 'completed',
            preview_image: '../generated_images/list_preview.png',
            source_feed_name: 'Nature',
            creator_name: 'openclaw-user',
            creator_auth_type: 'openclaw_key',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)
  })

  it('renders one topic preview image when topic contains image markdown', async () => {
    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    const image = await screen.findByRole('img', { name: '带图片的话题 预览图' })
    expect(screen.getByTestId('openclaw-skill-card')).toBeInTheDocument()
    expect(screen.getByText('板块：科研')).toBeInTheDocument()
    expect(screen.getByText('信源：Nature')).toBeInTheDocument()
    expect(screen.getByText('发起人：openclaw-user · OpenClaw')).toBeInTheDocument()
    expect(screen.getByText('AI 话题讨论')).toBeInTheDocument()
    expect(screen.queryByTestId('status-badge')).not.toBeInTheDocument()
    expect(image.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/list_preview\.png\?w=128&h=128&q=72&fm=webp$/,
    )
  })

  it('filters topics by selected category', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'thought',
            title: '思考话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'research',
            title: '科研话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.click((await screen.findAllByRole('button', { name: '思考' }))[0])

    await waitFor(() => {
      expect(mockedTopicsApiList).toHaveBeenCalledTimes(1)
    })
    expect(mockedTopicsApiList).toHaveBeenLastCalledWith({ q: undefined, limit: 20 })
    expect(screen.getByTestId('topic-category-thought')).toHaveAttribute('data-active', 'true')
  })

  it('shows only the adjacent preview columns around the active category', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'plaza',
            title: '广场话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'thought',
            title: '思考话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-3',
            session_id: 'topic-3',
            category: 'research',
            title: '科研话题',
            body: 'C',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-4',
            session_id: 'topic-4',
            category: 'product',
            title: '产品话题',
            body: 'D',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.click((await screen.findAllByRole('button', { name: '科研' }))[0])

    await waitFor(() => {
      expect(screen.getByTestId('topic-category-thought')).toBeInTheDocument()
      expect(screen.getByTestId('topic-category-research')).toHaveAttribute('data-active', 'true')
      expect(screen.getByTestId('topic-category-product')).toBeInTheDocument()
      expect(screen.queryByTestId('topic-category-plaza')).not.toBeInTheDocument()
    })
  })

  it('searches topics from the right-aligned search input', async () => {
    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByRole('searchbox', { name: '搜索话题' }), {
      target: { value: '多智能体' },
    })

    await waitFor(() => {
      expect(mockedTopicsApiList).toHaveBeenLastCalledWith({ q: '多智能体', limit: 20 })
    })
  })

  it('keeps expanded cards visible after loading the next page', async () => {
    const firstPageItems = Array.from({ length: 20 }, (_, index) => ({
      id: `topic-${index + 1}`,
      session_id: `topic-${index + 1}`,
      category: 'research',
      title: `科研话题 ${index + 1}`,
      body: `B${index + 1}`,
      status: 'open',
      discussion_status: 'pending',
      created_at: '2026-03-12T00:00:00Z',
      updated_at: '2026-03-12T00:00:00Z',
    }))
    const secondPageItems = Array.from({ length: 20 }, (_, index) => ({
      id: `topic-${index + 21}`,
      session_id: `topic-${index + 21}`,
      category: 'research',
      title: `科研话题 ${index + 21}`,
      body: `B${index + 21}`,
      status: 'open',
      discussion_status: 'pending',
      created_at: '2026-03-12T00:00:00Z',
      updated_at: '2026-03-12T00:00:00Z',
    }))

    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: firstPageItems,
        next_cursor: 'cursor-1',
      },
    } as any)
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: secondPageItems,
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '继续显示更多卡片' }))
    expect(await screen.findByText('科研话题 20')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))

    await waitFor(() => {
      expect(mockedTopicsApiList).toHaveBeenNthCalledWith(2, { q: undefined, cursor: 'cursor-1', limit: 20 })
      expect(screen.getByText('科研话题 20')).toBeInTheDocument()
    })
  })

  it('shows delete action in admin mode and deletes topic', async () => {
    mockedTopicsApiDelete.mockResolvedValue({ data: { ok: true, topic_id: 'topic-1' } } as any)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    localStorage.setItem('auth_token', 'jwt-token')
    localStorage.setItem('auth_user', JSON.stringify({
      id: 1,
      phone: '13800000001',
      username: 'admin',
      is_admin: true,
      created_at: '2026-03-12T00:00:00Z',
    }))

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '删除话题' }))

    await waitFor(() => {
      expect(mockedTopicsApiDelete).toHaveBeenCalledWith('topic-1')
    })
  })

  it('keeps latest order inside each category column', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'research',
            title: '科研话题 A',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            source_feed_name: 'Nature',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'research',
            title: '科研话题 B',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            source_feed_name: 'Nature',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-4',
            session_id: 'topic-4',
            category: 'research',
            title: '科研话题 C',
            body: 'C',
            status: 'open',
            discussion_status: 'pending',
            source_feed_name: '站内创建',
            created_at: '2026-03-11T00:00:00Z',
            updated_at: '2026-03-11T00:00:00Z',
          },
          {
            id: 'topic-3',
            session_id: 'topic-3',
            category: 'product',
            title: '产品话题',
            body: 'D',
            status: 'open',
            discussion_status: 'pending',
            source_feed_name: 'TechCrunch',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    const centerSlot = await screen.findByTestId('topic-category-slot-center')
    expect(within(centerSlot).getByRole('heading', { name: '科研' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: '产品' }).length).toBeGreaterThan(0)
    expect(screen.getByText('科研话题 A')).toBeInTheDocument()
    expect(screen.getByText('科研话题 B')).toBeInTheDocument()
    expect(screen.getByText('科研话题 C')).toBeInTheDocument()
    expect(screen.getAllByText('产品话题').length).toBeGreaterThan(0)

    const researchSection = within(centerSlot).getByTestId('topic-category-research')
    const researchCards = Array.from(researchSection.querySelectorAll('h3')).map((node) => node.textContent)
    expect(researchCards).toEqual(['科研话题 A', '科研话题 B', '科研话题 C'])
  })

  it('defaults the center slot to the category with the highest topic count', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'research',
            title: '科研话题 A',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'research',
            title: '科研话题 B',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-3',
            session_id: 'topic-3',
            category: 'research',
            title: '科研话题 C',
            body: 'C',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-4',
            session_id: 'topic-4',
            category: 'product',
            title: '产品话题',
            body: 'D',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    const centerSlot = await screen.findByTestId('topic-category-slot-center')
    expect(within(centerSlot).getByTestId('topic-category-research')).toHaveAttribute('data-active', 'true')
    expect(screen.getAllByTestId('topic-category-product').length).toBeGreaterThan(0)
  })

  it('keeps the tab strip order fixed after switching categories', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'plaza',
            title: '广场话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'thought',
            title: '思考话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-3',
            session_id: 'topic-3',
            category: 'research',
            title: '科研话题',
            body: 'C',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-4',
            session_id: 'topic-4',
            category: 'product',
            title: '产品话题',
            body: 'D',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-5',
            session_id: 'topic-5',
            category: 'app',
            title: '应用话题',
            body: 'E',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-6',
            session_id: 'topic-6',
            category: 'news',
            title: '资讯话题',
            body: 'F',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.click((await screen.findAllByRole('button', { name: '资讯' }))[0])

    await waitFor(() => {
      const tabButtons = screen.getAllByRole('button').filter((button) =>
        ['广场', '思考', '科研', '产品', '应用', '资讯'].includes(button.textContent ?? ''),
      )
      const labels = tabButtons.map((button) => button.textContent)
      expect(labels).toEqual(['广场', '思考', '科研', '产品', '应用', '资讯'])
    })
  })

  it('widens the active category tab after selection', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'thought',
            title: '思考话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'research',
            title: '科研话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    const thoughtTab = (await screen.findAllByRole('button', { name: '思考' }))[0]
    fireEvent.click(thoughtTab)

    await waitFor(() => {
      expect(thoughtTab.className).toContain('px-6')
      expect(thoughtTab.className).toContain('font-medium')
    })
  })

  it('renders the underline inside the active tab label', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'plaza',
            title: '广场话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'thought',
            title: '思考话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    const thoughtTab = (await screen.findAllByRole('button', { name: '思考' }))[0]

    fireEvent.click(thoughtTab)

    await waitFor(() => {
      const underline = screen.getByTestId('topic-category-tab-underline')
      expect(thoughtTab).toContainElement(underline)
      expect(underline).toHaveStyle({ width: 'calc(100% + 1.75rem)' })
    })
  })

  it('adds directional animation when switching categories', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'plaza',
            title: '广场话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'thought',
            title: '思考话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    fireEvent.click((await screen.findAllByRole('button', { name: '思考' }))[0])

    await waitFor(() => {
      expect(screen.getByTestId('topic-category-slot-left-inner').className).toContain('animate-stage-enter-right')
      expect(screen.getByTestId('topic-category-slot-center-inner').className).toContain('animate-stage-enter-right')
      expect(screen.getByTestId('topic-category-slot-right-inner').className).toContain('animate-stage-enter-right')
    })
  })

  it('wraps the preview columns when the active category is at either edge', async () => {
    mockedTopicsApiList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'topic-1',
            session_id: 'topic-1',
            category: 'plaza',
            title: '广场话题',
            body: 'A',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-2',
            session_id: 'topic-2',
            category: 'thought',
            title: '思考话题',
            body: 'B',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'topic-3',
            session_id: 'topic-3',
            category: 'research',
            title: '科研话题',
            body: 'C',
            status: 'open',
            discussion_status: 'pending',
            created_at: '2026-03-12T00:00:00Z',
            updated_at: '2026-03-12T00:00:00Z',
          },
        ],
        next_cursor: null,
      },
    } as any)

    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    await screen.findByText('广场话题')

    expect(screen.getByTestId('topic-category-slot-left').childElementCount).toBe(1)
    expect(screen.getByTestId('topic-category-slot-center').querySelector('[data-active="true"]')).toBeTruthy()
    expect(screen.getByTestId('topic-category-slot-right').childElementCount).toBe(1)
    expect(screen.getByTestId('topic-category-research')).toBeInTheDocument()
    expect(screen.getByTestId('topic-category-thought')).toBeInTheDocument()

    fireEvent.click((await screen.findAllByRole('button', { name: '科研' }))[0])

    await waitFor(() => {
      expect(screen.getByTestId('topic-category-slot-left').childElementCount).toBe(1)
      expect(screen.getByTestId('topic-category-slot-center').querySelector('[data-active="true"]')).toBeTruthy()
      expect(screen.getByTestId('topic-category-slot-right').childElementCount).toBe(1)
      expect(screen.getByTestId('topic-category-thought')).toBeInTheDocument()
      expect(screen.getByTestId('topic-category-plaza')).toBeInTheDocument()
    })
  })
})
