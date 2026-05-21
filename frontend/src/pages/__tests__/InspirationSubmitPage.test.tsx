import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspirationSubmitPage from '../InspirationSubmitPage'
import { feedbackApi, inspirationApi } from '../../api/client'

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
    feedbackApi: {
      submit: vi.fn(() => Promise.resolve({
        data: {
          id: 101,
          username: '匿名用户',
          created_at: '2026-05-18T00:00:00Z',
        },
      })),
    },
  }
})

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="location-path">{location.pathname}{location.search}</div>
      <div data-testid="location-state">{JSON.stringify(location.state)}</div>
    </>
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inspiration-co-creation/submit']}>
      <LocationProbe />
      <Routes>
        <Route path="/inspiration-co-creation/submit" element={<InspirationSubmitPage />} />
        <Route path="/inspiration-co-creation" element={<div>灵感共创队主页</div>} />
        <Route path="/inspiration-co-creation/needs/:slug" element={<div>线索详情页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InspirationSubmitPage', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('submits a clear demand and immediately opens the claimable detail page', async () => {
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
      expect(localStorage.getItem('inspiration_claim_test-demand-1234')).toBe('claim-token-123')
    })

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/inspiration-co-creation/needs/test-demand-1234?claim_token=claim-token-123')
      expect(screen.getByTestId('location-state')).toHaveTextContent('inspirationSubmissionSuccess')
    })
  })

  it('records participant signups without creating a clue', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

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
      expect(inspirationApi.submitDemand).not.toHaveBeenCalled()
      expect(feedbackApi.submit).toHaveBeenCalledWith(expect.objectContaining({
        scenario: '灵感共创队报名',
        body: expect.stringContaining('参与方式：我想参与别人的项目'),
      }))
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
      expect(screen.getByTestId('location-path')).toHaveTextContent('/inspiration-co-creation')
      expect(screen.getByTestId('location-state')).toHaveTextContent('inspirationSignupSuccess')
    })

    scrollTo.mockRestore()
  })

  it('records observer signups without creating a clue', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

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
      expect(inspirationApi.submitDemand).not.toHaveBeenCalled()
      expect(feedbackApi.submit).toHaveBeenCalledWith(expect.objectContaining({
        scenario: '灵感共创队报名',
        body: expect.stringContaining('参与方式：我想先加入看看'),
      }))
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
      expect(screen.getByTestId('location-path')).toHaveTextContent('/inspiration-co-creation')
      expect(screen.getByTestId('location-state')).toHaveTextContent('inspirationSignupSuccess')
    })

    scrollTo.mockRestore()
  })

})
