import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  HIDDEN_TOPIC_CATEGORY_IDS,
  VISIBLE_TOPIC_CATEGORIES,
  topicsApi,
  TopicLinkViewerProfileResponse,
  TopicLinkSimulationResponse,
  TopicLinkKnowledgeAnswerResponse,
  TopicCategory,
  TopicListItem,
} from '../api/client'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { handleApiError } from '../utils/errorHandler'
import TopicCard from '../components/TopicCard'
import DefaultAvatar from '../components/DefaultAvatar'
import { toast } from '../utils/toast'
import { useThrottledCallbackByKey } from '../hooks/useThrottledCallback'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import {
  LIYUYANG_TOPIC_VIEWER_PROFILE,
  TopicViewerProfile,
} from '../data/topicViewerProfiles'
import {
  applyTopicLinkRecommendation,
  clamp,
  cleanTopicVisibleText,
  dedupeParticipants,
  getConnectionParticipants,
  getParticipantDisplayName,
  getParticipantRoleLabel,
  getProfileSignalCards,
  getTopicCrowdCount,
  getTopicDetailPath,
  getTopicLinkDebugUser,
  getTopicLinkRuntimeLabel,
  getTopicPanelTitle,
  getTopicPlazaPanelTitle,
  getTopicPlazaTitle,
  getTopicRecommendation,
  hasTopicLinkMetadata,
  shouldUseLiyuyangTopicLinkProfile,
} from '../topicLink/topicLinkModel'
import { TopicPlazaSidebar } from '../topicLink/TopicPlazaSidebar'
import { TOPIC_LINK_SKILL_SEARCH_HINTS } from '../topicLink/topicLinkSkill'
import { useTopicLinkRecommendations } from '../topicLink/useTopicLinkRecommendations'

const PAGE_SIZE = 20
const INITIAL_TOPIC_PAGE_SIZE = 80
const STAGE_GAP_PX = 20
const FOCUS_COLUMN_MAX_WIDTH = 56 * 16
const FOCUS_COLUMN_MIN_WIDTH = 42 * 16
const SIDE_COLUMN_MAX_WIDTH = 24 * 16
const YOUTH_TED_CATEGORY_ID = 'youth_ted'
const TOPICLINK_RESIDENT_STORAGE_PREFIX = 'topiclink-resident:'
const YOUTH_TED_CATEGORY: TopicCategory = {
  id: YOUTH_TED_CATEGORY_ID,
  name: '青年TED',
  description: '从青年TED延伸出来的讨论桌，适合顺着现场问题继续聊。',
}
function getTopicLinkResidentStorageKey(topicId: string) {
  return `${TOPICLINK_RESIDENT_STORAGE_PREFIX}${topicId}`
}
const TOPIC_PLAZA_CATEGORIES: TopicCategory[] = [
  ...VISIBLE_TOPIC_CATEGORIES.slice(0, 1),
  YOUTH_TED_CATEGORY,
  ...VISIBLE_TOPIC_CATEGORIES.slice(1),
]
const TOPIC_PLAZA_CATEGORY_IDS = new Set(TOPIC_PLAZA_CATEGORIES.map((category) => category.id))
const HIDDEN_TOPIC_CATEGORY_ID_SET = new Set<string>(HIDDEN_TOPIC_CATEGORY_IDS)

function getStageWidths(stageWidth: number) {
  if (stageWidth <= 0) {
    return {
      focus: FOCUS_COLUMN_MAX_WIDTH,
      side: 20 * 16,
    }
  }

  if (stageWidth < 960) {
    const focus = Math.max(0, Math.min(stageWidth, FOCUS_COLUMN_MAX_WIDTH))
    const side = 0
    return { focus, side }
  }

  const focus = clamp(stageWidth * 0.56, FOCUS_COLUMN_MIN_WIDTH, FOCUS_COLUMN_MAX_WIDTH)
  const side = Math.min(
    SIDE_COLUMN_MAX_WIDTH,
    Math.max(0, (stageWidth - focus - STAGE_GAP_PX * 2) / 2),
  )

  return { focus, side }
}

type CategoryTopicPage = {
  items: TopicListItem[]
  nextCursor: string | null
  categoryScoped: boolean
}

type TopicKnowledgeSearchResult = {
  topic: TopicListItem
  category: TopicCategory
  reason: string
}

type TopicKnowledgeAnswer = Pick<TopicLinkKnowledgeAnswerResponse, 'answer' | 'provider_status' | 'topic_ids'>

function isYouthTedTopic(topic: TopicListItem) {
  const text = [
    topic.title,
    topic.body,
    topic.source_feed_name,
    topic.creator_name,
    topic.metadata?.scene,
    topic.metadata?.topic_link?.openclaw_digest?.description,
  ].filter(Boolean).join('\n')
  return /青年\s*TED|Youth\s*TED|youth[-_\s]?ted/i.test(text)
}

function getDisplayCategoryId(topic: TopicListItem, fallbackCategory = 'plaza') {
  if (isYouthTedTopic(topic)) return YOUTH_TED_CATEGORY_ID

  const categoryId = topic.category ?? fallbackCategory
  if (HIDDEN_TOPIC_CATEGORY_ID_SET.has(categoryId)) return categoryId
  if (TOPIC_PLAZA_CATEGORY_IDS.has(categoryId)) return categoryId
  return 'plaza'
}

function normalizeTopicCategory(topic: TopicListItem, fallbackCategory: string): TopicListItem {
  return {
    ...topic,
    category: getDisplayCategoryId(topic, fallbackCategory),
  }
}

function normalizeTopicSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[「」『』“”"'`.,，。:：;；!?！？()[\]{}<>《》/\\|_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stringifyTopicMetadata(metadata: TopicListItem['metadata']) {
  if (!metadata) return ''
  try {
    return JSON.stringify(metadata)
  } catch {
    return ''
  }
}

function getTopicSearchHaystack(topic: TopicListItem, category: TopicCategory) {
  return normalizeTopicSearchText([
    category.name,
    category.description,
    topic.title,
    topic.body,
    topic.source_feed_name,
    topic.creator_name,
    stringifyTopicMetadata(topic.metadata),
  ].filter(Boolean).join(' '))
}

function getTopicSearchRank(topic: TopicListItem, category: TopicCategory, query: string) {
  const normalizedQuery = normalizeTopicSearchText(query)
  if (!normalizedQuery) return 0

  const haystack = getTopicSearchHaystack(topic, category)
  const terms = normalizedQuery.split(' ').filter(Boolean)
  if (terms.length === 0) return 0

  let rank = 0
  const title = normalizeTopicSearchText(topic.title || '')
  const categoryName = normalizeTopicSearchText(category.name)
  for (const term of terms) {
    if (title.includes(term)) rank += 12
    if (categoryName.includes(term)) rank += 8
    if (haystack.includes(term)) rank += 4
  }
  if (haystack.includes(normalizedQuery)) rank += 10
  return rank
}

function getTopicKnowledgeSearchReason(topic: TopicListItem, category: TopicCategory, query: string) {
  const normalizedQuery = normalizeTopicSearchText(query)
  const title = normalizeTopicSearchText(topic.title || '')
  const categoryName = normalizeTopicSearchText(category.name)
  if (normalizedQuery && title.includes(normalizedQuery)) return '标题里就有这条线索'
  if (normalizedQuery && categoryName.includes(normalizedQuery)) return `在「${category.name}」里`
  const recommendation = getTopicRecommendation(topic)
  const role = getCompactRoleLabel(recommendation.role)
  if (role && role !== '可接话') return `这桌有人在找「${role}」`
  return getTopicEntryAngle(recommendation.role)
}

function topicLinkProfileFromResponse(profile: TopicLinkViewerProfileResponse): TopicViewerProfile {
  const displayAgentName = profile.agent_name && !/分身/.test(profile.agent_name) ? profile.agent_name : '我这边'
  return {
    username: profile.username,
    displayName: profile.display_name || profile.username || '我',
    agentName: displayAgentName,
    handle: profile.handle || '',
    title: profile.title || '我的话题偏好',
    subtitle: profile.subtitle || '近期关注、协作方式、表达节奏',
    summary: profile.summary || '先从你的公开参与和当前输入里找合适的一桌。',
    cards: profile.cards?.length
      ? profile.cards
      : [
          {
            label: '近期线索',
            value: '待了解',
            detail: '会随着你的参与逐步变清楚',
          },
        ],
  }
}

function groupTopicsByCategory(categoryPages: Record<string, CategoryTopicPage>) {
  const categoryItems = TOPIC_PLAZA_CATEGORIES.map((category) => {
    const categoryTopics = categoryPages[category.id]?.items ?? []
    return {
      category,
      topicCount: categoryTopics.length,
      audienceCount: categoryTopics.reduce((sum, topic) => sum + getTopicCrowdCount(topic), 0),
      topics: categoryTopics,
    }
  })

  return categoryItems.sort((a, b) => {
    if (b.topicCount !== a.topicCount) {
      return b.topicCount - a.topicCount
    }
    return TOPIC_PLAZA_CATEGORIES.findIndex((category) => category.id === a.category.id)
      - TOPIC_PLAZA_CATEGORIES.findIndex((category) => category.id === b.category.id)
  })
}

function buildInitialCategoryPages(items: TopicListItem[], nextCursor: string | null): Record<string, CategoryTopicPage> {
  const categoryIds = new Set<string>()
  const grouped = items.reduce<Record<string, TopicListItem[]>>((acc, topic) => {
    const categoryId = getDisplayCategoryId(topic)
    categoryIds.add(categoryId)
    acc[categoryId] = acc[categoryId] ?? []
    acc[categoryId].push(normalizeTopicCategory(topic, categoryId))
    return acc
  }, {})

  const pageNextCursor = categoryIds.size === 1 ? nextCursor : null
  return Object.fromEntries(
    Object.entries(grouped).map(([categoryId, categoryTopics]) => [
      categoryId,
      {
        items: categoryTopics,
        nextCursor: pageNextCursor,
        categoryScoped: false,
      },
    ]),
  )
}
const CONNECTION_NODE_LAYOUT = [
  { left: '15%', top: '18%', color: '#f2a13b', curve: 'M 50 50 C 41 35 28 22 15 18' },
  { left: '85%', top: '18%', color: '#40aeb0', curve: 'M 50 50 C 59 35 72 22 85 18' },
  { left: '88%', top: '50%', color: '#8b7bd8', curve: 'M 50 50 C 64 45 76 47 88 50' },
  { left: '72%', top: '78%', color: '#54b07a', curve: 'M 50 50 C 58 61 65 72 72 78' },
  { left: '30%', top: '78%', color: '#5a9de2', curve: 'M 50 50 C 42 61 36 72 30 78' },
  { left: '12%', top: '50%', color: '#5a9de2', curve: 'M 50 50 C 36 45 24 47 12 50' },
  { left: '50%', top: '84%', color: '#54b07a', curve: 'M 50 50 C 47 62 48 76 50 84' },
] as const

const CONNECTION_AVATAR_LAYOUT = [
  { left: '31%', top: '13%', tone: '#f2a13b' },
  { left: '69%', top: '13%', tone: '#40aeb0' },
  { left: '91%', top: '37%', tone: '#40aeb0' },
  { left: '84%', top: '68%', tone: '#8b7bd8' },
  { left: '59%', top: '87%', tone: '#54b07a' },
  { left: '25%', top: '75%', tone: '#5a9de2' },
  { left: '9%', top: '43%', tone: '#5a9de2' },
  { left: '42%', top: '88%', tone: '#54b07a' },
] as const

const OUTER_TOPIC_LAYOUT = [
  { left: '19%', top: '34%', color: '#40aeb0', curve: 'M 19 34 C 30 35 40 42 50 48' },
  { left: '19%', top: '65%', color: '#5a9de2', curve: 'M 19 65 C 32 64 40 56 50 48' },
  { left: '77%', top: '34%', color: '#f2a13b', curve: 'M 77 34 C 66 35 59 42 50 48' },
  { left: '77%', top: '65%', color: '#8b7bd8', curve: 'M 77 65 C 65 64 58 56 50 48' },
  { left: '41%', top: '78%', color: '#54b07a', curve: 'M 41 78 C 43 66 46 56 50 48' },
  { left: '59%', top: '78%', color: '#40aeb0', curve: 'M 59 78 C 57 66 54 56 50 48' },
] as const

function getTopicConnectionNeed(role: string) {
  const normalizedRole = role.trim()
  if (!normalizedRole || normalizedRole === '合适的人') {
    return '也在等一位合适的人接一句'
  }
  if (normalizedRole.endsWith('的人')) {
    return `也在等一位${normalizedRole}接一句`
  }
  return `也正缺一个能「${normalizedRole}」的人`
}

function getTopicEntryAngle(role: string) {
  const normalizedRole = role.trim()
  if (!normalizedRole || normalizedRole === '合适的人') {
    return '先看看大家聊到哪一步'
  }
  if (normalizedRole.endsWith('的人')) {
    return `这桌有人在找「${normalizedRole.replace(/的人$/, '')}」`
  }
  return `这桌有人在找「${normalizedRole}」`
}

function getCompactRoleLabel(role: string) {
  const normalizedRole = role.trim()
  if (!normalizedRole || normalizedRole === '合适的人') return '可接话'
  return normalizedRole.replace(/的人$/, '')
}

function getOuterTopicRelationLabel(topic: TopicListItem, fallbackIndex: number) {
  const categoryId = topic.category
  if (categoryId === 'inspiration') return '可以往下拆'
  if (categoryId === YOUTH_TED_CATEGORY_ID) return '现场话题延伸'
  if (categoryId === 'research') return '能补材料'
  if (categoryId === 'thought') return '同一个问题'
  if (categoryId === 'information') return '外部线索'
  if (categoryId === 'application') return '落地例子'
  if (categoryId === 'arcade') return '接力任务'

  const fallbackLabels = ['旁边也在聊', '刚有人提到', '另一条线索', '也在聊这个', '候场的一桌', '顺手看看']
  return fallbackLabels[fallbackIndex % fallbackLabels.length]
}

function TopicMapCard({
  topic,
  index,
  active,
  onSelect,
}: {
  topic: TopicListItem
  index: number
  active?: boolean
  onSelect: (topic: TopicListItem) => void
}) {
  const layout = CONNECTION_NODE_LAYOUT[index % CONNECTION_NODE_LAYOUT.length]
  const crowdCount = getTopicCrowdCount(topic)
  const recommendation = getTopicRecommendation(topic)
  const entryLabel = getCompactRoleLabel(recommendation.role)
  const entryCopy = entryLabel === '可接话' ? '等人接一句' : `从「${entryLabel}」接`
  const categoryLabel = TOPIC_PLAZA_CATEGORIES.find((category) => category.id === topic.category)?.name
  return (
    <button
      type="button"
      onClick={() => onSelect(topic)}
      className={`absolute z-30 w-[13rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border px-3.5 py-3 text-left transition hover:-translate-y-[calc(50%+2px)] ${
        active
          ? 'border-[#f39c32] bg-[#fffaf0] shadow-[0_18px_42px_rgba(217,134,36,0.22)] ring-2 ring-[#f39c32]/25'
          : 'border-[#c7dbd1] bg-[#fffdf8]/94 shadow-[0_18px_38px_rgba(34,54,48,0.16)] backdrop-blur-md hover:border-[#68b9b5] hover:bg-[#fffdf8]'
      }`}
      style={{ left: layout.left, top: layout.top }}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white shadow-[0_8px_16px_rgba(38,48,43,0.16)]" style={{ backgroundColor: layout.color }}>
          +
        </span>
        <div className="min-w-0">
          {categoryLabel && categoryLabel !== '广场' ? (
            <span className="mb-0.5 inline-flex rounded-full bg-[#eaf6f4] px-1.5 py-0.5 text-[10px] font-medium text-[#2f8586]">
              {categoryLabel}
            </span>
          ) : null}
          <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-[#1f2926]">{getTopicPlazaTitle(topic)}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#e4eee8] pt-2">
        <span className="truncate text-xs text-[#66716d]">{entryCopy}</span>
        <span className="shrink-0 text-xs text-[#8a9690]">{crowdCount} 人</span>
      </div>
    </button>
  )
}

function TopicOuterPlazaCard({
  topic,
  index,
  onSelect,
}: {
  topic: TopicListItem
  index: number
  onSelect: (topic: TopicListItem) => void
}) {
  const layout = OUTER_TOPIC_LAYOUT[index % OUTER_TOPIC_LAYOUT.length]
  const recommendation = getTopicRecommendation(topic)
  const entryLabel = getCompactRoleLabel(recommendation.role)
  const entryCopy = entryLabel === '可接话' ? '等人接一句' : `缺${entryLabel}`
  const categoryLabel = TOPIC_PLAZA_CATEGORIES.find((category) => category.id === topic.category)?.name
  const relationLabel = getOuterTopicRelationLabel(topic, index)

  return (
    <button
      type="button"
      onClick={() => onSelect(topic)}
      className="absolute z-[28] w-[12.8rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#cfded5] bg-[#fffdf8]/88 px-3 py-2.5 text-left shadow-[0_16px_34px_rgba(38,48,43,0.14)] backdrop-blur-xl transition hover:-translate-y-[calc(50%+2px)] hover:border-[#70bdb8] hover:bg-[#fffdf8]"
      style={{ left: layout.left, top: layout.top }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.72)]" style={{ backgroundColor: layout.color }} />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-[#2f8586]">{relationLabel}{categoryLabel && categoryLabel !== '广场' ? ` · ${categoryLabel}` : ''}</p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-[#202a26]">{getTopicPlazaPanelTitle(topic)}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#e4eee8] pt-2 text-[11px] text-[#6c7771]">
        <span className="truncate">{entryCopy}</span>
        <span className="shrink-0">{getTopicCrowdCount(topic)} 人</span>
      </div>
    </button>
  )
}

function MapRecommendationCallout({
  topic,
  loading,
  personalized,
  sourceLabel,
}: {
  topic: TopicListItem
  loading?: boolean
  personalized: boolean
  sourceLabel: string
}) {
  const signals = topic.metadata?.topic_link?.profile_signals ?? {}
  const visibleSignals = [
    signals.rcss ? '长期协作' : null,
    signals.motivation ? '主动参与' : null,
    signals.personality ? '表达相合' : null,
    signals.skill ? '能力互补' : null,
  ].filter(Boolean)
  const connectionStatus = sourceLabel === '这桌更近' ? '这桌更贴近你' : '可以先看看'

  return (
    <div className="rounded-[1rem] border border-[#cbded4] bg-[#fffdf8]/95 p-3.5 shadow-[0_22px_48px_rgba(44,61,55,0.18)] backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-[#6f8580]">和你有关的人在这里</p>
          <h3 className="mt-1 font-serif text-base font-semibold leading-snug text-[#17231f]">先看看这一桌</h3>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#102d45] text-center shadow-[0_10px_26px_rgba(16,45,69,0.24)]">
          <span className="text-[11px] font-semibold leading-none text-white">在聊</span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#66716d]">
        {personalized ? '这里有人在聊你熟悉的事，也想听听不同人的看法。' : '登录后会先看你关心的人和话题。'}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {(visibleSignals.length > 0 ? visibleSignals : [personalized ? '值得看看' : '公共线索']).map((signal) => (
          <span key={signal} className="rounded-full bg-[#eaf6f6] px-2.5 py-1 text-[11px] text-[#2f8586]">
            {signal}
          </span>
        ))}
      </div>
      <div className="mt-3 rounded-xl bg-[#edf6f2] px-3 py-2.5 text-[11px] leading-5 text-[#56645f] ring-1 ring-[#d4e7df]">
        有人在聊你熟悉的事；先看两句，觉得接得上再进去。
      </div>
      <div className="mt-2.5 rounded-xl bg-[#e9f4f0] px-3 py-2 text-[11px] text-[#56645f]">
        <span className="font-medium text-[#2f8586]">{loading ? '正在看' : connectionStatus}</span>
        <span className="mx-1 text-[#a1aca7]">·</span>
        {loading ? '稍等一下' : '先看过再决定'}
      </div>
    </div>
  )
}

function TopicPlazaMap({
  topicColumns,
  selectedTopic,
  onTopicSelect,
  recommendationLoading,
  simulation,
  simulationLoading,
  onSimulate,
  resident,
  viewerProfile,
  personalized,
  recommendationSourceLabel,
  searchInput,
  searchPlaceholder,
  searchLoading,
  searchResults,
  searchResultCount,
  searchAnswer,
  searchAnswerLoading,
  showSearchHints,
  onSearchInputChange,
  onSearchResultSelect,
  onOpenConnections,
  leftRail,
  rightRail,
}: {
  topicColumns: ReturnType<typeof groupTopicsByCategory>
  selectedTopic: TopicListItem
  onTopicSelect: (topic: TopicListItem) => void
  recommendationLoading: boolean
  simulation: TopicLinkSimulationResponse | null
  simulationLoading: boolean
  onSimulate: (topic: TopicListItem) => void
  resident: boolean
  viewerProfile?: TopicViewerProfile
  personalized: boolean
  recommendationSourceLabel: string
  searchInput: string
  searchPlaceholder: string
  searchLoading: boolean
  searchResults: TopicKnowledgeSearchResult[]
  searchResultCount: number
  searchAnswer?: string
  searchAnswerLoading?: boolean
  showSearchHints: boolean
  onSearchInputChange: (value: string) => void
  onSearchResultSelect: (topic: TopicListItem) => void
  onOpenConnections: () => void
  leftRail?: ReactNode
  rightRail?: ReactNode
}) {
  const categoryPriority = (categoryId?: string | null) => {
    if (categoryId === YOUTH_TED_CATEGORY_ID) return 0
    if (categoryId === 'arcade') return 1
    if (categoryId === 'research') return 2
    if (categoryId === 'thought') return 3
    return 4
  }
  const categorySeedTopics = topicColumns
    .filter((column) => column.topics.length > 0)
    .sort((a, b) => {
      const priorityDelta = categoryPriority(a.category.id) - categoryPriority(b.category.id)
      if (priorityDelta !== 0) return priorityDelta
      return b.topicCount - a.topicCount
    })
    .map((column) => column.topics[0])
  const rankedTopics = topicColumns.flatMap((column) => column.topics)
  const plazaTopics = Array.from(new Map([
    selectedTopic,
    ...categorySeedTopics,
    ...rankedTopics,
  ].map((topic) => [topic.id, topic])).values()).slice(0, 8)
  const mapTopics = plazaTopics.slice(0, 8)
  const relatedTopics = mapTopics.slice(1)
  const mapTopicIds = new Set(mapTopics.map((topic) => topic.id))
  const outerTopics = Array.from(new Map([
    ...rankedTopics,
    ...categorySeedTopics,
  ].filter((topic) => !mapTopicIds.has(topic.id)).map((topic) => [topic.id, topic])).values()).slice(0, OUTER_TOPIC_LAYOUT.length)
  const recommendation = getTopicRecommendation(selectedTopic)
  const people = getConnectionParticipants(selectedTopic).slice(0, 4)
  const mapPeople = dedupeParticipants([
    ...getConnectionParticipants(selectedTopic),
    ...relatedTopics.flatMap((topic) => getConnectionParticipants(topic)),
  ]).slice(0, CONNECTION_AVATAR_LAYOUT.length)
  const simulationTurns = simulation?.turns ?? []
  const simulationButtonLabel = simulationLoading ? '正在看...' : resident ? '它在这桌' : simulationTurns[0] ? '让它留在这' : '先替我看看'
  const detailPath = getTopicDetailPath(selectedTopic, viewerProfile)
  const primaryActionLabel = detailPath.startsWith('/inspiration-co-creation') ? '进入共创' : '进入讨论'
  const connectionNeed = getTopicConnectionNeed(recommendation.role)
  const focusEntryLabel = getCompactRoleLabel(recommendation.role)
  const focusEntryCopy = focusEntryLabel === '可接话' ? '等人说一句' : `找${focusEntryLabel}`
  const selectedCrowdCount = getTopicCrowdCount(selectedTopic)
  const relatedCrowdCount = relatedTopics.reduce((sum, topic) => sum + getTopicCrowdCount(topic), 0)
  const normalizedSearchInput = searchInput.trim()
  const hasSearchInput = normalizedSearchInput.length > 0

  return (
    <section className="topiclink-plaza-surface relative self-start overflow-hidden rounded-[1.45rem] border border-[#b9d0c4] bg-[#e8f0e8] shadow-[0_28px_70px_rgba(38,48,43,0.20)]">
      <div className="relative h-[calc(100vh-6.5rem)] min-h-[45rem]">
        <div className="pointer-events-none absolute inset-0">
          <img
            src="/media/topic-plaza-map.png"
            alt=""
            className="h-full w-full object-cover opacity-[0.98] saturate-[1.13] contrast-[1.07] brightness-[0.98]"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0)_0%,rgba(255,255,255,0.03)_44%,rgba(206,219,206,0.14)_100%)]" />
        </div>
        <div className="topiclink-plaza-water pointer-events-none absolute inset-0 z-10" />
        {leftRail ? (
          <div className="absolute left-5 top-5 z-[70] hidden w-[220px] lg:block">
            {leftRail}
          </div>
        ) : null}
        {rightRail ? (
          <div className="absolute right-6 top-6 z-[70] hidden max-h-[calc(100%-3rem)] w-[380px] max-w-[calc(100%-2rem)] overflow-x-hidden overflow-y-auto scrollbar-hide lg:block">
            {rightRail}
          </div>
        ) : null}

        {!leftRail ? (
          <div className="absolute left-5 top-5 z-40 w-[12.6rem]">
            <MapRecommendationCallout topic={selectedTopic} loading={recommendationLoading} personalized={personalized} sourceLabel={recommendationSourceLabel} />
          </div>
        ) : null}

        {outerTopics.length > 0 ? (
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-[18] h-full w-full">
            <g fill="none" strokeLinecap="round">
              {outerTopics.map((topic, index) => {
                const layout = OUTER_TOPIC_LAYOUT[index % OUTER_TOPIC_LAYOUT.length]
                return (
                  <path
                    key={`outer-line-${topic.id}`}
                    d={layout.curve}
                    stroke={layout.color}
                    strokeWidth="0.16"
                    opacity="0.18"
                  />
                )
              })}
            </g>
          </svg>
        ) : null}

        {outerTopics.map((topic, index) => (
          <TopicOuterPlazaCard key={`outer-${topic.id}`} topic={topic} index={index} onSelect={onTopicSelect} />
        ))}

        <div className="absolute left-1/2 top-[48%] z-30 aspect-square h-[min(61rem,calc(100%-1rem))] -translate-x-1/2 -translate-y-1/2">
          <div className="pointer-events-none absolute inset-[3%] rounded-full border border-[#9fc4b7]/56" />
          <div className="pointer-events-none absolute inset-[15%] rounded-full border border-[#9fc4b7]/66" />
          <div className="pointer-events-none absolute inset-[28%] rounded-full border border-[#9fc4b7]/76" />
          <div className="pointer-events-none absolute inset-[40%] rounded-full border border-[#9fc4b7]/90" />
          <div className="pointer-events-none absolute inset-[10%] rounded-full bg-[conic-gradient(from_0deg,rgba(64,174,176,0),rgba(64,174,176,0.14),rgba(242,161,59,0.08),rgba(64,174,176,0))] opacity-40 blur-[0.4px] animate-topic-orbit-scan" />
          <div className="pointer-events-none absolute inset-[16%] rounded-full bg-[conic-gradient(from_30deg,rgba(79,181,183,0)_0deg,rgba(79,181,183,0.16)_26deg,rgba(255,255,255,0.02)_50deg,rgba(79,181,183,0)_76deg)] opacity-42 blur-[0.2px] animate-topic-radar-sweep" />
          <div className="pointer-events-none absolute inset-[47%] rounded-full bg-[#f2fbf6]/72 shadow-[0_0_56px_rgba(79,181,183,0.24)]" />
          <svg aria-hidden="true" viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <filter id="topic-node-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="0.75" />
              </filter>
            </defs>
            <g fill="none" strokeLinecap="round" strokeWidth="0.85">
              {relatedTopics.map((topic, index) => {
                const layout = CONNECTION_NODE_LAYOUT[index % CONNECTION_NODE_LAYOUT.length]
                return (
                  <path
                    key={topic.id}
                    d={layout.curve}
                    stroke={layout.color}
                    strokeWidth={index === 1 ? '0.72' : '0.48'}
                    opacity={index === 1 ? '0.40' : '0.26'}
                  />
                )
              })}
            </g>
            <g filter="url(#topic-node-glow)">
              {relatedTopics.slice(0, 4).map((topic, index) => {
                const layout = CONNECTION_NODE_LAYOUT[index % CONNECTION_NODE_LAYOUT.length]
                return (
                  <circle key={`pulse-${topic.id}`} r="0.62" fill={layout.color} opacity="0.42">
                    <animateMotion dur={`${14 + index * 2.2}s`} repeatCount="indefinite" path={layout.curve} />
                  </circle>
                )
              })}
            </g>
          </svg>

          {relatedTopics.map((topic, index) => (
            <TopicMapCard key={topic.id} topic={topic} index={index} active={false} onSelect={onTopicSelect} />
          ))}

          {mapPeople.length > 0 ? (
            <button
              type="button"
              onClick={onOpenConnections}
              className="absolute left-1/2 top-[8%] z-30 -translate-x-1/2 rounded-full border border-white/72 bg-[#fffdf8]/72 px-3 py-1.5 text-xs font-medium text-[#2f8586] shadow-[0_10px_24px_rgba(35,48,44,0.12)] backdrop-blur-2xl transition hover:bg-[#fffdf8]/88 focus:outline-none focus:ring-2 focus:ring-[#8fcac5]"
              aria-label="查看和我相关的人"
            >
              和我相关的人 · 点头像看是谁
            </button>
          ) : null}

          {mapPeople.map((person, index) => {
            const avatar = CONNECTION_AVATAR_LAYOUT[index % CONNECTION_AVATAR_LAYOUT.length]
            const displayName = getParticipantDisplayName(person) || `相关的人 ${index + 1}`
            const roleLabel = getParticipantRoleLabel(person, selectedTopic)
            return (
            <button
              type="button"
              key={`${displayName}-${index}`}
              onClick={onOpenConnections}
              className="absolute z-20 h-[40px] w-[40px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-0.5 shadow-[0_10px_22px_rgba(35,48,44,0.18)] transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#8fcac5]"
              style={{ left: avatar.left, top: avatar.top, border: `2px solid ${avatar.tone}` }}
              title={`${displayName} · ${roleLabel}`}
              aria-label={`查看相关的人：${displayName}`}
            >
              <DefaultAvatar
                name={displayName}
                kind={person.openclaw ? 'openclaw' : 'person'}
                className="h-full w-full rounded-full animate-topic-avatar-breathe"
                style={{ animationDelay: `${index * 0.22}s` }}
              />
            </button>
            )
          })}

          <div className="topiclink-focus-card absolute left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-[1.45rem] border-2 border-[#f39c32] bg-[#fffaf2] px-7 py-6 text-center shadow-[0_34px_84px_rgba(44,61,55,0.28)] outline-none backdrop-blur-md">
            <div className="pointer-events-none absolute inset-[-0.55rem] -z-10 rounded-[1.75rem] border border-[#f3b35c]/35 opacity-80 topiclink-focus-halo" />
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onOpenConnections}
                className="flex -space-x-2 rounded-full bg-[#eef6f2] px-2.5 py-1.5 ring-1 ring-[#cfe2da] transition hover:-translate-y-0.5 hover:bg-[#e4f2ed] focus:outline-none focus:ring-2 focus:ring-[#8fcac5]"
                aria-label="查看这桌有哪些人在"
              >
                {people.slice(0, 4).map((person, index) => (
                  <div key={`${person.name}-${index}`} className="h-[44px] w-[44px] overflow-hidden rounded-full bg-[#edf3ef] ring-2 ring-white shadow-[0_8px_16px_rgba(38,48,43,0.12)]">
                    <DefaultAvatar name={getParticipantDisplayName(person) || `P${index + 1}`} kind={person.openclaw ? 'openclaw' : 'person'} className="h-full w-full animate-topic-avatar-breathe" />
                  </div>
                ))}
              </button>
              <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f39c32] text-base font-semibold text-white shadow-[0_10px_24px_rgba(217,134,36,0.28)]">
                <span className="absolute inset-0 rounded-full bg-[#f39c32] animate-topic-score-pulse" />
                <span className="relative text-[11px]">正聊</span>
              </div>
            </div>
            <p className="mt-3 text-sm font-medium text-[#2f8586]">这桌和你有关</p>
            <h2 className="mt-2 line-clamp-2 font-serif text-[1.55rem] font-semibold leading-tight text-[#17231f]">{getTopicPlazaPanelTitle(selectedTopic)}</h2>
            <p className="mx-auto mt-3 max-w-[21rem] text-sm leading-6 text-[#65716b]">
              这里有人正在聊你熟悉的事，{connectionNeed}。
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs text-[#61716a]">
              <span className="rounded-full bg-[#edf6f2] px-3 py-1.5 ring-1 ring-[#d8e7df]">{selectedCrowdCount} 人在看</span>
              <span className="rounded-full bg-[#edf6f2] px-3 py-1.5 ring-1 ring-[#d8e7df]">{focusEntryCopy}</span>
              <span className="rounded-full bg-[#edf6f2] px-3 py-1.5 ring-1 ring-[#d8e7df]">{relatedTopics.length} 桌相邻</span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Link to={detailPath} className="flex h-11 items-center justify-center rounded-xl bg-[#102d45] text-sm font-semibold text-white shadow-[0_14px_30px_rgba(16,45,69,0.24)] transition hover:bg-[#1e4562]">
                {primaryActionLabel}
              </Link>
              <button
                type="button"
                onClick={() => onSimulate(selectedTopic)}
                disabled={simulationLoading || resident}
                className={`flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition disabled:opacity-75 ${
                  resident
                    ? 'border-[#b9d8c8] bg-[#eaf6ef] text-[#3d8a5d]'
                    : 'border-[#9fcfca] bg-white text-[#257d7d] hover:border-[#69b7b2] hover:bg-[#eef8f6]'
                }`}
              >
                {simulationButtonLabel}
              </button>
            </div>
            {resident ? (
              <p className="mt-3 rounded-xl bg-[#ecf7f0] px-3 py-2 text-left text-[11px] leading-5 text-[#53675e] ring-1 ring-[#cfe6d8]">
                <span className="font-semibold text-[#3d8a5d]">它在这桌：</span>
                会先听新回应，再找合适的时候接一句。
              </p>
            ) : simulationTurns[0] ? (
              <p className="mt-3 rounded-xl bg-[#edf6f2] px-3 py-2 text-left text-[11px] leading-5 text-[#586761] ring-1 ring-[#d5e7df]">
                <span className="font-semibold text-[#2f8586]">{simulationTurns[0].speaker}：</span>
                {simulationTurns[0].message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="absolute inset-x-5 bottom-4 z-40 flex justify-center">
          <div className="w-full max-w-[58rem] rounded-[1.45rem] border border-[#d5e3dc] bg-[#fffdf8]/92 p-3.5 shadow-[0_20px_44px_rgba(38,48,43,0.16)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="shrink-0 px-1 lg:w-[9.2rem]">
                <p className="text-xs font-semibold text-[#2f8586]">他山知识库</p>
                <p className="mt-1 text-xs leading-5 text-[#7a8580]">按意思找相关话题</p>
              </div>
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">想找哪一桌</span>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#4faeb0]">
                  <path d="M14.5 14.5L18 18M16.4 9.2A7.2 7.2 0 1 1 2 9.2a7.2 7.2 0 0 1 14.4 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => onSearchInputChange(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-12 w-full rounded-2xl border border-transparent bg-[#eef6f2] pl-12 pr-4 text-[15px] text-[#2f3835] outline-none transition placeholder:text-[#9aa8a2] focus:border-[#85c6c3] focus:bg-white focus:shadow-[0_0_0_3px_rgba(79,174,176,0.12)]"
                />
              </label>
              <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-[#586761] md:justify-start">
                {hasSearchInput ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-[#eaf6f4] px-3 py-1.5 font-medium text-[#2f8586] ring-1 ring-[#cfe4df]">
                    {searchLoading ? '正在找' : searchResultCount > 0 ? `${searchResultCount} 条线索` : '暂时没找到'}
                  </span>
                ) : null}
                <span className="flex items-center gap-1.5 rounded-full bg-white/72 px-3 py-1.5 ring-1 ring-[#e0ebe5]">
                  <span className="h-2 w-2 rounded-full bg-[#f2a13b]" />
                  {relatedTopics.length} 桌相邻
                </span>
                <span className="rounded-full bg-white/72 px-3 py-1.5 ring-1 ring-[#e0ebe5]">{relatedCrowdCount} 人在附近</span>
              </div>
            </div>
            {hasSearchInput ? (
              <div className="mt-3 border-t border-[#e1ebe5] pt-3">
                {(searchAnswerLoading || searchAnswer) ? (
                  <div className="mb-3 rounded-2xl border border-[#d9e8e1] bg-[#f5fbf8] px-3.5 py-3">
                    <p className="text-[11px] font-medium text-[#2f8586]">可以先这样看</p>
                    <p className="mt-1 text-sm leading-6 text-[#34443d]">
                      {searchAnswerLoading ? '正在把相关几桌串起来...' : searchAnswer}
                    </p>
                  </div>
                ) : null}
                {searchResults.length > 0 ? (
                  <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
                    {searchResults.map(({ topic, category, reason }) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => onSearchResultSelect(topic)}
                        className="group min-w-[16rem] max-w-[16rem] rounded-2xl border border-[#d6e5de] bg-white/82 px-3 py-2.5 text-left shadow-[0_8px_18px_rgba(38,48,43,0.06)] transition hover:-translate-y-0.5 hover:border-[#92c9c4] hover:bg-white hover:shadow-[0_12px_24px_rgba(38,48,43,0.11)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-full bg-[#edf7f4] px-2 py-0.5 text-[11px] text-[#348486]">{category.name}</span>
                          <span className="text-[11px] text-[#7e8a85]">打开这一桌</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-5 text-[#1d2925] group-hover:text-[#0f3b4d]">{getTopicPlazaPanelTitle(topic)}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-[#69756f]">{reason}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-[#eef6f2] px-3 py-2.5 text-sm text-[#65716b]">
                    这批话题里暂时没对上；换个说法试试。
                  </p>
                )}
              </div>
            ) : showSearchHints ? (
              <div className="mt-3 flex flex-nowrap gap-2 overflow-hidden">
                {TOPIC_LINK_SKILL_SEARCH_HINTS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => onSearchInputChange(hint)}
                    className="shrink-0 rounded-full bg-[#edf6f4] px-3 py-1.5 text-xs text-[#3f7777] transition hover:bg-[#dff0ee]"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function TopicSideConnectionPanel({
  topic,
  onClose,
  onSimulate,
  simulationLoading,
  simulation,
  resident,
  viewerProfile,
  personalized,
}: {
  topic: TopicListItem
  onClose: () => void
  onSimulate: (topic: TopicListItem) => void
  simulationLoading: boolean
  simulation: TopicLinkSimulationResponse | null
  resident: boolean
  viewerProfile?: TopicViewerProfile
  personalized: boolean
}) {
  const crowdCount = getTopicCrowdCount(topic)
  const recommendation = getTopicRecommendation(topic)
  const profileCards = getProfileSignalCards(topic, viewerProfile)
  const previewTurn = simulation?.turns?.[0]
  const simulationButtonLabel = simulationLoading ? '正在看...' : resident ? '它在这桌' : previewTurn ? '让它留在这' : '先替我看看'
  const detailPath = getTopicDetailPath(topic, viewerProfile)
  const primaryActionLabel = detailPath.startsWith('/inspiration-co-creation') ? '进入共创' : '进入讨论'
  const people = dedupeParticipants(getConnectionParticipants(topic)).slice(0, 4)
  const crowdLabel = crowdCount > 99 ? '99+' : String(crowdCount)

  return (
    <aside className="w-full max-w-full self-start overflow-hidden rounded-2xl border border-white/72 bg-[#fffaf2]/72 p-4 shadow-[0_24px_64px_rgba(38,48,43,0.22)] ring-1 ring-[#9fc4b7]/35 backdrop-blur-2xl xl:sticky xl:top-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="h-[48px] w-[48px] shrink-0 overflow-hidden rounded-full bg-[#edf3ef] ring-2 ring-white shadow-[0_10px_20px_rgba(38,48,43,0.13)]">
            <DefaultAvatar name={viewerProfile?.agentName ?? '我这边'} kind="openclaw" className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#6f8580]">我这边</p>
            <h2 className="mt-1 font-serif text-lg font-semibold leading-snug text-[#171d1a]">{viewerProfile?.title ?? '先看看'}</h2>
            <p className="mt-1 text-xs text-[#6d7772]">{viewerProfile?.subtitle ?? (personalized ? '先旁听，再接一句' : '登录后再按你的习惯来')}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-[#6b7872] hover:bg-[#edf5f1]" aria-label="关闭详情">
          <span className="text-lg leading-none">×</span>
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-white/68 bg-[#e8f4ef]/74 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#fffdf8]/62 px-3 py-2 ring-1 ring-white/65">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#25302d]">这桌现在</p>
            <p className="mt-0.5 truncate text-[11px] text-[#69756f]">{getTopicEntryAngle(recommendation.role)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#dff2f1] px-2.5 py-1 text-[11px] font-medium text-[#2f8586]">可能有关 {recommendation.total}</span>
        </div>
        <div className="mt-3 space-y-2">
          {recommendation.breakdown.map((item) => {
            const relatedProfileCard = profileCards.find((card) => card.label === item.label)
            return (
              <div key={item.label} className="rounded-xl bg-[#fffdf8]/76 px-3 py-2 ring-1 ring-white/62 backdrop-blur-md">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[11px] text-[#7a8781]">
                    {relatedProfileCard ? `${item.label} · ${relatedProfileCard.value}` : item.label}
                  </p>
                  <span className="shrink-0 text-[11px] font-semibold text-[#41514b]">{item.value}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/80">
                  <div className="h-full rounded-full" style={{ width: `${clamp(item.value, 0, 100)}%`, backgroundColor: item.color }} />
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] text-[#8a9690]">{relatedProfileCard?.detail ?? item.detail}</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-[#1d2421]">这桌有哪些人在</h3>
        <span className="text-xs text-[#81908a]">{crowdLabel} 人在附近</span>
      </div>

      {people.length > 0 ? (
        <div className="mt-3 space-y-2.5">
          {people.map((person, index) => (
            <div key={`${person.name}-${index}`} className="flex items-center gap-2.5 rounded-2xl bg-[#fffdf8]/82 px-3 py-2.5 shadow-[0_10px_22px_rgba(38,48,43,0.08)] ring-1 ring-white/70 backdrop-blur-xl">
              <div className="h-[44px] w-[44px] shrink-0 overflow-hidden rounded-full bg-[#edf3ef] ring-2 ring-white shadow-[0_8px_16px_rgba(38,48,43,0.10)]">
                <DefaultAvatar name={getParticipantDisplayName(person) || `P${index + 1}`} kind={person.openclaw ? 'openclaw' : 'person'} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-[#202825]">{getParticipantDisplayName(person)}</p>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-[#dff2f1] px-2 py-0.5 text-[11px] text-[#2f8586]">{person.status === 'starter' ? '开桌' : '在场'}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[#66716d]">{getParticipantRoleLabel(person, topic)}</p>
              </div>
              <Link to={detailPath} className="shrink-0 whitespace-nowrap rounded-md border border-[#b7d8d4] px-2.5 py-1.5 text-xs text-[#257d7d] hover:bg-[#eef8f7]">
                去看看
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-white px-3 py-3 text-xs leading-5 text-[#6c7771] ring-1 ring-[#dfece5]">
          现在还看不出谁接得上。先进去看看正文和已有回应。
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onSimulate(topic)}
          disabled={simulationLoading || resident}
          className={`flex h-11 items-center justify-center rounded-xl border text-sm font-medium transition disabled:opacity-75 ${
            resident
              ? 'border-[#b9d8c8] bg-[#eaf6ef] text-[#3d8a5d]'
              : 'border-[#9fcfca] bg-white text-[#257d7d] hover:border-[#69b7b2] hover:bg-[#eef8f6]'
          }`}
        >
          {simulationButtonLabel}
        </button>
        <Link to={detailPath} className="flex h-11 items-center justify-center rounded-xl bg-[#17324a] text-sm font-semibold text-white transition hover:bg-[#23455f]">
          {primaryActionLabel}
        </Link>
      </div>
      {resident ? (
        <p className="mt-3 rounded-2xl bg-[#ecf7f0] px-3 py-2 text-xs leading-5 text-[#53675e] ring-1 ring-[#cfe6d8]">
          <span className="font-semibold text-[#3d8a5d]">它在这桌：</span>
          它会先听新回应，再找合适的时候接一句。
        </p>
      ) : previewTurn ? (
        <p className="mt-3 rounded-2xl bg-[#edf6f2] px-3 py-2 text-xs leading-5 text-[#5f6f68] ring-1 ring-[#d5e7df]">
          <span className="font-semibold text-[#2f8586]">{previewTurn.speaker}：</span>
          {cleanTopicVisibleText(previewTurn.message)}
        </p>
      ) : null}
    </aside>
  )
}

function TopicConnectionPeek({
  topic,
  onOpen,
}: {
  topic: TopicListItem
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-2xl border border-[#cbded4] bg-[#fffdf8]/92 p-4 text-left shadow-[0_18px_48px_rgba(38,48,43,0.12)] transition hover:-translate-y-0.5 hover:border-[#8fcac6]"
    >
          <p className="text-xs text-[#6f8580]">先看关系</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="font-serif text-base font-semibold text-[#17231f]">看看「{getTopicPlazaTitle(topic)}」</p>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#17324a] text-[11px] font-semibold text-white">在聊</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#66716d]">展开后看在场的人，再决定要不要进去。</p>
    </button>
  )
}

function TopicRecommendationPanel({ topic, viewerProfile }: { topic: TopicListItem | null, viewerProfile?: TopicViewerProfile }) {
  if (!topic) {
    return null
  }

  const recommendation = getTopicRecommendation(topic)

  return (
    <aside className="mt-4 rounded-2xl border border-[#c4ded8] bg-gradient-to-br from-[#fffdf8] via-white to-[#eaf7f4] p-4 shadow-[0_16px_38px_rgba(47,133,134,0.13)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#5f7f7a]">这桌为什么值得看</p>
          <h2 className="mt-1 text-base font-serif font-semibold leading-snug text-[var(--text-primary)]">
            这桌和你哪里近？
          </h2>
          <p className="mt-1 text-xs text-[#6f7b76]">{getTopicEntryAngle(recommendation.role)}</p>
        </div>
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#eaf6f4] text-center ring-1 ring-[#cfe4dc]">
          <div className="text-xs font-semibold leading-4 text-[#2f8586]">可以<br />先看</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-[#cfe4dc] bg-white/82 px-3 py-2.5">
        <p className="text-xs leading-5 text-[#56635e]">
          这里聊的方向你不陌生，也正好缺一个能补资料、提问题或整理路径的人。
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-white/70 px-3 py-2">
          <p className="text-[#8a9690]">为什么看到</p>
          <p className="mt-1 font-semibold text-[#17231f]">
            聊的事接近
          </p>
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2">
          <p className="text-[#8a9690]">现在缺什么</p>
          <p className="mt-1 font-semibold text-[#17231f]">
            有人接一句
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Link to={getTopicDetailPath(topic, viewerProfile)} className="rounded-lg bg-[#102d45] px-3 py-2 text-center font-medium text-white shadow-[0_10px_22px_rgba(16,45,69,0.22)]">
          进入讨论
        </Link>
        <Link to={getTopicDetailPath(topic, viewerProfile)} className="rounded-lg border border-[#9fcfca] bg-white px-3 py-2 text-center font-medium text-[#257d7d]">
          了解一下
        </Link>
        <Link to="/profile-helper" className="rounded-lg border border-[#c7d9d2] bg-white px-3 py-2 text-center font-medium text-[#586761]">
          调整资料
        </Link>
      </div>

      <details className="mt-4 rounded-xl border border-[#cfe4dc] bg-white/82 px-3 py-3">
        <summary className="cursor-pointer select-none text-xs font-semibold text-[#25302d]">多看两句</summary>
        <div className="mt-3 space-y-2 text-[11px] leading-5 text-gray-500">
          <p>这桌的主题和你平时看的方向接近。</p>
          <p>如果要回，可以先补资料、问一个卡点，或者把大家的说法收一下。</p>
        </div>
      </details>
    </aside>
  )
}

function TopicCompactConnectionList({
  topics,
  selectedTopic,
  onTopicSelect,
  viewerProfile,
}: {
  topics: TopicListItem[]
  selectedTopic: TopicListItem
  onTopicSelect: (topic: TopicListItem) => void
  viewerProfile?: TopicViewerProfile
}) {
  const selectedRecommendation = getTopicRecommendation(selectedTopic)
  const selectedPeople = dedupeParticipants(getConnectionParticipants(selectedTopic)).slice(0, 4)
  const selectedDetailPath = getTopicDetailPath(selectedTopic, viewerProfile)
  const selectedActionLabel = selectedDetailPath.startsWith('/inspiration-co-creation') ? '进入共创' : '进入讨论'

  return (
    <section className="min-h-[calc(100vh-12.5rem)] rounded-[1.45rem] border border-[#cbded4] bg-[#fffdf8]/88 p-5 shadow-[0_18px_48px_rgba(38,48,43,0.12)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-[#17211f]">可以去的几桌</h2>
          <p className="mt-1 text-sm text-[#68736f]">按关系排好，看到想接的就进去。</p>
        </div>
        <span className="rounded-full bg-[#eaf6f6] px-3 py-1 text-xs text-[#2f8586]">{topics.length} 个相关话题</span>
      </div>

      <div className="mb-4 rounded-[1.2rem] border border-[#d8e7df] bg-[#f4faf6] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#2f8586]">当前更近的一桌</p>
            <h3 className="mt-1 line-clamp-1 font-serif text-xl font-semibold text-[#17231f]">{getTopicPanelTitle(selectedTopic)}</h3>
            <p className="mt-1 text-xs text-[#6d7772]">
              {getTopicCrowdCount(selectedTopic)} 人在看 · {getTopicEntryAngle(selectedRecommendation.role)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex -space-x-2">
              {selectedPeople.map((person, index) => (
                <DefaultAvatar
                  key={`${getParticipantDisplayName(person)}-${index}`}
                  name={getParticipantDisplayName(person)}
                  kind={person.openclaw ? 'openclaw' : 'person'}
                  className="h-8 w-8 ring-2 ring-[#f4faf6]"
                />
              ))}
            </div>
            <Link to={selectedDetailPath} className="flex h-10 items-center justify-center rounded-xl bg-[#17324a] px-4 text-sm font-semibold text-white transition hover:bg-[#23455f]">
              {selectedActionLabel}
            </Link>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.2rem] border border-[#d8e7df] bg-white/86">
        <div className="hidden grid-cols-[minmax(0,1fr)_10rem_12rem_10rem] gap-4 border-b border-[#e1ece6] bg-[#f7fbf8] px-4 py-2.5 text-[11px] font-medium text-[#7c8982] lg:grid">
          <span>话题</span>
          <span>这桌</span>
          <span>在场的人</span>
          <span className="text-right">动作</span>
        </div>
        {topics.slice(0, 14).map((topic) => {
          const recommendation = getTopicRecommendation(topic)
          const active = topic.id === selectedTopic.id
          const categoryLabel = TOPIC_PLAZA_CATEGORIES.find((category) => category.id === topic.category)?.name ?? '广场'
          const people = dedupeParticipants(getConnectionParticipants(topic)).slice(0, 3)
          const detailPath = getTopicDetailPath(topic, viewerProfile)
          const actionLabel = detailPath.startsWith('/inspiration-co-creation') ? '进入共创' : '进入讨论'
          return (
            <div
              key={topic.id}
              className={`grid gap-3 border-b border-[#e5eee9] px-4 py-3.5 transition last:border-b-0 lg:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem] lg:items-center lg:gap-4 ${
                active ? 'bg-[#fff7e9]' : 'hover:bg-[#f7fbf8]'
              }`}
            >
              <button type="button" onClick={() => onTopicSelect(topic)} className="min-w-0 text-left">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded-full bg-[#edf6f4] px-2 py-0.5 text-[11px] text-[#2f8586]">{categoryLabel}</span>
                  {active ? <span className="rounded-full bg-[#f39c32] px-2 py-0.5 text-[11px] font-medium text-white">正在看</span> : null}
                </div>
                <p className="line-clamp-1 font-serif text-base font-semibold leading-snug text-[#1f2926]">{getTopicPanelTitle(topic)}</p>
                <p className="mt-1 line-clamp-1 text-xs text-[#6d7772]">{getTopicEntryAngle(recommendation.role)}</p>
              </button>

              <button type="button" onClick={() => onTopicSelect(topic)} className="flex items-center justify-between gap-3 text-left lg:block">
                <span className="text-xs text-[#7c8781]">{getTopicCrowdCount(topic)} 人在看</span>
                <span className="rounded-full bg-[#eef6f2] px-2.5 py-1 text-[11px] font-medium text-[#2f8586] lg:mt-2 lg:inline-block">
                  {detailPath.startsWith('/inspiration-co-creation') ? '共创' : '讨论'}
                </span>
              </button>

              <button type="button" onClick={() => onTopicSelect(topic)} className="flex min-w-0 items-center gap-2 text-left">
                <div className="flex -space-x-2">
                  {people.length > 0 ? (
                    people.map((person, index) => (
                      <DefaultAvatar
                        key={`${getParticipantDisplayName(person)}-${index}`}
                        name={getParticipantDisplayName(person)}
                        kind={person.openclaw ? 'openclaw' : 'person'}
                        className="h-7 w-7 ring-2 ring-white"
                      />
                    ))
                  ) : (
                    <DefaultAvatar name="TopicLink" kind="person" className="h-7 w-7 ring-2 ring-white" />
                  )}
                </div>
                <span className="truncate text-xs text-[#7c8781]">{people[0] ? getParticipantRoleLabel(people[0], topic) : '等人接话'}</span>
              </button>

              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => onTopicSelect(topic)} className="whitespace-nowrap rounded-lg border border-[#c9ded6] px-3 py-2 text-xs font-medium text-[#2f8586] transition hover:border-[#8fc6c1] hover:bg-[#eef8f6]">
                  看一眼
                </button>
                <Link to={detailPath} className="whitespace-nowrap rounded-lg bg-[#17324a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#23455f]">
                  {actionLabel}
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function TopicLinkPage() {
  const isTopicLinkSurface = true
  const [searchParams, setSearchParams] = useSearchParams()
  const [categoryPages, setCategoryPages] = useState<Record<string, CategoryTopicPage>>({})
  const [activeCategory, setActiveCategory] = useState('')
  const [columnWidths, setColumnWidths] = useState(() => ({
    focus: FOCUS_COLUMN_MAX_WIDTH,
    side: 20 * 16,
  }))
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [knowledgeAnswer, setKnowledgeAnswer] = useState<TopicKnowledgeAnswer | null>(null)
  const [knowledgeAnswerLoading, setKnowledgeAnswerLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [remoteViewerProfile, setRemoteViewerProfile] = useState<TopicViewerProfile | undefined>(undefined)
  const [authReady, setAuthReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMoreCategory, setLoadingMoreCategory] = useState<string | null>(null)
  const [pendingTopicLikeIds, setPendingTopicLikeIds] = useState<Set<string>>(new Set())
  const [pendingTopicFavoriteIds, setPendingTopicFavoriteIds] = useState<Set<string>>(new Set())
  const [plazaViewMode, setPlazaViewMode] = useState<'map' | 'list'>(() => (searchParams.get('view') === 'list' ? 'list' : 'map'))
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [residentTopicIds, setResidentTopicIds] = useState<Set<string>>(() => new Set())
  const [connectionPanelOpen, setConnectionPanelOpen] = useState(true)
  const [stageTransitionDirection, setStageTransitionDirection] = useState<'none' | 'left' | 'right'>('none')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const contentStageRef = useRef<HTMLDivElement | null>(null)
  const categoryTabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const categoryTabsTrackRef = useRef<HTMLDivElement | null>(null)

  const debouncedSetSearchQuery = useDebouncedCallback((value: string) => {
    setSearchQuery(value.trim())
  }, 250)

  useEffect(() => {
    const nextViewMode = searchParams.get('view') === 'list' ? 'list' : 'map'
    setPlazaViewMode((prev) => (prev === nextViewMode ? prev : nextViewMode))
  }, [searchParams])

  const handlePlazaViewModeChange = useCallback((nextViewMode: 'map' | 'list') => {
    setPlazaViewMode(nextViewMode)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (nextViewMode === 'list') {
        next.set('view', 'list')
      } else {
        next.delete('view')
      }
      return next
    })
  }, [setSearchParams])

  const useLiyuyangProfile = isTopicLinkSurface && shouldUseLiyuyangTopicLinkProfile(currentUser)
  const viewerProfile = isTopicLinkSurface ? (useLiyuyangProfile ? LIYUYANG_TOPIC_VIEWER_PROFILE : remoteViewerProfile) : undefined
  const hasPersonalizedProfile = isTopicLinkSurface && Boolean(currentUser || viewerProfile)
  const semanticSkillQuery = ''
  const listSearchQuery = isTopicLinkSurface ? '' : searchQuery
  const topicListPageSize = INITIAL_TOPIC_PAGE_SIZE

  useEffect(() => {
    const syncUser = async () => {
      setAuthReady(false)
      try {
        const debugUser = getTopicLinkDebugUser()
        if (debugUser) {
          setCurrentUser(debugUser)
          return
        }
        const token = tokenManager.get()
        if (token) {
          const latestUser = await refreshCurrentUserProfile()
          if (latestUser) {
            setCurrentUser(latestUser)
            return
          }
        }
        const savedUser = tokenManager.getUser()
        setCurrentUser(token && savedUser ? savedUser : null)
      } finally {
        setAuthReady(true)
      }
    }

    void syncUser()
    const handleStorage = () => { void syncUser() }
    const handleAuthChange = () => { void syncUser() }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth-change', handleAuthChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth-change', handleAuthChange)
    }
  }, [])

  useEffect(() => {
    if (!authReady) {
      return
    }
    void loadTopics()
  }, [authReady, currentUser, listSearchQuery, topicListPageSize, useLiyuyangProfile])

  useEffect(() => {
    if (!isTopicLinkSurface || !authReady || !currentUser || useLiyuyangProfile) {
      setRemoteViewerProfile(undefined)
      return
    }
    let cancelled = false
    topicsApi.getTopicLinkProfile()
      .then((res) => {
        if (!cancelled) {
          setRemoteViewerProfile(topicLinkProfileFromResponse(res.data))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteViewerProfile(undefined)
        }
      })
    return () => {
      cancelled = true
    }
  }, [authReady, currentUser?.id, isTopicLinkSurface, useLiyuyangProfile])

  useEffect(() => {
    const node = loadMoreRef.current
    const activeNextCursor = activeCategory ? categoryPages[activeCategory]?.nextCursor ?? null : null
    if (!node || !activeNextCursor || loading || loadingMoreCategory) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreTopics(activeCategory)
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [activeCategory, categoryPages, loading, loadingMoreCategory])

  const loadTopics = async () => {
    setLoading(true)
    try {
      const topicResult = await topicsApi.list({
        q: listSearchQuery || undefined,
        limit: topicListPageSize,
      })
      setCategoryPages(buildInitialCategoryPages(topicResult.data.items, topicResult.data.next_cursor))
    } catch (err) {
      handleApiError(err, '加载话题列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadCategoryTopics = async (categoryId: string) => {
    setLoadingMoreCategory(categoryId)
    try {
      const youthTedQuery = [listSearchQuery, '青年 TED'].filter(Boolean).join(' ')
      const res = await topicsApi.list({
        category: categoryId === YOUTH_TED_CATEGORY_ID ? undefined : categoryId,
        q: categoryId === YOUTH_TED_CATEGORY_ID ? youthTedQuery : listSearchQuery || undefined,
        limit: PAGE_SIZE,
      })
      const nextItems = res.data.items
        .map((topic) => normalizeTopicCategory(topic, categoryId))
        .filter((topic) => categoryId !== YOUTH_TED_CATEGORY_ID || isYouthTedTopic(topic))
      setCategoryPages((prev) => ({
        ...prev,
        [categoryId]: {
          items: nextItems,
          nextCursor: categoryId === YOUTH_TED_CATEGORY_ID ? null : res.data.next_cursor,
          categoryScoped: true,
        },
      }))
    } catch (err) {
      handleApiError(err, '加载话题列表失败')
    } finally {
      setLoadingMoreCategory(null)
    }
  }

  const loadMoreTopics = async (categoryId: string) => {
    const page = categoryPages[categoryId]
    if (!page?.nextCursor || loadingMoreCategory) {
      return
    }
    setLoadingMoreCategory(categoryId)
    try {
      const youthTedQuery = [listSearchQuery, '青年 TED'].filter(Boolean).join(' ')
      const res = await topicsApi.list({
        category: categoryId === YOUTH_TED_CATEGORY_ID ? undefined : categoryId,
        q: categoryId === YOUTH_TED_CATEGORY_ID ? youthTedQuery : listSearchQuery || undefined,
        cursor: page.nextCursor,
        limit: PAGE_SIZE,
      })
      setCategoryPages((prev) => {
        const current = prev[categoryId] ?? { items: [], nextCursor: null, categoryScoped: true }
        const nextItems = [
          ...current.items,
          ...res.data.items
            .map((topic) => normalizeTopicCategory(topic, categoryId))
            .filter((topic) => categoryId !== YOUTH_TED_CATEGORY_ID || isYouthTedTopic(topic))
            .filter((item) => !current.items.some((existing) => existing.id === item.id)),
        ]
        return {
          ...prev,
          [categoryId]: {
            items: nextItems,
            nextCursor: categoryId === YOUTH_TED_CATEGORY_ID ? null : res.data.next_cursor,
            categoryScoped: true,
          },
        }
      })
    } catch (err) {
      handleApiError(err, '加载更多话题失败')
    } finally {
      setLoadingMoreCategory(null)
    }
  }

  const handleDeleteTopic = async (topicId: string) => {
    if (!currentUser) return
    const confirmed = window.confirm('确认删除这个话题？')
    if (!confirmed) return
    try {
      await topicsApi.delete(topicId)
      setCategoryPages((prev) => Object.fromEntries(
        Object.entries(prev).map(([categoryId, page]) => [
          categoryId,
          {
            ...page,
            items: page.items.filter((topic) => topic.id !== topicId),
          },
        ]),
      ))
      const totalTopics = Object.values(categoryPages).reduce((sum, page) => sum + page.items.length, 0)
      if (totalTopics <= 1) {
        void loadTopics()
      }
    } catch (err) {
      handleApiError(err, '删除话题失败')
    }
  }

  const requireCurrentUser = useCallback(() => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
  }, [currentUser])

  const updateTopicInteraction = useCallback((topicId: string, interaction: TopicListItem['interaction']) => {
    setCategoryPages(prev => Object.fromEntries(
      Object.entries(prev).map(([categoryId, page]) => [
        categoryId,
        {
          ...page,
          items: page.items.map(item => item.id === topicId ? { ...item, interaction } : item),
        },
      ]),
    ))
  }, [])

  const handleTopicLike = useCallback(async (topic: TopicListItem) => {
    if (!requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.liked ?? false)
    setPendingTopicLikeIds(prev => new Set(prev).add(topic.id))
    const previousInteraction = topic.interaction
    updateTopicInteraction(topic.id, {
      likes_count: Math.max(0, (topic.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
      favorites_count: topic.interaction?.favorites_count ?? 0,
      shares_count: topic.interaction?.shares_count ?? 0,
      liked: nextEnabled,
      favorited: topic.interaction?.favorited ?? false,
    })
    try {
      const res = await topicsApi.like(topic.id, nextEnabled)
      updateTopicInteraction(topic.id, res.data)
    } catch (err) {
      updateTopicInteraction(topic.id, previousInteraction)
      handleApiError(err, nextEnabled ? '点赞失败' : '取消点赞失败')
    } finally {
      setPendingTopicLikeIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }, [requireCurrentUser, updateTopicInteraction])

  const handleTopicFavorite = useCallback(async (topic: TopicListItem) => {
    if (!requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.favorited ?? false)
    setPendingTopicFavoriteIds(prev => new Set(prev).add(topic.id))
    const previousInteraction = topic.interaction
    updateTopicInteraction(topic.id, {
      likes_count: topic.interaction?.likes_count ?? 0,
      favorites_count: Math.max(0, (topic.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1)),
      shares_count: topic.interaction?.shares_count ?? 0,
      liked: topic.interaction?.liked ?? false,
      favorited: nextEnabled,
    })
    try {
      const res = await topicsApi.favorite(topic.id, nextEnabled)
      updateTopicInteraction(topic.id, res.data)
    } catch (err) {
      updateTopicInteraction(topic.id, previousInteraction)
      handleApiError(err, nextEnabled ? '收藏失败' : '取消收藏失败')
    } finally {
      setPendingTopicFavoriteIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }, [requireCurrentUser, updateTopicInteraction])

  const handleTopicShare = useCallback(async (topic: TopicListItem) => {
    try {
      const res = await topicsApi.share(topic.id)
      updateTopicInteraction(topic.id, res.data)
    } catch (err) {
      handleApiError(err, '记录分享失败')
    }
    try {
      const url = new URL(`${import.meta.env.BASE_URL}topics/${topic.id}`, window.location.origin).toString()
      const text = topic.title ? `${topic.title}\n${url}` : url
      await navigator.clipboard.writeText(text)
      toast.success('话题链接已复制')
    } catch {
      toast.error('复制链接失败')
    }
  }, [updateTopicInteraction])

  const throttledLike = useThrottledCallbackByKey(handleTopicLike, (t) => t.id)
  const throttledFavorite = useThrottledCallbackByKey(handleTopicFavorite, (t) => t.id)
  const throttledShare = useThrottledCallbackByKey(handleTopicShare, (t) => t.id)
  const baseTopicColumns = useMemo(() => groupTopicsByCategory(categoryPages), [categoryPages])
  const baseVisibleTopicItems = baseTopicColumns.flatMap((column) => column.topics)
  const localSearchQuery = searchInput.trim()
  const baseActiveIndex = baseTopicColumns.findIndex(({ category }) => category.id === activeCategory)
  const baseResolvedActiveIndex = baseActiveIndex >= 0 ? baseActiveIndex : 0
  const baseActiveColumn = baseTopicColumns[baseResolvedActiveIndex] ?? null
  const selectedTopicForRecommendation = selectedTopicId
    ? baseVisibleTopicItems.find((topic) => topic.id === selectedTopicId)
    : null
  const recommendationSeedTopic = selectedTopicForRecommendation
    ?? baseActiveColumn?.topics.find(hasTopicLinkMetadata)
    ?? baseActiveColumn?.topics[0]
    ?? baseVisibleTopicItems.find(hasTopicLinkMetadata)
    ?? baseVisibleTopicItems[0]
    ?? null
  const topicLink = useTopicLinkRecommendations({
    selectedTopic: isTopicLinkSurface ? recommendationSeedTopic : null,
    candidateTopics: isTopicLinkSurface ? baseVisibleTopicItems : [],
    viewerProfile,
    skillQuery: semanticSkillQuery,
  })
  const searchTopicLink = useTopicLinkRecommendations({
    selectedTopic: null,
    candidateTopics: isTopicLinkSurface && searchQuery ? baseVisibleTopicItems : [],
    skillQuery: searchQuery,
  })
  const recommendedTopicColumns = useMemo(() => (
    baseTopicColumns.map((column) => ({
      ...column,
      topics: column.topics
        .map((topic) => applyTopicLinkRecommendation(topic, topicLink.recommendations[topic.id])),
    }))
  ), [baseTopicColumns, topicLink.recommendations])
  const knowledgeSearchResults = useMemo(() => {
    const normalizedQuery = normalizeTopicSearchText(localSearchQuery)
    if (!normalizedQuery) return []

    const categoryByTopicId = new Map<string, TopicCategory>()
    for (const column of recommendedTopicColumns) {
      for (const topic of column.topics) {
        categoryByTopicId.set(topic.id, column.category)
      }
    }

    return baseVisibleTopicItems
      .map((topic) => {
        const category = categoryByTopicId.get(topic.id)
          ?? TOPIC_PLAZA_CATEGORIES.find((item) => item.id === topic.category)
          ?? TOPIC_PLAZA_CATEGORIES[0]
        const semanticRecommendation = searchTopicLink.recommendations[topic.id]
        const semanticRank = semanticRecommendation?.recommendation_score ?? 0
        const localRank = getTopicSearchRank(topic, category, normalizedQuery)
        return {
          topic: applyTopicLinkRecommendation(topic, semanticRecommendation ?? topicLink.recommendations[topic.id]),
          category,
          localRank,
          semanticRank,
          rank: semanticRank * 2 + localRank,
        }
      })
      .filter(({ localRank, semanticRank }) => localRank > 0 || semanticRank > 0)
      .sort((a, b) => {
        if (b.rank !== a.rank) return b.rank - a.rank
        return getTopicCrowdCount(b.topic) - getTopicCrowdCount(a.topic)
      })
      .slice(0, 6)
      .map(({ topic, category }) => ({
        topic,
        category,
        reason: getTopicKnowledgeSearchReason(topic, category, normalizedQuery),
      }))
  }, [baseVisibleTopicItems, localSearchQuery, recommendedTopicColumns, searchTopicLink.recommendations, topicLink.recommendations])
  const knowledgeAnswerTopics = useMemo(
    () => knowledgeSearchResults.map(({ topic }) => topic).slice(0, 6),
    [knowledgeSearchResults],
  )
  const knowledgeAnswerTopicSignature = knowledgeAnswerTopics.map((topic) => topic.id).join('|')

  useEffect(() => {
    const query = searchQuery.trim()
    if (!isTopicLinkSurface || !query || knowledgeAnswerTopics.length === 0) {
      setKnowledgeAnswer(null)
      setKnowledgeAnswerLoading(false)
      return
    }

    let cancelled = false
    setKnowledgeAnswerLoading(true)
    void topicsApi.answerTopicLinkKnowledge({ query, topics: knowledgeAnswerTopics })
      .then((res) => {
        if (cancelled) return
        setKnowledgeAnswer({
          answer: res.data.answer,
          provider_status: res.data.provider_status,
          topic_ids: res.data.topic_ids,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setKnowledgeAnswer(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setKnowledgeAnswerLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isTopicLinkSurface, knowledgeAnswerTopicSignature, searchQuery])
  const topicColumns = recommendedTopicColumns
  const visibleTopicItems = topicColumns.flatMap((column) => column.topics)
  const hasAnyTopics = visibleTopicItems.length > 0
  const activeIndex = topicColumns.findIndex(({ category }) => category.id === activeCategory)
  const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : 0
  const activeColumn = topicColumns[resolvedActiveIndex] ?? null
  const bestPersonalizedTopic = isTopicLinkSurface && hasPersonalizedProfile
    ? [...visibleTopicItems]
      .filter(hasTopicLinkMetadata)
      .sort((a, b) => getTopicRecommendation(b).total - getTopicRecommendation(a).total)[0] ?? null
    : null
  const selectedTopicById = selectedTopicId
    ? visibleTopicItems.find((topic) => topic.id === selectedTopicId)
    : null
  const selectedTopic = selectedTopicById
    ?? bestPersonalizedTopic
    ?? activeColumn?.topics.find(hasTopicLinkMetadata)
    ?? activeColumn?.topics[0]
    ?? visibleTopicItems.find(hasTopicLinkMetadata)
    ?? visibleTopicItems[0]
    ?? null
  const selectedTopicResident = selectedTopic ? residentTopicIds.has(selectedTopic.id) : false
  const hasPlazaFeaturedModules = topicColumns.some(({ category, topicCount }) => (
    topicCount > 0 && (category.id === YOUTH_TED_CATEGORY_ID || category.id === 'arcade')
  ))
  const usePlazaMap = isTopicLinkSurface && Boolean(selectedTopic && (hasTopicLinkMetadata(selectedTopic) || viewerProfile || hasPlazaFeaturedModules))
  const topicLinkRuntimeLabel = getTopicLinkRuntimeLabel(topicLink.runtimeStatus, useLiyuyangProfile)
  const hasPreviewColumns = topicColumns.length > 1
  const prevColumn = hasPreviewColumns
    ? topicColumns[(resolvedActiveIndex - 1 + topicColumns.length) % topicColumns.length]
    : null
  const nextColumn = hasPreviewColumns
    ? topicColumns[(resolvedActiveIndex + 1) % topicColumns.length]
    : null
  const stageEnterAnimationClass = stageTransitionDirection === 'right'
    ? 'animate-stage-enter-right'
    : stageTransitionDirection === 'left'
      ? 'animate-stage-enter-left'
      : 'animate-fade-in'

  useEffect(() => {
    if (topicColumns.length === 0 || !hasAnyTopics) {
      setActiveCategory('')
      return
    }
    if (!activeCategory || !topicColumns.some(({ category }) => category.id === activeCategory)) {
      const firstCategoryWithTopics = topicColumns.find(({ topicCount }) => topicCount > 0)
      setActiveCategory((firstCategoryWithTopics ?? topicColumns[0]).category.id)
    }
  }, [activeCategory, hasAnyTopics, topicColumns])

  useEffect(() => {
    if (!selectedTopic?.id) return
    let cancelled = false
    topicsApi.getTopicLinkPresence(selectedTopic.id, { personaName: viewerProfile?.agentName })
      .then((res) => {
        if (cancelled || !res.data.resident) return
        setResidentTopicIds((prev) => {
          if (prev.has(selectedTopic.id)) return prev
          const next = new Set(prev)
          next.add(selectedTopic.id)
          return next
        })
      })
      .catch(() => {
        if (window.sessionStorage.getItem(getTopicLinkResidentStorageKey(selectedTopic.id)) !== '1') return
        setResidentTopicIds((prev) => {
          if (prev.has(selectedTopic.id)) return prev
          const next = new Set(prev)
          next.add(selectedTopic.id)
          return next
        })
      })
    return () => {
      cancelled = true
    }
  }, [selectedTopic?.id, viewerProfile?.agentName])

  useEffect(() => {
    if (selectedTopicId || !bestPersonalizedTopic?.category || activeCategory === bestPersonalizedTopic.category) {
      return
    }
    setActiveCategory(bestPersonalizedTopic.category)
  }, [activeCategory, bestPersonalizedTopic?.category, bestPersonalizedTopic?.id, selectedTopicId])

  const handleCategoryJump = useCallback((categoryId: string) => {
    const currentIndex = topicColumns.findIndex(({ category }) => category.id === activeCategory)
    const nextIndex = topicColumns.findIndex(({ category }) => category.id === categoryId)
    setStageTransitionDirection(
      currentIndex < 0 || nextIndex < 0
        ? 'none'
        : nextIndex > currentIndex
          ? 'right'
          : nextIndex < currentIndex
            ? 'left'
            : nextIndex > 0
              ? 'right'
              : 'none',
    )
    setActiveCategory(categoryId)
    setConnectionPanelOpen(true)
    const firstKnownTopic = topicColumns.find(({ category }) => category.id === categoryId)?.topics[0]
      ?? categoryPages[categoryId]?.items?.[0]
    if (firstKnownTopic) {
      setSelectedTopicId(firstKnownTopic.id)
    }
    const page = categoryPages[categoryId]
    if (!page?.categoryScoped && loadingMoreCategory !== categoryId) {
      void loadCategoryTopics(categoryId)
    }
  }, [activeCategory, categoryPages, listSearchQuery, loadingMoreCategory, topicColumns])

  const handlePlazaTopicSelect = useCallback((topic: TopicListItem) => {
    setSelectedTopicId(topic.id)
    setConnectionPanelOpen(true)
    if (topic.category) {
      setActiveCategory(topic.category)
    }
  }, [])

  const handleTopicLinkPlazaPresence = useCallback((topic: TopicListItem) => {
    if (residentTopicIds.has(topic.id)) return
    if (!topicLink.simulation?.turns?.[0]) {
      topicLink.simulate(topic)
      return
    }
    const markResident = () => {
      setResidentTopicIds((prev) => {
        const next = new Set(prev)
        next.add(topic.id)
        return next
      })
      window.sessionStorage.setItem(getTopicLinkResidentStorageKey(topic.id), '1')
      toast.success('已经留在这桌了，会先听一轮再接话')
    }
    topicsApi.setTopicLinkPresence(topic.id, { persona_name: viewerProfile?.agentName })
      .then(() => markResident())
      .catch(() => markResident())
  }, [residentTopicIds, topicLink, viewerProfile?.agentName])

  useEffect(() => {
    const activeTab = categoryTabRefs.current[activeCategory]
    activeTab?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeCategory])

  useEffect(() => {
    const updateColumnMetrics = () => {
      const stage = contentStageRef.current
      if (!stage) {
        return
      }

      const nextWidths = getStageWidths(stage.clientWidth)
      setColumnWidths((prev) => {
        if (
          Math.abs(prev.focus - nextWidths.focus) < 0.5
          && Math.abs(prev.side - nextWidths.side) < 0.5
        ) {
          return prev
        }
        return nextWidths
      })
    }

    const frame = window.requestAnimationFrame(updateColumnMetrics)
    window.addEventListener('resize', updateColumnMetrics)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateColumnMetrics)
    }
  }, [activeCategory, topicColumns.length])

  const renderColumn = (column: (typeof topicColumns)[number], isActive: boolean) => {
    const { category, topics: categoryTopics, topicCount } = column

    return (
      <section
        key={category.id}
        data-testid={`topic-category-${category.id}`}
        data-active={isActive ? 'true' : 'false'}
        className={`min-w-0 rounded-2xl border border-gray-200 bg-[rgba(255,255,255,0.84)] p-4 transition-[width,opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
          isActive ? '' : 'opacity-90'
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-lg font-serif font-semibold text-[var(--text-primary)]">{category.name}</h2>
            <p className="mt-1 text-xs font-serif text-[var(--text-tertiary)]">{category.description}</p>
          </div>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
            {topicCount}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {categoryTopics.map((topic) => {
            const canDeleteTopic = Boolean(currentUser && (currentUser.is_admin || (topic.creator_user_id != null && topic.creator_user_id === currentUser.id)))
            return (
              <TopicCard
                key={topic.id}
                topic={topic}
                canDelete={canDeleteTopic}
                onDelete={handleDeleteTopic}
                onLike={throttledLike}
                onFavorite={throttledFavorite}
                onShare={throttledShare}
                likePending={pendingTopicLikeIds.has(topic.id)}
                favoritePending={pendingTopicFavoriteIds.has(topic.id)}
              />
            )
          })}
        </div>
      </section>
    )
  }

  if (isTopicLinkSurface && !loading && hasAnyTopics && selectedTopic && usePlazaMap) {
    const plazaSidebar = (
      <TopicPlazaSidebar
        topicColumns={topicColumns}
        activeCategory={activeCategory}
        viewMode={plazaViewMode}
        onCategoryJump={handleCategoryJump}
        onViewModeChange={handlePlazaViewModeChange}
        onPeopleOpen={() => setConnectionPanelOpen(true)}
        variant={plazaViewMode === 'map' ? 'overlay' : 'page'}
      />
    )
    const plazaRightRail = (
      <div className="grid gap-4">
        {connectionPanelOpen ? (
          <TopicSideConnectionPanel
            topic={selectedTopic}
            onClose={() => setConnectionPanelOpen(false)}
            onSimulate={handleTopicLinkPlazaPresence}
            simulationLoading={topicLink.simulationLoading}
            simulation={topicLink.simulation}
            resident={selectedTopicResident}
            viewerProfile={viewerProfile}
            personalized={hasPersonalizedProfile}
          />
        ) : (
          <TopicConnectionPeek topic={selectedTopic} onOpen={() => setConnectionPanelOpen(true)} />
        )}
      </div>
    )

    if (plazaViewMode === 'map') {
      return (
        <div className="bg-[#f1f5ef] text-[#1f2523]">
          <section className="min-w-0 px-4 pb-6 pt-3 sm:px-6 lg:px-6">
            <TopicPlazaMap
              topicColumns={topicColumns}
              selectedTopic={selectedTopic}
              onTopicSelect={handlePlazaTopicSelect}
              recommendationLoading={topicLink.loading}
              simulation={topicLink.simulation}
              simulationLoading={topicLink.simulationLoading}
              onSimulate={handleTopicLinkPlazaPresence}
              resident={selectedTopicResident}
              viewerProfile={viewerProfile}
              personalized={hasPersonalizedProfile}
              recommendationSourceLabel={topicLinkRuntimeLabel}
              searchInput={searchInput}
              searchPlaceholder={hasPersonalizedProfile ? '搜一个问题、关键词或你想找的人' : '搜索话题、文章、人物'}
              searchLoading={Boolean(searchInput.trim()) && searchTopicLink.loading}
              searchResults={knowledgeSearchResults}
              searchResultCount={knowledgeSearchResults.length}
              searchAnswer={knowledgeAnswer?.answer}
              searchAnswerLoading={Boolean(searchQuery.trim()) && knowledgeAnswerLoading}
              showSearchHints={hasPersonalizedProfile && !localSearchQuery}
              onSearchInputChange={(value) => {
                setSearchInput(value)
                debouncedSetSearchQuery(value)
              }}
              onSearchResultSelect={handlePlazaTopicSelect}
              onOpenConnections={() => setConnectionPanelOpen(true)}
              leftRail={plazaSidebar}
              rightRail={plazaRightRail}
            />
          </section>
        </div>
      )
    }

    return (
      <div className="bg-[#f1f5ef] text-[#1f2523]">
        <div className="grid lg:grid-cols-[15rem_minmax(0,1fr)]">
          {plazaSidebar}

          <section className="min-w-0 px-4 py-5 pb-6 sm:px-6 lg:px-6">
            <div className="mb-4">
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#17211f]">TopicLink</h1>
                <p className="mt-2 text-sm text-[#68736f]">把和你有关的人、问题和资料摊开；看到想聊的，就进去说两句。</p>
              </div>
            </div>

            <TopicCompactConnectionList topics={visibleTopicItems} selectedTopic={selectedTopic} onTopicSelect={handlePlazaTopicSelect} viewerProfile={viewerProfile} />

          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">
              {isTopicLinkSurface ? 'TopicLink' : '话题列表'}
            </h1>
            {isTopicLinkSurface ? (
              <p className="mt-2 text-sm text-gray-500">这里先展示和你有关的人、问题和材料。</p>
            ) : null}
          </div>

          <div className="py-1">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
              <div className="min-w-0 overflow-x-auto scrollbar-hide">
                <div
                  ref={categoryTabsTrackRef}
                  className="relative flex h-12 w-full min-w-max items-center gap-1 px-4 py-1"
                >
                  {topicColumns.map(({ category }) => (
                    <button
                      key={category.id}
                      ref={(node) => {
                        categoryTabRefs.current[category.id] = node
                      }}
                      type="button"
                      onClick={() => handleCategoryJump(category.id)}
                      className={`relative z-10 flex h-10 shrink-0 cursor-pointer items-center rounded-full text-sm transition-[padding,color] duration-200 motion-reduce:transition-none ${
                        activeCategory === category.id
                          ? 'px-6 sm:px-7 font-medium text-[var(--color-dark)]'
                          : 'px-4 text-gray-600 hover:text-[var(--color-dark)]'
                      }`}
                    >
                      <span className="relative inline-block">
                        {category.name}
                        <span
                          data-testid={activeCategory === category.id ? 'topic-category-tab-underline' : undefined}
                          aria-hidden="true"
                          className={`pointer-events-none absolute left-1/2 top-[calc(100%+10px)] h-[2px] -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_0%,rgba(15,23,42,0.5)_50%,rgba(15,23,42,0.06)_100%)] transition-all duration-300 ease-out motion-reduce:transition-none ${
                            activeCategory === category.id ? 'opacity-100' : 'opacity-0'
                          }`}
                          style={{
                            width: activeCategory === category.id ? 'calc(100% + 1.75rem)' : '0px',
                          }}
                        />
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="relative block">
                <span className="sr-only">搜索话题</span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-[6px] h-[1px] bg-[rgba(148,163,184,0.8)]"
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                >
                  <path
                    d="M14.5 14.5L18 18M16.4 9.2A7.2 7.2 0 1 1 2 9.2a7.2 7.2 0 0 1 14.4 0Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => {
                    const value = event.target.value
                    setSearchInput(value)
                    debouncedSetSearchQuery(value)
                  }}
                  placeholder="搜索话题"
                  className="h-10 w-full border-0 bg-transparent py-0 pl-8 pr-3 text-sm text-gray-700 placeholder:text-gray-400 outline-none transition duration-200 motion-reduce:transition-none"
                />
              </label>
            </div>
          </div>
        </div>

        {loading && (
          <p className="text-gray-500 font-serif">加载中...</p>
        )}

        {!loading && !hasAnyTopics && (
          <p className="text-gray-500 font-serif">
            {searchQuery ? '没有找到相关话题' : '当前板块暂无话题'}
          </p>
        )}

        {!loading && hasAnyTopics && activeColumn ? (
          <div className={`mx-auto grid w-full gap-5 pb-4 ${isTopicLinkSurface ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
            <div className="min-w-0">
              <div
                ref={contentStageRef}
                data-testid="topic-category-rail"
                className="grid items-start justify-center overflow-hidden"
                style={{
                  gap: `${STAGE_GAP_PX}px`,
                  gridTemplateColumns: columnWidths.side > 0
                    ? `${columnWidths.side}px minmax(0, ${columnWidths.focus}px) ${columnWidths.side}px`
                    : `minmax(0, ${columnWidths.focus}px)`,
                }}
              >
                {columnWidths.side > 0 ? (
                  <div data-testid="topic-category-slot-left" className="min-w-0">
                    {prevColumn ? (
                      <div
                        key={prevColumn.category.id}
                        data-testid="topic-category-slot-left-inner"
                        className={stageEnterAnimationClass}
                      >
                        {renderColumn(prevColumn, false)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div data-testid="topic-category-slot-center" className="min-w-0">
                  <div
                    key={activeColumn.category.id}
                    data-testid="topic-category-slot-center-inner"
                    className={stageEnterAnimationClass}
                  >
                    {renderColumn(activeColumn, true)}
                  </div>
                </div>
                {columnWidths.side > 0 ? (
                  <div data-testid="topic-category-slot-right" className="min-w-0">
                    {nextColumn ? (
                      <div
                        key={nextColumn.category.id}
                        data-testid="topic-category-slot-right-inner"
                        className={stageEnterAnimationClass}
                      >
                        {renderColumn(nextColumn, false)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {isTopicLinkSurface ? <TopicRecommendationPanel topic={selectedTopic} viewerProfile={viewerProfile} /> : null}
          </div>
        ) : null}

        {!loading && activeCategory && ((categoryPages[activeCategory]?.nextCursor ?? null) || loadingMoreCategory === activeCategory) ? (
          <div ref={loadMoreRef} className="py-6 text-center text-sm text-gray-500">
            {loadingMoreCategory === activeCategory ? '加载更多话题中...' : '继续下滑加载更多'}
          </div>
        ) : null}

        {!loading && activeCategory && (categoryPages[activeCategory]?.nextCursor ?? null) ? (
          <div className="pb-6 text-center">
            <button
              type="button"
              onClick={() => { void loadMoreTopics(activeCategory) }}
              disabled={loadingMoreCategory === activeCategory}
              className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black disabled:opacity-50"
            >
              {loadingMoreCategory === activeCategory ? '加载中...' : '加载更多'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
