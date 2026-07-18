import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourceFeedPage from '../SourceFeedPage'
import { sourceFeedApi } from '../../api/client'

function renderSourceFeed(initialEntry = '/info/source') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} initialIndex={0}>
      <Routes>
        <Route path="/info/:section" element={<SourceFeedPage />} />
        <Route path="/source-feed/:section" element={<SourceFeedPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

vi.mock('../../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    sourceFeedApi: {
      ...actual.sourceFeedApi,
      list: vi.fn(),
    },
  }
})

const mockedSourceFeedApiList = vi.mocked(sourceFeedApi.list)
describe('SourceFeedPage', () => {
  const setViewport = (width: number) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: width,
    })
    window.dispatchEvent(new Event('resize'))
  }

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    setViewport(1280)
    mockedSourceFeedApiList.mockResolvedValue({
      data: {
        list: [
          {
            id: 258,
            title: '远端入库文章',
            source_feed_name: 'arXiv cs.AI',
            source_type: 'gqy',
            url: 'https://example.com/article',
            pic_url: 'https://mmbiz.qpic.cn/example.jpg',
            description: '用于验证独立信源页面渲染。',
            publish_time: '2026-03-12 16:25:00',
            created_at: '2026-03-12T10:09:13.216155',
          },
          {
            id: 259,
            title: '第二条信源文章',
            source_feed_name: 'arXiv cs.LG',
            source_type: 'gqy',
            url: 'https://example.com/article-2',
            pic_url: null,
            description: '用于验证信息流列表。',
            publish_time: '2026-03-12 17:25:00',
            created_at: '2026-03-12T11:09:13.216155',
          },
        ],
        limit: 12,
        offset: 0,
      },
    } as any)
  })

  it('renders the standalone source feed page', async () => {
    renderSourceFeed()

    const frame = await screen.findByTitle('世界脉络')
    expect(frame).toBeInTheDocument()
    expect(frame.getAttribute('src')).toBe('/worldweave/')
    expect(frame).toHaveClass('h-full', 'w-full')
    expect(frame).not.toHaveStyle({ transform: 'scale(0.85)' })
    expect(frame).toHaveAttribute('scrolling', 'auto')
    expect(screen.queryByText('Trends')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '世界脉络' })).not.toBeInTheDocument()
    expect(mockedSourceFeedApiList).not.toHaveBeenCalled()
  })

  it('keeps the WorldWeave iframe scrollable inside the viewport', async () => {
    renderSourceFeed()

    const frame = (await screen.findByTitle('世界脉络')) as HTMLIFrameElement
    const iframeDocument = document.implementation.createHTMLDocument('世界脉络')

    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => iframeDocument,
    })
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      get: () => ({ document: iframeDocument }),
    })

    fireEvent.load(frame)

    await waitFor(() => {
      expect(frame).toHaveClass('h-full', 'w-full')
      expect(frame).toHaveClass('touch-pan-y')
      expect(frame.parentElement).toHaveClass('overflow-auto', 'overscroll-contain')
      expect(frame).not.toHaveStyle({ transform: 'scale(0.85)' })
      expect(iframeDocument.documentElement.style.overflowY).toBe('')
      expect(iframeDocument.body.style.overflowY).toBe('')
    })
  })

  it('forwards mobile touch drags to the WorldWeave iframe document', async () => {
    renderSourceFeed()

    const frame = (await screen.findByTitle('世界脉络')) as HTMLIFrameElement
    const iframeDocument = document.implementation.createHTMLDocument('世界脉络')
    const frameWindow = {
      document: iframeDocument,
      scrollY: 0,
      scrollBy: vi.fn(({ top }: ScrollToOptions) => {
        frameWindow.scrollY += Number(top ?? 0)
      }),
    } as unknown as Window & typeof globalThis

    Object.defineProperty(iframeDocument, 'defaultView', {
      configurable: true,
      get: () => frameWindow,
    })
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => iframeDocument,
    })
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      get: () => frameWindow,
    })

    fireEvent.load(frame)

    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(touchStart, 'touches', {
      value: [{ clientY: 420 }],
    })
    iframeDocument.dispatchEvent(touchStart)

    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    Object.defineProperty(touchMove, 'touches', {
      value: [{ clientY: 300 }],
    })
    iframeDocument.dispatchEvent(touchMove)

    await waitFor(() => {
      expect(frameWindow.scrollBy).toHaveBeenCalledWith({
        top: 120,
        behavior: 'instant',
      })
      expect(touchMove.defaultPrevented).toBe(true)
    })
  })

  it('shows a readable WorldWeave outage state when the iframe fails to load', async () => {
    renderSourceFeed()

    fireEvent.error(await screen.findByTitle('世界脉络'))

    expect(await screen.findByText('世界脉络服务未连接')).toBeInTheDocument()
    expect(
      screen.getByText('请确认 WorldWeave 已在本机 3020 端口启动，并重新刷新页面。'),
    ).toBeInTheDocument()
    expect(screen.queryByTitle('世界脉络')).not.toBeInTheDocument()
  })

  it('keeps a native source list without exposing topic entry buttons', async () => {
    renderSourceFeed('/info/source-list')

    await waitFor(() => {
      expect(mockedSourceFeedApiList).toHaveBeenCalledWith(
        expect.objectContaining({ source_type: 'worldweave-signal' }),
      )
    })
    expect(await screen.findByText('远端入库文章')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '回复到话题' })).not.toBeInTheDocument()
  })

  it('keeps the original media source feed without exposing topic entry buttons', async () => {
    renderSourceFeed('/info/media')

    await waitFor(() => {
      expect(mockedSourceFeedApiList).toHaveBeenCalledWith(
        expect.objectContaining({ source_type: 'we-mp-rss' }),
      )
    })
    expect(await screen.findByText('远端入库文章')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '回复到话题' })).not.toBeInTheDocument()
  })

  it('filters cards by search query', async () => {
    mockedSourceFeedApiList.mockResolvedValue({
      data: {
        list: [
          {
            id: 501,
            title: 'Agentic BPM: A Manifesto',
            source_feed_name: 'arXiv cs.AI',
            source_type: 'gqy',
            url: 'https://arxiv.org/abs/2603.18916',
            pic_url: null,
            description: '第一条论文',
            publish_time: '2026-03-12 17:25:00',
            created_at: '2026-03-12T11:09:13.216155',
          },
          {
            id: 502,
            title: '第二条论文',
            source_feed_name: 'arXiv cs.LG',
            source_type: 'gqy',
            url: 'https://arxiv.org/abs/2603.18917',
            pic_url: null,
            description: '用于验证搜索。',
            publish_time: '2026-03-12 18:25:00',
            created_at: '2026-03-12T12:09:13.216155',
          },
        ],
        limit: 12,
        offset: 0,
      },
    } as any)
    renderSourceFeed('/info/academic')

    const input = (await screen.findAllByRole('textbox', { name: '搜索' }))[0]
    const form = input.closest('form')

    expect(form).not.toBeNull()
    fireEvent.change(input, { target: { value: '第二条' } })
    fireEvent.submit(form!)

    expect(
      (await screen.findAllByText('第二条论文')).length,
    ).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.queryAllByText('Agentic BPM: A Manifesto')).toHaveLength(0)
    })
  })

  it('uses four columns with max 280px cards on wide screens', async () => {
    setViewport(1440)
    renderSourceFeed('/info/academic')

    const grid = await screen.findByTestId('academic-feed-grid')
    await waitFor(() => {
      expect(grid).toHaveStyle({
        gridTemplateColumns: 'repeat(4, 267px)',
      })
    })
  })

  it('keeps at least two columns on mobile by shrinking card width', async () => {
    setViewport(390)
    renderSourceFeed('/info/academic')

    const grid = await screen.findByTestId('academic-feed-grid')
    await waitFor(() => {
      expect(grid).toHaveStyle({
        gridTemplateColumns: 'repeat(2, 174px)',
      })
    })
  })

  it('academic tab scans gqy until it finds arXiv partition rows (IC ignores source_feed_name)', async () => {
    const blogRow = (id: number) => ({
      id,
      title: `Blog ${id}`,
      source_feed_name: 'Eugene Yan Blog',
      source_type: 'gqy',
      url: 'https://eugeneyan.com/writing/x',
      pic_url: null,
      description: '',
      publish_time: '2026-03-12 16:25:00',
      created_at: '2026-03-12T10:09:13.216155',
    })
    mockedSourceFeedApiList.mockImplementation(async (params) => {
      const off = params?.offset ?? 0
      if (off === 0) {
        return {
          data: {
            list: Array.from({ length: 12 }, (_, i) => blogRow(200 + i)),
            limit: 12,
            offset: 0,
          },
        } as any
      }
      if (off === 12) {
        return {
          data: {
            list: [
              {
                id: 501,
                title: 'Agentic BPM: A Manifesto',
                source_feed_name: 'arXiv cs.AI',
                source_type: 'gqy',
                url: 'https://arxiv.org/abs/2603.18916',
                pic_url: null,
                description: '',
                publish_time: '2026-03-12 17:25:00',
                created_at: '2026-03-12T11:09:13.216155',
              },
              ...Array.from({ length: 11 }, (_, i) => blogRow(300 + i)),
            ],
            limit: 12,
            offset: 12,
          },
        } as any
      }
      return { data: { list: [], limit: 12, offset: off } } as any
    })

    renderSourceFeed('/info/academic')

    await waitFor(() => {
      expect(mockedSourceFeedApiList).toHaveBeenCalledTimes(3)
    })
    expect(mockedSourceFeedApiList).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ source_type: 'gqy', offset: 0 }),
    )
    expect(mockedSourceFeedApiList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ source_type: 'gqy', offset: 12 }),
    )
    expect(mockedSourceFeedApiList).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ source_type: 'gqy', offset: 24 }),
    )
    expect(screen.queryByText('Blog 200')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Agentic BPM: A Manifesto'),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('academic-feed-grid')).toBeInTheDocument()
  })

  it('academic tab shows empty when gqy has no arXiv partition rows in first upstream page', async () => {
    mockedSourceFeedApiList.mockResolvedValue({
      data: {
        list: [
          {
            id: 1,
            title: 'Only blog',
            source_feed_name: 'Eugene Yan Blog',
            source_type: 'gqy',
            url: 'https://eugeneyan.com/x',
            pic_url: null,
            description: '',
            publish_time: '2026-03-12 16:25:00',
            created_at: '2026-03-12T10:09:13.216155',
          },
        ],
        limit: 12,
        offset: 0,
      },
    } as any)

    renderSourceFeed('/info/academic')

    await waitFor(() => {
      expect(mockedSourceFeedApiList).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(/暂无论文/)).toBeInTheDocument()
  })
})
