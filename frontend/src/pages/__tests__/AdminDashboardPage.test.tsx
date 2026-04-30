import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboardPage from '../AdminDashboardPage'

const mockGetCommunityObservability = vi.fn()
const mockListOpenClawAgents = vi.fn()
const mockGetOpenClawAgent = vi.fn()
const mockListOpenClawAgentEvents = vi.fn()
const mockListOpenClawAgentLedger = vi.fn()
const mockMe = vi.fn()
const mockRemove = vi.fn()

vi.mock('../../api/admin', () => ({
  adminApi: {
    me: (...args: unknown[]) => mockMe(...args),
    getCommunityObservability: (...args: unknown[]) => mockGetCommunityObservability(...args),
    listOpenClawAgents: (...args: unknown[]) => mockListOpenClawAgents(...args),
    getOpenClawAgent: (...args: unknown[]) => mockGetOpenClawAgent(...args),
    listOpenClawAgentEvents: (...args: unknown[]) => mockListOpenClawAgentEvents(...args),
    listOpenClawAgentLedger: (...args: unknown[]) => mockListOpenClawAgentLedger(...args),
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
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    const openClawAgent = {
      id: 1,
      agent_uid: 'oc_test',
      display_name: 'test openclaw',
      handle: 'test_openclaw',
      skill_token: null,
      status: 'active',
      bound_user_id: 10,
      is_primary: true,
      profile_json: {},
      username: 'guest-user',
      phone: 'guest_123',
      points_balance: 0,
      total_actions: 1,
      created_at: '2026-04-21T16:00:00+08:00',
      updated_at: '2026-04-21T16:00:00+08:00',
      last_seen_at: null,
    }
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
    mockListOpenClawAgents.mockResolvedValue({
      items: [openClawAgent],
      total: 1,
      limit: 20,
      offset: 0,
    })
    mockGetOpenClawAgent.mockResolvedValue({ agent: openClawAgent })
    mockListOpenClawAgentEvents.mockResolvedValue({ items: [], total: 0, limit: 8, offset: 0 })
    mockListOpenClawAgentLedger.mockResolvedValue({ items: [], total: 0, limit: 8, offset: 0 })
    mockListOpenClawAgents.mockClear()
    mockGetOpenClawAgent.mockClear()
    mockListOpenClawAgentEvents.mockClear()
    mockListOpenClawAgentLedger.mockClear()
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

  it('passes zombie and real user filters when listing OpenClaw agents', async () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'OpenClaw 身份' }))

    await waitFor(() => {
      expect(mockListOpenClawAgents).toHaveBeenCalled()
    })

    fireEvent.change(screen.getByLabelText('用户类型筛选'), { target: { value: 'zombie' } })

    await waitFor(() => {
      expect(mockListOpenClawAgents).toHaveBeenLastCalledWith(
        expect.objectContaining({ user_kind: 'zombie' }),
      )
    })

    fireEvent.change(screen.getByLabelText('用户类型筛选'), { target: { value: 'real' } })

    await waitFor(() => {
      expect(mockListOpenClawAgents).toHaveBeenLastCalledWith(
        expect.objectContaining({ user_kind: 'real' }),
      )
    })
  })
})
