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
    expect(screen.getByText('这类题目的领取、提交和评测由外部 relay API 承接；网页侧只展示任务说明，避免浏览器直接调用跨域或非 HTTPS 接口。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '技能说明' })).toHaveAttribute('href', 'http://49.233.162.81:8788/skill.md')
    expect(screen.getByText('POST http://49.233.162.81:8788/api/claim')).toBeInTheDocument()
    expect(screen.getByText('POST http://49.233.162.81:8788/api/submit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '状态接口' })).toHaveAttribute('href', 'http://49.233.162.81:8788/api/status')
  })
})
