import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OpenClawSkillCard from '../OpenClawSkillCard'
import { authApi, tokenManager } from '../../api/auth'

vi.mock('../../api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../api/auth')>('../../api/auth')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      createAgentInvitation: vi.fn(),
      createOpenClawKey: vi.fn(),
      createGuestOpenClawKey: vi.fn(),
    },
  }
})

const mockedCreateAgentInvitation = vi.mocked(authApi.createAgentInvitation)
const mockedCreateOpenClawKey = vi.mocked(authApi.createOpenClawKey)
const mockedCreateGuestOpenClawKey = vi.mocked(authApi.createGuestOpenClawKey)

describe('OpenClawSkillCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAgentInvitation.mockResolvedValue({onboarding_path:"/api/v1/agents/onboarding.md?invitation=tli_test_invitation",expires_at:Date.now()/1000+600})
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          site_stats: {
            topics_count: 12,
            openclaw_count: 3,
            replies_count: 27,
            likes_count: 45,
            favorites_count: 9,
            skills_count: 6,
          },
        }),
      }),
    )
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    })
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    })
  })

  it('renders generic skill url when user is logged out', async () => {
    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /智能体注册/ })).toBeInTheDocument()
    expect(within(view.container).getByRole('button', { name: '一键复制' })).toBeInTheDocument()
    expect(screen.getAllByText('帖子数量').length).toBeGreaterThan(0)
    expect(screen.getAllByText('智能体数量').length).toBeGreaterThan(0)
    expect(screen.getAllByText('回帖数量').length).toBeGreaterThan(0)
    expect(screen.getAllByText('点赞数量').length).toBeGreaterThan(0)
    expect(screen.getAllByText('收藏数量').length).toBeGreaterThan(0)
    expect(screen.getAllByText('应用/技能数量').length).toBeGreaterThan(0)
    expect(screen.getByText('只需一次复制，你的智能体就能接入他山世界，帮你筛选、分析和跟进信息。')).toBeInTheDocument()
    const expectedBase = import.meta.env.BASE_URL || '/'
    const expectedHomeHref = new URL(
      `${expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`}api/v1/home`,
      window.location.origin,
    ).toString()
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expectedHomeHref)
    })
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('27')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('copies anonymous skill when register is clicked without authentication', async () => {
    mockedCreateGuestOpenClawKey.mockResolvedValue({
      has_key: true,
      key: 'tloc_guest_key',
      bind_key: 'tlos_guest_bind_key',
      bootstrap_path: '/api/v1/agents/onboarding.md?invitation=tli_test_invitation',
      claim_register_path: '/register',
      claim_login_path: '/login',
      is_guest: true,
    })

    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard />
      </MemoryRouter>,
    )

    fireEvent.click(within(view.container).getByRole('button', { name: '一键复制' }))

    const expectedBase = import.meta.env.BASE_URL || '/'
    const expectedSkillHref = new URL(
      `${expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`}api/v1/agents/onboarding.md?invitation=tli_test_invitation`,
      window.location.origin,
    ).toString()

    expect(mockedCreateOpenClawKey).not.toHaveBeenCalled()
    expect(mockedCreateAgentInvitation).toHaveBeenCalledWith(undefined)
    expect(mockedCreateGuestOpenClawKey).not.toHaveBeenCalled()
    expect(await screen.findByText('邀请十分钟内有效，只能兑换一次。接入后可以登录网站管理账号。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去登录' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去注册' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute('href', '/login')
    expect(screen.getByText('智能体限时邀请')).toBeInTheDocument()
    expect(screen.getByText(expectedSkillHref)).toBeInTheDocument()
  })

  it('notifies the parent when copy is triggered', async () => {
    const onCopyAction = vi.fn()

    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard onCopyAction={onCopyAction} />
      </MemoryRouter>,
    )

    fireEvent.click(within(view.container).getByRole('button', { name: '一键复制' }))

    expect(onCopyAction).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('智能体限时邀请')).toBeInTheDocument()
  })

  it('shows personalized skill url after generating a bound key', async () => {
    tokenManager.set('jwt-token')
    tokenManager.setUser({
      id: 7,
      phone: '13812345678',
      username: 'alice',
      created_at: '2026-03-14T00:00:00Z',
    })

    mockedCreateOpenClawKey.mockResolvedValue({
      has_key: true,
      key: 'tloc_test_personal_key',
      bind_key: 'tlos_test_bind_key',
      bootstrap_path: '/api/v1/agents/onboarding.md?invitation=tli_test_invitation',
      masked_key: 'tloc_tes..._key',
      created_at: '2026-03-14T00:00:00Z',
      last_used_at: null,
    })

    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard />
      </MemoryRouter>,
    )

    fireEvent.click(within(view.container).getByRole('button', { name: '一键复制' }))

    await waitFor(() => {
      expect(mockedCreateAgentInvitation).toHaveBeenCalledWith('jwt-token')
    })

    expect(await within(view.container).findByText('已复制')).toBeInTheDocument()
  })

  it('falls back to execCommand when clipboard API is unavailable', async () => {
    tokenManager.set('jwt-token')
    mockedCreateOpenClawKey.mockResolvedValue({
      has_key: true,
      key: 'tloc_test_personal_key',
      bind_key: 'tlos_test_bind_key',
      bootstrap_path: '/api/v1/agents/onboarding.md?invitation=tli_test_invitation',
      masked_key: 'tloc_tes..._key',
      created_at: '2026-03-14T00:00:00Z',
      last_used_at: null,
    })
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })

    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard />
      </MemoryRouter>,
    )

    fireEvent.click(within(view.container).getByRole('button', { name: '一键复制' }))

    const expectedBase = import.meta.env.BASE_URL || '/'
    const expectedSkillHref = new URL(
      `${expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`}api/v1/agents/onboarding.md?invitation=tli_test_invitation`,
      window.location.origin,
    ).toString()

    expect(await within(view.container).findByText('智能体限时邀请')).toBeInTheDocument()
    expect(within(view.container).getByText(expectedSkillHref)).toBeInTheDocument()
    expect(await within(view.container).findByText('已复制')).toBeInTheDocument()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('renders the generated link when both clipboard strategies fail', async () => {
    tokenManager.set('jwt-token')
    mockedCreateOpenClawKey.mockResolvedValue({
      has_key: true,
      key: 'tloc_test_personal_key',
      bind_key: 'tlos_test_bind_key',
      bootstrap_path: '/api/v1/agents/onboarding.md?invitation=tli_test_invitation',
      masked_key: 'tloc_tes..._key',
      created_at: '2026-03-14T00:00:00Z',
      last_used_at: null,
    })
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
      configurable: true,
    })
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => {
        throw new Error('copy failed')
      }),
      configurable: true,
    })

    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard />
      </MemoryRouter>,
    )

    fireEvent.click(within(view.container).getByRole('button', { name: '一键复制' }))

    const expectedBase = import.meta.env.BASE_URL || '/'
    const expectedSkillHref = new URL(
      `${expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`}api/v1/agents/onboarding.md?invitation=tli_test_invitation`,
      window.location.origin,
    ).toString()

    expect(await within(view.container).findByText('智能体限时邀请')).toBeInTheDocument()
    expect(within(view.container).getByText(expectedSkillHref)).toBeInTheDocument()
    expect(within(view.container).getByText('如果浏览器未授予剪贴板权限，请手动复制下方链接。')).toBeInTheDocument()
  })
})
