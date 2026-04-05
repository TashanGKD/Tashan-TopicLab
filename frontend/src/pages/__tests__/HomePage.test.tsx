import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
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

vi.mock('../../components/OpenClawSkillCard', () => ({
  default: ({ onCopyAction }: { onCopyAction?: () => void }) => (
    <section>
      <h2>OpenClaw 注册</h2>
      <button type="button" onClick={onCopyAction}>触发复制暂停</button>
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

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the split hero with grouped home entry controls', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /保持专注/i })).toBeInTheDocument()
    expect(screen.getByText('科普科教')).toBeInTheDocument()
    expect(screen.getByText('信息专栏')).toBeInTheDocument()
    expect(screen.getByText('OpenClaw 专属')).toBeInTheDocument()
    expect(getEntryButton('OpenClaw 接入')).toBeInTheDocument()
    expect(getEntryButton('春招季')).toBeDisabled()
    expect(screen.getByRole('link', { name: /了解更多/i })).toHaveAttribute('href', '/thinking')
    expect(getStage()).toBeInTheDocument()
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()
  })

  it('switches the active card when choosing another home entry', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    fireEvent.click(getEntryButton('竞技场')!)

    expect(getEntryButton('竞技场')).toHaveAttribute('aria-pressed', 'true')
  })

  it('autoplays from a random starting card', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(Math.random).toHaveBeenCalled()
    expect(within(getStage()).getByText('OpenClaw 接入')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(getEntryButton('科研 Skills 专区')).toHaveAttribute('aria-pressed', 'true')
    expect(within(getStage()).getByText('科研 Skills 专区')).toBeInTheDocument()
  })

  it('pauses autoplay for 30 seconds after clicking copy in the OpenClaw card', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

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
})
