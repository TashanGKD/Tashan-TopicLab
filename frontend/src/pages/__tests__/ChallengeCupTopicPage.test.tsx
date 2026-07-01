import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChallengeCupTopicPage from '../ChallengeCupTopicPage'

describe('ChallengeCupTopicPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders as a native site page instead of an iframe microsite', () => {
    const { container } = render(<ChallengeCupTopicPage />)

    expect(container.querySelector('iframe')).not.toBeInTheDocument()
    expect(screen.queryByText('Challenge Cup Topic')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '挑战杯中国青年科技创新揭榜挂帅擂台赛官方横幅' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '挑战杯公众科学' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看工具接入' })).toHaveAttribute('href', '#tools')
    expect(screen.getByRole('link', { name: '挑战杯官方页面' })).toHaveAttribute('href', 'https://university.aliyun.com/action/tzbjbgs2026')
    expect(screen.getByRole('link', { name: '进入灵感共创队' })).toHaveAttribute('href', '/inspiration-co-creation')
    expect(screen.getByRole('link', { name: '进入青年 TED' })).toHaveAttribute('href', '/youth-ted')
    expect(screen.getByRole('heading', { name: '周三，他山青年 TED' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '周五，灵感共创队' })).toBeInTheDocument()
    expect(screen.getByLabelText('科学问题自动滚动列表')).toBeInTheDocument()
    expect(screen.getAllByText('125个前沿问题')).toHaveLength(1)
    expect(screen.getByText('科学问题样例')).toBeInTheDocument()
    expect(screen.getByText('Open Deep Research')).toBeInTheDocument()
    expect(screen.getByText('工具接入')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '科研实用工具' })).toBeInTheDocument()
    expect(screen.getByText('每日更新领域前沿动态，含最新研究与工具发布。')).toBeInTheDocument()
    expect(screen.getByText('查看已验证的研究方法模板，可直接用于项目。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '科研问题示例' })).toBeInTheDocument()
    expect(screen.getByText('黑洞的观测与理论存在差异，需要进一步研究。')).toBeInTheDocument()
    expect(screen.getByText('AI如何改变分子发现和实验设计方法。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '每周科研讨论安排' })).toBeInTheDocument()
    expect(screen.getByText('每周三讨论前沿研究，周五解决具体问题。')).toBeInTheDocument()
    expect(screen.getByText('分享最新AI模型和科研工具的应用案例。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '参考项目资源' })).toBeInTheDocument()
    expect(screen.getByText('管理研究假设和实验设计的工具。')).toBeInTheDocument()
    expect(screen.getByText('自动化文献检索与证据提取工具。')).toBeInTheDocument()
    expect(screen.getByText('确保实验结果可靠性的验证工具。')).toBeInTheDocument()
    expect(screen.queryByText('每周都有线上讨论，欢迎来玩')).not.toBeInTheDocument()
    expect(screen.queryByText('你可以从这些问题开始')).not.toBeInTheDocument()
    expect(screen.getByText('Agent4S 专栏')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Agent4S：人工智能驱动的科研范式革命' })).toBeInTheDocument()
    expect(screen.queryByText('这组公众号文章来自他山主页 Agent4S 板块，覆盖数据规范、记忆与工具、OpenClaw 运行过程、科研第五范式和实验科学闭环。')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看专辑' })).toHaveAttribute('href', 'https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzkyNjY0NjI3NA==&action=getalbum&album_id=4525736241471864843')
    expect(screen.getByRole('heading', { name: 'Agent4S｜实验科学重构：从人为决策逐渐走向智能闭环' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Agent4S｜实验科学重构：从人为决策逐渐走向智能闭环' })).toBeInTheDocument()
    expect(screen.getByLabelText('Agent4S 文章列表')).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('link', { name: /Agent4S｜实验科学重构/ })).toHaveClass('w-[13.5rem]')
    expect(screen.getByText('阅读 214')).toBeInTheDocument()
    expect(screen.getByText('每周讨论')).toBeInTheDocument()
  })

  it('hydrates Agent4S articles from the shared database API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          articles: [
            {
              msgid: 'shared-db',
              title: 'Agent4S｜共享数据库实时文章',
              cover_url: 'https://example.com/shared.jpg',
              link: 'https://mp.weixin.qq.com/s/shared-db',
              published_at: '2026-07-01T10:00:00+08:00',
              read_count: 88,
              like_count: 9,
            },
          ],
        }),
      })),
    )

    render(<ChallengeCupTopicPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Agent4S｜共享数据库实时文章' })).toBeInTheDocument()
    })
    expect(screen.getByText('阅读 88')).toBeInTheDocument()
    expect(screen.getByText('点赞 9')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Agent4S｜共享数据库实时文章' })).toHaveAttribute('src', 'https://example.com/shared.jpg')
  })
})
