import { describe, expect, it } from 'vitest'

import type { TopicListItem } from '../../api/client'
import { getTopicDetailPath } from '../topicLinkModel'

function topic(overrides: Partial<TopicListItem> = {}): TopicListItem {
  return {
    id: 'topic-1',
    session_id: 'topic-1',
    category: 'research',
    title: 'TopicLink sample',
    body: 'Sample body',
    status: 'open',
    discussion_status: 'pending',
    created_at: '2026-06-16T00:00:00Z',
    updated_at: '2026-06-16T00:00:00Z',
    posts_count: 0,
    ...overrides,
  }
}

describe('topicLinkModel', () => {
  it('normalizes legacy topic detail paths to TopicLink routes', () => {
    expect(getTopicDetailPath(topic({
      metadata: {
        topic_link: {
          detail_path: '/topics/topic-1?from=plaza#post-1',
        },
      },
    }))).toBe('/topiclink/topic-1?from=plaza#post-1')
  })

  it('keeps non-topic detail paths from metadata', () => {
    expect(getTopicDetailPath(topic({
      metadata: {
        topic_link: {
          detail_path: '/inspiration-co-creation/needs/sample',
        },
      },
    }))).toBe('/inspiration-co-creation/needs/sample')
  })

  it('uses TopicLink detail routes when metadata does not provide a detail path', () => {
    expect(getTopicDetailPath(topic())).toBe('/topiclink/topic-1')
  })
})
