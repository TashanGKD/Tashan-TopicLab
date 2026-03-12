import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TopicList from '../TopicList'
import { topicsApi } from '../../api/client'

vi.mock('../../components/StatusBadge', () => ({
  default: () => <span data-testid="status-badge" />,
}))

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    topicsApi: {
      ...actual.topicsApi,
      list: vi.fn(),
    },
  }
})

const mockedTopicsApiList = vi.mocked(topicsApi.list)

describe('TopicList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTopicsApiList.mockResolvedValue({
      data: [
        {
          id: 'topic-1',
          session_id: 'topic-1',
          title: '带图片的话题',
          body: '正文中没有图片',
          status: 'open',
          discussion_status: 'completed',
          preview_image: '../generated_images/list_preview.png',
          created_at: '2026-03-12T00:00:00Z',
          updated_at: '2026-03-12T00:00:00Z',
        },
      ],
    } as any)
  })

  it('renders one topic preview image when topic contains image markdown', async () => {
    render(
      <MemoryRouter>
        <TopicList />
      </MemoryRouter>,
    )

    const image = await screen.findByRole('img', { name: '带图片的话题 预览图' })
    expect(image.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/list_preview\.png\?w=192&h=192&q=72&fm=webp$/,
    )
  })
})
