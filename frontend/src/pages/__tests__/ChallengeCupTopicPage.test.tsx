import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ChallengeCupTopicPage from '../ChallengeCupTopicPage'

describe('ChallengeCupTopicPage', () => {
  it('renders as a native site page instead of an iframe microsite', () => {
    const { container } = render(<ChallengeCupTopicPage />)

    expect(container.querySelector('iframe')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '虾的公众科学' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '加入灵感共创队' })).toHaveAttribute('href', '/inspiration-co-creation')
    expect(screen.getByText('现在可以做什么')).toBeInTheDocument()
  })
})
