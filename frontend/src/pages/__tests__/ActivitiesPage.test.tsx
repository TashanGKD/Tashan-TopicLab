import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import ActivitiesPage from '../ActivitiesPage'

describe('ActivitiesPage', () => {
  it('links to the public activity pages', () => {
    render(
      <MemoryRouter>
        <ActivitiesPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '活动' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /他山青年 TED/ })).toHaveAttribute('href', '/youth-ted')
    expect(screen.getByRole('link', { name: /灵感共创队/ })).toHaveAttribute('href', '/inspiration-co-creation')
    expect(screen.getByRole('link', { name: /挑战杯专题/ })).toHaveAttribute('href', '/challenge-cup-topic')
  })
})
