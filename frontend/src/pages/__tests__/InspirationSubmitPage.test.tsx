import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspirationSubmitPage from '../InspirationSubmitPage'
import { inspirationApi } from '../../api/client'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    inspirationApi: {
      submitDemand: vi.fn(() => Promise.resolve({
        data: {
          demand: {
            id: 'demand-new',
            slug: 'test-demand-1234',
            status: 'published',
            stage: '问题定义中',
            title: '工作效率：我想做一个 AI 工具',
            summary: '我想做一个 AI 工具。',
            tags: ['工作效率'],
            stuck: '想把需求边界说清楚',
            created_at: '2026-05-18T00:00:00Z',
            updated_at: '2026-05-18T00:00:00Z',
          },
          claim_token: 'claim-token-123',
          llm_review: {
            next_step: '先把目标用户、使用场景和一次可观察的验证动作写清楚。',
            follow_up_questions: ['目标用户是谁？'],
          },
        },
      })),
    },
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <InspirationSubmitPage />
    </MemoryRouter>,
  )
}

describe('InspirationSubmitPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('submits a clear demand after asking demand-specific questions first', async () => {
    renderPage()

    expect(screen.getByText('说说你在琢磨的事儿')).toBeInTheDocument()
    expect(screen.getByText('把这个需求说明白一点')).toBeInTheDocument()
    expect(screen.queryByLabelText('怎么联系你')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('把这个需求说明白一点'), {
      target: { value: '我想做一个 AI 工具，帮助社群成员把模糊想法拆成一周内可以验证的小实验。' },
    })
    expect(screen.getByText('已经能看到一个真实场景或需求了。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '工作效率' }))
    fireEvent.click(screen.getByRole('radio', { name: '想把需求边界说清楚' }))
    fireEvent.click(screen.getByRole('radio', { name: '先不公开，只提交给共创队' }))
    fireEvent.change(screen.getByLabelText('怎么联系你'), {
      target: { value: 'may@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提交这个需求/ }))

    await waitFor(() => {
      expect(inspirationApi.submitDemand).toHaveBeenCalledWith(expect.objectContaining({
        allow_public: false,
        category: '工作效率',
        current_blockers: '想把需求边界说清楚',
        participation_mode: '我有一个明确需求',
      }))
      expect(screen.getByText('已经收到你的需求')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /查看整理后的内容/ })).toHaveAttribute(
      'href',
      '/inspiration-co-creation/needs/test-demand-1234',
    )
    expect(screen.getByText('登录后绑定这条记录')).toBeInTheDocument()
  })

  it('lets participants submit intent without writing a demand body', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('radio', { name: /我想参与别人的项目/ }))
    expect(screen.queryByText('把这个需求说明白一点')).not.toBeInTheDocument()
    expect(screen.getByText('你想参与哪类项目')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '科研 / 数据' }))
    fireEvent.click(screen.getByRole('radio', { name: '找资料 / 调研' }))
    fireEvent.change(screen.getByLabelText('怎么联系你'), {
      target: { value: 'research@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /提交参与意愿/ }))

    await waitFor(() => {
      expect(inspirationApi.submitDemand).toHaveBeenCalledWith(expect.objectContaining({
        allow_public: false,
        category: '科研 / 数据',
        current_blockers: '找资料 / 调研',
        participation_mode: '我想参与别人的项目',
      }))
      expect(screen.getByText('已经收到你的参与意愿')).toBeInTheDocument()
    })
  })

  it('lets observers sign up with contact only', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('radio', { name: /我想先加入看看/ }))
    expect(screen.getByText(/留下联系方式就好/)).toBeInTheDocument()
    expect(screen.queryByText('你想参与哪类项目')).not.toBeInTheDocument()
    expect(screen.queryByText('把这个需求说明白一点')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('怎么联系你'), {
      target: { value: 'observer@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /报名加入共创队/ }))

    await waitFor(() => {
      expect(inspirationApi.submitDemand).toHaveBeenCalledWith(expect.objectContaining({
        allow_public: false,
        category: '先加入看看',
        current_blockers: '先加入看看',
        participation_mode: '我想先加入看看',
      }))
      expect(screen.getByText('已经收到你的报名')).toBeInTheDocument()
    })
  })
})
