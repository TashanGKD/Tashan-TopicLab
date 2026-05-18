import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspirationNeedDetailPage from '../InspirationNeedDetailPage'
import { inspirationApi } from '../../api/client'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  const demand = {
    id: 'demand-1',
    slug: 'need-01-ai-english-reading-assistant',
    status: 'published',
    stage: '问题定义中',
    title: '英语阅读课堂的 AI 助教',
    summary: '把一套大学英语阅读课拆成词汇、语法、阅读、翻译和写作训练。',
    tags: ['教育 / 学习'],
    stuck: '问题太大，需要拆成可先验证的一步。',
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
    can_view_private: true,
    can_update: true,
    llm_review: {
      clarity: '偏模糊',
      next_step: '先把目标用户写清楚。',
      follow_up_questions: ['目标用户是谁？'],
    },
    path_progress: [
      { key: 'submitted', label: '留下线索', status: 'done', summary: '一个需求、想法或参与意愿已经被放到这里。', emotion_note: '先被看见，就是共创的第一步。' },
      { key: 'defined', label: '问题定义', status: 'current', summary: '等待下一次共创更新。', emotion_note: '有人愿意把这件事继续往前推。' },
      { key: 'demo', label: 'Demo 验证', status: 'pending', summary: '尚未开始。', emotion_note: '' },
    ],
    updates: [],
  }
  return {
    ...actual,
    inspirationApi: {
      getDemand: vi.fn((_slug: string, options?: { includePrivate?: boolean }) => Promise.resolve({
        data: {
          demand: options?.includePrivate ? { ...demand, private: { 联系方式: '18773233131' } } : demand,
        },
      })),
      claimDemand: vi.fn(() => Promise.resolve({
        data: {
          demand,
        },
      })),
      createUpdate: vi.fn(() => Promise.resolve({
        data: {
          update: {
            id: 'upd-1',
            week_label: '2026-W21',
            summary: '完成问题定义',
            progress: '已拆成课堂练习和课后反馈。',
            blockers: '',
            next_steps: '找 3 名学生试用。',
            stage_key: 'defined',
            stage_status: 'done',
            emotion_note: '从大想法变成可讨论的课堂实验。',
            artifacts: [],
            visibility: 'public',
            created_at: '2026-05-18T00:00:00Z',
          },
        },
      })),
    },
  }
})

function renderDetail(initialPath = '/inspiration-co-creation/needs/need-01-ai-english-reading-assistant') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/inspiration-co-creation/needs/:slug" element={<InspirationNeedDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InspirationNeedDetailPage', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders visual path, reveals private detail on demand, and lets owners update progress', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 1, phone: 'admin', username: '管理员', is_admin: true, created_at: '2026-05-18T00:00:00Z' }),
    )
    renderDetail()

    expect(await screen.findByText('英语阅读课堂的 AI 助教')).toBeInTheDocument()
    expect(screen.getByText('留下线索')).toBeInTheDocument()
    expect(screen.getAllByText('问题定义').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('人工访谈')).not.toBeInTheDocument()
    expect(screen.queryByText('18773233131')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /显示完整信息/ }))
    await waitFor(() => {
      expect(inspirationApi.getDemand).toHaveBeenCalledWith('need-01-ai-english-reading-assistant', { includePrivate: true })
      expect(screen.getByText('18773233131')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('2026-W21'), { target: { value: '2026-W21' } })
    fireEvent.change(screen.getByLabelText('路径阶段'), { target: { value: 'defined' } })
    fireEvent.change(screen.getByPlaceholderText('本次进展摘要'), { target: { value: '完成问题定义' } })
    fireEvent.click(screen.getByRole('button', { name: /保存进展/ }))

    await waitFor(() => {
      expect(inspirationApi.createUpdate).toHaveBeenCalled()
      expect(screen.getByText('完成问题定义')).toBeInTheDocument()
    })
  })

  it('claims a private demand from the login redirect token even if public detail is hidden', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 2, phone: '13800138002', username: '提出者', is_admin: false, created_at: '2026-05-18T00:00:00Z' }),
    )
    vi.mocked(inspirationApi.getDemand).mockRejectedValueOnce(new Error('hidden'))

    renderDetail('/inspiration-co-creation/needs/need-01-ai-english-reading-assistant?claim_token=claim-token-123')

    await waitFor(() => {
      expect(inspirationApi.claimDemand).toHaveBeenCalledWith('need-01-ai-english-reading-assistant', 'claim-token-123')
      expect(screen.getByText('已绑定这条线索，后续可以持续更新路径进展。')).toBeInTheDocument()
    })
  })
})
