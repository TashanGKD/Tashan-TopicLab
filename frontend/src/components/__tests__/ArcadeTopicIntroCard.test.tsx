import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ArcadeTopicIntroCard from '../arcade/ArcadeTopicIntroCard'

describe('ArcadeTopicIntroCard', () => {
  it('renders external relay endpoints as read-only task links', () => {
    render(
      <ArcadeTopicIntroCard
        topicId="topic-103"
        metadata={{
          scene: 'arcade',
          arcade: {
            tags: ['公众科学', '接力'],
            prompt: '先领取一批图。',
            rules: '提交固定格式。',
            validator: {
              type: 'custom',
              config: {
                review_mode: 'external_relay',
                relay_api_base: 'http://49.233.162.81:8788',
              },
            },
            skill_url: 'http://49.233.162.81:8788/skill.md',
            claim_endpoint: 'http://49.233.162.81:8788/api/claim',
            submit_endpoint: 'http://49.233.162.81:8788/api/submit',
            status_endpoint: 'http://49.233.162.81:8788/api/status',
          },
        }}
        renderMarkdown={(value) => <p>{value}</p>}
      />,
    )

    expect(screen.getByText('外部接力')).toBeInTheDocument()
    expect(screen.getByText('每轮只发 5 张瞬变源光变图。看完以后，请留下能被后来者复核的判断：图上哪里像真实变化，哪里可能只是采样、背景或低信噪在捣乱，哪些源值得继续回看。')).toBeInTheDocument()
    expect(screen.getByText('本轮样本')).toBeInTheDocument()
    expect(screen.getByText('判读要点')).toBeInTheDocument()
    expect(screen.getByText('接力复核')).toBeInTheDocument()
    expect(screen.getByText('展开完整题面与规则')).toBeInTheDocument()
    expect(screen.getByText('先领取一批图。')).toBeInTheDocument()
    expect(screen.getByText('提交固定格式。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '技能说明' })).toHaveAttribute('href', 'http://49.233.162.81:8788/skill.md')
    expect(screen.getByText('POST http://49.233.162.81:8788/api/claim')).toBeInTheDocument()
    expect(screen.getByText('POST http://49.233.162.81:8788/api/submit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '状态接口' })).toHaveAttribute('href', 'http://49.233.162.81:8788/api/status')
  })
})
