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
      listCategories: vi.fn(),
    },
  }
})

const mockedAppsList = vi.mocked(appsApi.list)
const mockedSkillHubList = vi.mocked(skillHubApi.listSkills)
const mockedSkillHubCategories = vi.mocked(skillHubApi.listCategories)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AppsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedAppsList.mockResolvedValue({
      data: {
        list: [
          {
            id: 'prisma-literature-screening',
            name: 'PRISMA 文献筛选助手',
            summary: 'Screening workspace',
            description: 'A PRISMA app.',
            icon: 'prisma',
            tags: ['research'],
            links: { docs: 'https://example.com/prisma', repo: 'https://example.com/prisma-repo' },
            link_labels: { docs: '进入应用' },
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
          {
            id: 2,
            slug: 'lab-robot-playbook',
            name: 'Lab Robot Playbook',
            summary: 'Plan lab automation routines',
            tagline: 'automation workflows',
            category_key: '08',
            category_name: '工学',
            cluster_key: 'labos',
            cluster_name: '实验室自动化',
            compatibility_level: 'install',
            openclaw_ready: true,
            tags: ['lab', 'automation'],
            capabilities: ['automation'],
            avg_rating: 4.5,
            total_reviews: 3,
            total_downloads: 12,
            total_favorites: 2,
            weekly_downloads: 4,
            price_points: 0,
          },
        ],
        total: 2,
        limit: 100,
        offset: 0,
      },
    } as any)

    mockedSkillHubCategories.mockResolvedValue({
      data: {
        disciplines: [
          { key: '07', name: '信息科学', summary: 'Info' },
          { key: '08', name: '工学', summary: 'Engineering' },
        ],
        clusters: [
          { key: 'literature', title: '文献检索', summary: 'Find papers' },
          { key: 'labos', title: '实验室自动化', summary: 'Lab workflows' },
        ],
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
    expect((await screen.findAllByText('Literature Map')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('CLI Install').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PRISMA 文献筛选助手').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: '进入应用' }).length).toBeGreaterThan(0)
    expect(screen.getByText('一级学科')).toBeInTheDocument()
    expect(screen.getByText('研究领域（Cluster）')).toBeInTheDocument()
    expect(screen.getByText('集中收录可安装的科研 Skill：按一级学科与研究领域（Cluster）筛选，查看说明、售价与 CLI 安装命令，并参与评测、许愿与发布。')).toBeInTheDocument()
    expect(screen.getAllByText(/下载/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/收藏/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/评分/).length).toBeGreaterThan(0)

    await waitFor(() => expect(mockedAppsList).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockedSkillHubList).toHaveBeenCalled())
    await waitFor(() => expect(mockedSkillHubCategories).toHaveBeenCalledTimes(1))
  })

  it('renders app catalog before skill batches finish loading', async () => {
    const skillsDeferred = createDeferred<any>()
    mockedSkillHubList.mockReturnValue(skillsDeferred.promise)

    render(
      <MemoryRouter initialEntries={['/apps']}>
        <Routes>
          <Route path="/apps" element={<AppsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('PRISMA 文献筛选助手')).length).toBeGreaterThan(0)
    expect(screen.getByText('技能加载中…')).toBeInTheDocument()
    expect(mockedSkillHubList).toHaveBeenCalledWith({ sort: 'new', limit: 24, offset: 0 })
  })

})
