import {
  TopicLinkParticipant,
  TopicLinkRecommendationItem,
  TopicLinkRecommendationResponse,
  TopicLinkSimulationResponse,
  TopicListItem,
} from '../api/client'
import { User } from '../api/auth'
import {
  LIYUYANG_TOPIC_VIEWER_PROFILE,
  TopicViewerProfile,
} from '../data/topicViewerProfiles'

const TOPIC_LINK_EMBEDDING_DIM = 192
const TOPIC_LINK_SCORE_LIMIT = 32

export type TopicLinkRecommendationMap = Record<string, TopicLinkRecommendationItem>

export type TopicLinkRuntimeStatus = {
  vectorStatus: TopicLinkRecommendationResponse['vector_status'] | 'idle'
  embeddingModel: string
  message?: string | null
}

export function getTopicLinkProfileText(profile: TopicViewerProfile) {
  return [
    profile.title,
    profile.subtitle,
    profile.summary,
    ...profile.cards.flatMap((card) => [card.label, card.value, card.detail]),
  ].join('\n')
}

export const LIYUYANG_TOPIC_LINK_PROFILE_TEXT = getTopicLinkProfileText(LIYUYANG_TOPIC_VIEWER_PROFILE)

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function hashTopicLinkToken(token: string) {
  let hash = 2166136261
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function tokenizeTopicLinkText(text: string) {
  return text
    .toLowerCase()
    .match(/[\u4e00-\u9fff]|[a-z0-9+#._-]+/g) ?? []
}

function buildTopicLinkEmbedding(text: string) {
  const vector = new Float64Array(TOPIC_LINK_EMBEDDING_DIM)
  const tokens = tokenizeTopicLinkText(text)
  for (const token of tokens) {
    const hash = hashTopicLinkToken(token)
    const index = hash % TOPIC_LINK_EMBEDDING_DIM
    const sign = hash & 1 ? 1 : -1
    const weight = token.length > 1 ? 1.35 : 0.8
    vector[index] += sign * weight
  }
  let norm = 0
  for (const value of vector) {
    norm += value * value
  }
  if (norm <= 0) {
    return vector
  }
  const scale = 1 / Math.sqrt(norm)
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] *= scale
  }
  return vector
}

function cosineTopicLinkEmbedding(a: Float64Array, b: Float64Array) {
  let sum = 0
  for (let index = 0; index < a.length; index += 1) {
    sum += a[index] * b[index]
  }
  return sum
}

function scoreTopicLinkEmbedding(profileText: string, targetText: string) {
  if (!targetText.trim()) {
    return 45
  }
  const profileVector = buildTopicLinkEmbedding(profileText)
  const targetVector = buildTopicLinkEmbedding(targetText)
  const cosine = cosineTopicLinkEmbedding(profileVector, targetVector)
  return Math.round(clamp(30 + cosine * 120, 38, 96))
}

export function applyTopicLinkRecommendation(topic: TopicListItem, recommendation?: TopicLinkRecommendationItem): TopicListItem {
  if (!recommendation) {
    return topic
  }
  const metadata = topic.metadata ?? {}
  const topicLink = metadata.topic_link ?? {}
  return {
    ...topic,
    metadata: {
      ...metadata,
      topic_link: {
        ...topicLink,
        semantic_similarity: recommendation.semantic_similarity,
        profile_similarity: recommendation.profile_similarity,
        recommendation_score: recommendation.recommendation_score,
        recommendation_reasons: recommendation.reasons,
        recommendation_next_action: recommendation.next_action,
        recommendation_confidence: recommendation.confidence,
        recommendation_score_source: recommendation.score_source,
        embedding_breakdown: recommendation.embedding_breakdown,
      },
    },
  }
}

export function isLiyuyangTopicLinkUser(user: User | null) {
  const username = (user?.username ?? '').trim().toLowerCase()
  return username === LIYUYANG_TOPIC_VIEWER_PROFILE.username
}

export function shouldUseLiyuyangTopicLinkProfile(user: User | null) {
  return isLiyuyangTopicLinkUser(user)
}

export function getTopicLinkDebugUser(): User | null {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return null
  }
  const debugUser = new URLSearchParams(window.location.search).get('debug_user')?.trim().toLowerCase()
  if (debugUser !== LIYUYANG_TOPIC_VIEWER_PROFILE.username) {
    return null
  }
  return {
    id: 134,
    phone: 'local-debug',
    username: LIYUYANG_TOPIC_VIEWER_PROFILE.username,
    created_at: '2026-03-21T12:56:11+08:00',
  }
}

export function buildLocalTopicLinkSimulation(topic: TopicListItem, viewerProfile?: TopicViewerProfile): TopicLinkSimulationResponse {
  const profile = viewerProfile ?? LIYUYANG_TOPIC_VIEWER_PROFILE
  const role = getWantedTitle(topic)
  return {
    provider_status: 'local',
    model: 'local-profile',
    summary: `${profile.agentName} 会先看大家聊到了哪一步，再找一个合适的开口。`,
    turns: [
      {
        speaker: profile.agentName,
        role,
        message: `这和我平时关心的「${profile.subtitle}」有交集。我会先看大家卡在哪里，再补一条资料或一个反例。`,
      },
    ],
    suggested_action: '先看清楚，再说一句真正有用的话。',
  }
}

export function hasTopicLinkMetadata(topic: TopicListItem) {
  const raw = topic.metadata?.topic_link
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function getTopicLinkRuntimeLabel(status: TopicLinkRuntimeStatus, useLocalSnapshot: boolean) {
  if (useLocalSnapshot && status.vectorStatus === 'ready') return '这桌更近'
  if (useLocalSnapshot) return '先看看'
  if (status.vectorStatus === 'ready') return '这桌更近'
  if (status.vectorStatus === 'failed') return '先看看'
  if (status.vectorStatus === 'unconfigured') return '先看看'
  return '正在看看'
}

export function cleanTopicVisibleText(value: string) {
  return value
    .replace(/小虾/g, '我这边')
    .replace(/你的虾/g, '你这边')
    .replace(/主人/g, '自己')
    .replace(/先听一轮/g, '先了解一下')
    .replace(/先听两句/g, '先了解一下')
    .replace(/先看一圈/g, '先了解一下')
    .replace(/先看两句/g, '先了解一下')
    .replace(/旁听/g, '先了解')
    .replace(/靠近/g, '加入')
    .replace(/长期\s*Agent/g, '长期数字伙伴')
    .replace(/\bAgent\b/g, '数字伙伴')
    .replace(/智能体协作/g, '协作')
    .replace(/检索画像/g, '了解你的偏好')
    .replace(/用户画像/g, '个人偏好')
    .replace(/画像系统/g, '偏好记录')
    .replace(/语义检索/g, '找相近内容')
    .replace(/Embedding/gi, '相近度')
}

export function getWantedTitle(topic: TopicListItem) {
  return topic.metadata?.topic_link?.wanted?.[0]?.title ?? '合适的人'
}

export function getTopicBody(topic: TopicListItem | null) {
  if (!topic?.body?.trim()) return '先把问题放出来，等有人从自己的经验里说一句。'
  return cleanTopicVisibleText(topic.body.trim())
}

export function getTopicDisplayTitle(topic: TopicListItem) {
  const title = topic.title.trim()
  if (!title) return '新的讨论'
  if (/^(probe|test|demo|sample)(\s|-|_)/i.test(title) || title.toLowerCase() === 'probe topic') {
    const categoryTitleMap: Record<string, string> = {
      thinking: '慢思考的实践',
      research: '科研协作的现场',
      application: 'AI 与创造力',
      needs: '想找人一起聊',
    }
    return categoryTitleMap[topic.category ?? ''] ?? '新的讨论'
  }
  return title
}

export function getTopicPanelTitle(topic: TopicListItem) {
  const title = getTopicDisplayTitle(topic)
  if (/^关于[「“"]/.test(title) || title.startsWith('关于')) {
    return title
  }
  return `关于「${title}」`
}

export function getTopicPlazaTitle(topic: TopicListItem) {
  const topicLink = topic.metadata?.topic_link as (NonNullable<TopicListItem['metadata']>['topic_link'] & { plaza_title?: unknown }) | undefined
  const plazaTitle = typeof topicLink?.plaza_title === 'string' ? topicLink.plaza_title.trim() : ''
  if (plazaTitle) return plazaTitle

  const title = getTopicDisplayTitle(topic)
  if (title.length <= 24) return title
  const [lead] = title.split(/[：:]/)
  if (
    lead
    && lead.length >= 8
    && lead.length <= 24
    && !/(看|谈|聊|论|关于|如何|为什么|怎样)$/.test(lead.trim())
  ) return lead
  return `${title.slice(0, 22)}...`
}

export function getTopicPlazaPanelTitle(topic: TopicListItem) {
  const title = getTopicPlazaTitle(topic)
  if (/^关于[「“"]/.test(title) || title.startsWith('关于')) {
    return title
  }
  return `关于「${title}」`
}

export function getTopicDetailPath(topic: TopicListItem, viewerProfile?: TopicViewerProfile) {
  const topicLink = topic.metadata?.topic_link as (NonNullable<TopicListItem['metadata']>['topic_link'] & { detail_path?: unknown }) | undefined
  const detailPath = typeof topicLink?.detail_path === 'string' ? topicLink.detail_path.trim() : ''
  if (detailPath) {
    return detailPath
  }
  const debugQuery = import.meta.env.DEV && viewerProfile?.username === LIYUYANG_TOPIC_VIEWER_PROFILE.username
    ? `?debug_user=${LIYUYANG_TOPIC_VIEWER_PROFILE.username}`
    : ''
  return `/topiclink/${topic.id}${debugQuery}`
}

export function getParticipantDisplayName(person: TopicLinkParticipant) {
  const name = (person.name ?? '').trim()
  if (person.openclaw || /^openclaw$/i.test(name)) return '我这边'
  if (!name) {
    return '我这边'
  }
  return name
}

export function getConnectionParticipants(topic: TopicListItem): TopicLinkParticipant[] {
  const participants = topic.metadata?.topic_link?.participants
  if (Array.isArray(participants) && participants.length > 0) {
    return participants.slice(0, 5)
  }
  return [
    { name: topic.creator_name?.trim() || 'Lin', role: getWantedTitle(topic), status: 'starter' },
    { name: '我这边', role: '先看再说', status: 'digesting', openclaw: true },
  ]
}

export function getParticipantRoleLabel(person: TopicLinkParticipant, topic: TopicListItem) {
  const role = person.role ?? getWantedTitle(topic)
  return cleanTopicVisibleText(role)
    .replace('补充工程实现', '补充落地路径')
    .replace('整理证据与共识', '整理资料与共识')
}

function readNumericSignal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (Array.isArray(value)) {
    const nums = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    if (nums.length > 0) {
      return nums.reduce((sum, item) => sum + item, 0) / nums.length
    }
  }
  return null
}

export function readTopicLinkNumber(topic: TopicListItem, key: string) {
  const topicLink = topic.metadata?.topic_link as Record<string, unknown> | undefined
  return readNumericSignal(topicLink?.[key])
}

export function getTopicLinkScoreCandidates(selectedTopic: TopicListItem | null | undefined, topics: TopicListItem[]) {
  const rankedTopics = [...topics]
    .sort((a, b) => (
      (readTopicLinkNumber(b, 'recommendation_score') ?? b.posts_count ?? 0)
      - (readTopicLinkNumber(a, 'recommendation_score') ?? a.posts_count ?? 0)
    ))
  const categorySeeds = Array.from(new Map(
    topics
      .filter((topic) => topic.category)
      .map((topic) => [topic.category, topic]),
  ).values())
  const candidates = selectedTopic
    ? [selectedTopic, ...categorySeeds, ...rankedTopics]
    : [...categorySeeds, ...rankedTopics]
  return Array.from(new Map(candidates.map((topic) => [topic.id, topic])).values())
    .filter((topic) => Boolean(topic.title?.trim() || topic.body?.trim()))
    .slice(0, TOPIC_LINK_SCORE_LIMIT)
}

function stringifyTopicLinkValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyTopicLinkValue).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(stringifyTopicLinkValue).filter(Boolean).join('\n')
  }
  return ''
}

function getTopicEmbeddingSegments(topic: TopicListItem) {
  const topicLink = topic.metadata?.topic_link
  const wanted = topicLink?.wanted ?? []
  const angles = topicLink?.angles ?? []
  const participants = topicLink?.participants ?? []
  const signals = topicLink?.profile_signals ?? {}
  return {
    semantic: [
      getTopicDisplayTitle(topic),
      topic.body ?? '',
      topic.category ?? '',
    ].join('\n'),
    demand: wanted.map((item) => [item.title, item.description, item.kind, item.source].filter(Boolean).join('\n')).join('\n'),
    context: [
      stringifyTopicLinkValue(signals),
      angles.map((item) => [item.title, item.description, item.kind].filter(Boolean).join('\n')).join('\n'),
      participants.map((item) => [item.name, item.role, item.intent, item.status].filter(Boolean).join('\n')).join('\n'),
    ].join('\n'),
    field: [
      topic.creator_name ?? '',
      topicLink?.openclaw_digest?.description ?? '',
      stringifyTopicLinkValue((topicLink as Record<string, unknown> | undefined)?.snapshot_source),
    ].join('\n'),
  }
}

function getWantedSourceStats(topic: TopicListItem) {
  const wanted = topic.metadata?.topic_link?.wanted ?? []
  const sourceCount = wanted.reduce<Record<string, number>>((acc, item) => {
    const source = item.source ?? 'manual'
    acc[source] = (acc[source] ?? 0) + 1
    return acc
  }, {})
  return {
    scale: sourceCount.scale ?? 0,
    skill: sourceCount.skill ?? 0,
    manual: sourceCount.manual ?? 0,
    registration: sourceCount.registration ?? 0,
    total: wanted.length,
  }
}

export function getTopicCrowdCount(topic: TopicListItem) {
  if (typeof topic.posts_count === 'number' && topic.posts_count > 0) {
    return topic.posts_count
  }
  const linkedPeople = topic.metadata?.topic_link?.participants?.length ?? 0
  return Math.max(linkedPeople, getConnectionParticipants(topic).length)
}

export function dedupeParticipants(people: TopicLinkParticipant[]) {
  const seen = new Set<string>()
  return people.filter((person) => {
    const key = (person.name ?? '').trim().toLowerCase()
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getTopicRecommendation(topic: TopicListItem) {
  const topicLink = topic.metadata?.topic_link
  const hasParticipants = Boolean(topicLink?.participants?.length)
  const sourceStats = getWantedSourceStats(topic)
  const snapshotUserPosts = readTopicLinkNumber(topic, 'snapshot_user_posts') ?? 0
  const qwenBreakdown = topicLink?.embedding_breakdown as { semantic?: unknown; demand?: unknown; context?: unknown; field?: unknown } | undefined
  const scoreSource = String((topicLink as Record<string, unknown> | undefined)?.recommendation_score_source ?? '')
  const hasQwenBreakdown = qwenBreakdown != null && scoreSource !== 'local_text_rule' && scoreSource !== 'metadata_rule'
  const toScore = (value: unknown) => (
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(clamp(value <= 1 ? value * 100 : value, 0, 100))
      : null
  )
  const segments = getTopicEmbeddingSegments(topic)
  const semanticEmbeddingScore = toScore(qwenBreakdown?.semantic)
    ?? scoreTopicLinkEmbedding(LIYUYANG_TOPIC_LINK_PROFILE_TEXT, segments.semantic)
  const demandEmbeddingScore = toScore(qwenBreakdown?.demand)
    ?? scoreTopicLinkEmbedding(LIYUYANG_TOPIC_LINK_PROFILE_TEXT, segments.demand || segments.semantic)
  const contextEmbeddingScore = toScore(qwenBreakdown?.context)
    ?? scoreTopicLinkEmbedding(LIYUYANG_TOPIC_LINK_PROFILE_TEXT, segments.context || segments.semantic)
  const fieldEmbeddingScore = toScore(qwenBreakdown?.field)
    ?? scoreTopicLinkEmbedding(LIYUYANG_TOPIC_LINK_PROFILE_TEXT, segments.field || segments.semantic)
  const qwenTotal = readTopicLinkNumber(topic, 'recommendation_score')
  const total = qwenTotal != null ? Math.round(clamp(qwenTotal, 0, 96)) : clamp(Math.round(
    semanticEmbeddingScore * 0.45
      + demandEmbeddingScore * 0.25
      + contextEmbeddingScore * 0.2
      + fieldEmbeddingScore * 0.1,
  ), 0, 96)
  const role = getWantedTitle(topic)

  return {
    total,
    role,
    confidence: total >= 84 ? '很贴近' : total >= 72 ? '可以看看' : '还要再看',
    similarityScore: semanticEmbeddingScore,
    sourceStats,
    breakdown: [
      {
        label: '聊的事',
        value: contextEmbeddingScore,
        max: 100,
        detail: hasQwenBreakdown ? '和你平时看的内容有重合' : snapshotUserPosts > 0 ? `你来过类似话题 ${snapshotUserPosts} 次` : '和你平时看的内容有重合',
        color: '#4fb5b7',
      },
      {
        label: '聊法',
        value: semanticEmbeddingScore,
        max: 100,
        detail: '说法不绕，能看懂他们在问什么',
        color: '#5a9de2',
      },
      {
        label: '需要的人',
        value: demandEmbeddingScore,
        max: 100,
        detail: '这桌有人在找这类帮助',
        color: '#f2a13b',
      },
      {
        label: '现在',
        value: fieldEmbeddingScore,
        max: 100,
        detail: hasParticipants ? '已经有人开聊了' : '现在进去不突兀',
        color: '#54b07a',
      },
    ],
    reasons: [
      role && role !== '合适的人' ? `这桌有人在找「${role.replace(/的人$/, '')}」。` : '先看看大家聊到哪一步。',
      '这件事和你平时看的内容有重合。',
      '这里已经有人开聊了。',
      '可以直接进去，也可以先看一眼。',
    ],
  }
}

export function getProfileSignalCards(topic: TopicListItem, viewerProfile?: TopicViewerProfile) {
  if (viewerProfile) {
    return viewerProfile.cards.map((card) => ({
      ...card,
      label: card.label
        .replace('研究方向', '常看的事')
        .replace('协作偏好', '习惯怎么做')
        .replace('表达风格', '说话习惯')
        .replace('近期关注', '最近在看')
        .replace('关系偏好', '熟的人')
        .replace('动机状态', '想不想接'),
    }))
  }
  const signals = topic.metadata?.topic_link?.profile_signals ?? {}
  const sourceStats = getWantedSourceStats(topic)
  return [
    {
      label: '熟的人',
      value: signals.rcss ? '有熟人' : '先看看',
      detail: signals.rcss ? '有过稳定来往的人在附近' : '先看这桌有哪些人在',
    },
    {
      label: '想不想接',
      value: signals.motivation ? '可以接' : '先听听',
      detail: signals.motivation ? '这件事可能适合一起往下做' : '先听几句再说',
    },
    {
      label: '怎么开口',
      value: signals.personality ? '轻一点' : '先问清楚',
      detail: signals.personality ? '可以低打扰地说一句' : '先问清楚再回应',
    },
    {
      label: '最近在看',
      value: sourceStats.total > 0 ? '有线索' : '从这桌开始',
      detail: sourceStats.total > 0 ? '和最近留下的内容有关' : '先从当前话题开始',
    },
  ]
}
