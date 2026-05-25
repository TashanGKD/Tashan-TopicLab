import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { inspirationApi } from '../../api/client'
import { tokenManager } from '../../api/auth'
import InspirationAdminNeedsPage from '../InspirationAdminNeedsPage'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    inspirationApi: {
      listAdminDemands: vi.fn(() => Promise.resolve({
        data: {
          list: [
            {
              id: 'demand-private',
              slug: 'private-need-01',
              clue_number: 26,
              status: 'private',
              allow_public: false,
              stage: '模糊想法',
              title: '只给管理员看的线索',
              summary: '公开页不会展示这条线索。',
              tags: ['生活效率'],
              stuck: '不希望先公开。',
              private: {
                submitter_name: '隐藏提出者',
                contact: 'hidden@example.com',
                problem: '我想提交一条只给管理员看的灵感共创线索。',
                current_blockers: '需要先人工判断。',
              },
              path_progress: [],
              created_at: '2026-05-20T00:00:00Z',
              updated_at: '2026-05-20T00:00:00Z',
              latest_update_at: '2026-05-21T00:00:00Z',
            },
            {
              id: 'demand-public',
              slug: 'public-need-01',
              clue_number: 1,
              status: 'published',
              allow_public: true,
              stage: '问题定义',
              title: '公开线索',
              summary: '公开页可见。',
              tags: ['教育'],
              stuck: '需要继续拆解。',
              private: {
                submitter_name: '公开提出者',
                contact: 'public@example.com',
                problem: '公开线索的完整问题。',
                current_blockers: '缺少反馈。',
              },
              path_progress: [],
              created_at: '2026-05-18T00:00:00Z',
              updated_at: '2026-05-18T00:00:00Z',
              latest_update_at: '2026-05-18T00:00:00Z',
            },
          ],
          limit: 50,
          offset: 0,
          total: 2,
          has_more: false,
          next_offset: null,
        },
      })),
    },
  }
})

vi.mock('../../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../api/auth')>('../../api/auth')
  return {
    ...actual,
    refreshCurrentUserProfile: vi.fn(() => Promise.resolve(actual.tokenManager.getUser())),
  }
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inspiration-co-creation/admin/needs']}>
      <Routes>
        <Route path="/inspiration-co-creation/admin/needs" element={<InspirationAdminNeedsPage />} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InspirationAdminNeedsPage', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('loads private and public clues for admins', async () => {
    tokenManager.set('admin-token')
    tokenManager.setUser({
      id: 1,
      phone: 'admin',
      username: '管理员',
      is_admin: true,
      created_at: '2026-05-18T00:00:00Z',
    })

    renderPage()

    expect(await screen.findByRole('heading', { name: '灵感共创队线索入口' })).toBeInTheDocument()
    expect(inspirationApi.listAdminDemands).toHaveBeenCalledWith(
      { includePrivate: true, limit: 50, offset: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(screen.getByText('只给管理员看的线索')).toBeInTheDocument()
    expect(screen.getByText('hidden@example.com')).toBeInTheDocument()
    expect(screen.getByText('我想提交一条只给管理员看的灵感共创线索。')).toBeInTheDocument()
    expect(screen.getByText('公开线索')).toBeInTheDocument()
    expect(screen.getByText('public@example.com')).toBeInTheDocument()

    const privateCard = screen.getByText('只给管理员看的线索').closest('article')
    expect(privateCard).not.toBeNull()
    expect(within(privateCard as HTMLElement).getByText('不公开')).toBeInTheDocument()
    expect(within(privateCard as HTMLElement).getByRole('link', { name: '查看详情' })).toHaveAttribute(
      'href',
      '/inspiration-co-creation/needs/private-need-01',
    )
  })

  it('does not call the admin list API for non-admin users', async () => {
    tokenManager.set('user-token')
    tokenManager.setUser({
      id: 2,
      phone: '13800138002',
      username: '普通用户',
      is_admin: false,
      created_at: '2026-05-18T00:00:00Z',
    })

    renderPage()

    expect(await screen.findByText('没有权限查看这个入口')).toBeInTheDocument()
    await waitFor(() => {
      expect(inspirationApi.listAdminDemands).not.toHaveBeenCalled()
    })
    expect(screen.queryByText('hidden@example.com')).not.toBeInTheDocument()
  })
})
