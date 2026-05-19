import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspirationCoCreationPage from '../InspirationCoCreationPage'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    inspirationApi: {
      listDemands: vi.fn(() => Promise.resolve({
        data: {
          list: [
            {
              id: 'demand-1',
              slug: 'need-01-ai-english-reading-assistant',
              clue_number: 1,
              status: 'published',
              stage: '模糊想法',
              title: '英语阅读课堂的 AI 助教',
              summary: '把一套大学英语阅读课拆成词汇、语法、阅读、翻译和写作训练。',
              tags: ['教育 / 学习', '需求拆解'],
              stuck: '问题太大，需要拆成可先验证的一步。',
              path_progress: [
                { key: 'submitted', label: '留下线索', status: 'done', summary: '', emotion_note: '' },
                { key: 'defined', label: '问题定义', status: 'current', summary: '', emotion_note: '' },
              ],
              created_at: '2026-05-15 15:32:05',
              updated_at: '2026-05-18T00:00:00Z',
            },
            {
              id: 'demand-2',
              slug: 'need-02-demo-feedback',
              clue_number: 2,
              status: 'published',
              stage: '模糊想法',
              title: 'AI for Science Demo 反馈',
              summary: '已有 Demo，希望获得真实用户反馈并寻找协作伙伴。',
              tags: ['科研 / AI for Science', 'Demo 反馈', '找伙伴'],
              stuck: '缺少真实用户反馈，需要协作伙伴。',
              path_progress: [
                { key: 'submitted', label: '留下线索', status: 'needs_input', summary: '请补充：最小验证对象是谁？', emotion_note: '' },
                { key: 'defined', label: '问题定义', status: 'pending', summary: '', emotion_note: '' },
              ],
              created_at: '2026-05-16 15:32:05',
              updated_at: '2026-05-19T00:00:00Z',
            },
          ],
        },
      })),
      getDemand: vi.fn(() => Promise.resolve({
        data: {
          demand: {
            id: 'demand-1',
            slug: 'need-01-ai-english-reading-assistant',
            status: 'published',
            stage: '模糊想法',
            title: '英语阅读课堂的 AI 助教',
            summary: '把一套大学英语阅读课拆成词汇、语法、阅读、翻译和写作训练。',
            tags: ['教育 / 学习', '需求拆解'],
            stuck: '问题太大，需要拆成可先验证的一步。',
            created_at: '2026-05-15 15:32:05',
            updated_at: '2026-05-18T00:00:00Z',
            can_view_private: true,
            private: { 称呼: 'May', 联系方式: '18773233131' },
          },
        },
      })),
    },
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <InspirationCoCreationPage />
    </MemoryRouter>,
  )
}

describe('InspirationCoCreationPage', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows audience categories without repeated descriptions in the hero audience strip', () => {
    renderPage()

    const audience = screen.getByLabelText('适合参与的人群')
    const primaryCta = screen.getByRole('link', { name: /填写需求\/想法表单/ })

    expect(primaryCta).toHaveAttribute(
      'href',
      '/inspiration-co-creation/submit',
    )
    expect(screen.getByText('真实问题提出者')).toBeInTheDocument()
    expect(screen.getByText('AI 应用开发者')).toBeInTheDocument()
    expect(screen.getByText('项目验证志愿者')).toBeInTheDocument()
    expect(audience.textContent?.replace(/\s+/g, '')).toBe(
      '真实问题提出者/AI应用开发者/行业观察者/产品与设计伙伴/高校社群成员/项目验证志愿者',
    )
    expect(primaryCta.closest('.max-w-3xl')).toContainElement(audience)
    expect(screen.queryByText('围绕真实场景组队，把想法推进到可验证的一步。')).not.toBeInTheDocument()
  })

  it('shows desensitized real needs directly as a waterfall', () => {
    renderPage()

    expect(screen.queryByText('共创流程')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /查看共创流程/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /浏览真实需求/ })).not.toBeInTheDocument()
    expect(screen.queryByText('真实需求墙')).not.toBeInTheDocument()
    expect(screen.queryByText('上传真实表单')).not.toBeInTheDocument()

    const waterfall = screen.getByLabelText('共创线索瀑布流')
    expect(within(waterfall).getByText('英语阅读课堂的 AI 助教')).toBeInTheDocument()
    expect(within(waterfall).getAllByText('问题定义').length).toBeGreaterThanOrEqual(1)
    expect(within(waterfall).queryByText('一个需求、想法或参与意愿已经被放到这里。')).not.toBeInTheDocument()
    expect(within(waterfall).queryByText('已脱敏')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /显示需求 01 完整信息/ })).not.toBeInTheDocument()
    expect(within(waterfall).queryByText('人工访谈')).not.toBeInTheDocument()
    expect(screen.queryByText('18773233131')).not.toBeInTheDocument()
  })

  it('summarizes public clues above the waterfall without revealing private data', async () => {
    renderPage()

    const overview = await screen.findByLabelText('线索概览')

    expect(within(overview).getByText('线索总数')).toBeInTheDocument()
    expect(within(overview).getByText('待补充')).toBeInTheDocument()
    expect(within(overview).getByText('Demo/反馈')).toBeInTheDocument()
    expect(within(overview).getByText('参与/围观')).toBeInTheDocument()
    expect(within(overview).getByText('方向分布')).toBeInTheDocument()
    expect(within(overview).getByText('路径分布')).toBeInTheDocument()
    expect(within(overview).getByText('卡点标签')).toBeInTheDocument()
    expect(within(overview).getByText('教育')).toBeInTheDocument()
    expect(within(overview).getByText('科研')).toBeInTheDocument()
    expect(within(overview).getByText('留下线索')).toBeInTheDocument()
    expect(within(overview).getByText('真实反馈')).toBeInTheDocument()
    expect(within(overview).queryByText('18773233131')).not.toBeInTheDocument()
  })

  it('renders each demand card as a direct detail link', async () => {
    renderPage()

    await screen.findByRole('link', { name: /打开线索 01：英语阅读课堂的 AI 助教/ })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /打开线索 01：英语阅读课堂的 AI 助教/ })).toHaveAttribute(
        'href',
        '/inspiration-co-creation/needs/need-01-ai-english-reading-assistant',
      )
    })
  })

  it('does not reveal full form details on the public wall', async () => {
    localStorage.setItem(
      'auth_user',
      JSON.stringify({
        id: 1,
        phone: 'admin',
        username: '管理员',
        is_admin: true,
        created_at: '2026-05-18T00:00:00Z',
      }),
    )

    renderPage()
    await screen.findByText('把一套大学英语阅读课拆成词汇、语法、阅读、翻译和写作训练。')

    expect(screen.queryByRole('button', { name: /显示需求 01 完整信息/ })).not.toBeInTheDocument()
    expect(screen.queryByText('18773233131')).not.toBeInTheDocument()
  })
})
