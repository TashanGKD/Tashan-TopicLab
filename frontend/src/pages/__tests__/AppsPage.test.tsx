import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { appsApi, skillHubApi } from '../../api/client'
import AppsPage from '../AppsPage'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    appsApi: {
      ...actual.appsApi,
      list: vi.fn(),
      like: vi.fn(),
      ensureTopic: vi.fn(),
    },
    skillHubApi: {
      ...actual.skillHubApi,
      listSkills: vi.fn(),
    },
  }
})

const mockedAppsList = vi.mocked(appsApi.list)
const mockedSkillHubList = vi.mocked(skillHubApi.listSkills)

describe('AppsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedAppsList.mockResolvedValue({
      data: {
        list: [
          {
            id: 'topiclab-cli',
            name: 'TopicLab CLI',
            summary: 'CLI runtime',
            description: 'A runtime app.',
            icon: 'spark',
            tags: ['cli'],
            builtin: true,
            links: { docs: 'https://example.com/docs', repo: 'https://example.com/repo' },
            interaction: { likes_count: 0, shares_count: 0, favorites_count: 0, liked: false, favorited: false },
          },
        ],
      },
    } as any)

    mockedSkillHubList.mockResolvedValue({
      data: {
        list: [
          {
            id: 1,
            slug: 'literature-map',
            name: 'Literature Map',
            summary: 'Build a paper graph',
            tagline: 'map papers fast',
            category_key: '07',
            category_name: '信息科学',
            cluster_key: 'literature',
            cluster_name: '文献检索',
            compatibility_level: 'install',
            openclaw_ready: true,
            tags: ['papers', 'graph'],
            capabilities: ['search'],
            avg_rating: 4.7,
            total_reviews: 8,
            total_downloads: 33,
            total_favorites: 4,
            weekly_downloads: 11,
            price_points: 0,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    } as any)
  })

  it('renders research skills directly on the apps page', async () => {
    render(
      <MemoryRouter initialEntries={['/apps']}>
        <Routes>
          <Route path="/apps" element={<AppsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '应用' })
    expect(await screen.findByText('Literature Map')).toBeInTheDocument()
    expect(screen.getByText('全站应用 2 · 独立应用 1 · 科研专区 1')).toBeInTheDocument()
    expect(screen.getByText('TopicLab CLI')).toBeInTheDocument()

    await waitFor(() => expect(mockedAppsList).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockedSkillHubList).toHaveBeenCalled())
  })
})
