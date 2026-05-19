import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Login from '../Login'
import { authApi } from '../../api/auth'

vi.mock('../../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../api/auth')>('../../api/auth')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: vi.fn(() => Promise.resolve({
        message: 'ok',
        token: 'jwt-token',
        user: {
          id: 7,
          phone: '13800138000',
          username: 'Zerui',
          is_admin: false,
          created_at: '2026-05-18T00:00:00Z',
        },
      })),
      startWatchaLogin: vi.fn(() => Promise.resolve({
        authorization_url: 'https://watcha.example/authorize',
        state: 'state-1',
      })),
    },
  }
})

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-path">{location.pathname}{location.search}</div>
}

function renderLogin(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/inspiration-co-creation/needs/:slug" element={<div>线索详情页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Login', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns to an inspiration claim link carried by the next query after login', async () => {
    renderLogin('/login?next=%2Finspiration-co-creation%2Fneeds%2Ftesta-be83b158%3Fclaim_token%3Dclaim-token-123')

    fireEvent.change(screen.getByPlaceholderText('请输入手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByPlaceholderText('请输入密码'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith('13800138000', 'password123', null)
      expect(localStorage.getItem('auth_token')).toBe('jwt-token')
    })

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/inspiration-co-creation/needs/testa-be83b158?claim_token=claim-token-123')
    }, { timeout: 1800 })
  })
})
