import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { skillHubApi } from '../../api/client'
import AppsSkillLibraryPage from '../AppsSkillLibraryPage'
import AppsSkillProfilePage from '../AppsSkillProfilePage'
import LibraryPage from '../LibraryPage'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    skillHubApi: {
      ...actual.skillHubApi,
      listSkills: vi.fn(),
      listCategories: vi.fn(),
      listLeaderboard: vi.fn(),
      getProfile: vi.fn(),
    },
  }
})

vi.mock('../SkillLibrary', () => ({
  SkillLibraryContent: () => <div>旧 Resonnet Skill Library</div>,
}))

const mockedListSkills = vi.mocked(skillHubApi.listSkills)
const mockedListCategories = vi.mocked(skillHubApi.listCategories)
const mockedListLeaderboard = vi.mocked(skillHubApi.listLeaderboard)
const mockedGetProfile = vi.mocked(skillHubApi.getProfile)

function renderSkillHubHome() {
  return render(
    <MemoryRouter initialEntries={['/apps/skills']}>
      <Routes>
        <Route path="/apps/skills" element={<AppsSkillLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SkillHub pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    mockedListSkills
      .mockResolvedValueOnce({
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
          limit: 12,
          offset: 0,
        },
      } as any)

    mockedListCategories.mockResolvedValue({
      data: {
        disciplines: [{ key: '07', name: '信息科学', description: 'Info' }],
        clusters: [{ key: 'literature', title: '文献检索', summary: 'Find papers' }],
      },
    } as any)

    mockedListLeaderboard.mockResolvedValue({
      data: {
        users: [{ id: 9, display_name: 'Alice', balance: 42, total_skills: 2, total_reviews: 3, total_downloads: 12 }],
        skills: [],
        weekly: [],
      },
    } as any)
  })

  it('renders the new SkillHub home with real API data', async () => {
    renderSkillHubHome()

    expect(await screen.findByText('面向科研场景的可安装技能目录：按学科筛选，支持搜索与热门 / 高分 / 最新排序；可查看详情与作者排行，并参与评测、许愿、发布与个人管理。')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '技能列表' })).toBeInTheDocument()
    expect((await screen.findAllByText('文献检索')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Literature Map')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('link', { name: '许愿墙' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '上传技能' })).toBeInTheDocument()
    await waitFor(() => expect(mockedListSkills).toHaveBeenCalledTimes(1))
  })

  it('shows a login prompt in profile when user is not authenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/skills/profile']}>
        <Routes>
          <Route path="/apps/skills/profile" element={<AppsSkillProfilePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '登录后再进入绑定中心' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去登录' })).toBeInTheDocument()
    expect(mockedGetProfile).not.toHaveBeenCalled()
  })

  it('keeps the legacy Resonnet skill library under /library/skills', async () => {
    render(
      <MemoryRouter initialEntries={['/library/skills']}>
        <Routes>
          <Route path="/library/:section" element={<LibraryPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('保留 Resonnet 原有的讨论技能库，供 AI 话题讨论与主持流程使用。')).toBeInTheDocument()
    expect(screen.getByText('旧 Resonnet Skill Library')).toBeInTheDocument()
  })
})
