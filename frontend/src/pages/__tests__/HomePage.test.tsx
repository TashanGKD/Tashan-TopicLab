import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from '../HomePage'

vi.mock('../../components/AppsPageCard', () => ({
  default: () => <section><h2>应用与技能</h2></section>,
}))

vi.mock('../../components/ArcadeArenaCard', () => ({
  default: () => <section><h2>龙虾竞技场</h2></section>,
}))

vi.mock('../../components/ResearchSkillZoneCard', () => ({
  default: () => <section><h2>科研技能专区</h2></section>,
}))

function createMockOpenClawController(onCopyAction?: () => void) {
  return {
    loading: false,
    copied: false,
    showLoginPrompt: false,
    generatedSkillUrl: null,
    generatedSkillIsBound: false,
    guestClaimLoginPath: null,
    guestClaimRegisterPath: null,
    siteStats: {
      topics_count: 0,
      openclaw_count: 0,
      replies_count: 0,
      likes_count: 0,
      favorites_count: 0,
      skills_count: 0,
    },
    copy: async () => {
      onCopyAction?.()
    },
  }
}

vi.mock('../../components/OpenClawSkillCard', () => ({
  useOpenClawSkillCardController: ({ onCopyAction }: { onCopyAction?: () => void } = {}) =>
    createMockOpenClawController(onCopyAction),
  default: ({
    controller,
    onCopyAction,
  }: {
    controller?: { copy?: () => Promise<void> }
    onCopyAction?: () => void
  }) => (
    <section>
      <h2>OpenClaw 注册</h2>
      <button
        type="button"
        onClick={() => {
          if (controller?.copy) {
            void controller.copy()
            return
          }
          onCopyAction?.()
        }}
      >
        触发复制暂停
      </button>
    </section>
  ),
}))

vi.mock('../../components/VerticalCardCarousel', () => ({
  default: ({
    items,
    activeIndex,
  }: {
    items: Array<{ label: string, content: ReactNode }>
    activeIndex: number
  }) => (
    <div aria-label="首页卡片轮播舞台">
      {items[activeIndex]?.label}
      {items[activeIndex]?.content}
    </div>
  ),
}))

describe('HomePage', () => {
  const getEntryButton = (label: string) => screen.getByRole('button', { name: label })
  const getStage = () => screen.getByLabelText('首页卡片轮播舞台')
  const renderHomePage = (initialEntries: string[] = ['/']) => render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/apps" element={<div>Apps Route</div>} />
        <Route path="/apps/skills" element={<div>Skills Route</div>} />
        <Route path="/profile-helper" element={<div>Profile Helper Route</div>} />
        <Route path="/arcade" element={<div>Arcade Route</div>} />
        <Route path="/thinking" element={<div>Thinking Route</div>} />
      </Routes>
    </MemoryRouter>,
  )
  let scrollIntoViewMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    scrollIntoViewMock = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the split hero with grouped home entry controls', () => {
    renderHomePage()

    expect(screen.getByRole('heading', { name: /保持专注/i })).toBeInTheDocument()
    expect(screen.getByText('科教生态')).toBeInTheDocument()
    expect(screen.getByText('信息专栏')).toBeInTheDocument()
    expect(screen.getByText('OpenClaw 专属')).toBeInTheDocument()
    expect(getEntryButton('OpenClaw 接入')).toBeInTheDocument()
    expect(getEntryButton('春招季')).toBeDisabled()
    expect(screen.getByRole('link', { name: /了解更多/i })).toHaveAttribute('href', '/thinking')
    expect(getStage()).toBeInTheDocument()
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()
  })

  it('switches the active card when choosing another home entry', () => {
    renderHomePage()

    fireEvent.click(getEntryButton('竞技场')!)

    expect(getEntryButton('竞技场')).toHaveAttribute('aria-pressed', 'true')
  })

  it('scrolls to the card stage after choosing another entry on mobile', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    })

    renderHomePage()

    fireEvent.click(getEntryButton('竞技场'))

    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('does not scroll to the card stage after choosing another entry on desktop', () => {
    renderHomePage()

    fireEvent.click(getEntryButton('竞技场'))

    act(() => {
      vi.advanceTimersByTime(16)
    })

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })

  it('autoplays from a random starting card', () => {
    renderHomePage()

    expect(Math.random).toHaveBeenCalled()
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(getEntryButton('科研 Skills 专区')).toHaveAttribute('aria-pressed', 'true')
    expect(within(getStage()).getByText('科研 Skills 专区')).toBeInTheDocument()
  })

  it('pauses autoplay for 30 seconds after clicking copy in the OpenClaw card', () => {
    renderHomePage()

    fireEvent.click(screen.getAllByRole('button', { name: '触发复制暂停' })[0])
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(getEntryButton('科研 Skills 专区')).toHaveAttribute('aria-pressed', 'true')
    expect(within(getStage()).getByText('科研 Skills 专区')).toBeInTheDocument()
  })

  it('triggers the same copy pause when clicking the hero OpenClaw entry button', () => {
    renderHomePage()

    fireEvent.click(getEntryButton('竞技场'))
    expect(within(getStage()).getByText('竞技场')).toBeInTheDocument()

    fireEvent.click(getEntryButton('OpenClaw 接入'))
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(getEntryButton('科研 Skills 专区')).toHaveAttribute('aria-pressed', 'true')
    expect(within(getStage()).getByText('科研 Skills 专区')).toBeInTheDocument()
  })

  it('triggers the same copy pause from the hero OpenClaw entry button on mobile', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    })

    renderHomePage()

    fireEvent.click(getEntryButton('竞技场'))
    expect(within(getStage()).getByText('竞技场')).toBeInTheDocument()

    fireEvent.click(getEntryButton('OpenClaw 接入'))
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(getEntryButton('科研 Skills 专区')).toHaveAttribute('aria-pressed', 'true')
    expect(within(getStage()).getByText('科研 Skills 专区')).toBeInTheDocument()
  })

  it('navigates directly when clicking the active home entry control again', () => {
    renderHomePage()

    fireEvent.click(getEntryButton('应用与技能'))
    expect(getEntryButton('应用与技能')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(getEntryButton('应用与技能'))

    expect(screen.getByText('Apps Route')).toBeInTheDocument()
  })
})
