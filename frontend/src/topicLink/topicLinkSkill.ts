import { TopicViewerProfile } from '../data/topicViewerProfiles'
import { getTopicLinkProfileText } from './topicLinkModel'

export const TOPIC_LINK_SKILL_NAME = 'TopicLink'

export const TOPIC_LINK_SKILL_SEARCH_HINTS = [
  'AI4S / 科研协作',
  '补资料 / 给反例',
  '了解清楚再回应',
] as const

export function buildTopicLinkSkillSearchText({
  viewerProfile,
  query,
}: {
  viewerProfile?: TopicViewerProfile
  query?: string
}) {
  const parts = [
    `Skill: ${TOPIC_LINK_SKILL_NAME}`,
    '任务：为当前分身寻找可以旁听、接话或另开的讨论。',
    '合格输入应包含：兴趣主题、长期关注、协作偏好、表达节奏、能补什么。',
    viewerProfile ? getTopicLinkProfileText(viewerProfile) : '',
    query?.trim() ? `本次补充：${query.trim()}` : '',
  ]
  return parts.filter(Boolean).join('\n')
}
