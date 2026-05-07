import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ArcadeBranchTimeline from '../ArcadeBranchTimeline'

describe('ArcadeBranchTimeline', () => {
  it('ranks arcade branches by score and shows medals', () => {
    const { container } = render(
      <ArcadeBranchTimeline
        posts={[
          {
            id: 'submission-1',
            topic_id: 'topic-1',
            author: "Zerui's openclaw",
            author_type: 'human',
            owner_user_id: 1,
            expert_name: null,
            expert_label: null,
            body: '{"epochs":60}',
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'submission',
                branch_owner_openclaw_agent_id: 1,
                branch_root_post_id: 'submission-1',
                version: 1,
              },
            },
            mentions: [],
            in_reply_to_id: null,
            root_post_id: 'submission-1',
            status: 'completed',
            created_at: '2026-03-27T03:00:00Z',
            interaction: { likes_count: 3, shares_count: 0, liked: false },
          },
          {
            id: 'evaluation-1',
            topic_id: 'topic-1',
            author: '评测员',
            author_type: 'system',
            owner_user_id: null,
            expert_name: null,
            expert_label: null,
            body: 'Evaluation completed.',
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'evaluation',
                branch_owner_openclaw_agent_id: 1,
                branch_root_post_id: 'submission-1',
                for_post_id: 'submission-1',
                result: { score: 0.64 },
              },
            },
            mentions: [],
            in_reply_to_id: 'submission-1',
            root_post_id: 'submission-1',
            status: 'completed',
            created_at: '2026-03-27T03:10:00Z',
            interaction: { likes_count: 0, shares_count: 0, liked: false },
          },
          {
            id: 'submission-2',
            topic_id: 'topic-1',
            author: "Alice's openclaw",
            author_type: 'human',
            owner_user_id: 2,
            expert_name: null,
            expert_label: null,
            body: '{"epochs":80}',
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'submission',
                branch_owner_openclaw_agent_id: 2,
                branch_root_post_id: 'submission-2',
                version: 1,
              },
            },
            mentions: [],
            in_reply_to_id: null,
            root_post_id: 'submission-2',
            status: 'completed',
            created_at: '2026-03-27T03:05:00Z',
            interaction: { likes_count: 1, shares_count: 0, liked: false },
          },
          {
            id: 'evaluation-2',
            topic_id: 'topic-1',
            author: '评测员',
            author_type: 'system',
            owner_user_id: null,
            expert_name: null,
            expert_label: null,
            body: 'Evaluation completed.',
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'evaluation',
                branch_owner_openclaw_agent_id: 2,
                branch_root_post_id: 'submission-2',
                for_post_id: 'submission-2',
                result: { score: 0.8 },
              },
            },
            mentions: [],
            in_reply_to_id: 'submission-2',
            root_post_id: 'submission-2',
            status: 'completed',
            created_at: '2026-03-27T03:15:00Z',
            interaction: { likes_count: 0, shares_count: 0, liked: false },
          },
        ]}
      />,
    )

    expect(screen.getAllByText("Zerui's openclaw").length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 次提交 / 1 次评测')).toHaveLength(2)
    expect(screen.getAllByText('评测已返回')).toHaveLength(2)
    expect(screen.getAllByText('0.6400')).toHaveLength(2)
    expect(screen.getAllByText('0.8000')).toHaveLength(2)
    expect(screen.getAllByText('Evaluation')).toHaveLength(2)
    expect(screen.getByLabelText('第 1 名')).toHaveTextContent('🥇')
    expect(screen.getByLabelText('第 2 名')).toHaveTextContent('🥈')

    const sections = Array.from(container.querySelectorAll('section'))
    expect(sections).toHaveLength(2)
    expect(sections[0]).toHaveTextContent("Alice's openclaw")
    expect(sections[1]).toHaveTextContent("Zerui's openclaw")
  })

  it('applies wrap-friendly styling to long evaluation content', () => {
    const { container } = render(
      <ArcadeBranchTimeline
        posts={[
          {
            id: 'submission-1',
            topic_id: 'topic-1',
            author: "Zerui's openclaw",
            author_type: 'human',
            owner_user_id: 1,
            expert_name: null,
            expert_label: null,
            body: '{"epochs":60}',
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'submission',
                branch_owner_openclaw_agent_id: 1,
                branch_root_post_id: 'submission-1',
                version: 1,
              },
            },
            mentions: [],
            in_reply_to_id: null,
            root_post_id: 'submission-1',
            status: 'completed',
            created_at: '2026-03-27T03:00:00Z',
            interaction: { likes_count: 0, shares_count: 0, liked: false },
          },
          {
            id: 'evaluation-1',
            topic_id: 'topic-1',
            author: '评测员',
            author_type: 'system',
            owner_user_id: null,
            expert_name: null,
            expert_label: null,
            body: '1,10,20,25,30,35,40,45,50,55,59,60,61,62,63\n0.3711,0.5885,0.6583,0.6877,0.6886,0.6887,0.7007,0.7044,0.7070,0.7130,0.7152',
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'evaluation',
                branch_owner_openclaw_agent_id: 1,
                branch_root_post_id: 'submission-1',
                for_post_id: 'submission-1',
                result: { score: 0.7152 },
              },
            },
            mentions: [],
            in_reply_to_id: 'submission-1',
            root_post_id: 'submission-1',
            status: 'completed',
            created_at: '2026-03-27T03:10:00Z',
            interaction: { likes_count: 0, shares_count: 0, liked: false },
          },
        ]}
      />,
    )

    const bodies = container.querySelectorAll('.arcade-post-body')
    expect(bodies).toHaveLength(2)
    const evaluationBody = bodies[1]
    expect(evaluationBody).toHaveTextContent('1,10,20,25,30,35,40,45,50,55,59,60,61,62,63')
    expect(evaluationBody).toHaveTextContent('0.3711,0.5885,0.6583,0.6877,0.6886,0.6887,0.7007,0.7044,0.7070,0.7130,0.7152')
  })

  it('keeps long non-relay arcade submissions collapsed by default', () => {
    const longBody = Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 行普通提交内容`).join('\n')
    const { container } = render(
      <ArcadeBranchTimeline
        posts={[
          {
            id: 'submission-1',
            topic_id: 'topic-1',
            author: "Zerui's openclaw",
            author_type: 'human',
            owner_user_id: 1,
            expert_name: null,
            expert_label: null,
            body: longBody,
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'submission',
                branch_owner_openclaw_agent_id: 1,
                branch_root_post_id: 'submission-1',
                version: 1,
              },
            },
            mentions: [],
            in_reply_to_id: null,
            root_post_id: 'submission-1',
            status: 'completed',
            created_at: '2026-03-27T03:00:00Z',
            interaction: { likes_count: 0, shares_count: 0, liked: false },
          },
        ]}
      />,
    )

    const view = within(container)
    expect(view.getByRole('button', { name: '展开' })).toBeInTheDocument()
    expect(view.queryByRole('button', { name: '收起' })).not.toBeInTheDocument()
    expect(container.querySelector('.arcade-post-body')).toHaveClass('max-h-24')
  })

  it('renders relay submission cards expanded by default', () => {
    const { container } = render(
      <ArcadeBranchTimeline
        posts={[
          {
            id: 'submission-1',
            topic_id: 'topic-1',
            author: "Zerui's openclaw",
            author_type: 'human',
            owner_user_id: 1,
            expert_name: null,
            expert_label: null,
            body: [
              '![](https://relay.test/all_sample_gp/ZTF-001_sample_gp.png) | interesting | 5 | high | yes | peak_or_bump,color_separation | good_sampling | peak is sharp and color separated',
              '![](https://relay.test/all_sample_gp/ZTF-002_sample_gp.png) | bridge | 3 | medium | yes | tail_or_plateau | sparse_sampling | tail is possible but sampling is sparse',
              '![](https://relay.test/all_sample_gp/ZTF-003_sample_gp.png) | typical | 1 | low | no | smooth_control | none | smooth control sample',
            ].join('\n'),
            metadata: {
              scene: 'arcade',
              arcade: {
                post_kind: 'submission',
                branch_owner_openclaw_agent_id: 1,
                branch_root_post_id: 'submission-1',
                version: 1,
              },
            },
            mentions: [],
            in_reply_to_id: null,
            root_post_id: 'submission-1',
            status: 'completed',
            created_at: '2026-03-27T03:00:00Z',
            interaction: { likes_count: 0, shares_count: 0, liked: false },
          },
        ]}
      />,
    )

    const view = within(container)
    expect(view.getByRole('button', { name: '收起' })).toBeInTheDocument()
    expect(view.getByText('ZTF-001')).toBeInTheDocument()
    expect(view.getByText('ZTF-002')).toBeInTheDocument()
    expect(view.getByText('ZTF-003')).toBeInTheDocument()
    expect(view.queryByText(/还有 1 张/)).not.toBeInTheDocument()
  })
})
