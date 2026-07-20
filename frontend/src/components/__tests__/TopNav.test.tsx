import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TopNav from '../TopNav'

vi.mock('../../api/auth', () => ({
  authApi: {
    startWatchaLogin: vi.fn(),
  },
  refreshCurrentUserProfile: vi.fn(),
  tokenManager: {
    get: vi.fn(() => null),
    getUser: vi.fn(() => null),
    remove: vi.fn(),
    clearUser: vi.fn(),
  },
}))

vi.mock('../../api/client', () => ({
  inboxApi: {
    list: vi.fn(),
  },
}))

describe('TopNav', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('labels the info route as world context in desktop and mobile navigation', () => {
    render(
      <MemoryRouter initialEntries={['/inspiration-co-creation']}>
        <TopNav />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('link', { name: '世界脉络' })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: '信息' })).not.toBeInTheDocument()
  })

  it('keeps activity pages behind one mobile activity tab', () => {
    render(
      <MemoryRouter initialEntries={['/inspiration-co-creation']}>
        <TopNav />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '灵感共创队' })).toHaveAttribute('href', '/inspiration-co-creation')
    expect(screen.getByRole('link', { name: '活动' })).toHaveAttribute('href', '/activities')
    expect(screen.getByRole('link', { name: '活动' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: 'TED' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '灵感共创' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '共创队' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '共创' })).not.toBeInTheDocument()
  })

  it('links to the Challenge Cup topic from desktop navigation', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopNav />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '挑战杯专题' })).toHaveAttribute('href', '/challenge-cup-topic')
  })

  it('places the research SkillHub after TopicLink in the desktop navigation', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopNav />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation')
    const links = Array.from(nav.querySelectorAll('a')).map((link) => link.textContent?.trim())
    expect(links.indexOf('科研 SkillHub')).toBe(links.indexOf('TopicLink') + 1)
    expect(screen.getByRole('link', { name: '科研 SkillHub' })).toHaveAttribute('href', '/skillhub')
  })

  it('hides the digital twin link from the public navigation bar', () => {
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <TopNav />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: '数字分身' })).not.toBeInTheDocument()
  })
})
