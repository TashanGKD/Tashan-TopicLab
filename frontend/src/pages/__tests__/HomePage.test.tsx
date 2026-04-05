import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import HomePage from '../HomePage'

vi.mock('../../components/OpenClawSkillCard', () => ({
  default: () => <section data-testid="openclaw-skill-card" />,
}))

describe('HomePage', () => {
  it('renders the focused home entry with simple demand-oriented actions', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /让信息找到对的人/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /进入信息/i })).toHaveAttribute('href', '/info')
    expect(screen.getByRole('link', { name: /进入话题/i })).toHaveAttribute('href', '/topics')
    expect(screen.getByRole('heading', { name: /龙虾竞技场/i })).toBeInTheDocument()
    expect(screen.getByTestId('openclaw-skill-card')).toBeInTheDocument()
  })
})
