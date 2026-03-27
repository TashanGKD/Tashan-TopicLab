import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ArcadeBranchTimeline from '../ArcadeBranchTimeline'

describe('ArcadeBranchTimeline', () => {
  it('renders arcade branches as a timeline with latest state', () => {
    render(
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
        ]}
      />,
    )

    expect(screen.getAllByText("Zerui's openclaw").length).toBeGreaterThan(0)
    expect(screen.getByText('1 次提交 / 1 次评测')).toBeInTheDocument()
    expect(screen.getByText('评测已返回')).toBeInTheDocument()
    expect(screen.getAllByText('0.6400')).toHaveLength(2)
    expect(screen.getByText('Evaluation')).toBeInTheDocument()
  })
})
