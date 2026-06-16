import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ProgramAudienceStrip,
  ProgramCtaLink,
  ProgramHero,
  ProgramPosterFrame,
  ProgramSectionHeading,
} from '../PublicProgramPage'

describe('public program components', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a hero with CTAs, audience labels, and a visual slot', () => {
    render(
      <MemoryRouter>
        <ProgramHero
          accent="teal"
          eyebrow="PUBLIC PROGRAM"
          title="灵感共创队"
          subtitle="把想法推进到可验证的一步。"
          body="共创线索、真实问题和项目反馈在同一个页面沉淀。"
          primaryCta={{ href: '/inspiration-co-creation/submit', label: '填写需求/想法表单' }}
          secondaryCta={{ href: '/inspiration-co-creation/admin/needs', label: '管理员线索入口' }}
          audience={['真实问题提出者', 'AI 应用开发者']}
          audienceLabel="适合参与的人群"
          side={<ProgramPosterFrame accent="teal" label="活动海报"><img src="/poster.webp" alt="活动海报" /></ProgramPosterFrame>}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '灵感共创队' })).toBeInTheDocument()
    expect(screen.getByText('PUBLIC PROGRAM')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /填写需求\/想法表单/ })).toHaveAttribute('href', '/inspiration-co-creation/submit')
    expect(screen.getByRole('link', { name: '管理员线索入口' })).toHaveAttribute('href', '/inspiration-co-creation/admin/needs')
    expect(screen.getByLabelText('适合参与的人群').textContent?.replace(/\s+/g, '')).toBe('真实问题提出者/AI应用开发者')
    expect(screen.getByLabelText('活动海报')).toContainElement(screen.getByAltText('活动海报'))
  })

  it('renders internal and external CTA links correctly', () => {
    render(
      <MemoryRouter>
        <div>
          <ProgramCtaLink accent="sky" cta={{ href: '/youth-ted', label: '进入青年 TED' }} />
          <ProgramCtaLink accent="sky" cta={{ href: 'https://example.com', label: '查看详情', external: true, variant: 'secondary' }} />
        </div>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '进入青年 TED' })).toHaveAttribute('href', '/youth-ted')
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute('rel', 'noreferrer')
  })

  it('renders section heading and standalone audience strip', () => {
    render(
      <div>
        <ProgramSectionHeading accent="slate" eyebrow="工具接入" title="几个留下材料和过程的工具">
          TopicLab、世界脉络、SkillHub 和 Arcade 分别对应不同入口。
        </ProgramSectionHeading>
        <ProgramAudienceStrip accent="sky" items={['青年科研者', '跨学科实践者']} label="适合参与的人群" />
      </div>,
    )

    expect(screen.getByRole('heading', { name: '几个留下材料和过程的工具' })).toBeInTheDocument()
    expect(screen.getByText('工具接入')).toBeInTheDocument()
    expect(within(screen.getByLabelText('适合参与的人群')).getByText('青年科研者')).toBeInTheDocument()
  })
})
