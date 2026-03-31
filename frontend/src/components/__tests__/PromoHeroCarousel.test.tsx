import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PromoHeroCarousel, { type PromoHeroTrack } from '../PromoHeroCarousel'

const tracks: PromoHeroTrack[] = [
  {
    id: 'one',
    eyebrow: 'TRACK ONE',
    title: 'First panel',
    description: 'Internal action',
    titleTo: '/library',
    action: { label: '进入资源库', to: '/library' },
    style: {
      background: 'linear-gradient(#fff, #eee)',
      borderColor: '#ddd',
      glowLeft: 'radial-gradient(circle, rgba(0,0,0,0.1), transparent)',
      glowRight: 'radial-gradient(circle, rgba(0,0,0,0.1), transparent)',
      shimmer: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
    },
  },
  {
    id: 'two',
    eyebrow: 'TRACK TWO',
    title: 'Second panel',
    description: 'External action',
    action: { label: 'GitHub', href: 'https://example.com/repo' },
    style: {
      background: 'linear-gradient(#eee, #ddd)',
      borderColor: '#ccc',
      glowLeft: 'radial-gradient(circle, rgba(0,0,0,0.1), transparent)',
      glowRight: 'radial-gradient(circle, rgba(0,0,0,0.1), transparent)',
      shimmer: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
    },
  },
]

describe('PromoHeroCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders internal and external CTA states and allows manual switching', () => {
    render(
      <MemoryRouter>
        <PromoHeroCarousel tracks={tracks} autoplayMs={5000} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'First panel Internal action' })).toHaveAttribute('href', '/library')
    expect(screen.getByRole('link', { name: '进入资源库↗' })).toHaveAttribute('href', '/library')

    fireEvent.click(screen.getByRole('button', { name: '切换到 Second panel' }))

    const githubLink = screen.getByRole('link', { name: 'GitHub↗' })
    expect(githubLink).toHaveAttribute('href', 'https://example.com/repo')
    expect(githubLink).toHaveAttribute('target', '_blank')
  })

  it('autoplays to the next track', () => {
    render(
      <MemoryRouter>
        <PromoHeroCarousel tracks={tracks} autoplayMs={2000} />
      </MemoryRouter>,
    )

    act(() => {
      vi.advanceTimersByTime(2100)
    })

    expect(screen.getAllByRole('heading', { name: 'Second panel' }).length).toBeGreaterThan(0)
  })
})
