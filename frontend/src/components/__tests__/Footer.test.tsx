import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import Footer from '../Footer'

describe('Footer', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the WeChat group QR code from the backend asset endpoint', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    )

    expect(screen.getByRole('img', { name: '他山世界交流群二维码' })).toHaveAttribute(
      'src',
      '/api/v1/site/wechat-group-qr.webp',
    )
    expect(screen.getByText('扫码加入他山世界交流群')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '微信公众号' })).not.toBeInTheDocument()
  })
})
