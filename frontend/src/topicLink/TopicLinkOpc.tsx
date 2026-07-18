import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  InspirationDemand,
  InspirationDemandAssistant,
  TopicLinkAgentTask,
  topicsApi,
} from '../api/client'
import { TopicViewerProfile } from '../data/topicViewerProfiles'
import opcParkMapUrl from '../assets/opc-park-map.webp'
import opcProfessionalCapybaraSheetUrl from '../assets/opc-professional-capybara-mascots.webp'

function normalizeTopicSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[「」『』“”"'`.,，。:：;；!?！？()[\]{}<>《》/\\|_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDiligenceErrorMessage(error: unknown) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail !== 'string') {
    return '派出失败，请确认已经登录并绑定可用分身。'
  }
  if (detail.includes('登录后') && /OpenClaw|绑定/.test(detail)) {
    return '登录后才能派出你的分身。'
  }
  if (detail.includes('登录后')) return '登录状态已失效，请重新登录后再调研。'
  if (detail.includes('请先绑定') && /OpenClaw|分身/.test(detail)) {
    return '请先绑定你的分身，再开始调研。'
  }
  if (/未处于\s*active|未激活/.test(detail) && /OpenClaw|分身/.test(detail)) {
    return '当前分身尚未启用，请先启用后再调研。'
  }
  if (/OpenClaw/i.test(detail)) return '调研任务未能派出，请稍后再试。'
  return detail
}

export const OPC_CANDIDATE_LIMIT = 24
const OPC_INSPIRATION_SUBMIT_PATH = `/inspiration-co-creation/submit?${new URLSearchParams({
  from: 'topiclink',
  intent: 'demand',
  topic_title: 'OPC Link 一人公司预挂牌',
  problem: '我想把一个任务在 OPC Link 中预挂牌，先找合适的一人公司承接，或让分身先做一版尽调反馈。',
  category: '工作效率',
  category_extra: '一人公司预挂牌',
  current_blockers: '想找共创伙伴',
  note: '来自 OPC Link 预挂牌',
}).toString()}`

export type TopicLinkMode = 'social' | 'opc'

export interface TopicLinkOpcCandidate {
  id: string
  source: 'inspiration' | string
  source_slug: string
  source_path: string
  clue_number?: number | null
  title: string
  summary: string
  stage: string
  tags: string[]
  blocker: string
  fit_score: number
  fit_reasons: string[]
  suggested_next_action: string
  assistant?: InspirationDemandAssistant
}

export function getTopicLinkMode(searchParams: URLSearchParams): TopicLinkMode {
  return searchParams.get('mode') === 'opc' ? 'opc' : 'social'
}

export function TopicLinkModeSwitch({
  mode,
  onChange,
  className = '',
}: {
  mode: TopicLinkMode
  onChange: (mode: TopicLinkMode) => void
  className?: string
}) {
  return (
    <div className={`inline-flex rounded-full border border-[#d4e4dc] bg-[#fbfdfc] p-1 shadow-[0_12px_28px_rgba(36,54,48,0.10)] ${className}`} role="group" aria-label="切换 TopicLink 模式">
      {([
        { id: 'social', label: '科研' },
        { id: 'opc', label: 'OPC' },
      ] as const).map((item) => {
        const active = mode === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`h-8 rounded-full px-4 text-sm font-medium transition ${
              active
                ? 'bg-[#17324a] text-white shadow-[0_8px_18px_rgba(23,50,74,0.20)]'
                : 'text-[#33443d] hover:bg-[#eef6f2] hover:text-[#17324a]'
            }`}
            aria-pressed={active}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function getOpcDemandStage(need: InspirationDemand) {
  const current = need.path_progress?.find((stage) => stage.status === 'current' || stage.status === 'needs_input')
  return current?.label || need.stage || '线索待拆'
}

function getOpcDemandFitScore(need: InspirationDemand) {
  let score = 44
  if (need.stuck?.trim()) score += 18
  if ((need.summary ?? '').trim().length >= 40) score += 12
  if ((need.tags ?? []).length > 0) score += 8
  if (need.path_progress?.some((stage) => stage.status === 'current' || stage.status === 'needs_input')) score += 10
  return Math.min(92, score)
}

function getOpcDemandFitReasons(need: InspirationDemand) {
  const reasons: string[] = []
  if (need.stuck?.trim()) reasons.push('有明确卡点，适合先做尽调')
  if ((need.tags ?? []).length > 0) reasons.push(`领域标签：${need.tags.slice(0, 2).join(' / ')}`)
  if (need.path_progress?.some((stage) => stage.status === 'current' || stage.status === 'needs_input')) {
    reasons.push('共创路径已有当前节点')
  }
  return reasons.length ? reasons : ['需要先补充交付边界']
}

export function opcCandidateFromDemand(need: InspirationDemand): TopicLinkOpcCandidate {
  return {
    id: `inspiration:${need.slug}`,
    source: 'inspiration',
    source_slug: need.slug,
    source_path: `/inspiration-co-creation/needs/${need.slug}`,
    clue_number: need.clue_number,
    title: need.title,
    summary: need.summary,
    stage: getOpcDemandStage(need),
    tags: (need.tags ?? []).filter(Boolean).slice(0, 4),
    blocker: need.stuck,
    fit_score: getOpcDemandFitScore(need),
    fit_reasons: getOpcDemandFitReasons(need),
    suggested_next_action: '先让分身尽调，再决定是否转成 OPC 挂牌。',
    assistant: need.assistant,
  }
}

function getOpcCandidateTags(need: TopicLinkOpcCandidate | undefined) {
  return (need?.tags ?? []).filter(Boolean).slice(0, 3)
}

function getOpcCandidateSearchText(need: TopicLinkOpcCandidate) {
  return normalizeTopicSearchText([
    need.title,
    need.summary,
    need.stage,
    need.blocker,
    need.fit_reasons.join(' '),
    need.tags.join(' '),
  ].filter(Boolean).join(' '))
}

const OPC_MASCOT_COLUMNS = 9
const OPC_MASCOT_ROWS = 6

function getOpcMascotIndex(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return hash % (OPC_MASCOT_COLUMNS * OPC_MASCOT_ROWS)
}

function OpcCapybaraAvatar({
  name,
  className = '',
  testId,
}: {
  name: string
  className?: string
  testId?: string
}) {
  const mascotIndex = getOpcMascotIndex(name || 'OPC')
  const column = mascotIndex % OPC_MASCOT_COLUMNS
  const row = Math.floor(mascotIndex / OPC_MASCOT_COLUMNS)
  return (
    <span
      aria-label={`${name || '发起者'}头像`}
      className={`block overflow-hidden rounded-full bg-[#e7f1f1] bg-no-repeat ring-2 ring-white shadow-[0_10px_24px_rgba(16,45,69,0.22)] ${className}`}
      data-testid={testId}
      role="img"
      style={{
        backgroundImage: `url(${opcProfessionalCapybaraSheetUrl})`,
        backgroundPosition: `${column === 0 ? 0 : (column / (OPC_MASCOT_COLUMNS - 1)) * 100}% ${row === 0 ? 0 : (row / (OPC_MASCOT_ROWS - 1)) * 100}%`,
        backgroundSize: `${OPC_MASCOT_COLUMNS * 100}% ${OPC_MASCOT_ROWS * 100}%`,
      }}
    />
  )
}

function getOpcCandidateRelationReason(need: TopicLinkOpcCandidate, focus: TopicLinkOpcCandidate | undefined) {
  const focusTags = new Set(getOpcCandidateTags(focus).map((tag) => normalizeTopicSearchText(tag)))
  const sharedTag = getOpcCandidateTags(need).find((tag) => focusTags.has(normalizeTopicSearchText(tag)))
  if (sharedTag) return `同标签：${sharedTag}`
  if (focus?.blocker?.trim() && need.blocker?.trim()) return '都有明确卡点'
  if (focus?.stage && need.stage && focus.stage === need.stage) return `同阶段：${need.stage}`
  if (need.stage) return `都在关注：${need.stage}`
  return '可以对照着看'
}

const OPC_CANDIDATE_LAYOUT = [
  { left: '30%', top: '21%', size: 'large', color: '#40aeb0' },
  { left: '47%', top: '15%', size: 'small', color: '#5a9de2' },
  { left: '63%', top: '23%', size: 'large', color: '#8b7bd8' },
  { left: '65%', top: '48%', size: 'small', color: '#f2a13b' },
  { left: '63%', top: '72%', size: 'large', color: '#54b07a' },
  { left: '42%', top: '79%', size: 'small', color: '#40aeb0' },
  { left: '29%', top: '66%', size: 'large', color: '#7d8f8a' },
  { left: '29%', top: '44%', size: 'small', color: '#5a9de2' },
  { left: '36%', top: '37%', size: 'small', color: '#f2a13b' },
  { left: '64%', top: '42%', size: 'small', color: '#40aeb0' },
  { left: '50%', top: '87%', size: 'small', color: '#5a9de2' },
  { left: '66%', top: '86%', size: 'small', color: '#54b07a' },
] as const

export function getOpcCandidateMatchProfile(candidate: TopicLinkOpcCandidate | undefined) {
  const fallback = {
    headline: '先看项目相似，再找一人公司',
    people: ['需求澄清', '项目拆解', '交付验收'],
    reasons: ['先输入技能或关键词，把中心项目换到最相关的一单。'],
  }
  if (!candidate) return fallback

  const tags = candidate?.tags?.join(' ') ?? ''
  const text = `${candidate?.title ?? ''} ${candidate?.summary ?? ''} ${tags}`
  const reasons = candidate.fit_reasons.length
    ? candidate.fit_reasons.slice(0, 3)
    : [candidate.suggested_next_action]
  if (/Science|科研|论文|仿真|ANSYS/i.test(text)) {
    return {
      headline: '先核验技术路径，再找科研公司',
      people: ['科研尽调', '实验复现', '产业访谈'],
      reasons,
    }
  }
  if (/设计|品牌|logo|VI|视觉/i.test(text)) {
    return {
      headline: '先对齐审美边界，再找设计公司',
      people: ['设计承接', '品牌判断', '交付把关'],
      reasons,
    }
  }
  if (/GitHub|JSON|代码|coding|工程|自动化/i.test(text)) {
    return {
      headline: '先拆最小工作流，再找工程公司',
      people: ['代码实现', '工程拆解', '数据清洗'],
      reasons,
    }
  }
  return {
    headline: fallback.headline,
    people: fallback.people,
    reasons,
  }
}

function getOpcAssistantStatusLabel(candidate: TopicLinkOpcCandidate | undefined) {
  const assistant = candidate?.assistant
  const snapshot = assistant?.snapshot
  const hasAssistantOutput = Boolean(
    typeof snapshot?.summary === 'string' && snapshot.summary.trim()
    || typeof snapshot?.next_step === 'string' && snapshot.next_step.trim()
    || Array.isArray(snapshot?.follow_up_questions) && snapshot.follow_up_questions.length > 0,
  )
  if (assistant?.status === 'ready' && hasAssistantOutput) return '共创队分身已读'
  if (assistant?.status === 'pending' || assistant?.status === 'running') return '共创队分身待跑'
  if (assistant?.status === 'failed') return '共创队分身失败'
  if (assistant) return '共创队分身暂无结果'
  return '可派出调研'
}

export function OpcDemandPreviewBoard({
  candidates,
  total,
  sourceLabel,
  loading,
  error,
  mode,
  onModeChange,
  viewerProfile,
}: {
  candidates: TopicLinkOpcCandidate[]
  total: number
  sourceLabel: string
  loading: boolean
  error: string | null
  mode: TopicLinkMode
  onModeChange: (mode: TopicLinkMode) => void
  viewerProfile?: TopicViewerProfile
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const focusSlugParam = searchParams.get('opc_focus')?.trim() || null
  const [opcSearchInput, setOpcSearchInput] = useState('')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [diligenceCandidate, setDiligenceCandidate] = useState<TopicLinkOpcCandidate | null>(null)
  const [diligenceTask, setDiligenceTask] = useState<TopicLinkAgentTask | null>(null)
  const [diligenceSubmitting, setDiligenceSubmitting] = useState(false)
  const [diligenceError, setDiligenceError] = useState<string | null>(null)
  const opcSearchQuery = normalizeTopicSearchText(opcSearchInput)
  const matchedCandidates = useMemo(() => {
    if (!opcSearchQuery) return candidates
    return candidates.filter((need) => getOpcCandidateSearchText(need).includes(opcSearchQuery))
  }, [candidates, opcSearchQuery])
  const visibleDemands = matchedCandidates.slice(0, 12)
  const focusDemand = visibleDemands.find((need) => need.id === selectedCandidateId) ?? visibleDemands[0]
  const relatedDemands = visibleDemands.filter((need) => need.id !== focusDemand?.id)
  const withBlockers = visibleDemands.filter((need) => need.blocker?.trim()).length
  const matchProfile = getOpcCandidateMatchProfile(focusDemand)
  const focusAssistantLabel = getOpcAssistantStatusLabel(focusDemand)
  const readableSourceLabel = sourceLabel.includes('TopicLink Zvec')
    ? '已连接灵感共创队 · 语义匹配'
    : sourceLabel.includes('本地降级')
      ? '已连接灵感共创队 · 内容排序'
      : '已连接灵感共创队'
  const searchPlaceholder = '按技能或关键词筛单，比如 AI for Science'
  const diligenceDrawerRef = useRef<HTMLElement | null>(null)
  const closeDiligence = () => {
    setDiligenceCandidate(null)
    setDiligenceTask(null)
    setDiligenceError(null)
    setDiligenceSubmitting(false)
  }
  const openDiligence = async (candidate: TopicLinkOpcCandidate) => {
    setDiligenceCandidate(candidate)
    setDiligenceTask(null)
    setDiligenceError(null)
    setDiligenceSubmitting(true)
    try {
      const dispatched = await topicsApi.dispatchOpcDiligence(candidate.source_slug)
      setDiligenceTask(dispatched.data.task)
      const refreshed = await topicsApi.getTopicLinkDispatch(dispatched.data.task.id)
      setDiligenceTask(refreshed.data.task)
    } catch (error) {
      setDiligenceError(getDiligenceErrorMessage(error))
    } finally {
      setDiligenceSubmitting(false)
    }
  }
  useEffect(() => {
    if (!diligenceCandidate) return
    diligenceDrawerRef.current?.focus()
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeDiligence()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [diligenceCandidate])
  useEffect(() => {
    if (!diligenceTask || !['pending', 'claimed'].includes(diligenceTask.status)) return
    let cancelled = false
    const timer = window.setInterval(() => {
      topicsApi.getTopicLinkDispatch(diligenceTask.id)
        .then((response) => {
          if (!cancelled) setDiligenceTask(response.data.task)
        })
        .catch((error) => {
          if (cancelled) return
          setDiligenceError(getDiligenceErrorMessage(error))
          window.clearInterval(timer)
        })
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [diligenceTask?.id, diligenceTask?.status])
  useEffect(() => {
    if (selectedCandidateId || !focusSlugParam) return
    const matched = candidates.find((need) => need.source_slug === focusSlugParam)
    if (matched) setSelectedCandidateId(matched.id)
  }, [candidates, focusSlugParam, selectedCandidateId])
  const focusCandidate = (candidateId: string) => {
    setSelectedCandidateId(candidateId)
    const slug = candidates.find((need) => need.id === candidateId)?.source_slug
    if (!slug) return
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('opc_focus', slug)
      return next
    }, { replace: true })
  }
  const handleCandidateKeyDown = (event: KeyboardEvent<HTMLElement>, candidateId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      focusCandidate(candidateId)
    }
  }
  const diligenceStatusLabel = diligenceSubmitting
    ? '正在派出分身'
    : diligenceError
      ? '派出失败'
      : diligenceTask?.status === 'pending'
        ? '已外派，等待接话'
        : diligenceTask?.status === 'claimed'
          ? '分身调研中'
          : diligenceTask?.status === 'replied'
            ? '分身已回复'
            : diligenceTask?.status === 'failed'
              ? '调研失败'
              : '准备派出分身'
  const diligenceRisks = Array.isArray(diligenceTask?.output?.risk_notes)
    ? diligenceTask.output.risk_notes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
  const diligenceDiscussionPath = typeof diligenceTask?.input?.discussion_path === 'string'
    ? diligenceTask.input.discussion_path
    : null
  const activityItems = useMemo(() => {
    const items: string[] = []
    if (diligenceTask && diligenceTask.status !== 'failed') {
      const agentName = viewerProfile?.title || diligenceTask.target_agent.handle.replace(/^@/, '') || '分身'
      const projectName = diligenceTask.source.title || diligenceCandidate?.title || '当前项目'
      items.push(
        diligenceTask.status === 'replied'
          ? `${agentName}交回了「${projectName}」调研`
          : `${agentName}接下了「${projectName}」调研`,
      )
    }
    candidates.slice(0, 4).forEach((candidate) => {
      items.push(`灵感共创队发布了「${candidate.title}」`)
    })
    return Array.from(new Set(items))
  }, [candidates, diligenceCandidate?.title, diligenceTask, viewerProfile])
  const [activityIndex, setActivityIndex] = useState(0)
  useEffect(() => {
    setActivityIndex(0)
    if (activityItems.length <= 1) return
    const timer = window.setInterval(() => {
      setActivityIndex((current) => (current + 1) % activityItems.length)
    }, 3600)
    return () => window.clearInterval(timer)
  }, [activityItems])
  return (
    <div className="min-h-screen bg-[#eef4f1] text-[#17231f]">
      <section className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="relative hidden min-h-[830px] overflow-hidden rounded-[1.75rem] border border-[#bed5cb] bg-[#dfeae5] shadow-[0_30px_80px_rgba(36,54,48,0.20)] lg:block" data-testid="opc-candidate-map">
          <img src={opcParkMapUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-92" />
          <div className="topiclink-plaza-water pointer-events-none absolute inset-0 z-10" />
          <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_center,rgba(248,251,249,0.46),rgba(238,244,241,0.14)_42%,rgba(23,50,74,0.12))]" />

          <div className="absolute left-6 top-6 z-50 w-60 rounded-2xl border border-[#bdd5ca] bg-[#fffdfa] p-4 text-[#17231f] shadow-[0_18px_45px_rgba(16,45,69,0.22)]" data-testid="opc-map-overview">
            <p className="text-xs font-semibold text-[#236f72]">TopicLink / OPC Link</p>
            <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-[#17231f]">项目关系预挂牌</h1>
            <p className="mt-3 text-xs font-medium leading-5 text-[#17231f]">这里汇集灵感共创队的公开需求。先看项目，再决定自己接，还是请分身先调研。</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#f4faf7] px-2 py-2">
                <p className="text-lg font-semibold text-[#17324a]">{loading ? '--' : total}</p>
                <p className="text-[11px] text-[#33443d]">需求</p>
              </div>
              <div className="rounded-xl bg-[#f4faf7] px-2 py-2">
                <p className="text-lg font-semibold text-[#17324a]">{loading ? '--' : withBlockers}</p>
                <p className="text-[11px] text-[#33443d]">有卡点</p>
              </div>
              <div className="rounded-xl bg-[#f4faf7] px-2 py-2">
                <p className="text-lg font-semibold text-[#17324a]">{loading ? '--' : visibleDemands.length}</p>
                <p className="text-[11px] text-[#33443d]">当前</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] font-semibold text-[#236f72]">{readableSourceLabel}</p>
            <div className="mt-2 rounded-xl border border-[#d7e6df] bg-[#f8fbf9] px-3 py-2" data-testid="opc-activity-feed">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-[#17324a]">园区动态</p>
                <span className="text-[10px] font-medium text-[#2f8586]">持续更新</span>
              </div>
              <div aria-live="polite" className="mt-1 h-11 overflow-hidden">
                <div
                  className="transition-transform duration-700 ease-out"
                  style={{ transform: `translateY(-${activityIndex * 2.75}rem)` }}
                >
                  {activityItems.map((item, index) => (
                    <p
                      aria-hidden={index !== activityIndex}
                      className="flex h-11 items-center text-[11px] font-medium leading-4 text-[#17231f]"
                      key={item}
                    >
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            </div>
            <Link to={OPC_INSPIRATION_SUBMIT_PATH} className="mt-3 inline-flex text-[11px] font-semibold text-[#2f8586]">
              发布新需求
            </Link>
          </div>

          <div className="absolute right-6 top-6 z-[60]">
            <TopicLinkModeSwitch mode={mode} onChange={onModeChange} />
          </div>

          {error ? (
            <div className="absolute left-1/2 top-24 z-30 w-[28rem] -translate-x-1/2 rounded-2xl border border-[#e6c6b8] bg-[#fff7f2] px-4 py-3 text-sm text-[#8a4a2f] shadow-[0_16px_38px_rgba(36,54,48,0.18)]">{error}</div>
          ) : null}

          <div className="absolute bottom-6 left-1/2 z-40 w-[34rem] -translate-x-1/2 rounded-2xl border border-[#d7e6df] bg-[#fbfdfc] p-3 shadow-[0_22px_55px_rgba(36,54,48,0.18)] ">
            <div className="flex items-center gap-3">
              <div className="min-w-[6.5rem]">
                <p className="text-xs font-semibold text-[#2f8586]">检索挂牌</p>
                <p className="text-[11px] text-[#33443d]">{opcSearchQuery ? `${matchedCandidates.length} 个命中` : '按技能或关键词'}</p>
              </div>
              <input
                value={opcSearchInput}
                onChange={(event) => setOpcSearchInput(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-11 min-w-0 flex-1 rounded-xl border border-[#cfe3da] bg-[#f7fbf9] px-4 text-sm text-[#17324a] outline-none transition placeholder:text-[#9aa9a2] focus:border-[#2f8586] focus:bg-white"
              />
            </div>
          </div>

          {loading ? (
            <p className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] px-6 py-5 text-sm text-[#33443d] shadow-[0_16px_38px_rgba(36,54,48,0.18)]">正在同步共创线索...</p>
          ) : focusDemand ? (
            <>
              <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {relatedDemands.slice(0, OPC_CANDIDATE_LAYOUT.length).map((need, index) => {
                  const layout = OPC_CANDIDATE_LAYOUT[index]
                  return (
                    <path
                      key={need.id}
                      d={`M 50 51 C ${50 + (parseFloat(layout.left) - 50) * 0.25} ${51 + (parseFloat(layout.top) - 51) * 0.25}, ${50 + (parseFloat(layout.left) - 50) * 0.72} ${51 + (parseFloat(layout.top) - 51) * 0.72}, ${parseFloat(layout.left)} ${parseFloat(layout.top)}`}
                      fill="none"
                      stroke={layout.color}
                      strokeWidth="0.22"
                      strokeOpacity="0.32"
                    />
                  )
                })}
              </svg>

              <article className="absolute left-1/2 top-1/2 z-40 w-[31rem] -translate-x-1/2 -translate-y-1/2 rounded-[1.5rem] border-2 border-[#28527a] bg-[#fffdfa] p-6 text-center shadow-[0_28px_70px_rgba(16,45,69,0.28)]" data-testid="opc-focus-candidate">
                <div className="mx-auto mb-3 flex items-center justify-center">
                  <OpcCapybaraAvatar name={focusDemand.title} className="h-14 w-14 ring-4" testId="opc-founder-avatar" />
                </div>
                <p className="text-xs font-medium text-[#2f8586]">推荐先看</p>
                <h2 className="mx-auto mt-2 max-w-[24rem] font-serif text-2xl font-semibold leading-snug text-[#17231f]">{focusDemand.title}</h2>
                <p className="mx-auto mt-3 line-clamp-3 max-w-[25rem] text-sm leading-6 text-[#33443d]">{focusDemand.summary}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="rounded-full bg-[#17324a] px-3 py-1 text-xs font-semibold text-white">{focusDemand.fit_score} 尽调匹配</span>
                  <span className="rounded-full bg-[#e8f5f1] px-3 py-1 text-xs font-semibold text-[#236f72]">{focusAssistantLabel}</span>
                  {getOpcCandidateTags(focusDemand).map((tag) => (
                    <span key={tag} className="rounded-full bg-[#eef6f2] px-3 py-1 text-xs text-[#33443d]">{tag}</span>
                  ))}
                </div>
                <div className="mt-5 flex justify-center gap-3">
                  <Link data-testid="opc-focus-source-link" to={focusDemand.source_path} className="rounded-xl bg-[#17324a] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#23455f]">自己接</Link>
                  <button data-testid="opc-focus-diligence-button" type="button" onClick={() => void openDiligence(focusDemand)} className="rounded-xl border border-[#9fd0cd] bg-white px-6 py-2.5 text-sm font-semibold text-[#17324a]">分身调研</button>
                </div>
              </article>

              {relatedDemands.slice(0, OPC_CANDIDATE_LAYOUT.length).map((need, index) => {
                const layout = OPC_CANDIDATE_LAYOUT[index]
                const compact = layout.size === 'small'
                return (
                  <article
                    key={need.id}
                    className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-2xl border border-[#bdd5ca] bg-[#fffdfa] p-3 text-left text-[#17231f] shadow-[0_18px_48px_rgba(16,45,69,0.24)] transition hover:-translate-y-[calc(50%+2px)] hover:border-[#9fd0cd] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#2f8586] ${compact ? 'w-48' : 'w-60'}`}
                    onClick={() => focusCandidate(need.id)}
                    onKeyDown={(event) => handleCandidateKeyDown(event, need.id)}
                    role="button"
                    tabIndex={0}
                    style={{ left: layout.left, top: layout.top }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <OpcCapybaraAvatar name={need.title} className="h-8 w-8" />
                      <span className="text-[11px] font-semibold text-[#17324a]">{need.fit_score} 关联</span>
                    </div>
                    {!compact ? <p className="mb-2 inline-flex rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[11px] font-semibold text-[#236f72]">{getOpcAssistantStatusLabel(need)}</p> : null}
                    <h3 className={`font-serif font-semibold leading-snug text-[#17231f] ${compact ? 'line-clamp-2 text-sm' : 'line-clamp-2 text-base'}`}>{need.title}</h3>
                    {!compact ? <p className="mt-2 line-clamp-2 text-xs font-medium leading-5 text-[#17231f]">{need.blocker || `正在推进：${need.stage}`}</p> : null}
                    <div className="mt-3 flex items-center justify-between border-t border-[#dce8e2] pt-2">
                      <span className="text-[11px] font-medium text-[#17231f]">{need.clue_number != null ? `线索 ${need.clue_number}` : need.stage}</span>
                      <Link to={need.source_path} onClick={(event) => event.stopPropagation()} className="text-[11px] font-semibold text-[#0f6f72]">查看</Link>
                    </div>
                  </article>
                )
              })}

              <div className="absolute right-6 top-20 z-50 w-[20rem] max-h-[calc(100%-7rem)] overflow-y-auto rounded-2xl border border-[#bdd5ca] bg-[#fffdfa] text-[#17231f] shadow-[0_24px_60px_rgba(16,45,69,0.24)]">
                <aside className="p-4" data-testid="opc-need-summary-panel">
                <p className="text-xs font-semibold text-[#0f6f72]">项目简报</p>
                <h2 className="mt-1 font-serif text-xl font-semibold leading-snug text-[#17231f]">{focusDemand.title}</h2>
                <p className="mt-3 text-sm font-medium leading-6 text-[#17231f]">{focusDemand.summary}</p>
                <div className="mt-4 grid gap-2">
                  <div className="rounded-xl border border-[#c4d9cf] bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold text-[#0f6f72]">现在走到</p>
                    <p className="mt-1 text-xs font-medium leading-5 text-[#17231f]">{focusDemand.stage}</p>
                  </div>
                  <div className="rounded-xl border border-[#c4d9cf] bg-white px-3 py-2">
                    <p className="text-[11px] font-semibold text-[#0f6f72]">当前卡点</p>
                    <p className="mt-1 text-xs font-medium leading-5 text-[#17231f]">{focusDemand.blocker || '还需要和发起者确认具体边界'}</p>
                  </div>
                </div>
                {getOpcCandidateTags(focusDemand).length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {getOpcCandidateTags(focusDemand).map((tag) => (
                      <span key={tag} className="rounded-full bg-[#eef6f2] px-2.5 py-1 text-[11px] font-medium text-[#33443d]">{tag}</span>
                    ))}
                  </div>
                ) : null}
                {relatedDemands.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-[#bdd5ca] bg-[#f7fbf8] p-3" data-testid="opc-relation-panel">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-[#17231f]">相似项目</p>
                      <span className="text-[11px] font-medium text-[#53635d]">可以对照着看</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {relatedDemands.slice(0, 3).map((need) => (
                        <button
                          key={need.id}
                          type="button"
                          onClick={() => focusCandidate(need.id)}
                          className="block w-full rounded-xl border border-[#c4d9cf] bg-white px-3 py-2 text-left shadow-[0_6px_18px_rgba(16,45,69,0.05)] transition hover:border-[#9fd0cd] hover:bg-[#fbfdfc] focus:outline-none focus:ring-2 focus:ring-[#2f8586]"
                        >
                          <span className="block line-clamp-1 text-xs font-semibold text-[#17231f]">{need.title}</span>
                          <span className="mt-1 block line-clamp-1 text-[11px] font-semibold text-[#0f6f72]">{getOpcCandidateRelationReason(need, focusDemand)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4">
                  <p className="text-xs font-semibold text-[#0f6f72]">适合找谁</p>
                  <p className="mt-1 text-xs font-medium leading-5 text-[#17231f]">{matchProfile.headline}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {matchProfile.people.map((person) => (
                      <span key={person} className="rounded-full border border-[#c4d9cf] bg-white px-3 py-1 text-xs font-medium text-[#17324a]">{person}</span>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-xs font-medium leading-5 text-[#53635d]">{focusAssistantLabel} · 内容来自灵感共创队公开需求</p>
                {focusDemand ? (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link to={focusDemand.source_path} className="rounded-xl bg-[#17324a] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#23455f]">打开线索</Link>
                    <button type="button" onClick={() => void openDiligence(focusDemand)} className="rounded-xl border border-[#9fd0cd] bg-white px-4 py-2.5 text-sm font-semibold text-[#17324a]">分身调研</button>
                  </div>
                ) : null}
                </aside>
              </div>
            </>
          ) : (
            <p className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] px-6 py-5 text-sm text-[#33443d] shadow-[0_16px_38px_rgba(36,54,48,0.18)]">{opcSearchQuery ? '没有匹配的预挂牌线索，换个关键词试试。' : '暂时没有可预挂牌的共创线索。'}</p>
          )}
        </div>

        <div className="lg:hidden">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium text-[#2f8586]">TopicLink / OPC Link</p>
              <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">项目关系预挂牌</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#33443d]">
                先把灵感共创队里的公开需求按项目看，判断卡点、需要的人和是否值得转成 OPC 挂牌。
              </p>
            </div>
            <TopicLinkModeSwitch mode={mode} onChange={onModeChange} />
          </div>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] p-4 shadow-[0_12px_28px_rgba(36,54,48,0.08)]">
              <p className="text-xs text-[#33443d]">公开线索</p>
              <p className="mt-1 text-2xl font-semibold text-[#17324a]">{loading ? '--' : total}</p>
            </div>
            <div className="rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] p-4 shadow-[0_12px_28px_rgba(36,54,48,0.08)]">
              <p className="text-xs text-[#33443d]">有明确卡点</p>
              <p className="mt-1 text-2xl font-semibold text-[#17324a]">{loading ? '--' : withBlockers}</p>
            </div>
            <div className="rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] p-4 shadow-[0_12px_28px_rgba(36,54,48,0.08)]">
              <p className="text-xs text-[#33443d]">同步来源</p>
              <p className="mt-1 text-sm font-semibold text-[#2f8586]">{sourceLabel}</p>
              <p className="mt-3 text-xs font-semibold text-[#17324a]">公开线索来自灵感共创队</p>
              <Link to={OPC_INSPIRATION_SUBMIT_PATH} className="mt-2 inline-flex text-xs font-semibold text-[#2f8586]">
                去灵感共创队发布
              </Link>
            </div>
          </div>
          <div className="mb-5 rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] p-3 shadow-[0_12px_28px_rgba(36,54,48,0.08)]">
            <p className="mb-2 text-xs font-semibold text-[#2f8586]">检索挂牌</p>
            <input
              value={opcSearchInput}
              onChange={(event) => setOpcSearchInput(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-11 w-full rounded-xl border border-[#cfe3da] bg-[#f7fbf9] px-4 text-sm text-[#17324a] outline-none transition placeholder:text-[#9aa9a2] focus:border-[#2f8586] focus:bg-white"
            />
            <p className="mt-2 text-[11px] text-[#33443d]">{opcSearchQuery ? `${matchedCandidates.length} 个命中` : '输入技能、领域或交付关键词，先把中心项目换到最相关的一单。'}</p>
          </div>
          {error ? (
            <div className="mb-5 rounded-2xl border border-[#e6c6b8] bg-[#fff7f2] px-4 py-3 text-sm text-[#8a4a2f]">{error}</div>
          ) : null}
          {loading ? (
            <p className="rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] px-4 py-5 text-sm text-[#33443d]">正在同步共创线索...</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2" data-testid="opc-mobile-candidate-list">
              {visibleDemands.map((need) => {
              const tags = getOpcCandidateTags(need)
              const relationReason = need.id === focusDemand?.id ? '中心项目' : getOpcCandidateRelationReason(need, focusDemand)
              return (
                <article key={need.id} className="flex min-h-[16rem] flex-col rounded-2xl border border-[#d2e3da] bg-[#fbfdfc] p-4 shadow-[0_16px_36px_rgba(36,54,48,0.10)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className="rounded-full bg-[#e8f5f1] px-2.5 py-1 text-xs font-medium text-[#2f8586]">{need.stage}</span>
                    <span className="text-xs font-semibold text-[#17324a]">{need.fit_score} 尽调匹配</span>
                  </div>
                  <h2 className="line-clamp-2 font-serif text-lg font-semibold leading-snug text-[#17231f]">{need.title}</h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#33443d]">{need.summary}</p>
                  {need.blocker ? (
                    <p className="mt-3 rounded-xl bg-[#f5faf7] px-3 py-2 text-xs leading-5 text-[#33443d]">
                      <span className="font-medium text-[#17324a]">卡点：</span>{need.blocker}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs leading-5 text-[#2f8586]">{need.blocker || `正在推进：${need.stage}`}</p>
                  <p className="mt-3 rounded-xl border border-[#d2e3da] bg-[#f7fbf9] px-3 py-2 text-xs leading-5 text-[#33443d]">
                    <span className="font-medium text-[#17324a]">项目关联：</span>{relationReason}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-[#eef6f2] px-2.5 py-1 text-[11px] text-[#33443d]">{tag}</span>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                    <span className="text-xs text-[#33443d]">{need.clue_number != null ? `线索 ${need.clue_number}` : '可评估为 OPC 挂牌'}</span>
                    <div className="flex items-center gap-2">
                      <Link to={need.source_path} className="rounded-xl border border-[#c7dcd3] bg-[#f7fbf9] px-3 py-2 text-xs font-semibold text-[#17324a]">
                        自己接
                      </Link>
                      <button type="button" onClick={() => void openDiligence(need)} className="rounded-xl border border-[#9fd0cd] bg-white px-3 py-2 text-xs font-semibold text-[#2f8586]">
                        分身调研
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
            </div>
          )}
        </div>
        {diligenceCandidate ? (
          <div className="pointer-events-none fixed right-6 top-24 z-[70] w-[min(28rem,calc(100vw-3rem))]" role="presentation">
            <aside
              aria-label="OPC 分身尽调"
              className="pointer-events-auto max-h-[calc(100vh-8rem)] w-full overflow-y-auto rounded-[1.5rem] border border-[#b9d3c8] bg-[#fffdfa] p-5 text-left shadow-[0_28px_90px_rgba(16,45,69,0.30)] focus:outline-none"
              data-testid="opc-diligence-drawer"
              ref={diligenceDrawerRef}
              role="dialog"
              tabIndex={-1}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#2f8586]">{diligenceStatusLabel}</p>
                  <h2 className="mt-1 font-serif text-2xl font-semibold leading-snug text-[#17231f]">{diligenceCandidate.title}</h2>
                </div>
                <span className="shrink-0 rounded-full bg-[#17324a] px-3 py-1 text-xs font-semibold text-white">主人确认后执行</span>
              </div>
              <p className="mt-3 text-sm font-medium leading-6 text-[#17231f]">{diligenceCandidate.summary}</p>
              <section className="mt-4 rounded-2xl border border-[#bdd5ca] bg-white p-4 shadow-[0_10px_28px_rgba(16,45,69,0.06)]">
                {diligenceSubmitting ? (
                  <p className="text-sm font-medium leading-6 text-[#17231f]">正在通知你的分身...</p>
                ) : diligenceError ? (
                  <div>
                    <p className="text-sm font-semibold text-[#8a4a2f]">{diligenceError}</p>
                    <button type="button" onClick={() => void openDiligence(diligenceCandidate)} className="mt-3 rounded-xl border border-[#d6a58f] bg-[#fff7f2] px-4 py-2 text-xs font-semibold text-[#8a4a2f]">重新派出</button>
                  </div>
                ) : diligenceTask?.status === 'replied' ? (
                  <div data-testid="opc-diligence-receipt">
                    <p className="text-xs font-semibold text-[#0f6f72]">调研结论</p>
                    <p className="mt-2 text-sm font-medium leading-6 text-[#17231f]">{String(diligenceTask.output.summary || '分身已完成调研。')}</p>
                    {diligenceRisks.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-[#17324a]">风险与待核验项</p>
                        <ul className="mt-2 space-y-2">
                          {diligenceRisks.map((risk) => (
                            <li key={risk} className="rounded-xl border border-[#d2e3da] bg-[#fbfdfc] px-3 py-2 text-xs font-medium leading-5 text-[#17231f]">{risk}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-xl bg-[#f0f7f4] px-3 py-3">
                      <p className="text-xs font-semibold text-[#0f6f72]">建议下一步</p>
                      <p className="mt-1 text-sm font-medium leading-6 text-[#17231f]">{String(diligenceTask.output.next_step || '请主人确认后再执行。')}</p>
                    </div>
                  </div>
                ) : diligenceTask?.status === 'failed' ? (
                  <div>
                    <p className="text-sm font-semibold text-[#8a4a2f]">{diligenceTask.error_message || '分身未能完成这次调研。'}</p>
                    <button type="button" onClick={() => void openDiligence(diligenceCandidate)} className="mt-3 rounded-xl border border-[#d6a58f] bg-[#fff7f2] px-4 py-2 text-xs font-semibold text-[#8a4a2f]">重新派出</button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium leading-6 text-[#17231f]">
                      {diligenceTask?.status === 'claimed'
                        ? '你的分身已接下调研，正在核对公开线索和交付边界。'
                        : '已经交给你的分身，完成后会在这里送回结果。'}
                    </p>
                    {diligenceTask ? <p className="mt-3 text-[11px] font-medium text-[#53635d]">结果会持续更新</p> : null}
                  </div>
                )}
              </section>
              <div className="mt-5 flex justify-end gap-3 border-t border-[#d2e3da] pt-4">
                <button type="button" onClick={closeDiligence} className="rounded-xl border border-[#9fd0cd] bg-white px-5 py-2.5 text-sm font-semibold text-[#0f6f72]">关闭</button>
                {diligenceDiscussionPath ? (
                  <Link data-testid="opc-diligence-discussion-link" to={diligenceDiscussionPath} className="rounded-xl bg-[#17324a] px-5 py-2.5 text-sm font-semibold text-white">进入讨论</Link>
                ) : null}
                <Link data-testid="opc-diligence-source-link" to={diligenceCandidate.source_path} className="rounded-xl border border-[#9fd0cd] bg-white px-5 py-2.5 text-sm font-semibold text-[#0f6f72]">打开原线索</Link>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  )
}
