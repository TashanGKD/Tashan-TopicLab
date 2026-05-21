import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WechatGroupQrPage from '../WechatGroupQrPage'

describe('WechatGroupQrPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the dedicated LGGC QR poster from the backend asset endpoint', () => {
    render(
      <MemoryRouter initialEntries={['/qr/lggc-wechat-group']}>
        <WechatGroupQrPage assetKey="lggc-wechat-group" title="灵感共创队群聊二维码" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '灵感共创队群聊二维码' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '灵感共创队群聊二维码' })).toHaveAttribute(
      'src',
      '/api/v1/site/assets/lggc-wechat-group.webp',
    )
    expect(screen.queryByRole('button', { name: '上传更新二维码' })).not.toBeInTheDocument()
  })

  it('uses the query key to upload and refresh the current QR image', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    render(
      <MemoryRouter initialEntries={['/qr/world-wechat-group?key=upload-secret']}>
        <WechatGroupQrPage assetKey="wechat-group-qr" title="他山世界交流群二维码" />
      </MemoryRouter>,
    )

    const fileInput = screen.getByLabelText('选择新二维码图片')
    const file = new File(['image'], 'world.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/site/assets/wechat-group-qr?key=upload-secret', {
        method: 'POST',
        body: expect.any(FormData),
      })
    })
    expect(screen.getByRole('img', { name: '他山世界交流群二维码' })).toHaveAttribute(
      'src',
      '/api/v1/site/assets/wechat-group-qr.webp?v=12345',
    )
    expect(screen.getByText('已更新二维码')).toBeInTheDocument()
  })
})
