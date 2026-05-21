import { startTransition, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  topicsApi,
  discussionApi,
  postsApi,
  topicExpertsApi,
  sourceFeedApi,
  Topic,
  TopicExpert,
  TopicLinkMetadata,
  TopicLinkParticipant,
  TopicLinkSimulationResponse,
  Post,
  SourceFeedArticle,
  StartDiscussionRequest,
  DiscussionProgress,
  getTopicCategoryMeta,
} from '../api/client'
import TopicConfigTabs from '../components/TopicConfigTabs'
import ResizableToc from '../components/ResizableToc'
import PostThread from '../components/PostThread'
import ArcadeBranchTimeline from '../components/ArcadeBranchTimeline'
import ArcadeReadonlyNotice from '../components/arcade/ArcadeReadonlyNotice'
import ArcadeTopicIntroCard from '../components/arcade/ArcadeTopicIntroCard'
import DefaultAvatar from '../components/DefaultAvatar'
import MentionTextarea from '../components/MentionTextarea'
import ReactionButton from '../components/ReactionButton'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'
import { toast } from '../utils/toast'
import { isArcadeTopic } from '../utils/arcade'
import { isVideoMediaSrc, resolveTopicImageSrc } from '../utils/topicImage'
import { useThrottledCallback, useThrottledCallbackByKey } from '../hooks/useThrottledCallback'
import {
  LIYUYANG_TOPIC_VIEWER_PROFILE,
  TopicViewerProfile,
} from '../data/topicViewerProfiles'
import { buildLocalTopicLinkSimulation, cleanTopicVisibleText, getTopicLinkDebugUser } from '../topicLink/topicLinkModel'
import { buildTopicLinkSkillSearchText } from '../topicLink/topicLinkSkill'
import logo2050 from '../assets/2050-logo.webp'

interface DiscussionPost {
  round: number
  expertName: string
  expertKey: string
  content: string
  id: string
}

interface NavigationItem {
  type: 'round' | 'summary' | 'posts'
  round?: number
  label: string
  id: string
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 16.25l-1.15-1.04C4.775 11.53 2.5 9.47 2.5 6.95A3.45 3.45 0 016 3.5c1.14 0 2.23.53 3 1.36A4.05 4.05 0 0112 3.5a3.45 3.45 0 013.5 3.45c0 2.52-2.27 4.58-6.35 8.27L10 16.25z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M6 3.75h8a1 1 0 011 1v11l-5-2.6-5 2.6v-11a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M8 10.5l4-2.5m-4 1.5l4 2.5M13.5 6.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zm0 10.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zM5.5 12.25a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const POLL_INTERVAL_MS = 3500
const TOPICLINK_RESIDENT_STORAGE_PREFIX = 'topiclink-resident:'

const DETAIL_TOPIC_LINK_EXCLUDED_CATEGORIES = new Set(['2050'])

function getTopicLinkResidentStorageKey(topicId: string) {
  return `${TOPICLINK_RESIDENT_STORAGE_PREFIX}${topicId}`
}

const DETAIL_TOPIC_LINK_CATEGORY_ROLES: Record<string, { title: string; description: string; kind: string }> = {
  research: {
    title: '能补充资料的人',
    description: '适合补充论文、报告、案例或可验证资料。',
    kind: 'source',
  },
  thinking: {
    title: '愿意反驳的人',
    description: '适合提出反例、边界条件和不同解释。',
    kind: 'counterpoint',
  },
  product: {
    title: '有实践经验的人',
    description: '适合带来真实项目、落地细节和协作经验。',
    kind: 'practice',
  },
  application: {
    title: '有实践经验的人',
    description: '适合从使用场景和落地路径切入。',
    kind: 'practice',
  },
  arcade: {
    title: '愿意挑战题目的人',
    description: '适合先读题面，看别人怎么走，再换一种解法试试。',
    kind: 'practice',
  },
  needs: {
    title: '能回应需求的人',
    description: '适合直接补资源、给建议或一起推进。',
    kind: 'peer',
  },
  plaza: {
    title: '有人一起想想',
    description: '先把眼前这件事说清楚，再看下一步。',
    kind: 'peer',
  },
}

function normalizeTopicDate(value: string | null | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) return new Date().toISOString()
  const withOffset = raw.replace(/([+-]\d{2})$/, '$1:00')
  const parsed = new Date(withOffset)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function formatTopicDate(value: string | null | undefined) {
  const parsed = new Date(normalizeTopicDate(value))
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isLiyuyangTopicLinkDebug(search: string) {
  if (!import.meta.env.DEV) {
    return false
  }
  const debugUser = new URLSearchParams(search).get('debug_user')?.trim().toLowerCase()
  return debugUser === LIYUYANG_TOPIC_VIEWER_PROFILE.username
}

function compactTopicText(text: string | null | undefined, fallback: string, maxLength = 156) {
  const normalized = (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return fallback
  const visibleText = cleanTopicVisibleText(normalized)
  return visibleText.length > maxLength ? `${visibleText.slice(0, maxLength - 1)}…` : visibleText
}

function getDetailTopicRole(topic: Topic) {
  const category = (topic.category ?? 'plaza').trim()
  return DETAIL_TOPIC_LINK_CATEGORY_ROLES[category] ?? DETAIL_TOPIC_LINK_CATEGORY_ROLES.plaza
}

function buildDerivedTopicLink(topic: Topic | null): TopicLinkMetadata | null {
  if (!topic) return null
  const category = (topic.category ?? '').trim()
  if (DETAIL_TOPIC_LINK_EXCLUDED_CATEGORIES.has(category)) return null
  if (!topic.title?.trim() && !topic.body?.trim()) return null

  const role = getDetailTopicRole(topic)
  const creatorName = topic.creator_name?.trim()
  const participants: TopicLinkParticipant[] = [
    creatorName
      ? {
          name: creatorName,
          role: topic.creator_auth_type === 'openclaw_key' ? '发起与整理' : role.title,
          status: 'starter',
          openclaw: topic.creator_auth_type === 'openclaw_key',
          fit: 86,
        }
      : {
          name: '发起人',
          role: role.title,
          status: 'starter',
          fit: 82,
        },
    {
      name: '我这边',
      role: '整理资料与共识',
      status: 'digesting',
      openclaw: true,
      fit: 84,
    },
  ]
  if ((topic.posts_count ?? 0) > 0) {
    participants.push({
      name: `${topic.posts_count} 条回应`,
      role: '已有回应',
      status: 'responded',
      fit: 78,
    })
  }

  return {
    connection_mode: 'openclaw_link',
    table_state: topic.posts_count && topic.posts_count > 0 ? 'active' : 'seeking',
    participants,
    wanted: [
      {
        kind: role.kind,
        title: role.title,
        description: role.description,
        source: 'manual',
      },
    ],
    angles: [
      {
        id: 'listen',
        title: '了解一下',
        description: '先把大家的观点理清楚，再决定怎么回应。',
        kind: 'co_read',
      },
      {
        id: 'source',
        title: '补充资料',
        description: '带来案例、数据或可验证材料。',
        kind: 'source',
      },
      {
        id: 'respond',
        title: '直接回应',
        description: '给出经验、反例或下一步建议。',
        kind: 'counterpoint',
      },
    ],
    profile_signals: {
      rcss: '连接意图',
      motivation: role.title,
      personality: category || '开放讨论',
      skill: topic.creator_auth_type === 'openclaw_key' ? '有人整理过' : '公共话题',
      needs: compactTopicText(topic.body, role.description, 112),
    },
    openclaw_digest: {
      title: '话题摘要',
      description: role.description,
      updated_at: topic.updated_at,
    },
    recommendation_score: Math.min(88, 62 + Math.min(14, Math.floor((topic.posts_count ?? 0) / 4)) + (category === 'research' ? 6 : 0)),
  }
}

function getTopicLink(topic: Topic | null): TopicLinkMetadata | null {
  const link = topic?.metadata?.topic_link
  if (link && typeof link === 'object' && !Array.isArray(link)) {
    return link
  }
  return buildDerivedTopicLink(topic)
}

function getTopicLinkParticipants(topicLink: TopicLinkMetadata | null, topic?: Topic | null): TopicLinkParticipant[] {
  const participants = topicLink?.participants
  if (Array.isArray(participants) && participants.length > 0) {
    return participants.slice(0, 6)
  }
  const role = topic ? getDetailTopicRole(topic) : DETAIL_TOPIC_LINK_CATEGORY_ROLES.plaza
  const creatorName = topic?.creator_name?.trim()
  return [
    { name: creatorName || '发起人', role: role.title, status: 'starter', openclaw: topic?.creator_auth_type === 'openclaw_key', fit: 86 },
    { name: '我这边', role: '先看再说', status: 'digesting', openclaw: true, fit: 84 },
  ]
}

function getParticipantName(person: TopicLinkParticipant) {
  const rawName = cleanTopicLinkPersonName(person.name)
  if (person.openclaw || /^openclaw$/i.test(person.name?.trim() ?? '')) {
    return '我这边'
  }
  return rawName || '参与者'
}

function cleanTopicLinkPersonName(name: string | null | undefined) {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  const guestMatch = raw.match(/^OpenClaw\s+Guest\s+([^'\s]+)(?:'s)?(?:\s+openclaw)?/i)
  if (guestMatch) return `来访者 ${guestMatch[1]}`
  if (/^openclaw$/i.test(raw)) return '我这边'
  return raw.replace(/\s*'s\s+openclaw$/i, '').trim()
}

function TopicLinkInsightAside({ topic }: { topic: Topic }) {
  const topicLink = getTopicLink(topic)
  if (!topicLink) return null
  const participants = getTopicLinkParticipants(topicLink, topic)
  return (
    <section className="rounded-[1.15rem] border border-[#d7e5dd] bg-[#fffdf8]/92 p-4 shadow-[0_14px_34px_rgba(42,59,49,0.08)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold text-[#17211f]">群里的人</h3>
        <span className="text-xs text-[#84928b]">{participants.length} 位在场</span>
      </div>
      <div className="space-y-3">
        {participants.slice(0, 5).map((person, index) => (
          <div key={`${getParticipantName(person)}-${person.role ?? ''}-${index}`} className="flex items-center gap-3">
            <DefaultAvatar name={getParticipantName(person)} kind={person.openclaw ? 'openclaw' : 'person'} className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#25302d]">{getParticipantName(person)}</p>
              <p className="truncate text-xs text-[#78857f]">{cleanTopicVisibleText(person.role ?? '正在看这桌')}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TopicLinkRoundtableGuide({
  topic,
  onInvite,
  onPreview,
  simulation,
  simulationLoading,
  resident,
}: {
  topic: Topic
  onInvite: () => void
  onPreview: () => void
  simulation: TopicLinkSimulationResponse | null
  simulationLoading: boolean
  resident: boolean
}) {
  const topicLink = getTopicLink(topic)
  if (!topicLink) return null
  const wanted = (topicLink.wanted ?? []).slice(0, 3)
  const participants = getTopicLinkParticipants(topicLink, topic).slice(0, 4)
  const topicSummary = compactTopicText(topic.body, '先把问题放出来，看看大家怎么说。', 170)

  const previewTurn = simulation?.turns?.[0]
  const previewButtonLabel = simulationLoading ? '正在看这桌…' : resident ? '已在群里' : previewTurn ? '留在群里' : '先替我看看'

  return (
    <section className="mb-5 rounded-[1.15rem] border border-[#d7e5dd] bg-[#fffdf8] p-4 shadow-[0_14px_34px_rgba(42,59,49,0.07)] sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem] xl:items-stretch">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#e8f4f0] px-3 py-1 text-xs font-medium text-[#2f8586]">群公告</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs text-[#61716a] ring-1 ring-[#dce9e2]">{participants.length} 人在看</span>
          </div>
          <h2 className="font-serif text-xl font-semibold text-[#17211f]">这桌在聊什么</h2>
          <p className="mt-3 line-clamp-5 max-w-[48rem] text-[15px] leading-7 text-[#46554f] sm:line-clamp-4">{topicSummary}</p>
          {wanted.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {wanted.slice(0, 2).map((item, index) => (
                <span key={`${item.title}-${index}`} className="rounded-full border border-[#d7e8df] bg-[#f4faf6] px-3 py-1 text-xs text-[#53675f]">
                  {cleanTopicVisibleText(item.title || '有人能补一句')}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col rounded-[1rem] bg-[#f4faf6] p-3 ring-1 ring-[#dce9e2]">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {participants.map((person, index) => (
                <DefaultAvatar
                  key={`${getParticipantName(person)}-${index}`}
                  name={getParticipantName(person)}
                  kind={person.openclaw ? 'openclaw' : 'person'}
                  className="h-8 w-8 ring-2 ring-white"
                />
            ))}
            </div>
            <span className="ml-auto rounded-full bg-[#eaf6ef] px-3 py-1 text-xs font-medium text-[#3d8a5d]">在旁边听</span>
          </div>
          <button
            type="button"
            onClick={onPreview}
            disabled={simulationLoading || resident}
            className={`mt-3 w-full rounded-xl border px-3 py-2 text-sm font-medium transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-75 ${
              resident
                ? 'border-[#b9d8c8] bg-[#eaf6ef] text-[#3d8a5d]'
                : 'border-[#b7d8d4] bg-[#edf8f6] text-[#286f72] hover:border-[#69b7b2] hover:bg-white'
            }`}
          >
            {previewButtonLabel}
          </button>
          <button
            type="button"
            onClick={onInvite}
            className="mt-2 w-full rounded-xl border border-[#dfc898] bg-[#fff8e9] px-3 py-2 text-sm font-medium text-[#8a661d] transition hover:border-[#d0aa55] hover:bg-[#fff2d5]"
          >
            邀请附近的人
          </button>
          <p className="mt-auto pt-3 text-xs leading-5 text-[#77847d]">
            {resident
              ? '已经留在这桌，会先看新的回应。'
              : previewTurn
              ? cleanTopicVisibleText(previewTurn.message)
              : '先看正文和回应，再决定要不要说。'}
          </p>
          {simulation?.suggested_action ? (
            <p className="mt-2 rounded-xl bg-[#f7fbf7] px-3 py-2 text-xs text-[#5f6f68] ring-1 ring-[#e2ede7]">
              {cleanTopicVisibleText(simulation.suggested_action)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

type InviteCandidate = {
  id: string
  name: string
  role: string
  note: string
  kind: 'openclaw' | 'person'
  source: string
  score: number
}

function TopicLinkInvitePanel({
  topic,
  topicExperts,
  posts,
  viewerProfile,
  onUsePrompt,
}: {
  topic: Topic
  topicExperts: TopicExpert[]
  posts: Post[]
  viewerProfile: TopicViewerProfile | null
  onUsePrompt: (text: string) => void
}) {
  const [query, setQuery] = useState('')
  const topicLink = getTopicLink(topic)
  if (!topicLink) return null
  const wanted = topicLink.wanted ?? []
  const participants = getTopicLinkParticipants(topicLink, topic)
  const topicTitle = cleanTopicVisibleText(topic.title || '这个话题')
  const queryText = query.trim().toLowerCase()
  const postAuthors = posts
    .filter((post) => post.author?.trim() && post.body?.trim() && post.body.trim() !== '-')
    .map((post, index) => ({
      id: `post-author-${post.author}-${index}`,
      name: cleanTopicLinkPersonName(post.expert_label || post.author) || '参与者',
      role: post.author_type === 'agent' ? '已经回应' : '已经回应',
      note: cleanTopicVisibleText(post.body).slice(0, 96),
      kind: (post.owner_auth_type === 'openclaw_key' || /openclaw/i.test(post.author)) ? 'openclaw' as const : 'person' as const,
      source: '在场',
      score: 88 - Math.min(index, 8),
    }))
  const rawCandidates: InviteCandidate[] = [
    ...postAuthors,
    ...participants.map((person, index) => ({
      id: `participant-${getParticipantName(person)}-${index}`,
      name: getParticipantName(person),
      role: cleanTopicVisibleText(person.role || '已经在附近'),
      note: person.fit != null ? '已经说过几句，可以继续聊' : '可以看看他的回应',
      kind: person.openclaw ? 'openclaw' as const : 'person' as const,
      source: person.status === 'starter' ? '开了这桌' : '在场',
      score: Number(person.fit ?? 72),
    })),
    ...wanted.map((item, index) => ({
      id: `wanted-${item.title}-${index}`,
      name: item.title || '合适的人',
      role: '想找',
      note: item.description || '可以带来一点新材料',
      kind: 'person' as const,
      source: '想找',
      score: 86 - index * 5,
    })),
    ...topicExperts
      .filter((expert) => expert.source !== 'preset' || expert.origin_type === 'digital_twin')
      .map((expert, index) => ({
      id: `expert-${expert.name}-${index}`,
      name: cleanTopicLinkPersonName(expert.label || expert.name) || '参与者',
      role: '可邀请',
      note: expert.description || '可以带来一点不同看法',
      kind: expert.origin_type === 'digital_twin' ? 'openclaw' as const : 'person' as const,
      source: '可请来',
      score: 76 - index,
    })),
    ...(viewerProfile ? [{
      id: `viewer-${viewerProfile.handle}`,
      name: viewerProfile.agentName,
      role: viewerProfile.title,
      note: viewerProfile.summary,
      kind: 'openclaw' as const,
      source: '我这边',
      score: 90,
    }] : []),
  ]
  const seen = new Set<string>()
  const candidates = rawCandidates
    .filter((candidate) => {
      const key = `${candidate.name}-${candidate.role}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .filter((candidate) => {
      if (!queryText) return true
      return [candidate.name, candidate.role, candidate.note, candidate.source]
        .join('\n')
        .toLowerCase()
        .includes(queryText)
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, queryText ? 8 : 4)

  return (
    <section id="topiclink-invite-panel" className="rounded-[1.15rem] border border-[#d9e6df] bg-[#fffdf8]/92 p-4 shadow-[0_12px_30px_rgba(42,59,49,0.07)]">
      <div>
        <p className="text-xs font-medium text-[#6f8580]">邀请进来</p>
        <h2 className="mt-1 font-serif text-lg font-semibold text-[#17211f]">看看谁在附近</h2>
      </div>
      <label className="relative mt-3 block">
        <span className="sr-only">搜索名字或关键词</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜名字或关键词"
          className="h-10 w-full rounded-xl border border-[#d5e5dc] bg-[#f1f7f3] px-3 text-sm text-[#25302d] outline-none transition focus:border-[#7fc4bf] focus:bg-white"
        />
      </label>

      <div className="mt-3 space-y-2">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onUsePrompt(`想请 ${candidate.name} 来看看「${topicTitle}」：${candidate.note}`)}
            className="flex w-full items-start gap-3 rounded-2xl border border-[#d9e8e1] bg-[#f7fbf7] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#9ccfca] hover:bg-white"
          >
            <DefaultAvatar name={candidate.name} kind={candidate.kind} className="h-9 w-9 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-[#1f2926]">{candidate.name}</span>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-[#2f8586] ring-1 ring-[#d5e8e3]">{candidate.source}</span>
              </span>
              <span className="mt-1 block truncate text-xs font-medium text-[#5b6b65]">{candidate.role}</span>
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[#77837d]">{candidate.note}</span>
            </span>
          </button>
        ))}
      </div>

      {candidates.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-[#f2f7f3] px-3 py-2 text-sm text-[#6c7771]">暂时没找到，换个关键词试试。</p>
      ) : null}
    </section>
  )
}

function getInspirationSubmitPathFromDetailTopic(topic: Topic) {
  const params = new URLSearchParams({
    from: 'topiclink',
    topic_id: topic.id,
    topic_title: cleanTopicVisibleText(topic.title || '这桌讨论').slice(0, 120),
  })
  return `/inspiration-co-creation/submit?${params.toString()}`
}

type TopicLinkCoCreationDemand = {
  id: string
  title: string
  role: string
  problem: string
  category: string
  currentBlockers: string
  note: string
}

function getCoCreationDemandSubmitPath(topic: Topic, demand: TopicLinkCoCreationDemand) {
  const params = new URLSearchParams({
    from: 'topiclink',
    intent: 'demand',
    topic_id: topic.id,
    topic_title: cleanTopicVisibleText(topic.title || '这桌讨论').slice(0, 120),
    problem: demand.problem,
    category: demand.category,
    current_blockers: demand.currentBlockers,
    note: demand.note,
  })
  return `/inspiration-co-creation/submit?${params.toString()}`
}

function buildCoCreationDemandsFromTopic(topic: Topic): TopicLinkCoCreationDemand[] {
  const title = cleanTopicVisibleText(topic.title || '这桌讨论')
  const body = compactTopicText(topic.body, '', 220)
  const text = `${title}\n${body}`.toLowerCase()
  const isMemoryTopic = /记忆|memory|画像|分身|persona/.test(text)
  const isResearchTopic = /科研|论文|数据|ai4s|模型|评估|实验/.test(text)
  if (isMemoryTopic) {
    return [
      {
        id: 'memory-eval',
        title: '先用几条真实记忆试一遍',
        role: '先小范围看看',
        problem: `先别急着定一套大标准。找 5 到 10 条真实记忆和几段对话，看哪些确实有用，哪些会让它说偏、说满，或者还得回头问本人。`,
        category: '科研 / 数据',
        currentBlockers: '想找人一起拆解',
        note: `来自 TopicLink 这桌：「${title}」。先要一份小样本和一张问题清单，不急着做完整系统。`,
      },
      {
        id: 'memory-conflict',
        title: '看看哪些地方前后对不上',
        role: '先理一遍',
        problem: `先把同一个人前后说法不一致、已经过期、没来源，或者不能替本人说出口的内容标出来。再分成三类：可以删、需要改、必须问本人。`,
        category: '科研 / 数据',
        currentBlockers: '想找人一起拆解',
        note: `来自 TopicLink 这桌：「${title}」。先拿少量真实材料试，看看清理前后会差多少。`,
      },
      {
        id: 'memory-playback',
        title: '让用户知道它看了什么',
        role: '说清楚就行',
        problem: `现在它看过哪桌、为什么先不说话、准备从哪里开始，用户其实看不太出来。先做一个很轻的记录页，把这几件事说清楚。`,
        category: '工作效率',
        currentBlockers: '想找共创伙伴',
        note: `来自 TopicLink 这桌：「${title}」。先画出一个能点的版本，不需要完整后台。`,
      },
    ]
  }
  return [
    {
      id: 'discussion-to-brief',
      title: '先把这桌收成一页纸',
      role: '让后来的人看懂',
      problem: `这桌已经聊了不少，但后来的人不一定接得上。先把背景、谁在场、还没说清的地方、下一步怎么试，收成一页纸。`,
      category: isResearchTopic ? '科研 / 数据' : '工作效率',
      currentBlockers: '想把需求边界说清楚',
      note: `来自 TopicLink 这桌：「${title}」。先做一版样例，让别人一眼看懂这事值不值得继续。`,
    },
    {
      id: 'source-finder',
      title: '给这桌补几条硬材料',
      role: '资料和反例',
        problem: `现在先别追求很全。找几条相关资料、反例和真实案例，再附上两三个可以继续追问的问题，让后来的人能继续聊。`,
      category: isResearchTopic ? '科研 / 数据' : '内容创作',
      currentBlockers: '想找真实反馈',
      note: `来自 TopicLink 这桌：「${title}」。先要一份能贴回讨论里的材料清单。`,
    },
    {
      id: 'prototype-plan',
      title: '拆成一周内能试的小事',
      role: '找人一起做',
      problem: `别一上来就做大项目。先定一个一周内能试的小事：做到哪一步算有用，需要什么材料，还缺谁一起做。`,
      category: '工作效率',
      currentBlockers: '想找共创伙伴',
      note: `来自 TopicLink 这桌：「${title}」。先写成短任务，方便共创队继续找人。`,
    },
  ]
}

function TopicLinkInspirationBridge({
  topic,
  onUsePrompt,
}: {
  topic: Topic
  onUsePrompt: (text: string) => void
}) {
  const topicTitle = cleanTopicVisibleText(topic.title || '这桌讨论')
  const coCreationDemands = buildCoCreationDemandsFromTopic(topic)
  const primaryDemand = coCreationDemands[0]
  return (
    <section className="rounded-[1.15rem] border border-[#d8e6dc] bg-[#fffdf8]/90 p-4 shadow-[0_10px_24px_rgba(42,59,49,0.06)]">
      <p className="text-xs font-medium text-[#6f8580]">有下一步</p>
      <h2 className="mt-1 font-serif text-lg font-semibold text-[#17211f]">再发给共创队</h2>
      <p className="mt-2 text-sm leading-6 text-[#66736d]">
        这边先聊清楚。真有小任务了，再找人继续做。
      </p>
      <div className="mt-3 grid gap-2 text-sm font-medium">
        <Link
          to={primaryDemand ? getCoCreationDemandSubmitPath(topic, primaryDemand) : getInspirationSubmitPathFromDetailTopic(topic)}
          className="rounded-xl bg-[#17324a] px-4 py-2.5 text-center text-white transition hover:bg-[#23455f]"
        >
          发给共创队
        </Link>
        <button
          type="button"
          onClick={() => onUsePrompt(`我想先把「${topicTitle}」往下拆一下：这件事现在最该说清楚的是什么？`)}
          className="rounded-xl border border-[#b7d8d4] bg-white px-4 py-2.5 text-[#286f72] transition hover:border-[#69b7b2] hover:bg-[#eef8f6]"
        >
          先在群里问问
        </button>
      </div>
    </section>
  )
}

export default function TopicLinkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const initialSkillIds = (location.state as { skillList?: string[] } | null)?.skillList
  const [topic, setTopic] = useState<Topic | null>(null)
  const [loading, setLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(true)
  const [topicExperts, setTopicExperts] = useState<TopicExpert[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [postNextCursor, setPostNextCursor] = useState<string | null>(null)
  const [loadingMorePosts, setLoadingMorePosts] = useState(false)
  const [replyLoadingPostIds, setReplyLoadingPostIds] = useState<Set<string>>(new Set())
  const [replyNextCursorByPostId, setReplyNextCursorByPostId] = useState<Record<string, string | null>>({})
  const [postText, setPostText] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [topicLinkSimulation, setTopicLinkSimulation] = useState<TopicLinkSimulationResponse | null>(null)
  const [topicLinkSimulationLoading, setTopicLinkSimulationLoading] = useState(false)
  const [topicLinkResident, setTopicLinkResident] = useState(false)
  const [startingDiscussion, setStartingDiscussion] = useState(false)
  const [polling, setPolling] = useState(false)
  const [progress, setProgress] = useState<DiscussionProgress | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const discussionStartRef = useRef<number | null>(null)
  const [activeNavId, setActiveNavId] = useState<string>('')
  const [replyingTo, setReplyingTo] = useState<Post | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [topicLikePending, setTopicLikePending] = useState(false)
  const [topicFavoritePending, setTopicFavoritePending] = useState(false)
  const [postLikePendingIds, setPostLikePendingIds] = useState<Set<string>>(new Set())
  const [linkedSourceArticle, setLinkedSourceArticle] = useState<SourceFeedArticle | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingRepliesRef = useRef<Set<string>>(new Set())
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const topicLinkDraftRef = useRef<HTMLElement>(null)
  const loginComposerRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const focusThreadRequestKeyRef = useRef<string | null>(null)
  const focusedPostIdRef = useRef<string | null>(null)
  const isTopicLinkRoute = location.pathname.startsWith('/topiclink/')
  const topicLinkViewerProfile = isLiyuyangTopicLinkDebug(location.search) ? LIYUYANG_TOPIC_VIEWER_PROFILE : null

  useEffect(() => {
    if (window.navigator.userAgent.toLowerCase().includes('jsdom')) {
      return
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [id])

  useEffect(() => {
    if (id) {
      void bootstrapTopicDetail(id)
    }
  }, [id, location.search])

  useEffect(() => {
    if (!id) {
      setTopicLinkResident(false)
      return
    }
    let cancelled = false
    topicsApi.getTopicLinkPresence(id, { personaName: topicLinkViewerProfile?.agentName })
      .then((res) => {
        if (!cancelled) {
          setTopicLinkResident(res.data.resident)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTopicLinkResident(window.sessionStorage.getItem(getTopicLinkResidentStorageKey(id)) === '1')
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, topicLinkViewerProfile?.agentName])

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const focusPostId = searchParams.get('focusPost') || (location.hash.startsWith('#post-') ? location.hash.slice(6) : '')
    const threadRootId = searchParams.get('threadRoot') || ''

    if (!id || !focusPostId || postsLoading) {
      return
    }

    const scrollToFocusedPost = () => {
      const element = document.getElementById(`post-${focusPostId}`)
      if (!element) {
        return false
      }
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      focusedPostIdRef.current = focusPostId
      return true
    }

    if (focusedPostIdRef.current === focusPostId && scrollToFocusedPost()) {
      return
    }

    if (scrollToFocusedPost()) {
      return
    }

    const requestPostId = threadRootId || focusPostId
    if (!requestPostId) {
      return
    }
    const requestKey = `${id}:${focusPostId}:${requestPostId}`
    if (focusThreadRequestKeyRef.current === requestKey) {
      return
    }
    focusThreadRequestKeyRef.current = requestKey

    void postsApi.getThread(id, requestPostId)
      .then((res) => {
        setPosts((prev) => mergePosts(prev, res.data.items))
        window.setTimeout(() => {
          if (scrollToFocusedPost()) {
            focusThreadRequestKeyRef.current = null
          }
        }, 80)
      })
      .catch(() => {
        focusThreadRequestKeyRef.current = null
      })
  }, [id, location.hash, location.search, posts, postsLoading])

  useEffect(() => {
    if (topic?.discussion_status === 'running' && !polling) {
      setPolling(true)
      startPolling()
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [topic?.discussion_status])

  // Local elapsed timer — no backend round-trip needed
  useEffect(() => {
    if (topic?.discussion_status !== 'running') {
      discussionStartRef.current = null
      setElapsedSeconds(0)
      return
    }
    if (!discussionStartRef.current) {
      discussionStartRef.current = Date.now()
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - discussionStartRef.current!) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [topic?.discussion_status])

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!id || pendingRepliesRef.current.size === 0) return
      for (const replyId of [...pendingRepliesRef.current]) {
        try {
          const res = await postsApi.getReplyStatus(id, replyId)
          if (res.data.status !== 'pending') {
            pendingRepliesRef.current.delete(replyId)
            setPosts(prev => mergePosts(prev, [res.data]))
          }
        } catch {
          pendingRepliesRef.current.delete(replyId)
        }
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const syncUser = async () => {
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
    const articleId = extractSourceArticleId(topic?.body || '')
    if (!articleId) {
      setLinkedSourceArticle(null)
      return
    }
    let cancelled = false
    sourceFeedApi.detail(articleId)
      .then((res) => {
        if (!cancelled) {
          setLinkedSourceArticle(res.data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedSourceArticle(buildSourcePreviewFromTopicBody(topic?.body || '', articleId))
        }
      })
    return () => {
      cancelled = true
    }
  }, [topic?.body])

  // 信源话题且 expert_names 为空时轮询刷新 topic，以显示 AI 生成的角色（替代「生成中…」）
  useEffect(() => {
    if (!id || !topic || !linkedSourceArticle) return
    const expertNames = topic.expert_names ?? []
    if (expertNames.length > 0) return
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (cancelled) return
      try {
        const res = await topicsApi.get(id)
        if (!cancelled && (res.data.expert_names?.length ?? 0) > 0) {
          setTopic(res.data)
          return
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, 2000)
      }
    }
    timeoutId = setTimeout(poll, 2000)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [id, topic?.id, linkedSourceArticle, topic?.expert_names?.length])

  const mergePosts = (existing: Post[], incoming: Post[]) => {
    const byId = new Map(existing.map(item => [item.id, item]))
    for (const post of incoming) {
      byId.set(post.id, { ...byId.get(post.id), ...post })
    }
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  const flattenPostPage = (items: Post[]) => {
    const flat: Post[] = []
    for (const post of items) {
      flat.push({ ...post, latest_replies: undefined })
      for (const reply of post.latest_replies ?? []) {
        flat.push(reply)
      }
    }
    return flat
  }

  const isArcadeTopicData = (value: Topic | null | undefined) => isArcadeTopic(value)

  const enrichTopicLinkForCurrentViewer = async (nextTopic: Topic) => {
    if (!isLiyuyangTopicLinkDebug(location.search) || isArcadeTopicData(nextTopic)) {
      return nextTopic
    }

    const baseTopicLink = nextTopic.metadata?.topic_link ?? buildDerivedTopicLink(nextTopic)
    if (!baseTopicLink) {
      return nextTopic
    }

    try {
      const res = await topicsApi.scoreTopicLinkRecommendations({
        profile_text: buildTopicLinkSkillSearchText({ viewerProfile: LIYUYANG_TOPIC_VIEWER_PROFILE }),
        topics: [nextTopic],
      })
      const recommendation = res.data.items.find((item) => item.topic_id === nextTopic.id)
      if (!recommendation) {
        return nextTopic
      }

      const metadata = nextTopic.metadata ?? {}
      return {
        ...nextTopic,
        metadata: {
          ...metadata,
          topic_link: {
            ...baseTopicLink,
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
    } catch {
      return nextTopic
    }
  }

  const hydrateVisiblePosts = async (topicId: string, items: Post[], arcadeMode: boolean) => {
    const flat = flattenPostPage(items)
    if (!arcadeMode || items.length === 0) {
      return flat
    }
    const threadPages = await Promise.all(
      items.map(async (post) => {
        try {
          const res = await postsApi.getThread(topicId, post.id)
          return res.data.items
        } catch {
          return [post]
        }
      }),
    )
    return mergePosts([], [...flat, ...threadPages.flat()])
  }

  const bootstrapTopicDetail = async (topicId: string) => {
    setLoading(true)
    setPostsLoading(true)
    setPosts([])
    setTopicExperts([])
    setReplyNextCursorByPostId({})
    setPostNextCursor(null)
    try {
      const res = await topicsApi.get(topicId)
      const nextTopic = await enrichTopicLinkForCurrentViewer(res.data)
      if (location.pathname.startsWith('/arcade/topics/') && !isArcadeTopicData(nextTopic)) {
        navigate('/', { replace: true })
        return
      }
      setTopic(nextTopic)
      setLoading(false)
      void loadPosts(topicId, isArcadeTopicData(nextTopic))
      window.setTimeout(() => {
        void loadTopicExperts(topicId)
      }, 0)
    } catch (err) {
      handleApiError(err, '加载话题失败')
      setLoading(false)
      setPostsLoading(false)
      return
    }
  }

  const loadTopicExperts = async (topicId: string) => {
    try {
      const res = await topicExpertsApi.list(topicId)
      setTopicExperts(res.data)
    } catch (err) {
      handleApiError(err, '加载专家列表失败')
    }
  }

  const loadTopic = async (topicId: string) => {
    try {
      const res = await topicsApi.get(topicId)
      const nextTopic = await enrichTopicLinkForCurrentViewer(res.data)
      setTopic(nextTopic)
    } catch (err) {
      handleApiError(err, '加载话题失败')
    } finally {
      setLoading(false)
    }
  }

  const loadPosts = async (topicId: string, arcadeMode = isArcadeTopicData(topic)) => {
    setPostsLoading(true)
    try {
      const res = isTopicLinkRoute && !arcadeMode
        ? await topicsApi.getTopicLinkPosts(topicId, { limit: 100 })
        : await postsApi.list(topicId, { limit: arcadeMode ? 100 : undefined, previewReplies: 0 })
      const hydratedPosts = await hydrateVisiblePosts(topicId, res.data.items, arcadeMode)
      startTransition(() => {
        setPosts(hydratedPosts)
      })
      setPostNextCursor(isTopicLinkRoute && !arcadeMode ? null : res.data.next_cursor)
      setReplyNextCursorByPostId(
        arcadeMode
          ? {}
          : Object.fromEntries(res.data.items.map(post => [post.id, (post.reply_count ?? 0) > (post.latest_replies?.length ?? 0) ? '__more__' : null]))
      )
    } catch { /* ignore */ }
    finally {
      setPostsLoading(false)
    }
  }

  const loadMorePosts = async () => {
    if (!id || !postNextCursor || loadingMorePosts) return
    setLoadingMorePosts(true)
    try {
      const arcadeMode = isArcadeTopicData(topic)
      const res = await postsApi.list(id, { cursor: postNextCursor, limit: arcadeMode ? 100 : undefined, previewReplies: 0 })
      const hydratedPosts = await hydrateVisiblePosts(id, res.data.items, arcadeMode)
      setPosts(prev => mergePosts(prev, hydratedPosts))
      setPostNextCursor(res.data.next_cursor)
      setReplyNextCursorByPostId(prev => ({
        ...prev,
        ...(arcadeMode
          ? {}
          : Object.fromEntries(res.data.items.map(post => [post.id, (post.reply_count ?? 0) > (post.latest_replies?.length ?? 0) ? '__more__' : null]))),
      }))
    } catch (err) {
      handleApiError(err, '加载更多帖子失败')
    } finally {
      setLoadingMorePosts(false)
    }
  }

  const handleLoadReplies = async (post: Post) => {
    if (!id) return
    const currentCursor = replyNextCursorByPostId[post.id]
    if (currentCursor === null || replyLoadingPostIds.has(post.id)) return
    setReplyLoadingPostIds(prev => new Set(prev).add(post.id))
    try {
      const res = await postsApi.listReplies(id, post.id, {
        cursor: currentCursor === '__more__' ? undefined : currentCursor,
      })
      setPosts(prev => mergePosts(prev, res.data.items))
      setReplyNextCursorByPostId(prev => ({
        ...prev,
        [post.id]: res.data.next_cursor,
      }))
    } catch (err) {
      handleApiError(err, '加载回复失败')
    } finally {
      setReplyLoadingPostIds(prev => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
    }
  }

  const handleReplyToPost = (post: Post) => {
    setSubmitError('')
    setReplyingTo(post)
    if (post.author_type === 'agent' && topic?.discussion_status !== 'pending' && topic?.discussion_status !== 'running') {
      const mentionName = post.expert_name ?? post.author
      setPostText(prev => ensureExpertMention(prev, mentionName))
    }
    setTimeout(() => composerTextareaRef.current?.focus(), 0)
  }

  const handleUseTopicLinkPrompt = (text: string) => {
    setSubmitError('')
    setReplyingTo(null)
    setPostText(text)
    setTimeout(() => {
      const target = composerTextareaRef.current ?? topicLinkDraftRef.current ?? loginComposerRef.current
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      composerTextareaRef.current?.focus()
    }, 80)
  }

  const handleOpenTopicLinkInvite = () => {
    const panel = document.getElementById('topiclink-invite-panel')
    if (!panel || panel.getClientRects().length === 0) {
      handleUseTopicLinkPrompt('想请熟悉这块的人进来看看。')
      return
    }
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => {
      const input = panel?.querySelector<HTMLInputElement>('input[type="search"]')
      input?.focus()
    }, 180)
  }

  const handlePreviewTopicLink = async () => {
    if (!id || !topic || topicLinkSimulationLoading) return
    if (topicLinkSimulation?.turns?.[0] && !topicLinkResident) {
      const markResident = () => {
        setTopicLinkResident(true)
        window.sessionStorage.setItem(getTopicLinkResidentStorageKey(id), '1')
        toast.success('已经留在这桌了，会先看新的回应')
      }
      try {
        await topicsApi.setTopicLinkPresence(id, { persona_name: topicLinkViewerProfile?.agentName })
        markResident()
      } catch {
        markResident()
      }
      return
    }
    setTopicLinkSimulationLoading(true)
    const profileText = buildTopicLinkSkillSearchText({
      viewerProfile: topicLinkViewerProfile ?? undefined,
    })
    try {
      const res = await topicsApi.simulateTopicLink(id, topicLinkViewerProfile
        ? {
            profile_text: profileText,
            persona_name: topicLinkViewerProfile.agentName,
          }
        : undefined)
      if (res.data.provider_status === 'ready' || !topicLinkViewerProfile) {
        setTopicLinkSimulation(res.data)
      } else {
        setTopicLinkSimulation(buildLocalTopicLinkSimulation(topic as any, topicLinkViewerProfile))
      }
    } catch {
      if (topicLinkViewerProfile) {
        setTopicLinkSimulation(buildLocalTopicLinkSimulation(topic as any, topicLinkViewerProfile))
      } else {
        setTopicLinkSimulation({
          provider_status: 'failed',
          model: 'MiniMax-M2.5',
          summary: '先给出一个参与建议。',
          turns: [
            {
              speaker: '我这边',
              role: getDetailTopicRole(topic).title,
              message: `我会先看看「${cleanTopicVisibleText(topic.title || '这桌')}」聊到哪一步，再决定补资料、提问题，还是直接回应。`,
            },
          ],
          suggested_action: '先了解一下，再说一句真正有用的话。',
          message: '现在先给出参与建议。',
        })
      }
    } finally {
      setTopicLinkSimulationLoading(false)
    }
  }

  const handleDeletePost = async (post: Post) => {
    if (!id) return
    const confirmed = window.confirm('确认删除这条帖子？')
    if (!confirmed) return
    try {
      await postsApi.delete(id, post.id)
      await loadPosts(id)
      await loadTopic(id)
      if (replyingTo?.id === post.id) {
        setReplyingTo(null)
      }
      handleApiSuccess('帖子已删除')
    } catch (err) {
      handleApiError(err, '删除帖子失败')
    }
  }

  const requireCurrentUser = () => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
  }

  const handleToggleTopicLike = async () => {
    if (!id || !topic || !requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.liked ?? false)
    setTopicLikePending(true)
    const previousInteraction = topic.interaction
    setTopic(prev => prev ? {
      ...prev,
      interaction: {
        likes_count: Math.max(0, (prev.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
        favorites_count: prev.interaction?.favorites_count ?? 0,
        shares_count: prev.interaction?.shares_count ?? 0,
        liked: nextEnabled,
        favorited: prev.interaction?.favorited ?? false,
      },
    } : prev)
    try {
      const res = await topicsApi.like(id, nextEnabled)
      setTopic(prev => (prev ? { ...prev, interaction: res.data } : prev))
    } catch (err) {
      setTopic(prev => (prev ? { ...prev, interaction: previousInteraction } : prev))
      handleApiError(err, nextEnabled ? '点赞失败' : '取消点赞失败')
    } finally {
      setTopicLikePending(false)
    }
  }

  const handleToggleTopicFavorite = async () => {
    if (!id || !topic || !requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.favorited ?? false)
    setTopicFavoritePending(true)
    const previousInteraction = topic.interaction
    setTopic(prev => prev ? {
      ...prev,
      interaction: {
        likes_count: prev.interaction?.likes_count ?? 0,
        favorites_count: Math.max(0, (prev.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1)),
        shares_count: prev.interaction?.shares_count ?? 0,
        liked: prev.interaction?.liked ?? false,
        favorited: nextEnabled,
      },
    } : prev)
    try {
      const res = await topicsApi.favorite(id, nextEnabled)
      setTopic(prev => (prev ? { ...prev, interaction: res.data } : prev))
    } catch (err) {
      setTopic(prev => (prev ? { ...prev, interaction: previousInteraction } : prev))
      handleApiError(err, nextEnabled ? '收藏失败' : '取消收藏失败')
    } finally {
      setTopicFavoritePending(false)
    }
  }

  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      handleApiSuccess(successMessage)
      toast.success(successMessage)
    } catch {
      toast.error('复制链接失败')
    }
  }

  const handleShareTopic = async () => {
    if (!id || !topic) return
    const url = new URL(`${import.meta.env.BASE_URL}topics/${id}`, window.location.origin).toString()
    try {
      const res = await topicsApi.share(id)
      setTopic(prev => (prev ? { ...prev, interaction: res.data } : prev))
    } catch (err) {
      handleApiError(err, '记录分享失败')
    }
    const text = topic.title ? `${topic.title}\n${url}` : url
    await copyToClipboard(text, '话题链接已复制')
  }

  const handleLikePost = async (post: Post) => {
    if (!id || !requireCurrentUser()) return
    const nextEnabled = !(post.interaction?.liked ?? false)
    setPostLikePendingIds(prev => new Set(prev).add(post.id))
    const previousInteraction = post.interaction
    setPosts(prev => prev.map(item => item.id === post.id ? {
      ...item,
      interaction: {
        likes_count: Math.max(0, (item.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
        shares_count: item.interaction?.shares_count ?? 0,
        liked: nextEnabled,
      },
    } : item))
    try {
      const res = await postsApi.like(id, post.id, nextEnabled)
      setPosts(prev => prev.map(item => item.id === post.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      setPosts(prev => prev.map(item => item.id === post.id ? { ...item, interaction: previousInteraction } : item))
      handleApiError(err, nextEnabled ? '帖子点赞失败' : '取消帖子点赞失败')
    } finally {
      setPostLikePendingIds(prev => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
    }
  }

  const handleSharePost = async (post: Post) => {
    if (!id || !topic) return
    const url = new URL(`${import.meta.env.BASE_URL}topiclink/${id}#post-${post.id}`, window.location.origin).toString()
    try {
      const res = await postsApi.share(id, post.id)
      setPosts(prev => prev.map(item => item.id === post.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      handleApiError(err, '记录帖子分享失败')
    }
    const title = (post.body?.split('\n')[0]?.trim() || topic.title || '帖子').slice(0, 80)
    const text = title ? `${title}\n${url}` : url
    await copyToClipboard(text, '帖子链接已复制')
  }

  const throttledToggleTopicLike = useThrottledCallback(handleToggleTopicLike)
  const throttledToggleTopicFavorite = useThrottledCallback(handleToggleTopicFavorite)
  const throttledShareTopic = useThrottledCallback(handleShareTopic)
  const throttledLikePost = useThrottledCallbackByKey(handleLikePost, (p) => p.id)
  const throttledSharePost = useThrottledCallbackByKey(handleSharePost, (p) => p.id)

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !postText.trim() || !currentUser) return
    if (topic?.category === 'arcade' && topic.metadata?.scene === 'arcade') {
      setSubmitError('Arcade 题目在 Web 端只读，只有授权账号和评测员可以在分支内写入。')
      return
    }

    const submittedText = postText
    const replyTarget = replyingTo
    const mentionMatch = submittedText.match(/@(\w+)/)
    const mentionedName = mentionMatch?.[1]
    const mentionedExpert = topicExperts.find(e => e.name === mentionedName)
    const inReplyToId = replyTarget?.id ?? null
    const authorName = getUserDisplayName(currentUser)
    const now = new Date().toISOString()
    const tempUserPostId = `temp-${crypto.randomUUID()}`
    let tempReplyId: string | null = null
    const tempUserPost: Post = {
      id: tempUserPostId,
      topic_id: id,
      author: authorName,
      author_type: 'human',
      delete_token: null,
      owner_user_id: currentUser.id,
      owner_auth_type: null,
      expert_name: null,
      expert_label: null,
      body: submittedText,
      mentions: [],
      in_reply_to_id: inReplyToId,
      root_post_id: inReplyToId ?? tempUserPostId,
      depth: replyTarget ? (replyTarget.depth ?? 0) + 1 : 0,
      reply_count: 0,
      status: 'completed',
      created_at: now,
      interaction: { likes_count: 0, shares_count: 0, liked: false },
    }

    setSubmitting(true)
      setPostText('')
      setSubmitError('')
      setReplyingTo(null)
      try {
        if (mentionedExpert) {
        tempReplyId = `temp-${crypto.randomUUID()}`
        const tempReplyPost: Post = {
          id: tempReplyId,
          topic_id: id,
          author: mentionedExpert.name,
          author_type: 'agent',
          delete_token: null,
          owner_user_id: null,
          owner_auth_type: null,
          expert_name: mentionedExpert.name,
          expert_label: mentionedExpert.label,
          body: '',
          mentions: [],
          in_reply_to_id: tempUserPostId,
          root_post_id: tempUserPostId,
          depth: (tempUserPost.depth ?? 0) + 1,
          reply_count: 0,
          status: 'pending',
          created_at: now,
          interaction: { likes_count: 0, shares_count: 0, liked: false },
        }
        setPosts(prev => mergePosts(prev, [tempUserPost, tempReplyPost]))
        setTopic(prev => prev ? { ...prev, posts_count: (prev.posts_count ?? 0) + 2 } : prev)
        const res = await postsApi.mention(id, {
          author: authorName,
          body: submittedText,
          expert_name: mentionedExpert.name,
          in_reply_to_id: inReplyToId,
        })
        pendingRepliesRef.current.add(res.data.reply_post_id)
        setPosts(prev => {
          const withoutTemps = prev.filter(item => item.id !== tempUserPostId && item.id !== tempReplyId)
          return mergePosts(withoutTemps, [res.data.user_post, ...(res.data.reply_post ? [res.data.reply_post] : [])])
        })
        setReplyNextCursorByPostId(prev => ({
          ...prev,
          ...(inReplyToId ? { [inReplyToId]: null } : {}),
          [res.data.user_post.id]: res.data.reply_post ? '__more__' : null,
        }))
        handleApiSuccess(`已向 ${mentionedExpert.label} 提问，等待回复中…`)
      } else {
        setPosts(prev => mergePosts(prev, [tempUserPost]))
        setTopic(prev => prev ? { ...prev, posts_count: (prev.posts_count ?? 0) + 1 } : prev)
        const res = await postsApi.create(id, {
          author: authorName,
          body: submittedText,
          in_reply_to_id: inReplyToId,
        })
        setPosts(prev => {
          const withoutTemp = prev.filter(item => item.id !== tempUserPostId)
          return mergePosts(withoutTemp, [res.data.post, ...(res.data.parent_post ? [res.data.parent_post] : [])])
        })
        setReplyNextCursorByPostId(prev => ({
          ...prev,
          ...(inReplyToId ? { [inReplyToId]: null } : {}),
          [res.data.post.id]: null,
        }))
        handleApiSuccess('发送成功')
      }
      setSubmitError('')
    } catch (err) {
      setPosts(prev => prev.filter(item => item.id !== tempUserPostId && item.id !== tempReplyId))
      setTopic(prev => prev ? { ...prev, posts_count: Math.max(0, (prev.posts_count ?? 0) - (mentionedExpert ? 2 : 1)) } : prev)
      const message = handleApiError(err, '发送失败')
      setPostText(submittedText)
      setReplyingTo(replyTarget)
      setSubmitError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartDiscussion = async (
    model: string,
    skillList?: string[],
    mcpServerIds?: string[],
    expertNamesOverride?: string[]
  ) => {
    if (!id) return
    setStartingDiscussion(true)
    const req: StartDiscussionRequest = {
      num_rounds: 5,
      max_turns: 50000,
      max_budget_usd: 500.0,
      model,
      skill_list: skillList && skillList.length > 0 ? skillList : undefined,
      mcp_server_ids: mcpServerIds && mcpServerIds.length > 0 ? mcpServerIds : undefined,
      expert_names: expertNamesOverride && expertNamesOverride.length > 0 ? expertNamesOverride : undefined,
    }
    try {
      await discussionApi.start(id, req)
      setTopic(prev => prev ? { ...prev, discussion_status: 'running' } : prev)
      setPolling(true)
      startPolling()
      handleApiSuccess('讨论已启动')
    } catch (err) {
      handleApiError(err, '启动讨论失败')
    } finally {
      setStartingDiscussion(false)
    }
  }

  const startPolling = () => {
    if (!id || pollIntervalRef.current) return
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await discussionApi.getStatus(id)
        setTopic(prev => {
          if (!prev) return prev
          const nextResult = res.data.result
          // 讨论进行中时，若 API 返回空 result，保留已有 discussion_result，避免内容突然消失
          const keepPrev =
            res.data.status === 'running' &&
            (nextResult == null ||
              (typeof nextResult === 'object' && !(nextResult.discussion_history || nextResult.discussion_summary || (nextResult.turns_count ?? 0) > 0)))
          return {
            ...prev,
            discussion_status: res.data.status,
            discussion_result: keepPrev ? prev.discussion_result : nextResult,
          }
        })
        // 讨论进行中时，若 API 返回全零的 progress，保留已有 progress，避免轮次在 0 与真实值间跳动
        setProgress(prev => {
          const next = res.data.progress
          if (!next) return prev
          if (res.data.status !== 'running') return next
          const nextEmpty = (next.completed_turns ?? 0) === 0 && (next.current_round ?? 0) === 0
          if (nextEmpty && prev && ((prev.completed_turns ?? 0) > 0 || (prev.current_round ?? 0) > 0)) {
            return prev
          }
          return next
        })
        if (res.data.status === 'completed' || res.data.status === 'failed') {
          clearInterval(pollIntervalRef.current!)
          pollIntervalRef.current = null
          setPolling(false)
          setProgress(null)
          await loadTopic(id)
        }
      } catch (err) {
        console.error('Poll failed', err)
      }
    }, POLL_INTERVAL_MS)
  }

  const parseDiscussionHistory = (history: string): DiscussionPost[] => {
    const items: DiscussionPost[] = []
    // Support both formats: "## 第N轮 - " (legacy) and "## Round N - " (Resonnet)
    const sections = history.split(/(?=^## (?:第\d+轮|Round \d+) - )/m)
    for (const section of sections) {
      const trimmed = section.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^## (?:第(\d+)轮|Round (\d+)) - (.+)$/m)
      if (match) {
        const round = parseInt(match[1] || match[2])
        const expertLabel = match[3].trim()
        // Content starts after the heading line
        const headingEnd = trimmed.indexOf('\n')
        const content = headingEnd !== -1
          ? trimmed.slice(headingEnd).trim().replace(/\n\n---\s*$/, '').trim()
          : ''
        if (content) {
          const expertKey = getExpertKey(expertLabel)
          items.push({ round, expertName: expertLabel, expertKey, content, id: `round-${round}-${expertKey}` })
        }
      }
    }
    return items
  }

  const getExpertKey = (label: string): string => {
    // Chinese labels
    if (label.includes('物理')) return 'physicist'
    if (label.includes('生物')) return 'biologist'
    if (label.includes('计算机')) return 'computer_scientist'
    if (label.includes('伦理')) return 'ethicist'
    // English labels (Resonnet topic-lab)
    if (/physics|physicist/i.test(label)) return 'physicist'
    if (/biology|biologist/i.test(label)) return 'biologist'
    if (/computer|science/i.test(label)) return 'computer_scientist'
    if (/ethic|sociolog/i.test(label)) return 'ethicist'
    return 'default'
  }

  const getNavigationItems = (discussionPosts: DiscussionPost[]): NavigationItem[] => {
    const items: NavigationItem[] = []
    if (topic?.discussion_result?.discussion_summary) {
      items.push({ type: 'summary', label: '讨论总结', id: 'summary-section' })
    }
    const rounds = [...new Set(discussionPosts.map(p => p.round))].sort((a, b) => a - b)
    for (const round of rounds) {
      items.push({ type: 'round', round, label: `第 ${round} 轮`, id: `round-section-${round}` })
    }
    const postCount = topic?.posts_count ?? posts.length
    if (postCount > 0) {
      items.push({ type: 'posts', label: `大家怎么说 (${postCount})`, id: 'posts-section' })
    }
    return items
  }

  const scrollToSection = (sectionId: string) => {
    const element = sectionRefs.current[sectionId]
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setActiveNavId(sectionId)
    }
  }

  const renderMarkdown = (content: string, topicId?: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={topicId ? {
        img: ({ src = '', alt = '', ...props }) => {
          const resolvedSrc = resolveTopicImageSrc(topicId, src, { format: 'webp', quality: 82 })
          if (isVideoMediaSrc(resolvedSrc)) {
            return (
              <video
                controls
                preload="metadata"
                className="max-h-[32rem] w-full rounded-xl bg-black/90"
                src={resolvedSrc}
                aria-label={alt || 'video'}
              />
            )
          }
          return (
            <img
              {...props}
              src={resolvedSrc}
              alt={alt}
              loading="lazy"
            />
          )
        },
      } : undefined}
    >
      {content}
    </ReactMarkdown>
  )

  if (loading) return (
    <div className="bg-white min-h-screen flex items-center justify-center">
      <p className="text-gray-500">加载中...</p>
    </div>
  )
  if (!topic) return (
    <div className="bg-white min-h-screen flex items-center justify-center">
      <p className="text-gray-500">话题不存在</p>
    </div>
  )

  const discussionHistory = topic.discussion_result?.discussion_history || ''
  const discussionPosts = parseDiscussionHistory(discussionHistory)
  const navItems = getNavigationItems(discussionPosts)
  const hasDiscussion = !!(topic.discussion_result || topic.discussion_status === 'running')
  const currentUserName = currentUser ? getUserDisplayName(currentUser) : ''
  const composerReplyName = replyingTo
    ? cleanTopicLinkPersonName(replyingTo.author_type === 'agent' ? (replyingTo.expert_label ?? replyingTo.author) : replyingTo.author) || '这位朋友'
    : ''
  const composerReplyPreview = replyingTo?.body
    ? replyingTo.body.replace(/\s+/g, ' ').slice(0, 72)
    : ''
  const postsByRound: Record<number, DiscussionPost[]> = {}
  for (const post of discussionPosts) {
    if (!postsByRound[post.round]) postsByRound[post.round] = []
    postsByRound[post.round].push(post)
  }

  const isDiscussionMode = topic.mode === 'discussion' || topic.mode === 'both'
  const isArcadeTopicMode = isArcadeTopic(topic)
  const canMentionExperts = !isArcadeTopicMode && topic.discussion_status !== 'pending' && topic.discussion_status !== 'running' && topicExperts.length > 0
  const shouldUseReplyDock = viewportWidth < 1024
  const shouldShowReplyDock = topic.status === 'open' && replyingTo !== null && shouldUseReplyDock
  const closeReplyDock = () => setReplyingTo(null)
  const categoryMeta = getTopicCategoryMeta(topic.category)
  const is2050Topic = topic.category === '2050' || topic.id === 'topic_2050_agenda_discussion'
  const creatorMeta = topic.creator_name
    ? `发起人 ${topic.creator_name}${topic.creator_auth_type === 'openclaw_key' ? ' · OpenClaw' : ''}`
    : null
  const canDeletePost = (post: Post) => {
    if (currentUser?.is_admin) {
      return true
    }
    if (!currentUser || post.author_type !== 'human') {
      return false
    }
    if (post.owner_user_id != null) {
      return post.owner_user_id === currentUser.id
    }
    return post.author === currentUserName
  }
  const topicLikes = topic.interaction?.likes_count ?? 0
  const topicShares = topic.interaction?.shares_count ?? 0
  const topicFavorites = topic.interaction?.favorites_count ?? 0
  const visiblePostCount = isTopicLinkRoute && !postsLoading ? posts.length : (topic.posts_count ?? posts.length)
  const topicLiked = topic.interaction?.liked ?? false
  const topicFavorited = topic.interaction?.favorited ?? false
  const topicLinkContext = getTopicLink(topic)
  const composerShellClass = isTopicLinkRoute
    ? 'w-full rounded-[1.35rem] border border-[#cbded4] bg-[#fffdf8] px-4 py-4 shadow-[0_16px_38px_rgba(42,59,49,0.10)]'
    : 'ml-auto w-full max-w-[42rem] rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm'
  const composerInputShellClass = isTopicLinkRoute
    ? 'rounded-[1.1rem] border border-[#cfe4dc] bg-[#f6fbf7] px-3 py-3 ring-1 ring-white/70'
    : 'rounded-xl border border-gray-200 bg-gray-50 px-3 py-3'
  const composerSubmitClass = isTopicLinkRoute
    ? 'mb-1 shrink-0 rounded-xl bg-[#17324a] px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-[#23455f] disabled:opacity-50'
    : 'mb-1 shrink-0 rounded-xl bg-black px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-gray-900 disabled:opacity-50'
  const composerHelperClass = isTopicLinkRoute ? 'mt-2 text-xs text-[#77847d]' : 'mt-2 text-xs text-gray-400'
  const loginComposerClass = isTopicLinkRoute
    ? 'w-full rounded-[1.35rem] border border-[#cbded4] bg-[#fffdf8] px-4 py-4 shadow-[0_16px_38px_rgba(42,59,49,0.10)]'
    : 'ml-auto w-full max-w-[42rem] rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm'
  return (
    <div className={`bg-white min-h-screen ${isTopicLinkRoute ? '' : 'overflow-x-hidden'}`}>
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-4 sm:py-5 flex flex-col lg:flex-row gap-5 lg:gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 min-w-0 w-full">

          {/* Topic title & actions */}
          <div className="mb-4 sm:mb-5">
            {is2050Topic ? (
              <img
                src={logo2050}
                alt="2050"
                data-testid="topic-detail-2050-logo"
                className="mb-4 h-14 w-auto object-contain sm:h-16"
                draggable={false}
              />
            ) : null}
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">{topic.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-serif text-gray-400">
              {categoryMeta ? <span>板块 {categoryMeta.name}</span> : null}
              <span>创建于 {formatTopicDate(topic.created_at)}</span>
              {creatorMeta ? <span>{creatorMeta}</span> : null}
              {topic.discussion_status !== 'pending' ? <span>圆桌进行中</span> : null}
              {topic.status === 'closed' ? <span>已关闭</span> : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <ReactionButton
                label="点赞"
                count={topicLikes}
                active={topicLiked}
                pending={topicLikePending}
                icon={<HeartIcon />}
                onClick={throttledToggleTopicLike}
              />
              <ReactionButton
                label="收藏"
                count={topicFavorites}
                active={topicFavorited}
                pending={topicFavoritePending}
                icon={<BookmarkIcon />}
                onClick={throttledToggleTopicFavorite}
              />
              <ReactionButton
                label="分享"
                count={topicShares}
                icon={<ShareIcon />}
                onClick={throttledShareTopic}
              />
            </div>
          </div>

          <TopicLinkRoundtableGuide
            topic={topic}
            onInvite={handleOpenTopicLinkInvite}
            onPreview={handlePreviewTopicLink}
            simulation={topicLinkSimulation}
            simulationLoading={topicLinkSimulationLoading}
            resident={topicLinkResident}
          />
          {isTopicLinkRoute && !currentUser && postText.trim() ? (
            <section
              ref={topicLinkDraftRef}
              className="mb-4 rounded-[1.2rem] border border-[#cfe4dc] bg-[#fffdf8] p-4 shadow-[0_10px_24px_rgba(42,59,49,0.06)]"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#2f8586]">先记在这</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#53675e]">{postText}</p>
                </div>
                <Link
                  to="/login"
                  state={{ from: location.pathname }}
                  className="shrink-0 rounded-xl bg-[#17324a] px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-[#23455f]"
                >
                  登录后再发
                </Link>
              </div>
            </section>
          ) : null}
          {/* TopicLink keeps the roundtable view focused; original topic settings stay on the original topic route. */}
          {isDiscussionMode && !isTopicLinkRoute ? (
            <details className="mb-4 sm:mb-5 rounded-[1.2rem] border border-[#d9e6df] bg-white/82 px-4 py-3 text-sm text-[#4d5c56] shadow-[0_8px_20px_rgba(42,59,49,0.05)]">
              <summary className="cursor-pointer select-none font-medium text-[#25302d]">
                更多设置
                <span className="ml-2 text-xs font-normal text-[#8a9690]">需要调整参与方式时再打开</span>
              </summary>
              <div className="mt-3 border-l-2 border-[#cfe4dc] pl-4 sm:pl-5">
                <TopicConfigTabs
                  topicId={id!}
                  topicBody={topic.body}
                  onTopicBodyUpdated={(body) => {
                    setTopic((prev) => (prev ? { ...prev, body } : prev))
                  }}
                  onExpertsChange={() => {
                    void loadTopicExperts(id!)
                    void loadTopic(id!)
                  }}
                  onModeChange={() => loadTopic(id!)}
                  onStartDiscussion={handleStartDiscussion}
                  isStarting={startingDiscussion}
                  isRunning={polling}
                  isCompleted={topic.discussion_status === 'completed'}
                  initialSkillIds={initialSkillIds}
                  linkedSourceArticle={linkedSourceArticle}
                  viewportWidth={viewportWidth}
                  topicExpertNames={topic.expert_names ?? []}
                />
              </div>
            </details>
          ) : null}

          <div className="border-t border-gray-100 my-5 sm:my-6" />

          {isArcadeTopicMode ? (
            <ArcadeTopicIntroCard
              topicId={topic.id}
              metadata={topic.metadata}
              renderMarkdown={renderMarkdown}
            />
          ) : null}

          {/* Mobile TOC - horizontal scroll, sticky */}
          {hasDiscussion && navItems.length > 0 && !isTopicLinkRoute && (
            <div className="lg:hidden sticky top-14 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-2 mb-4 bg-white/95 backdrop-blur border-b border-gray-100 overflow-x-auto scrollbar-hide overscroll-x-contain">
              <div className="flex gap-2 min-w-max">
                {navItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors touch-manipulation min-h-[36px] ${
                      activeNavId === item.id
                        ? 'bg-black text-white font-medium'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Discussion summary */}
          {topic.discussion_result?.discussion_summary && (
            <div
              id="summary-section"
              ref={el => { sectionRefs.current['summary-section'] = el }}
              className="mb-6 scroll-mt-6"
            >
              <div className="border-l-2 border-black pl-4 py-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm font-serif font-semibold text-black">讨论总结</span>
                  {topic.discussion_result.cost_usd != null && (
                    <span className="text-xs font-serif text-gray-400">
                      花费：¥{topic.discussion_result.cost_usd.toFixed(4)}
                    </span>
                  )}
                </div>
                <div className="markdown-content markdown-content-compact text-sm text-gray-700 font-serif">
                  {renderMarkdown(topic.discussion_result.discussion_summary, topic.id)}
                </div>
              </div>
            </div>
          )}

          {/* In-page progress indicator */}
          {topic.discussion_status === 'running' && (
            <div className="mb-5 sm:mb-6 border border-gray-200 rounded-lg p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4">
                <span className="spinner" />
                <span className="text-sm font-semibold text-gray-900">圆桌正在进行</span>
                {elapsedSeconds > 0 && (
                  <span className="text-xs text-gray-400 sm:ml-auto w-full sm:w-auto">
                    已运行 {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              {progress && progress.total_turns > 0 ? (
                <>
                  <div className="w-full h-1 bg-gray-100 mb-3">
                    <div
                      className="h-1 bg-black transition-all duration-500"
                      style={{ width: `${Math.min(100, (progress.completed_turns / progress.total_turns) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>
                      {progress.completed_turns > 0
                        ? `${progress.latest_speaker} 已完成发言`
                        : '等待角色开始发言...'}
                    </span>
                    <span>{progress.completed_turns} / {progress.total_turns} 轮次</span>
                  </div>
                  {progress.current_round > 0 && (
                    <div className="mt-2 text-xs text-gray-400">当前第 {progress.current_round} 轮</div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400">主持人正在协调角色，请稍候...</p>
              )}
            </div>
          )}

          {/* Roundtable discussion rounds - multi-column: 2+ on desktop, 1 on mobile */}
          {Object.keys(postsByRound).length > 0 && (
            <div className="mb-6 overflow-x-hidden">
              <h2 className="text-base font-semibold text-gray-900 mb-1">圆桌讨论</h2>
              <div className="grid grid-cols-1 gap-5 mt-3">
              {Object.keys(postsByRound).map(roundKey => {
                const round = parseInt(roundKey)
                const roundPosts = postsByRound[round]
                return (
                  <div
                    key={round}
                    id={`round-section-${round}`}
                    ref={el => { sectionRefs.current[`round-section-${round}`] = el }}
                    className="min-w-0 w-full scroll-mt-6"
                  >
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider py-3 border-b border-gray-100">
                      第 {round} 轮
                    </div>
                    {roundPosts.map(post => (
                      <div key={post.id} className="flex gap-3 sm:gap-4 py-4 sm:py-5 border-b border-gray-100">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black text-white flex items-center justify-center text-xs font-serif flex-shrink-0">
                          {post.expertName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0 overflow-x-hidden">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-gray-900">{post.expertName}</span>
                            <span className="text-[10px] border border-gray-200 rounded text-gray-400 px-1">角色</span>
                          </div>
                          <div className="markdown-content markdown-content-compact text-sm text-gray-700 overflow-x-auto">
                            {renderMarkdown(post.content, topic.id)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
              </div>
            </div>
          )}

          {/* Posts thread */}
          <div
            id="posts-section"
            ref={el => { sectionRefs.current['posts-section'] = el }}
            className="scroll-mt-6"
          >
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-semibold text-[#17231f]">大家怎么说</h2>
                <p className="mt-1 text-sm text-[#738079]">
                  先看几条，再决定要不要说。
                  {canMentionExperts ? ' 输入 @ 可以请同行加入。' : ''}
                  {isArcadeTopicMode ? ' 公开读取全部分支，Web 端只读。' : ''}
                </p>
              </div>
              <span className="rounded-full border border-[#cfe4dc] bg-[#fffdf8] px-3 py-1 text-xs text-[#65756e]">
                {visiblePostCount} 条回应
              </span>
            </div>

            {postsLoading ? (
              <div className="space-y-3 py-2">
                <div className="h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
                <div className="h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
              </div>
            ) : null}

            {!postsLoading ? (
              isArcadeTopicMode ? (
                <ArcadeBranchTimeline
                  posts={posts}
                  onDelete={handleDeletePost}
                  onLike={throttledLikePost}
                  onShare={throttledSharePost}
                  canDelete={canDeletePost}
                  canLike
                  pendingLikePostIds={postLikePendingIds}
                />
              ) : posts.length === 0 ? (
                <div className="rounded-[1.2rem] border border-[#dbe8e1] bg-[#fbfdfb] px-4 py-5 text-sm text-[#65756e]">
                  <p className="font-medium text-[#25302d]">还没有人开口</p>
                  <p className="mt-1 text-xs leading-5 text-[#78857f]">可以先写一句问题、补一条资料，或请一位合适的人来看。</p>
                </div>
              ) : (
                <div className={isTopicLinkRoute ? 'topiclink-thread-surface animate-fade-in rounded-[1.35rem] border border-[#d7e6df] bg-[#f4faf6] py-2 shadow-[0_18px_42px_rgba(42,59,49,0.08)]' : undefined}>
                  <PostThread
                    posts={posts}
                    onReply={handleReplyToPost}
                    onDelete={handleDeletePost}
                    onLike={throttledLikePost}
                    onShare={throttledSharePost}
                    onLoadReplies={handleLoadReplies}
                    canReply={topic.status === 'open' && !isArcadeTopicMode}
                    canDelete={canDeletePost}
                    canLike
                    pendingLikePostIds={postLikePendingIds}
                    replyLoadingPostIds={replyLoadingPostIds}
                    replyNextCursorByPostId={replyNextCursorByPostId}
                    compactLongPosts={isTopicLinkRoute}
                  />
                </div>
              )
            ) : null}

            {postNextCursor ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={loadMorePosts}
                  disabled={loadingMorePosts}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:border-gray-300 hover:text-black disabled:opacity-50"
                >
                  {loadingMorePosts ? '加载中...' : '加载更多回应'}
                </button>
              </div>
            ) : null}

            {topic.status === 'open' ? (
              <div className="mt-6 pt-4 border-t border-gray-100">
                {isArcadeTopicMode ? (
                  <ArcadeReadonlyNotice />
                ) : replyingTo ? (
                  shouldUseReplyDock ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      <div className="min-w-0">
                        <span className="font-medium text-gray-900">正在回复 {composerReplyName}</span>
                        <span className="ml-1 text-gray-500">输入框已从底部弹出</span>
                      </div>
                    </div>
                  ) : currentUser ? (
                    <form
                      onSubmit={handleSubmitPost}
                      className={composerShellClass}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                          <span className="rounded-full bg-black px-2.5 py-1 text-white">正在回复：{composerReplyName}</span>
                          {topic.discussion_status === 'running' && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">圆桌正在进行，@同行会在这一轮结束后收到</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={closeReplyDock}
                          className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                          aria-label="关闭回复窗口"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                        <div className="min-w-0">
                          <span className="font-medium text-gray-900">回复 {composerReplyName}</span>
                          {composerReplyPreview ? (
                            <span className="ml-1 text-gray-500">
                              · {composerReplyPreview}{replyingTo.body.length > composerReplyPreview.length ? '...' : ''}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className={composerInputShellClass}>
                        <div className="flex items-end gap-3">
                          <div className="min-w-0 flex-1">
                            <MentionTextarea
                              value={postText}
                              onChange={(value) => {
                                setPostText(value)
                                if (submitError) setSubmitError('')
                              }}
                              experts={canMentionExperts ? topicExperts : []}
                              disabled={submitting}
                              textareaRef={composerTextareaRef}
                              placeholder={
                                topic.discussion_status === 'running'
                                  ? '先写下你的想法，@同行会在这一轮结束后收到'
                                  : canMentionExperts
                                    ? '在这里继续讨论… 回复同行时会自动带上 @'
                                    : '在这里继续讨论… 也可以请同行加入'
                              }
                              textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                            />
                          </div>
                          <button
                            type="submit"
                            className={composerSubmitClass}
                            disabled={submitting || !postText.trim()}
                          >
                            {submitting ? '发送中...' : '发送'}
                          </button>
                        </div>
                        <p className={composerHelperClass}>
                          {topic.discussion_status === 'running'
                            ? '你的回应会先进入这桌，@同行会在这一轮结束后收到。'
                            : (canMentionExperts ? '输入 @ 可以请同行加入，回复时会自动带上 @。' : '写下想法即可发布；也可以邀请同行。')}
                        </p>
                        {submitError ? (
                          <p className="mt-2 text-xs text-red-600">{submitError}</p>
                        ) : null}
                      </div>
                    </form>
                  ) : (
                    <div className={loginComposerClass}>
                      {isTopicLinkRoute && postText.trim() ? (
                        <div className="mb-3 rounded-xl border border-[#cfe4dc] bg-[#f7fbf7] px-3 py-2 text-sm text-[#53675e]">
                          <p className="text-xs font-medium text-[#2f8586]">先记在这</p>
                          <p className="mt-1 whitespace-pre-wrap leading-6">{postText}</p>
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-black">{isTopicLinkRoute ? '想说的话先放这' : '登录后即可发帖和回帖'}</p>
                          <p className="mt-1 text-xs text-gray-500">{isTopicLinkRoute ? '等你登录后，再用自己的账号发出去。' : '回复同行时会自动带上 @，并以你的账号名发布。'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            to="/register"
                            state={{ from: location.pathname }}
                            className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black"
                          >
                            注册
                          </Link>
                          <Link
                            to="/login"
                            state={{ from: location.pathname }}
                            className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-900"
                          >
                            登录后回帖
                          </Link>
                        </div>
                      </div>
                    </div>
                  )
                ) : currentUser ? (
                  <form
                    onSubmit={handleSubmitPost}
                    className={composerShellClass}
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-500">发布回应</span>
                      {topic.discussion_status === 'running' && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">圆桌正在进行，@同行会在这一轮结束后收到</span>
                      )}
                    </div>
                    <div className={composerInputShellClass}>
                      <div className="flex items-end gap-3">
                        <div className="min-w-0 flex-1">
                          <MentionTextarea
                            value={postText}
                            onChange={(value) => {
                              setPostText(value)
                              if (submitError) setSubmitError('')
                            }}
                            experts={canMentionExperts ? topicExperts : []}
                            disabled={submitting}
                            textareaRef={composerTextareaRef}
                            placeholder={
                              topic.discussion_status === 'running'
                                ? '先写下你的想法，@同行会在这一轮结束后收到'
                                : canMentionExperts
                                  ? '在这里继续讨论… 输入 @ 可以请同行加入'
                                  : '在这里继续讨论… 也可以请同行加入'
                            }
                            textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                          />
                        </div>
                        <button
                          type="submit"
                          className={composerSubmitClass}
                          disabled={submitting || !postText.trim()}
                        >
                          {submitting ? '发送中...' : '发送'}
                        </button>
                      </div>
                      <p className={composerHelperClass}>
                        {topic.discussion_status === 'running'
                          ? '你的回应会先进入这桌，@同行会在这一轮结束后收到。'
                          : (canMentionExperts ? '输入 @ 可以请同行加入。' : '写下想法即可发布；也可以邀请同行。')}
                      </p>
                      {submitError ? (
                        <p className="mt-2 text-xs text-red-600">{submitError}</p>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <div ref={loginComposerRef} className={loginComposerClass}>
                    {isTopicLinkRoute && postText.trim() ? (
                      <div className="mb-3 rounded-xl border border-[#cfe4dc] bg-[#f7fbf7] px-3 py-2 text-sm text-[#53675e]">
                        <p className="text-xs font-medium text-[#2f8586]">先记在这</p>
                        <p className="mt-1 whitespace-pre-wrap leading-6">{postText}</p>
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-black">{isTopicLinkRoute ? '想说的话先放这' : '登录后即可发帖和回帖'}</p>
                        <p className="mt-1 text-xs text-gray-500">{isTopicLinkRoute ? '等你登录后，再用自己的账号发出去。' : '回复同行时会自动带上 @，并以你的账号名发布。'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to="/register"
                          state={{ from: location.pathname }}
                          className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black"
                        >
                          注册
                        </Link>
                        <Link
                          to="/login"
                          state={{ from: location.pathname }}
                          className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-900"
                        >
                          登录后回帖
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 pt-4 border-t border-gray-100 py-4 text-center">
                <p className="text-sm font-serif text-gray-400">此话题已关闭，无法跟帖</p>
              </div>
            )}
          </div>
        </div>

        {topicLinkContext ? (
          <aside className="hidden w-[20rem] shrink-0 space-y-4 lg:sticky lg:top-20 lg:block lg:self-start">
            <TopicLinkInsightAside topic={topic} />
            <TopicLinkInvitePanel
              topic={topic}
              topicExperts={topicExperts}
              posts={posts}
              viewerProfile={topicLinkViewerProfile}
              onUsePrompt={handleUseTopicLinkPrompt}
            />
            <TopicLinkInspirationBridge
              topic={topic}
              onUsePrompt={handleUseTopicLinkPrompt}
            />
          </aside>
        ) : null}

        {/* Right navigation sidebar - desktop */}
        {hasDiscussion && navItems.length > 0 && !isTopicLinkRoute && (
          <ResizableToc defaultWidth={192} side="right" className="sticky top-20 self-start hidden lg:flex flex-shrink-0">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              目录
            </div>
            {navItems.map(item => (
              <div
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`text-sm px-2 py-1.5 rounded cursor-pointer transition-colors mb-0.5 ${
                  activeNavId === item.id
                    ? 'text-gray-900 font-medium'
                    : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                {item.label}
              </div>
            ))}
          </ResizableToc>
        )}
      </div>

      <div id="topic-detail-bottom-anchor" className="h-px w-full" aria-hidden />

      {shouldShowReplyDock && !isArcadeTopicMode && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-end px-4 sm:px-6 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          onClick={closeReplyDock}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/95 to-transparent" />
          <div className="relative w-full max-w-[34rem]">
            {currentUser ? (
              <form
                onSubmit={handleSubmitPost}
                onClick={(event) => event.stopPropagation()}
                className="pointer-events-auto ml-auto w-full max-w-[34rem] animate-fade-in rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-16px_40px_rgba(0,0,0,0.08)] backdrop-blur"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                    <span className="rounded-full bg-black px-2.5 py-1 text-white">正在回复：{composerReplyName}</span>
                    {topic.discussion_status === 'running' && (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">圆桌正在进行，@同行会在这一轮结束后收到</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeReplyDock}
                    className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    aria-label="关闭回复窗口"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">回复 {composerReplyName}</span>
                    {composerReplyPreview ? (
                      <span className="ml-1 text-gray-500">
                        · {composerReplyPreview}{replyingTo.body.length > composerReplyPreview.length ? '...' : ''}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                  <div className="flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <MentionTextarea
                        value={postText}
                        onChange={(value) => {
                          setPostText(value)
                          if (submitError) setSubmitError('')
                        }}
                        experts={canMentionExperts ? topicExperts : []}
                        disabled={submitting}
                        textareaRef={composerTextareaRef}
                        placeholder={
                          topic.discussion_status === 'running'
                            ? '先写下你的想法，@同行会在这一轮结束后收到'
                            : canMentionExperts
                              ? '在这里继续讨论… 回复同行时会自动带上 @'
                              : '在这里继续讨论… 也可以请同行加入'
                        }
                        textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="mb-1 shrink-0 rounded-xl bg-black px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
                      disabled={submitting || !postText.trim()}
                    >
                      {submitting ? '发送中...' : '发送'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    {topic.discussion_status === 'running'
                      ? '你的回应会先进入这桌，@同行会在这一轮结束后收到。'
                      : (canMentionExperts ? '输入 @ 可以请同行加入，回复时会自动带上 @。' : '写下想法即可发布；也可以邀请同行。')}
                  </p>
                  {submitError ? (
                    <p className="mt-2 text-xs text-red-600">{submitError}</p>
                  ) : null}
                </div>
              </form>
            ) : (
              <div
                onClick={(event) => event.stopPropagation()}
                className="pointer-events-auto ml-auto w-full max-w-[34rem] animate-fade-in rounded-[26px] border border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-16px_40px_rgba(0,0,0,0.08)] backdrop-blur"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-black">登录后即可发帖和回帖</p>
                    <p className="mt-1 text-xs text-gray-500">回复同行时会自动带上 @，并以你的账号名发布。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeReplyDock}
                      className="rounded-xl px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-black"
                    >
                      关闭
                    </button>
                    <Link
                      to="/register"
                      state={{ from: location.pathname }}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black"
                    >
                      注册
                    </Link>
                    <Link
                      to="/login"
                      state={{ from: location.pathname }}
                      className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-900"
                    >
                      登录后回帖
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

function getUserDisplayName(user: User): string {
  return user.username?.trim() || user.phone || `用户-${user.id}`
}

function extractSourceArticleId(topicBody: string): number | null {
  const match = topicBody.match(/^- article_id:\s*(\d+)\s*$/m)
  if (!match) return null
  const articleId = Number.parseInt(match[1], 10)
  return Number.isFinite(articleId) && articleId > 0 ? articleId : null
}

function extractBulletValue(topicBody: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^- ${escaped}：\\s*(.+)$`, 'm')
  const match = topicBody.match(regex)
  return match?.[1]?.trim() ?? ''
}

function buildSourcePreviewFromTopicBody(topicBody: string, articleId: number): SourceFeedArticle {
  return {
    id: articleId,
    title: extractBulletValue(topicBody, '标题') || `信源 ${articleId}`,
    source_feed_name: extractBulletValue(topicBody, '来源') || '未知来源',
    source_type: 'source-feed',
    url: extractBulletValue(topicBody, '原文链接'),
    pic_url: null,
    description: extractBulletValue(topicBody, '原文摘要'),
    publish_time: extractBulletValue(topicBody, '发布时间'),
    created_at: '',
  }
}

function ensureExpertMention(text: string, expertName: string): string {
  const mention = `@${expertName}`
  const trimmed = text.trimStart()
  if (!trimmed) return `${mention} `
  if (new RegExp(`^@${escapeRegExp(expertName)}(?:\\s|$)`).test(trimmed)) {
    return text
  }
  return `${mention} ${trimmed}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
