import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PostThread from '../PostThread'

function renderPost(body: string) {
  const result = render(
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

  return {
    ...result,
    renderRichBody: () => {
      fireEvent.click(result.container.querySelector('.markdown-content') as HTMLElement)
    },
  }
}

describe('PostThread', () => {
  beforeEach(() => {
    class MockIntersectionObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as any)
  })

  it('renders inline latex formula in markdown body', async () => {
    const { renderRichBody, container } = renderPost('欧拉公式：$e^{i\\pi} + 1 = 0$')

    renderRichBody()

    await waitFor(() => {
      expect(container.querySelector('.katex')).toBeTruthy()
    })
    expect(screen.getByText(/欧拉公式/)).toBeInTheDocument()
  })

  it('renders a discussion image with a topic asset url', async () => {
    const { renderRichBody } = renderPost('![学术示意图](shared/generated_images/round2_concept_map.png)')

    renderRichBody()

    const img = await screen.findByRole('img', { name: '学术示意图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/round2_concept_map\.png\?q=82&fm=webp$/
    )
  })

  it('keeps api asset urls as renderable topic urls', async () => {
    const { renderRichBody } = renderPost('![生成图](/api/topics/topic-1/assets/generated_images/existing.png)')

    renderRichBody()

    const img = await screen.findByRole('img', { name: '生成图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/existing\.png\?q=82&fm=webp$/
    )
  })

  it('passes through external image urls unchanged', async () => {
    const { renderRichBody } = renderPost('![外部图](https://example.com/figure.png)')

    renderRichBody()

    const img = await screen.findByRole('img', { name: '外部图' })
    expect(img.getAttribute('src')).toBe('https://example.com/figure.png')
  })

  it('renders external video urls as playable video elements', async () => {
    const { renderRichBody } = renderPost('![演示视频](https://example.com/demo.mp4)')

    renderRichBody()

    const video = await screen.findByLabelText('演示视频')
    expect(video.tagName.toLowerCase()).toBe('video')
    expect(video.getAttribute('src')).toBe('https://example.com/demo.mp4')
  })

  it('keeps unrelated relative image paths unchanged', async () => {
    const { renderRichBody } = renderPost('![相对图](images/local-figure.png)')

    renderRichBody()

    const img = await screen.findByRole('img', { name: '相对图' })
    expect(img.getAttribute('src')).toBe('images/local-figure.png')
  })

  it('normalizes parent-relative generated image paths to topic asset url', async () => {
    const { renderRichBody } = renderPost('![架构图](../generated_images/architecture_layers.svg)')

    renderRichBody()

    const img = await screen.findByRole('img', { name: '架构图' })
    expect(img.getAttribute('src')).toMatch(
      /\/api\/topics\/topic-1\/assets\/generated_images\/architecture_layers\.svg$/
    )
  })

  it('shows delete action for deletable human posts', () => {
    const onDelete = vi.fn()
    render(
      <PostThread
        posts={[
          {
            id: 'p1',
            topic_id: 'topic-1',
            author: 'alice',
            author_type: 'human',
            owner_user_id: 7,
            expert_name: null,
            expert_label: null,
            body: '这是一条用户帖子',
            mentions: [],
            in_reply_to_id: null,
            status: 'completed',
            created_at: '2026-03-12T00:00:00Z',
          },
        ]}
        onDelete={onDelete}
        canDelete={() => true}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '删除 alice 的帖子' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps delete action available for nested human replies', () => {
    const onDelete = vi.fn()
    render(
      <PostThread
        posts={[
          {
            id: 'p1',
            topic_id: 'topic-1',
            author: 'alice',
            author_type: 'human',
            owner_user_id: 7,
            expert_name: null,
            expert_label: null,
            body: '第一层',
            mentions: [],
            in_reply_to_id: null,
            status: 'completed',
            created_at: '2026-03-12T00:00:00Z',
          },
          {
            id: 'p2',
            topic_id: 'topic-1',
            author: 'bob',
            author_type: 'human',
            owner_user_id: 8,
            expert_name: null,
            expert_label: null,
            body: '第二层',
            mentions: [],
            in_reply_to_id: 'p1',
            status: 'completed',
            created_at: '2026-03-12T00:01:00Z',
          },
          {
            id: 'p3',
            topic_id: 'topic-1',
            author: 'carol',
            author_type: 'human',
            owner_user_id: 9,
            expert_name: null,
            expert_label: null,
            body: '第三层',
            mentions: [],
            in_reply_to_id: 'p2',
            status: 'completed',
            created_at: '2026-03-12T00:02:00Z',
          },
        ]}
        onDelete={onDelete}
        canDelete={() => true}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '删除 carol 的帖子' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'p3' }))
  })

  it('shows delete action for system posts when caller is allowed to delete', () => {
    const onDelete = vi.fn()
    render(
      <PostThread
        posts={[
          {
            id: 'p-system',
            topic_id: 'topic-1',
            author: '评测员',
            author_type: 'system',
            owner_user_id: null,
            expert_name: null,
            expert_label: null,
            body: '这是一条评测回复',
            mentions: [],
            in_reply_to_id: null,
            status: 'completed',
            created_at: '2026-03-12T00:03:00Z',
          },
        ]}
        onDelete={onDelete}
        canDelete={() => true}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '删除 评测员 的帖子' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-system', author_type: 'system' }))
  })
})
