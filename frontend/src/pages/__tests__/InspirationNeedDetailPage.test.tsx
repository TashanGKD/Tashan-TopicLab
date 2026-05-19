import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspirationNeedDetailPage from '../InspirationNeedDetailPage'
import { inspirationApi } from '../../api/client'
import { refreshCurrentUserProfile } from '../../api/auth'

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
    assistant: {
      status: 'ready',
      snapshot: {
        clarity: '偏模糊',
        next_step: '先把目标用户写清楚。',
        follow_up_questions: ['目标用户是谁？'],
        stages: {
          submitted: {
            status: 'needs_input',
            ai_draft_answer: '可以写成：目标用户是正在做课堂阅读训练的学生。',
            follow_up_questions: ['学生现在用什么材料？'],
            next_step: '进入问题定义',
          },
          defined: {
            status: 'needs_input',
            ai_draft_answer: '可以先定义为：让学生在一节阅读课中完成词汇理解、长句拆解和阅读反馈。',
            follow_up_questions: ['第一节课最想验证哪个环节？'],
            next_step: '把问题定义成一周内可验证的小实验',
          },
        },
      },
      version: 1,
      latest_run_id: 'iar-ready',
      updated_at: '2026-05-18T00:00:00Z',
      error_message: null,
    },
    llm_review: {
      clarity: '偏模糊',
      next_step: '先把目标用户写清楚。',
      follow_up_questions: ['目标用户是谁？'],
      stages: {
        submitted: {
          status: 'needs_input',
          ai_draft_answer: '可以写成：目标用户是正在做课堂阅读训练的学生。',
          follow_up_questions: ['学生现在用什么材料？'],
          next_step: '进入问题定义',
        },
        defined: {
          status: 'needs_input',
          ai_draft_answer: '可以先定义为：让学生在一节阅读课中完成词汇理解、长句拆解和阅读反馈。',
          follow_up_questions: ['第一节课最想验证哪个环节？'],
          next_step: '把问题定义成一周内可验证的小实验',
        },
      },
    },
    path_progress: [
      { key: 'submitted', label: '留下线索', status: 'needs_input', summary: '请补充：目标用户是谁？', emotion_note: '' },
      { key: 'defined', label: '问题定义', status: 'current', summary: '', emotion_note: '' },
      { key: 'demo', label: 'Demo 验证', status: 'pending', summary: '尚未开始。', emotion_note: '' },
    ],
    updates: [],
  }
  return {
    ...actual,
    inspirationApi: {
      getDemand: vi.fn((_slug: string, options?: { includePrivate?: boolean }) => Promise.resolve({
        data: {
          demand: options?.includePrivate ? {
            ...demand,
            private: {
              participation_mode: '我有一个明确需求',
              problem: '我想把英语阅读课堂拆成可以验证的 AI 助教需求。',
              category: '学习 / 教育',
              current_blockers: '想找人一起拆解',
              note: '已有课程材料。',
              allow_public: false,
              contact: '18773233131',
              submitter_name: '测试同学',
              account_user_id: 1,
              account_phone: 'admin',
            },
          } : demand,
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
      updateDemandPrivate: vi.fn((_slug: string, privateData: Record<string, string | boolean | number | null | undefined>) => Promise.resolve({
        data: {
          demand: {
            ...demand,
            private: privateData,
          },
        },
      })),
      updateUpdate: vi.fn((_slug: string, _updateId: string, payload: any) => Promise.resolve({
        data: {
          update: {
            id: 'upd-1',
            created_at: '2026-05-18T00:00:00Z',
            ...payload,
          },
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

function renderDetail(
  initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/inspiration-co-creation/needs/need-01-ai-english-reading-assistant',
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
    vi.useRealTimers()
  })

  it('shows the submission completion animation when opened from the form', async () => {
    renderDetail({
      pathname: '/inspiration-co-creation/needs/need-01-ai-english-reading-assistant',
      search: '?claim_token=claim-token-123',
      state: { inspirationSubmissionSuccess: true },
    })

    expect(await screen.findByText('提交成功')).toBeInTheDocument()
    expect(screen.getByText('正在打开这条线索，你可以继续更新它。')).toBeInTheDocument()
  })

  it('renders visual path, reveals private detail on demand, and lets owners update progress', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 1, phone: 'admin', username: '管理员', is_admin: true, created_at: '2026-05-18T00:00:00Z' }),
    )
    renderDetail()

    expect(await screen.findByText('英语阅读课堂的 AI 助教')).toBeInTheDocument()
    expect(screen.getAllByText('智能助手').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('预分析')).not.toBeInTheDocument()
    expect(screen.getAllByText('留下线索').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/待补充/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('目标用户是谁？').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('AI 生成参考').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('可以写成：目标用户是正在做课堂阅读训练的学生。')).toBeInTheDocument()
    expect(screen.getByText('学生现在用什么材料？')).toBeInTheDocument()
    expect(screen.getByText('可以先定义为：让学生在一节阅读课中完成词汇理解、长句拆解和阅读反馈。')).toBeInTheDocument()
    expect(screen.getByText('第一节课最想验证哪个环节？')).toBeInTheDocument()
    expect(screen.getAllByText('问题定义').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('人工访谈')).not.toBeInTheDocument()
    expect(screen.queryByText('18773233131')).not.toBeInTheDocument()
    expect(screen.getByLabelText('路径时间轴')).toBeInTheDocument()
    expect(screen.getByLabelText('路径进展列表')).toBeInTheDocument()

    const submittedStage = screen.getByLabelText('留下线索阶段')
    fireEvent.click(within(submittedStage).getByRole('button', { name: '补充回答' }))
    fireEvent.change(within(submittedStage).getByPlaceholderText('比如：问题说清楚了 / 找到了一个可试的工具 / 做了一个小 Demo / 暂时卡住了。'), { target: { value: '目标用户是正在做课堂阅读训练的学生。' } })
    fireEvent.click(screen.getByRole('button', { name: /保存回答/ }))

    await waitFor(() => {
      expect(inspirationApi.createUpdate).toHaveBeenCalledWith(
        'need-01-ai-english-reading-assistant',
        expect.objectContaining({ stage_key: 'submitted', stage_status: 'done', summary: '目标用户是正在做课堂阅读训练的学生。' }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /显示完整信息/ }))
    await waitFor(() => {
      expect(inspirationApi.getDemand).toHaveBeenCalledWith('need-01-ai-english-reading-assistant', { includePrivate: true })
      expect(screen.getByText('18773233131')).toBeInTheDocument()
      expect(screen.getByText('怎么联系你')).toBeInTheDocument()
      expect(screen.getByText('是否愿意把它匿名展示出来')).toBeInTheDocument()
      expect(screen.getByText('先不公开，只提交给共创队')).toBeInTheDocument()
      expect(screen.queryByText('contact')).not.toBeInTheDocument()
      expect(screen.queryByText('allow_public')).not.toBeInTheDocument()
      expect(screen.queryByText('account_phone')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '收起完整信息' }))
    expect(screen.queryByText('18773233131')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /显示完整信息/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /显示完整信息/ }))
    expect(await screen.findByText('18773233131')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑完整信息' }))
    fireEvent.change(screen.getByLabelText('怎么联系你'), { target: { value: 'new-contact@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存完整信息' }))

    await waitFor(() => {
      expect(inspirationApi.updateDemandPrivate).toHaveBeenCalledWith(
        'need-01-ai-english-reading-assistant',
        expect.objectContaining({ contact: 'new-contact@example.com' }),
      )
    })

    const definedStage = screen.getByLabelText('问题定义阶段')
    fireEvent.click(within(definedStage).getByRole('button', { name: '更新' }))
    fireEvent.change(within(definedStage).getByPlaceholderText('比如：问题说清楚了 / 找到了一个可试的工具 / 做了一个小 Demo / 暂时卡住了。'), { target: { value: '完成问题定义' } })
    fireEvent.click(screen.getByRole('button', { name: /保存进展/ }))

    await waitFor(() => {
      expect(inspirationApi.createUpdate).toHaveBeenCalledWith(
        'need-01-ai-english-reading-assistant',
        expect.objectContaining({ stage_key: 'defined', summary: '完成问题定义', week_label: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) }),
      )
      expect(screen.getAllByText('完成问题定义').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows assistant progress and polls until the latest snapshot is ready', async () => {
    const pendingDemand = {
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
      assistant: {
        status: 'running',
        snapshot: {
          clarity: '偏模糊',
          next_step: '旧建议',
          follow_up_questions: ['旧追问'],
        },
        version: 1,
        latest_run_id: 'iar-running',
        updated_at: '2026-05-18T00:00:00Z',
        error_message: null,
      },
      llm_review: {
        clarity: '偏模糊',
        next_step: '旧建议',
        follow_up_questions: ['旧追问'],
      },
      path_progress: [
        { key: 'submitted', label: '留下线索', status: 'done', summary: '', emotion_note: '' },
        { key: 'defined', label: '问题定义', status: 'current', summary: '', emotion_note: '' },
      ],
      updates: [],
    }
    const readyDemand = {
      ...pendingDemand,
      assistant: {
        ...pendingDemand.assistant,
        status: 'ready',
        snapshot: {
          clarity: '更清晰',
          next_step: '找 3 名学生试用低保真原型。',
          follow_up_questions: ['第一个试用对象是谁？'],
        },
        version: 2,
        latest_run_id: 'iar-ready',
      },
      llm_review: {
        clarity: '更清晰',
        next_step: '找 3 名学生试用低保真原型。',
        follow_up_questions: ['第一个试用对象是谁？'],
      },
    }
    vi.mocked(inspirationApi.getDemand)
      .mockResolvedValueOnce({ data: { demand: pendingDemand } } as any)
      .mockResolvedValueOnce({ data: { demand: readyDemand } } as any)

    renderDetail()

    await waitFor(() => expect(screen.getAllByText('智能助手').length).toBeGreaterThanOrEqual(1))
    expect(screen.getAllByText('智能助手正在基于最新信息更新建议…').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('旧建议').length).toBeGreaterThanOrEqual(1)

    await new Promise((resolve) => setTimeout(resolve, 2100))

    await waitFor(() => {
      expect(inspirationApi.getDemand).toHaveBeenCalledTimes(2)
      expect(screen.getAllByText('找 3 名学生试用低保真原型。').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryAllByText('智能助手正在基于最新信息更新建议…')).toHaveLength(0)
    })
  }, 7000)

  it('claims a private demand from the login redirect token even if public detail is hidden', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 2, phone: '13800138002', username: '提出者', is_admin: false, created_at: '2026-05-18T00:00:00Z' }),
    )

    renderDetail('/inspiration-co-creation/needs/need-01-ai-english-reading-assistant?claim_token=claim-token-123')

    await waitFor(() => {
      expect(inspirationApi.claimDemand).toHaveBeenCalledWith('need-01-ai-english-reading-assistant', 'claim-token-123')
      expect(screen.getByText('已绑定这条线索，后续可以持续更新路径进展。')).toBeInTheDocument()
    })
  })

  it('syncs the logged-in user from token before claiming a demand', async () => {
    localStorage.setItem('auth_token', 'fresh-token')
    vi.mocked(refreshCurrentUserProfile).mockResolvedValueOnce({
      id: 3,
      phone: '13800138003',
      username: '刚登录的用户',
      is_admin: false,
      created_at: '2026-05-18T00:00:00Z',
    })

    renderDetail('/inspiration-co-creation/needs/need-01-ai-english-reading-assistant?claim_token=claim-token-123')

    await waitFor(() => {
      expect(refreshCurrentUserProfile).toHaveBeenCalled()
      expect(inspirationApi.claimDemand).toHaveBeenCalledWith('need-01-ai-english-reading-assistant', 'claim-token-123')
      expect(screen.getByText('已绑定这条线索，后续可以持续更新路径进展。')).toBeInTheDocument()
    })
  })

  it('guides anonymous submitters to log in before updating their demand', async () => {
    vi.mocked(inspirationApi.getDemand).mockResolvedValueOnce({
      data: {
        demand: {
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
          can_view_private: false,
          can_update: false,
          path_progress: [
            { key: 'submitted', label: '留下线索', status: 'done', summary: '', emotion_note: '' },
          ],
          updates: [],
        },
      },
    } as any)

    renderDetail('/inspiration-co-creation/needs/need-01-ai-english-reading-assistant?claim_token=claim-token-123')

    expect(await screen.findByText('这条线索可以绑定到你的账号')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录并绑定' })).toHaveAttribute(
      'href',
      '/login?next=%2Finspiration-co-creation%2Fneeds%2Fneed-01-ai-english-reading-assistant%3Fclaim_token%3Dclaim-token-123',
    )
    expect(screen.queryByRole('link', { name: '注册并绑定' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('完整表单信息')).toBeInTheDocument()
    expect(screen.getByText('登录并绑定这条线索，或使用管理员账号查看完整表单信息。')).toBeInTheDocument()
    expect(screen.getByText('登录并绑定后，就可以在这里持续更新这条线索。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument()
  })

  it('treats unauthorized claim attempts as expired login state instead of broken links', async () => {
    localStorage.setItem('auth_token', 'expired-token')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 2, phone: '13800138002', username: '提出者', is_admin: false, created_at: '2026-05-18T00:00:00Z' }),
    )
    vi.mocked(inspirationApi.claimDemand).mockRejectedValue({ response: { status: 401 } })

    renderDetail('/inspiration-co-creation/needs/need-01-ai-english-reading-assistant?claim_token=claim-token-123')

    expect(await screen.findByText('登录状态已过期')).toBeInTheDocument()
    expect(screen.getByText('重新登录后就可以把这条线索绑定到你的账号，之后继续补充进展、复盘和下一步。')).toBeInTheDocument()
    expect(screen.queryByText('绑定链接已失效或不匹配。')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录并绑定' })).toHaveAttribute(
      'href',
      '/login?next=%2Finspiration-co-creation%2Fneeds%2Fneed-01-ai-english-reading-assistant%3Fclaim_token%3Dclaim-token-123',
    )
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('auth_user')).toBeNull()
  })
})
