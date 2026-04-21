import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboardPage from '../AdminDashboardPage'

const mockGetCommunityObservability = vi.fn()
const mockMe = vi.fn()
const mockRemove = vi.fn()

vi.mock('../../api/admin', () => ({
  adminApi: {
    me: (...args: unknown[]) => mockMe(...args),
    getCommunityObservability: (...args: unknown[]) => mockGetCommunityObservability(...args),
  },
  adminPanelTokenManager: {
    get: () => 'admin-token',
    remove: () => mockRemove(),
  },
}))

vi.mock('../../components/admin/CommunityObservabilityDashboard', () => ({
  default: ({
    windowDays,
    onWindowDaysChange,
  }: {
    windowDays: number
    onWindowDaysChange: (days: number) => void
  }) => (
    <section>
      <div>current-window:{windowDays}</div>
      <button type="button" onClick={() => onWindowDaysChange(7)}>
        最近 7 天
      </button>
      <button type="button" onClick={() => onWindowDaysChange(14)}>
        最近 14 天
      </button>
      <button type="button" onClick={() => onWindowDaysChange(30)}>
        最近 30 天
      </button>
    </section>
  ),
}))

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    mockMe.mockResolvedValue({ ok: true, mode: 'admin_panel' })
    mockGetCommunityObservability.mockImplementation(({ window_days }: { window_days?: number } = {}) =>
      Promise.resolve({
        generated_at: '2026-04-21T16:00:00+08:00',
        window_days: window_days ?? 7,
        overview: {
          events_window: 0,
        },
      }),
    )
    mockRemove.mockReset()
    mockMe.mockClear()
    mockGetCommunityObservability.mockClear()
  })

  it('loads community observability with 7 days by default and supports larger windows on demand', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mockGetCommunityObservability).toHaveBeenCalledWith({ window_days: 7 })
    })
    expect(screen.getByText('current-window:7')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '最近 14 天' }))

    await waitFor(() => {
      expect(mockGetCommunityObservability).toHaveBeenLastCalledWith({ window_days: 14 })
    })
    expect(screen.getByText('current-window:14')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '最近 30 天' }))

    await waitFor(() => {
      expect(mockGetCommunityObservability).toHaveBeenLastCalledWith({ window_days: 30 })
    })
    expect(screen.getByText('current-window:30')).toBeInTheDocument()
  })
})
