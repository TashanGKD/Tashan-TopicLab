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

  it('renders the dedicated LGGC QR poster from the backend asset endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ updated_at: '2026-05-28T16:03:32Z' }),
        }),
      ),
    )

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
    expect(await screen.findByLabelText('二维码最近更新时间')).toHaveTextContent(
      '最近一次二维码图片更新时间：2026/05/29 00:03:32',
    )
  })

  it('uses the query key to upload and refresh the current QR image', async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ updated_at: '2026-05-29T00:03:32+08:00' }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated_at: '2026-05-28T16:03:32Z' }),
      })
    })
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
    expect(screen.getByLabelText('二维码最近更新时间')).toHaveTextContent(
      '最近一次二维码图片更新时间：2026/05/29 00:03:32',
    )
  })
})
