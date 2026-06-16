import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ChallengeCupTopicPage from '../ChallengeCupTopicPage'

describe('ChallengeCupTopicPage', () => {
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
    expect(screen.getByText('每周讨论')).toBeInTheDocument()
  })
})
