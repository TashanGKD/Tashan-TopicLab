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
            source_feed_name: '信息采集库',
            source_type: 'we-mp-rss',
            url: 'https://example.com/article',
            pic_url: 'https://mmbiz.qpic.cn/example.jpg',
            description: '用于验证独立信源页面渲染。',
            publish_time: '2026-03-12 16:25:00',
            created_at: '2026-03-12T10:09:13.216155',
          },
          {
            id: 259,
            title: '第二条信源文章',
            source_feed_name: '极客公园',
            source_type: 'we-mp-rss',
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

    await waitFor(() => {
      expect(mockedSourceFeedApiList).toHaveBeenCalledWith(
        expect.objectContaining({ source_type: 'we-mp-rss' }),
      )
    })
    expect(
      await screen.findByRole('heading', { name: '信息' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Trends')).toBeInTheDocument()
    expect(
      await screen.findByText('这里先承接需要浏览和筛选的信息。现阶段包括媒体与学术两类内容，后续招聘、机会和更多资源也会逐步并入这一入口。'),
    ).toBeInTheDocument()
    const academicLinks = await screen.findAllByRole('link', { name: '学术' })
    expect(
      academicLinks.some(
        (el) =>
          el.getAttribute('href') ===
          'https://daiduo2.github.io/academic-trend-monitor/',
      ),
    ).toBe(true)
    expect(
      academicLinks.some((el) =>
        el.getAttribute('href')?.endsWith('/info/academic'),
      ),
    ).toBe(true)
    expect(
      screen.getByRole('link', { name: '媒体' }).getAttribute('href'),
    ).toContain('/info/source')
    expect(
      await screen.findByRole('button', { name: '搜索' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('远端入库文章')).toBeInTheDocument()
    expect(await screen.findByText('第二条信源文章')).toBeInTheDocument()
    expect(
      await screen.findAllByRole('button', { name: '回复到话题' }),
    ).not.toHaveLength(0)
    const image = await screen.findByRole('img', { name: '远端入库文章' })
    expect(image.getAttribute('src')).toContain('/api/source-feed/image?url=')
  })

  it('filters cards by search query', async () => {
    renderSourceFeed()

    const input = (await screen.findAllByRole('textbox', { name: '搜索' }))[0]
    const form = input.closest('form')

    expect(form).not.toBeNull()
    fireEvent.change(input, { target: { value: '第二条' } })
    fireEvent.submit(form!)

    expect(
      (await screen.findAllByText('第二条信源文章')).length,
    ).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.queryAllByText('远端入库文章')).toHaveLength(0)
    })
  })

  it('uses four columns with max 280px cards on wide screens', async () => {
    setViewport(1440)
    renderSourceFeed()

    const grid = await screen.findByTestId('source-feed-grid')
    await waitFor(() => {
      expect(grid).toHaveStyle({
        gridTemplateColumns: 'repeat(4, 267px)',
      })
    })
  })

  it('keeps at least two columns on mobile by shrinking card width', async () => {
    setViewport(390)
    renderSourceFeed()

    const grid = await screen.findByTestId('source-feed-grid')
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
