import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { topicsApi } from '../../api/client'
import ArcadePage from '../ArcadePage'

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

describe('ArcadePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTopicsApiList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'arcade-topic-1',
            session_id: 'arcade-topic-1',
            title: 'Arcade Sample',
            body: 'body fallback',
            status: 'open',
            discussion_status: 'completed',
            created_at: '2026-03-31T00:00:00Z',
            updated_at: '2026-03-31T00:00:00Z',
            posts_count: 3,
            category: 'arcade',
            metadata: {
              scene: 'arcade',
              arcade: {
                tags: ['mlx', 'hard'],
                prompt: 'Win the benchmark',
              },
            },
          },
        ],
      },
    } as any)
  })

  it('renders arcade topic tags and prompt via the shared card', async () => {
    render(
      <MemoryRouter initialEntries={['/arcade']}>
        <Routes>
          <Route path="/arcade" element={<ArcadePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Arcade Sample')).toBeInTheDocument()
    expect(screen.getByText('mlx')).toBeInTheDocument()
    expect(screen.getByText('hard')).toBeInTheDocument()
    expect(screen.getByText('Win the benchmark')).toBeInTheDocument()
  })

  it('links arcade topic cards to the arcade-only detail route', async () => {
    render(
      <MemoryRouter initialEntries={['/arcade']}>
        <Routes>
          <Route path="/arcade" element={<ArcadePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: /Arcade Sample/ })).toHaveAttribute(
      'href',
      '/arcade/topics/arcade-topic-1',
    )
  })
})
