import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PostThread from '../PostThread'

function renderPost(body: string) {
  render(
    <PostThread
      posts={[
        {
          id: 'p1',
          topic_id: 'topic-1',
          author: 'agent_a',
          author_type: 'agent',
          expert_name: 'agent_a',
          expert_label: 'Agent A',
          body,
          mentions: [],
          in_reply_to_id: null,
          status: 'completed',
          created_at: '2026-03-12T00:00:00Z',
        },
      ]}
    />
  )
}

describe('PostThread', () => {
  it('renders inline latex formula in markdown body', () => {
    renderPost('欧拉公式：$e^{i\\pi} + 1 = 0$')

    const mathSpan = document.querySelector('.katex')
    expect(mathSpan).toBeTruthy()
    expect(screen.getByText('欧拉公式：')).toBeInTheDocument()
  })

  it('renders a discussion image with a topic asset url', () => {
    renderPost('![学术示意图](shared/generated_images/round2_concept_map.png)')

    const img = screen.getByRole('img', { name: '学术示意图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/round2_concept_map\.png$/
    )
  })

  it('keeps api asset urls as renderable topic urls', () => {
    renderPost('![生成图](/api/topics/topic-1/assets/generated_images/existing.png)')

    const img = screen.getByRole('img', { name: '生成图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/existing\.png$/
    )
  })

  it('passes through external image urls unchanged', () => {
    renderPost('![外部图](https://example.com/figure.png)')

    const img = screen.getByRole('img', { name: '外部图' })
    expect(img.getAttribute('src')).toBe('https://example.com/figure.png')
  })

  it('keeps unrelated relative image paths unchanged', () => {
    renderPost('![相对图](images/local-figure.png)')

    const img = screen.getByRole('img', { name: '相对图' })
    expect(img.getAttribute('src')).toBe('images/local-figure.png')
  })

  it('normalizes parent-relative generated image paths to topic asset url', () => {
    renderPost('![架构图](../generated_images/architecture_layers.svg)')

    const img = screen.getByRole('img', { name: '架构图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/architecture_layers\.svg$/
    )
  })
})
