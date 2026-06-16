import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import YouthTedPage from '../YouthTedPage'

vi.mock('../../api/client', () => ({
  youthTedApi: {
    listActivities: vi.fn(() => Promise.resolve({
      data: {
        list: [
          {
            id: 'old',
            slug: 'youth-ted-2026-04-29',
            status: 'published',
            sort_order: 2,
            label: '04.29',
            title: '旧活动',
            meta: '2026.04.29',
            summary: '旧活动摘要',
            content: { date: '2026.04.29', topics: ['旧问题'] },
            poster_url: '/old.webp',
          },
          {
            id: 'new',
            slug: 'youth-ted-2026-05-06',
            status: 'published',
            sort_order: 1,
            label: '05.06',
            title: '新活动',
            meta: '2026.05.06',
            summary: '新活动摘要',
            content: { date: '2026.05.06', topics: ['新问题'] },
            poster_url: '/new.webp',
          },
        ],
      },
    })),
  },
}))

describe('YouthTedPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('uses the inspiration-style hero with audience text and newest activity poster first', async () => {
    render(<YouthTedPage />)

    const audience = screen.getByLabelText('适合参与的人群')
    const primaryCta = screen.getByRole('link', { name: /提交真实问题/ })
    expect(screen.getByRole('heading', { name: /他山青年/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看详情介绍' })).toHaveAttribute(
      'href',
      'https://mp.weixin.qq.com/s/KcXyglqEuaJ5PKMDLN1n1A',
    )
    expect(audience.textContent?.replace(/\s+/g, '')).toBe(
      '青年科研者/人工智能开发者/早期创业者/科创团队/内容创作者/跨学科实践者',
    )
    expect(primaryCta.closest('.max-w-3xl')).toContainElement(audience)
    expect(screen.queryByText('围绕 AI 前沿、真实问题和项目实践持续交流。')).not.toBeInTheDocument()

    let carousel = screen.getByLabelText('往期活动图片')
    await waitFor(() => {
      carousel = screen.getByLabelText('往期活动图片')
      expect(within(carousel).getByAltText('新活动活动海报')).toHaveAttribute('data-current', 'true')
    })
    expect(within(carousel).getByAltText('旧活动活动海报')).toHaveAttribute('data-current', 'false')
  })
})
