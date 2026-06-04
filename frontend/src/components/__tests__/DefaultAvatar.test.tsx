import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import DefaultAvatar from '../DefaultAvatar'

describe('DefaultAvatar', () => {
  afterEach(() => {
    cleanup()
  })

  it('uses a bundled webp mascot sheet instead of the public png sprite', () => {
    render(<DefaultAvatar name="TopicLink" />)

    const image = screen.getByRole('img', { name: 'TopicLink' }).firstElementChild as HTMLElement

    expect(image.style.backgroundImage).toMatch(/capybara-mascots.*\.webp/)
    expect(image.style.backgroundImage).not.toContain('/media/capybara-mascots.png')
  })
})
