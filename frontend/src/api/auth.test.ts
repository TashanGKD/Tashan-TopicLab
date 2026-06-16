import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshCurrentUserProfile, tokenManager, type User } from './auth'

const cachedUser: User = {
  id: 7,
  phone: '13800000000',
  username: '旧用户',
  is_admin: false,
  created_at: '2026-01-01T00:00:00Z',
}

const freshUser: User = {
  ...cachedUser,
  username: '新用户',
}

describe('refreshCurrentUserProfile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('clears cached login state when /auth/me rejects the token', async () => {
    const authChangeListener = vi.fn()
    window.addEventListener('auth-change', authChangeListener)
    tokenManager.set('expired-token')
    tokenManager.setUser(cachedUser)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: '登录已过期' }), { status: 401 })),
    )

    const user = await refreshCurrentUserProfile()

    expect(user).toBeNull()
    expect(tokenManager.get()).toBeNull()
    expect(tokenManager.getUser()).toBeNull()
    expect(authChangeListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('auth-change', authChangeListener)
  })

  it('keeps cached login state for temporary profile refresh failures', async () => {
    tokenManager.set('active-token')
    tokenManager.setUser(cachedUser)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    await expect(refreshCurrentUserProfile()).resolves.toEqual(cachedUser)
    expect(tokenManager.get()).toBe('active-token')
    expect(tokenManager.getUser()).toEqual(cachedUser)
  })

  it('stores the latest profile when /auth/me succeeds', async () => {
    tokenManager.set('active-token')
    tokenManager.setUser(cachedUser)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: freshUser }), { status: 200 })),
    )

    await expect(refreshCurrentUserProfile()).resolves.toEqual(freshUser)
    expect(tokenManager.getUser()).toEqual(freshUser)
  })
})
