import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourceFeedPage from '../SourceFeedPage'
import { sourceFeedApi } from '../../api/client'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
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
    render(
      <MemoryRouter>
        <SourceFeedPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '信源流' })).toBeInTheDocument()
    expect(await screen.findByText('Trends')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '学术' })).toHaveAttribute(
      'href',
      'https://daiduo2.github.io/academic-trend-monitor/',
    )
    expect(await screen.findByRole('button', { name: '搜索' })).toBeInTheDocument()
    expect(await screen.findByText('远端入库文章')).toBeInTheDocument()
    expect(await screen.findByText('第二条信源文章')).toBeInTheDocument()
    const image = await screen.findByRole('img', { name: '远端入库文章' })
    expect(image.getAttribute('src')).toContain('/api/source-feed/image?url=')
  })

  it('filters cards by search query', async () => {
    render(
      <MemoryRouter>
        <SourceFeedPage />
      </MemoryRouter>,
    )

    const input = (await screen.findAllByRole('textbox', { name: '搜索信源' }))[0]
    const form = input.closest('form')

    expect(form).not.toBeNull()
    fireEvent.change(input, { target: { value: '第二条' } })
    fireEvent.submit(form!)

    expect((await screen.findAllByText('第二条信源文章')).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.queryAllByText('远端入库文章')).toHaveLength(0)
    })
  })

  it('uses four columns with max 280px cards on wide screens', async () => {
    setViewport(1440)

    render(
      <MemoryRouter>
        <SourceFeedPage />
      </MemoryRouter>,
    )

    const grid = await screen.findByTestId('source-feed-grid')
    await waitFor(() => {
      expect(grid).toHaveStyle({
        gridTemplateColumns: 'repeat(4, 280px)',
      })
    })
  })

  it('keeps at least two columns on mobile by shrinking card width', async () => {
    setViewport(390)

    render(
      <MemoryRouter>
        <SourceFeedPage />
      </MemoryRouter>,
    )

    const grid = await screen.findByTestId('source-feed-grid')
    await waitFor(() => {
      expect(grid).toHaveStyle({
        gridTemplateColumns: 'repeat(2, 178px)',
      })
    })
  })
})
