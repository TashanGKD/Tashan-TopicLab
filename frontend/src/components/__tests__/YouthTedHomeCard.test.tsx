import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import YouthTedHomeCard from '../YouthTedHomeCard'

describe('YouthTedHomeCard', () => {
  it('keeps short topic labels from breaking within a word', () => {
    render(
      <BrowserRouter>
        <YouthTedHomeCard />
      </BrowserRouter>,
    )

    expect(screen.getByText('青年同频')).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('AI 前沿')).toHaveClass('whitespace-nowrap')
  })
})
