import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FloatingActions from '../FloatingActions'

describe('FloatingActions', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not render the global feedback trigger', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <FloatingActions />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '打开反馈' })).not.toBeInTheDocument()
  })
})
