import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WechatGroupQrPage from '../WechatGroupQrPage'

const worldGroup = {
  slug: 'world-wechat-group',
  path: '/qr/world-wechat-group',
  title: '他山世界交流群二维码',
  key: 'wechat-group-qr',
  url: '/api/v1/site/assets/wechat-group-qr.webp',
  updated_at: '2026-05-28T16:03:32Z',
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/qr/:slug" element={<WechatGroupQrPage />} />
        <Route path="/admin/qr" element={<WechatGroupQrPage adminMode />} />
        <Route path="/login" element={<div>站点登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WechatGroupQrPage', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads any QR path dynamically and renders its configured title and image', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(worldGroup) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/qr/world-wechat-group')

    expect(await screen.findByRole('heading', { name: '他山世界交流群二维码' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/site/qr-groups/world-wechat-group')
    expect(screen.getByRole('img', { name: '他山世界交流群二维码' })).toHaveAttribute(
      'src',
      '/api/v1/site/assets/wechat-group-qr.webp',
    )
    expect(screen.queryByRole('heading', { name: '二维码管理' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('二维码最近更新时间')).toHaveTextContent(
      '最近一次二维码图片更新时间：2026/05/29 00:03:32',
    )
  })

  it('uses the site admin account token to create a QR with a path, title, and image', async () => {
    localStorage.setItem('auth_token', 'site-admin-token')
    const createdGroup = {
      ...worldGroup,
      slug: 'summer-community',
      path: '/qr/summer-community',
      title: '夏日共创群',
      key: 'qr-summer-community',
      url: '/api/v1/site/assets/qr-summer-community.webp',
    }
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(createdGroup) })
      }
      if (url.endsWith('/qr-groups/admin')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [worldGroup] }) })
      }
      if (url.endsWith('/summer-community')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(createdGroup) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(worldGroup) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/admin/qr')

    expect(await screen.findByRole('heading', { name: '二维码管理' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 新增' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('二维码公开路径'), { target: { value: 'summer-community' } })
    fireEvent.change(screen.getByLabelText('二维码标题'), { target: { value: '夏日共创群' } })
    const file = new File(['image'], 'summer.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('选择二维码图片'), { target: { files: [file] } })
    fireEvent.submit(screen.getByRole('button', { name: '创建二维码' }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(createCall?.[0]).toBe('/api/v1/site/qr-groups')
      expect(createCall?.[1]?.headers).toEqual({ Authorization: 'Bearer site-admin-token' })
      const body = createCall?.[1]?.body as FormData
      expect(body.get('path')).toBe('/qr/summer-community')
      expect(body.get('title')).toBe('夏日共创群')
      expect(body.get('image')).toBe(file)
    })
    expect(await screen.findByText('二维码已创建')).toBeInTheDocument()
  })

  it('can edit an existing QR title and public path without replacing its image', async () => {
    localStorage.setItem('auth_token', 'site-admin-token')
    const updatedGroup = {
      ...worldGroup,
      slug: 'world-community',
      path: '/qr/world-community',
      title: '他山世界新群',
    }
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(updatedGroup) })
      }
      if (url.endsWith('/qr-groups/admin')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [worldGroup] }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(worldGroup) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/admin/qr')

    const existingCard = await screen.findByRole('button', { name: /他山世界交流群二维码/ })
    fireEvent.click(existingCard)
    fireEvent.change(screen.getByLabelText('二维码公开路径'), { target: { value: 'world-community' } })
    fireEvent.change(screen.getByLabelText('二维码标题'), { target: { value: '他山世界新群' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
      expect(updateCall?.[0]).toBe('/api/v1/site/qr-groups/world-wechat-group')
      expect(updateCall?.[1]?.headers).toEqual({ Authorization: 'Bearer site-admin-token' })
      const body = updateCall?.[1]?.body as FormData
      expect(body.get('path')).toBe('/qr/world-community')
      expect(body.get('title')).toBe('他山世界新群')
      expect(body.get('image')).toBeNull()
    })
  })

  it('redirects unauthenticated visitors to the site login page', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/admin/qr')

    expect(await screen.findByText('站点登录页')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears an expired site token and redirects to login', async () => {
    localStorage.setItem('auth_token', 'expired-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ detail: '登录已过期' }),
        }),
      ),
    )

    renderPage('/admin/qr')

    expect(await screen.findByText('站点登录页')).toBeInTheDocument()
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('rejects a logged-in account without site administrator permission', async () => {
    localStorage.setItem('auth_token', 'regular-user-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ detail: '需要管理员权限' }),
        }),
      ),
    )

    renderPage('/admin/qr')

    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号没有管理员权限')
    expect(localStorage.getItem('auth_token')).toBe('regular-user-token')
  })
})
