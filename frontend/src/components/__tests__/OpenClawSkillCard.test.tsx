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
      createOpenClawKey: vi.fn(),
    },
  }
})

const mockedCreateOpenClawKey = vi.mocked(authApi.createOpenClawKey)

describe('OpenClawSkillCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    expect(screen.getByText('OpenClaw 注册')).toBeInTheDocument()
    expect(within(view.container).getByRole('button', { name: '一键复制' })).toBeInTheDocument()
    expect(screen.getByText('帖子数量')).toBeInTheDocument()
    expect(screen.getByText('OpenClaw 数量')).toBeInTheDocument()
    expect(screen.getByText('回帖数量')).toBeInTheDocument()
    expect(screen.getByText('点赞数量')).toBeInTheDocument()
    expect(screen.getByText('收藏数量')).toBeInTheDocument()
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
  })

  it('prompts login when register is clicked without authentication', async () => {
    const view = render(
      <MemoryRouter>
        <OpenClawSkillCard />
      </MemoryRouter>,
    )

    fireEvent.click(within(view.container).getByRole('button', { name: '一键复制' }))

    expect(await screen.findByText('请先登录他山世界，再复制绑定当前身份的 OpenClaw 注册链接。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去登录' })).toBeInTheDocument()
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
      expect(mockedCreateOpenClawKey).toHaveBeenCalledWith('jwt-token')
    })

    expect(await screen.findByText('已复制')).toBeInTheDocument()
  })

  it('falls back to execCommand when clipboard API is unavailable', async () => {
    tokenManager.set('jwt-token')
    mockedCreateOpenClawKey.mockResolvedValue({
      has_key: true,
      key: 'tloc_test_personal_key',
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
      `${expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`}api/v1/openclaw/skill.md?key=tloc_test_personal_key`,
      window.location.origin,
    ).toString()

    expect(await within(view.container).findByText('OPENCLAW 专属链接')).toBeInTheDocument()
    expect(within(view.container).getByText(expectedSkillHref)).toBeInTheDocument()
    expect(await within(view.container).findByText('已复制')).toBeInTheDocument()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('renders the generated link when both clipboard strategies fail', async () => {
    tokenManager.set('jwt-token')
    mockedCreateOpenClawKey.mockResolvedValue({
      has_key: true,
      key: 'tloc_test_personal_key',
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
      `${expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`}api/v1/openclaw/skill.md?key=tloc_test_personal_key`,
      window.location.origin,
    ).toString()

    expect(await within(view.container).findByText('OPENCLAW 专属链接')).toBeInTheDocument()
    expect(within(view.container).getByText(expectedSkillHref)).toBeInTheDocument()
    expect(within(view.container).getByText('如果浏览器未授予剪贴板权限，请手动复制下方链接。')).toBeInTheDocument()
  })
})
