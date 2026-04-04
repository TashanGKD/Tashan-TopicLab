import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { skillHubApi } from '../../api/client'
import AppsSkillLibraryPage from '../AppsSkillLibraryPage'
import AppsSkillDetailPage from '../AppsSkillDetailPage'
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
      getSkill: vi.fn(),
      getSkillContent: vi.fn(),
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
const mockedGetSkill = vi.mocked(skillHubApi.getSkill)
const mockedGetSkillContent = vi.mocked(skillHubApi.getSkillContent)

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

    mockedListSkills.mockResolvedValue({
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

    mockedGetSkill.mockResolvedValue({
      data: {
        id: 1,
        slug: 'literature-map',
        name: 'Literature Map',
        summary: 'Build a paper graph',
        tagline: 'map papers fast',
        description: 'Build and inspect a literature graph for research discovery.',
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
        viewer_favorited: false,
        versions: [{ id: 1, version: '1.0.0', changelog: 'init', install_command: 'topiclab skills install literature-map', is_latest: true }],
        reviews: [],
        related_skills: [],
      },
    } as any)

    mockedGetSkillContent.mockResolvedValue({
      data: {
        content: '# Literature Map',
        version: { id: 1, version: '1.0.0', changelog: 'init', install_command: 'topiclab skills install literature-map', is_latest: true },
      },
    } as any)
  })

  it('renders the new SkillHub home with real API data', async () => {
    renderSkillHubHome()

    expect(
      await screen.findByText(
        '这里收录科研场景下的可安装应用；其中很多底层能力形态仍然是 skill，但前台统一按应用展示。你可以按一级学科与研究领域（Cluster）筛选，查看详情、作者排行、售价与他山石消耗，并参与评测、许愿、发布与个人管理。',
      ),
    ).toBeInTheDocument()
    expect((await screen.findAllByText('文献检索')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Literature Map')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('link', { name: '许愿墙' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '上传技能' })).toBeInTheDocument()
    await waitFor(() => expect(mockedListSkills).toHaveBeenCalledTimes(1))
  })

  it('renders detail page with application-first framing and dual naming', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/skills/literature-map']}>
        <Routes>
          <Route path="/apps/skills/:slug" element={<AppsSkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('该对象在前台按应用展示；其底层能力形态仍然是 Skill，因此会保留版本、安装命令、全文说明，以及按“几他山石”展示的售价信息。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载 / 安装应用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 Skill 全文说明' })).toBeInTheDocument()
  })

  it('requests skills with cluster when a research cluster filter is selected', async () => {
    renderSkillHubHome()
    await screen.findAllByText('Literature Map')
    expect(mockedListSkills).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'hot', limit: 12 }),
    )
    const clusterHeadings = screen.getAllByText('研究领域（Cluster）')
    const clusterSection = clusterHeadings[0]?.closest('section')
    expect(clusterSection).toBeTruthy()
    fireEvent.click(
      within(clusterSection as HTMLElement).getByRole('button', { name: '筛选研究领域：文献检索' }),
    )
    await waitFor(() => {
      expect(mockedListSkills).toHaveBeenLastCalledWith(
        expect.objectContaining({ cluster: 'literature', sort: 'hot', limit: 12 }),
      )
    })
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
