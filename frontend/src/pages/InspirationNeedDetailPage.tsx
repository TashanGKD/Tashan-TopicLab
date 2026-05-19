import { FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { refreshCurrentUserProfile, tokenManager, type User } from '../api/auth'
import { inspirationApi, type InspirationDemand, type InspirationDemandUpdate, type InspirationDemandUpdateRequest } from '../api/client'

const initialUpdate: InspirationDemandUpdateRequest = {
  week_label: '',
  stage_key: 'defined',
  stage_status: 'done',
  summary: '',
  progress: '',
  blockers: '',
  next_steps: '',
  emotion_note: '',
  artifacts: [],
  visibility: 'public',
}

const statusOptions: Array<{ key: InspirationDemandUpdateRequest['stage_status']; label: string }> = [
  { key: 'done', label: '已完成' },
  { key: 'current', label: '进行中' },
  { key: 'needs_input', label: '待补充' },
  { key: 'pending', label: '待开始' },
]

type PrivateDraft = Record<string, string | boolean | number | null | undefined>
type UpdateOptionalSection = 'links' | 'tools' | 'emotion' | 'blockers'

const updateOptionalSections: Array<{ key: UpdateOptionalSection; label: string }> = [
  { key: 'links', label: '文档/网页链接' },
  { key: 'tools', label: '正在使用的工具' },
  { key: 'emotion', label: '反思&感想' },
  { key: 'blockers', label: '遇到的问题' },
]

function getCurrentMinuteLabel() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const accountPrivateFields = new Set(['account_user_id', 'account_username', 'account_phone'])
const privateFieldOrder = [
  'participation_mode',
  'problem',
  'category_extra',
  'category',
  'current_blockers',
  'note',
  'allow_public',
  'contact',
  'submitter_name',
]

const commonPrivateFieldLabels: Record<string, string> = {
  participation_mode: '你现在更接近哪种情况',
  note: '还有什么想补充的',
  allow_public: '是否愿意把它匿名展示出来',
  contact: '怎么联系你',
  submitter_name: '怎么称呼你（可选）',
}

function getPrivateFieldLabel(key: string, draft: PrivateDraft) {
  const mode = String(draft.participation_mode ?? '')
  if (key === 'problem') {
    if (mode.includes('明确需求')) return '把这个需求说明白一点'
    if (mode.includes('想清楚')) return '先用一句话描述一下这个想法'
    if (mode.includes('参与')) return '想参与什么样的项目'
    if (mode.includes('看看')) return '想先了解什么'
    return '说说你在琢磨的事儿'
  }
  if (key === 'category_extra') {
    if (mode.includes('想清楚')) return '这个想法现在到什么阶段了'
    return '其他补充'
  }
  if (key === 'category') {
    if (mode.includes('明确需求')) return '这个需求大致在什么方向'
    if (mode.includes('想清楚')) return '这个想法大致和哪个领域相关'
    if (mode.includes('参与')) return '你想参与哪类项目'
    return '相关方向'
  }
  if (key === 'current_blockers') {
    if (mode.includes('明确需求')) return '你希望得到什么样的帮助'
    if (mode.includes('想清楚')) return '你现在最不确定的是什么'
    if (mode.includes('参与')) return '你更想怎么参与'
    return '当前状态'
  }
  return commonPrivateFieldLabels[key] ?? '补充信息'
}

function formatPrivateValue(key: string, value: PrivateDraft[string]) {
  if (key === 'allow_public') {
    const normalized = String(value).toLowerCase()
    return normalized === 'true' ? '愿意匿名公开，让更多人看到' : '先不公开，只提交给共创队'
  }
  const text = String(value ?? '').trim()
  if (text.toLowerCase() === 'null' || !text) return '未填写'
  return text
}

function getVisiblePrivateEntries(draft: PrivateDraft) {
  const keys = [
    ...privateFieldOrder.filter((key) => Object.prototype.hasOwnProperty.call(draft, key)),
    ...Object.keys(draft).filter((key) => !privateFieldOrder.includes(key) && !accountPrivateFields.has(key)),
  ]
  return keys.map((key) => ({
    key,
    label: getPrivateFieldLabel(key, draft),
    value: draft[key],
    displayValue: formatPrivateValue(key, draft[key]),
  }))
}

function normalizePathProgress(pathProgress?: InspirationDemand['path_progress']) {
  return (pathProgress ?? []).map((stage) => {
    if (stage.key !== 'interview' && stage.label !== '人工访谈') return stage
    return {
      ...stage,
      key: 'defined',
      label: '问题定义',
      summary: stage.summary?.replace('等待下一次访谈或共创更新。', '') || '',
      emotion_note: stage.emotion_note,
    }
  })
}

function statusLabel(status: string) {
  if (status === 'done') return '已完成'
  if (status === 'current') return '进行中'
  if (status === 'needs_input') return '待补充'
  return '待开始'
}

function draftFromUpdate(update: InspirationDemandUpdate): InspirationDemandUpdateRequest {
  return {
    week_label: update.week_label || '',
    stage_key: update.stage_key || 'defined',
    stage_status: (update.stage_status || 'done') as InspirationDemandUpdateRequest['stage_status'],
    summary: update.summary || '',
    progress: update.progress || '',
    blockers: update.blockers || '',
    next_steps: update.next_steps || '',
    emotion_note: update.emotion_note || '',
    artifacts: update.artifacts || [],
    visibility: update.visibility === 'admin_only' ? 'admin_only' : 'public',
  }
}

function updatePathProgressWithUpdate(
  stages: InspirationDemand['path_progress'] | undefined,
  update: InspirationDemandUpdate,
) {
  return (stages ?? []).map((stage) => (
    stage.key === update.stage_key
      ? {
          ...stage,
          status: update.stage_status || 'done',
          summary: update.summary || update.progress || stage.summary,
          emotion_note: update.emotion_note || stage.emotion_note,
        }
      : stage
  ))
}

function getUpdateArtifactsByType(update: InspirationDemandUpdate | InspirationDemandUpdateRequest, type: string) {
  return (update.artifacts ?? []).filter((artifact) => artifact.type === type || (!artifact.type && type === 'link' && artifact.url))
}

function setFirstArtifactByType(
  draft: InspirationDemandUpdateRequest,
  type: string,
  patch: { label?: string; url?: string },
): InspirationDemandUpdateRequest {
  const artifacts = [...(draft.artifacts ?? [])]
  const index = artifacts.findIndex((artifact) => artifact.type === type || (!artifact.type && type === 'link' && artifact.url))
  const nextArtifact = {
    ...(index >= 0 ? artifacts[index] : {}),
    type,
    ...patch,
  }
  const hasContent = Boolean((nextArtifact.label ?? '').trim() || (nextArtifact.url ?? '').trim())
  if (index >= 0) {
    if (hasContent) artifacts[index] = nextArtifact
    else artifacts.splice(index, 1)
  } else if (hasContent) {
    artifacts.push(nextArtifact)
  }
  return { ...draft, artifacts }
}

function getOpenSectionsFromUpdate(update: InspirationDemandUpdate): UpdateOptionalSection[] {
  const sections: UpdateOptionalSection[] = []
  if (getUpdateArtifactsByType(update, 'link').length) sections.push('links')
  if (getUpdateArtifactsByType(update, 'tool').length) sections.push('tools')
  if (update.emotion_note) sections.push('emotion')
  if (update.blockers) sections.push('blockers')
  return sections
}

function getDemandAssistant(demand: InspirationDemand | null) {
  if (!demand) return null
  return demand.assistant ?? {
    status: 'ready',
    snapshot: demand.llm_review,
    version: 0,
    latest_run_id: null,
    updated_at: demand.updated_at,
    error_message: null,
  }
}

function markAssistantPending(demand: InspirationDemand): InspirationDemand {
  const assistant = getDemandAssistant(demand)
  return {
    ...demand,
    assistant: {
      ...(assistant ?? {}),
      status: 'pending',
      error_message: null,
    },
  }
}

function getStageAssistant(
  assistant: NonNullable<ReturnType<typeof getDemandAssistant>> | null,
  stageKey: string,
) {
  const stages = assistant?.snapshot?.stages
  return stages && typeof stages === 'object' ? stages[stageKey] : undefined
}

function AssistantPanel({
  assistant,
  className = '',
}: {
  assistant: NonNullable<ReturnType<typeof getDemandAssistant>>
  className?: string
}) {
  const review = assistant.snapshot
  const isUpdating = assistant.status === 'pending' || assistant.status === 'running'
  return (
    <section className={`rounded-[var(--radius-md)] border border-slate-200 bg-white p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">智能助手</h2>
        {isUpdating ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600" />
            分析中
          </span>
        ) : null}
      </div>
      {isUpdating ? (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-teal-50 px-3 py-2 text-sm leading-6 text-teal-800">
          智能助手正在基于最新信息更新建议…
        </p>
      ) : null}
      {assistant.status === 'failed' ? (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
          本次分析暂未完成，稍后刷新可以再看。
        </p>
      ) : null}
      {review ? (
        <dl className="mt-4 space-y-4 text-sm leading-7">
          {review.clarity ? <div><dt className="font-semibold text-slate-500">清晰度</dt><dd>{review.clarity}</dd></div> : null}
          {review.next_step ? <div><dt className="font-semibold text-slate-500">建议下一步</dt><dd>{review.next_step}</dd></div> : null}
          {review.follow_up_questions?.length ? (
          <div>
            <dt className="font-semibold text-slate-500">建议追问</dt>
            <dd className="mt-2 space-y-1">
              {review.follow_up_questions.map((question) => <p key={question}>{question}</p>)}
            </dd>
          </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  )
}

export default function InspirationNeedDetailPage() {
  const { slug = '' } = useParams()
  const location = useLocation()
  const [currentUser, setCurrentUser] = useState<User | null>(() => tokenManager.getUser())
  const [demand, setDemand] = useState<InspirationDemand | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [privateOpen, setPrivateOpen] = useState(false)
  const [privateEditOpen, setPrivateEditOpen] = useState(false)
  const [privateDraft, setPrivateDraft] = useState<PrivateDraft>({})
  const [privateSaveStatus, setPrivateSaveStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [claimStatus, setClaimStatus] = useState<'idle' | 'claiming' | 'claimed' | 'auth_error' | 'error'>('idle')
  const [updateDraft, setUpdateDraft] = useState<InspirationDemandUpdateRequest>(initialUpdate)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [activeComposerStage, setActiveComposerStage] = useState<string | null>(null)
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null)
  const [openUpdateSections, setOpenUpdateSections] = useState<UpdateOptionalSection[]>([])

  useEffect(() => {
    const syncUser = () => setCurrentUser(tokenManager.getUser())
    window.addEventListener('auth-change', syncUser)
    window.addEventListener('storage', syncUser)
    if (tokenManager.get()) {
      refreshCurrentUserProfile()
        .then((user) => setCurrentUser(user))
        .catch(() => setCurrentUser(tokenManager.getUser()))
    }
    return () => {
      window.removeEventListener('auth-change', syncUser)
      window.removeEventListener('storage', syncUser)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const claimToken = new URLSearchParams(location.search).get('claim_token') || localStorage.getItem(`inspiration_claim_${slug}`)
    setStatus('loading')

    if (claimToken && currentUser) {
      setClaimStatus('claiming')
      inspirationApi.claimDemand(slug, claimToken)
        .then((response) => {
          if (cancelled) return
          localStorage.removeItem(`inspiration_claim_${slug}`)
          setDemand(response.data.demand)
          setStatus('ready')
          setClaimStatus('claimed')
        })
        .catch((error) => {
          if (cancelled) return
          const statusCode = (error as { response?: { status?: number } }).response?.status
          if (statusCode === 401) {
            tokenManager.remove()
            tokenManager.clearUser()
            window.dispatchEvent(new CustomEvent('auth-change'))
            setCurrentUser(null)
            setClaimStatus('auth_error')
          } else {
            setClaimStatus('error')
          }
          inspirationApi.getDemand(slug)
            .then((response) => {
              if (cancelled) return
              setDemand(response.data.demand)
              setStatus('ready')
            })
            .catch(() => {
              if (cancelled) return
              setStatus('error')
            })
        })
      return () => {
        cancelled = true
      }
    }

    inspirationApi.getDemand(slug)
      .then((response) => {
        if (cancelled) return
        setDemand(response.data.demand)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [currentUser, location.search, slug])

  useEffect(() => {
    if (demand && status !== 'ready') {
      setStatus('ready')
    }
  }, [demand, status])

  useEffect(() => {
    const assistant = getDemandAssistant(demand)
    if (!demand || !assistant || !['pending', 'running'].includes(String(assistant.status))) {
      return
    }
    let cancelled = false
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      inspirationApi.getDemand(demand.slug)
        .then((response) => {
          if (cancelled) return
          setDemand((current) => ({
            ...response.data.demand,
            private: current?.private ?? response.data.demand.private,
          }))
        })
        .catch(() => {
          if (attempts >= 30) window.clearInterval(timer)
        })
      if (attempts >= 30) {
        window.clearInterval(timer)
      }
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [demand?.assistant?.status, demand?.slug])

  async function revealPrivate() {
    if (!demand) return
    setPrivateOpen(true)
    if (demand.private) {
      setPrivateDraft(demand.private)
      return
    }
    try {
      const response = await inspirationApi.getDemand(demand.slug, { includePrivate: true })
      setDemand(response.data.demand)
      setPrivateDraft(response.data.demand.private ?? {})
    } catch {
      setPrivateOpen(false)
    }
  }

  async function handlePrivateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!demand) return
    setPrivateSaveStatus('saving')
    try {
      const response = await inspirationApi.updateDemandPrivate(demand.slug, privateDraft)
      setDemand(response.data.demand)
      setPrivateDraft(response.data.demand.private ?? {})
      setPrivateEditOpen(false)
      setPrivateSaveStatus('idle')
    } catch {
      setPrivateSaveStatus('error')
    }
  }

  function startStageComposer(stageKey: string) {
    setEditingUpdateId(null)
    setActiveComposerStage(stageKey)
    setUpdateDraft({ ...initialUpdate, stage_key: stageKey, week_label: getCurrentMinuteLabel() })
    setOpenUpdateSections([])
    setUpdateStatus('idle')
  }

  function startEditUpdate(update: InspirationDemandUpdate) {
    setActiveComposerStage(update.stage_key || 'defined')
    setEditingUpdateId(update.id)
    setUpdateDraft(draftFromUpdate(update))
    setOpenUpdateSections(getOpenSectionsFromUpdate(update))
    setUpdateStatus('idle')
  }

  function toggleUpdateSection(section: UpdateOptionalSection) {
    setOpenUpdateSections((current) => (
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section]
    ))
  }

  async function handleUpdateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!demand || !updateDraft.summary.trim()) return
    const previousDemand = demand
    const submitDraft = { ...updateDraft, week_label: getCurrentMinuteLabel() }
    const currentEditingUpdateId = editingUpdateId
    const pendingUpdate: InspirationDemandUpdate = {
      id: currentEditingUpdateId ? `pending-edit-${currentEditingUpdateId}` : `pending-${Date.now()}`,
      ...submitDraft,
      visibility: submitDraft.visibility,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setUpdateStatus('saving')
    setDemand((current) => current ? {
      ...current,
      updates: currentEditingUpdateId
        ? (current.updates ?? []).map((update) => update.id === currentEditingUpdateId ? pendingUpdate : update)
        : [pendingUpdate, ...(current.updates ?? [])],
      path_progress: updatePathProgressWithUpdate(current.path_progress, pendingUpdate),
    } : current)
    setUpdateDraft(initialUpdate)
    setOpenUpdateSections([])
    setActiveComposerStage(null)
    setEditingUpdateId(null)
    try {
      const response = currentEditingUpdateId
        ? await inspirationApi.updateUpdate(demand.slug, currentEditingUpdateId, submitDraft)
        : await inspirationApi.createUpdate(demand.slug, submitDraft)
      setDemand((current) => {
        if (!current) return current
        return markAssistantPending({
          ...current,
          updates: currentEditingUpdateId
            ? (current.updates ?? []).map((update) => update.id === pendingUpdate.id || update.id === response.data.update.id ? response.data.update : update)
            : (current.updates ?? []).map((update) => update.id === pendingUpdate.id ? response.data.update : update),
          path_progress: updatePathProgressWithUpdate(current.path_progress, response.data.update),
        })
      })
      setUpdateStatus('idle')
    } catch {
      setDemand(previousDemand)
      setUpdateDraft(submitDraft)
      setOpenUpdateSections(openUpdateSections)
      setActiveComposerStage(submitDraft.stage_key)
      setEditingUpdateId(currentEditingUpdateId)
      setUpdateStatus('error')
    }
  }

  if (status === 'loading') {
    return <div className="px-5 py-20 text-center text-sm text-slate-500">共创路径加载中…</div>
  }

  if (status === 'error' || !demand) {
    return (
      <div className="px-5 py-20 text-center">
        <p className="text-lg font-semibold text-slate-950">共创路径暂时无法打开</p>
        <Link to="/inspiration-co-creation" className="mt-5 inline-flex text-sm font-semibold text-teal-700">返回共创线索</Link>
      </div>
    )
  }

  const assistant = getDemandAssistant(demand)
  const canRevealPrivate = Boolean(demand.can_view_private)
  const canUpdate = Boolean(demand.can_update)
  const pathProgress = normalizePathProgress(demand.path_progress)
  const updatesByStage = (demand.updates ?? []).reduce<Record<string, InspirationDemandUpdate[]>>((acc, update) => {
    const key = update.stage_key || 'defined'
    acc[key] = acc[key] ?? []
    acc[key].push(update)
    return acc
  }, {})
  const currentStageIndex = pathProgress.findIndex((stage) => stage.status === 'current')
  const lastDoneStageIndex = pathProgress.reduce((latest, stage, index) => stage.status === 'done' ? index : latest, 0)
  const timelineIndex = currentStageIndex >= 0 ? currentStageIndex : lastDoneStageIndex
  const pendingClaimToken = new URLSearchParams(location.search).get('claim_token') || localStorage.getItem(`inspiration_claim_${demand.slug}`)
  const claimReturnPath = `/inspiration-co-creation/needs/${encodeURIComponent(demand.slug)}${pendingClaimToken ? `?claim_token=${encodeURIComponent(pendingClaimToken)}` : ''}`
  const loginBindSearch = `?next=${encodeURIComponent(claimReturnPath)}`
  const shouldShowClaimLogin = Boolean(pendingClaimToken && (!currentUser || claimStatus === 'auth_error'))
  const privateDraftEntries = getVisiblePrivateEntries(privateDraft)
  const linkArtifact = getUpdateArtifactsByType(updateDraft, 'link')[0] ?? {}
  const toolArtifact = getUpdateArtifactsByType(updateDraft, 'tool')[0] ?? {}
  const activeStage = pathProgress.find((stage) => stage.key === activeComposerStage)
  const isAnsweringAssistantQuestions = activeStage?.key === 'submitted' && activeStage?.status === 'needs_input'

  const progressForm = (
    <form onSubmit={handleUpdateSubmit} className="mt-5 space-y-4 rounded-[var(--radius-md)] border border-teal-100 bg-teal-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-950">{isAnsweringAssistantQuestions ? '补充追问回答' : '更新这一步'}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {isAnsweringAssistantQuestions ? '直接回答智能助手提出的问题，保存后会重新触发分析。' : '先写一句话就可以，时间会自动记录到当前分钟。'}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
          {getCurrentMinuteLabel()}
        </span>
      </div>
      <label className="block text-sm font-semibold text-slate-700">
        这一阶段现在有什么变化？
        <textarea
          value={updateDraft.summary}
          onChange={(event) => setUpdateDraft((current) => ({ ...current, summary: event.target.value }))}
          rows={3}
          placeholder="比如：问题说清楚了 / 找到了一个可试的工具 / 做了一个小 Demo / 暂时卡住了。"
          className="mt-2 w-full rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 py-2 text-sm leading-7"
        />
      </label>
      <div className="flex flex-wrap gap-2" aria-label="阶段状态">
        {statusOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setUpdateDraft((current) => ({ ...current, stage_status: option.key }))}
            className={`min-h-9 rounded-full px-3 text-sm font-medium transition ${updateDraft.stage_status === option.key ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-teal-200'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="可选补充">
        {updateOptionalSections.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => toggleUpdateSection(section.key)}
            className={`inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium transition ${openUpdateSections.includes(section.key) ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-teal-200'}`}
          >
            <span aria-hidden="true" className="mr-1">{openUpdateSections.includes(section.key) ? '−' : '+'}</span>
            {section.label}
          </button>
        ))}
      </div>
      {openUpdateSections.includes('links') ? (
        <div className="grid gap-3 rounded-[var(--radius-sm)] bg-white p-3 ring-1 ring-teal-100 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <input
            value={linkArtifact.label ?? ''}
            onChange={(event) => setUpdateDraft((current) => setFirstArtifactByType(current, 'link', { label: event.target.value }))}
            placeholder="链接名称，可选"
            className="min-h-10 rounded-[var(--radius-sm)] border border-slate-200 px-3 text-sm"
          />
          <input
            value={linkArtifact.url ?? ''}
            onChange={(event) => setUpdateDraft((current) => setFirstArtifactByType(current, 'link', { url: event.target.value }))}
            placeholder="文档、网页、Demo 或原型链接"
            className="min-h-10 rounded-[var(--radius-sm)] border border-slate-200 px-3 text-sm"
          />
        </div>
      ) : null}
      {openUpdateSections.includes('tools') ? (
        <input
          value={toolArtifact.label ?? ''}
          onChange={(event) => setUpdateDraft((current) => setFirstArtifactByType(current, 'tool', { label: event.target.value }))}
          placeholder="正在使用的工具，比如：飞书表格、Cursor、Coze、Dify、Claude、剪映……"
          className="min-h-10 w-full rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 text-sm"
        />
      ) : null}
      {openUpdateSections.includes('emotion') ? (
        <textarea
          value={updateDraft.emotion_note}
          onChange={(event) => setUpdateDraft((current) => ({ ...current, emotion_note: event.target.value }))}
          rows={2}
          placeholder="反思&感想：这一步有什么发现、判断或感受？"
          className="w-full rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 py-2 text-sm leading-7"
        />
      ) : null}
      {openUpdateSections.includes('blockers') ? (
        <textarea
          value={updateDraft.blockers}
          onChange={(event) => setUpdateDraft((current) => ({ ...current, blockers: event.target.value }))}
          rows={2}
          placeholder="遇到的问题：现在卡在哪里？需要什么帮助？"
          className="w-full rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 py-2 text-sm leading-7"
        />
      ) : null}
      {updateStatus === 'error' ? <p className="text-sm text-red-600">保存失败，请确认登录状态和更新权限。</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={updateStatus === 'saving'}
          className="inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {updateStatus === 'saving' ? '保存中…' : editingUpdateId ? '保存修改' : isAnsweringAssistantQuestions ? '保存回答' : '保存进展'}
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveComposerStage(null)
            setEditingUpdateId(null)
            setUpdateDraft(initialUpdate)
            setOpenUpdateSections([])
            setUpdateStatus('idle')
          }}
          className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
        >
          取消
        </button>
      </div>
    </form>
  )

  return (
    <div className="bg-[#fbfdfc] px-5 py-12 text-slate-950 sm:px-8 lg:py-16">
      <main className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="min-w-0">
        <Link to="/inspiration-co-creation" className="text-sm font-semibold text-teal-700">← 返回共创线索</Link>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-teal-50 px-3 py-1 font-medium text-teal-700">{demand.stage}</span>
          <span className="text-slate-400">{demand.slug}</span>
        </div>
        <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">{demand.title}</h1>
        <section className="mt-7 space-y-5" aria-label="线索概览">
          <div>
            <p className="text-xs font-semibold text-slate-400">线索摘要</p>
            <p className="mt-2 text-base leading-8 text-slate-600">{demand.summary}</p>
          </div>
          {demand.stuck ? (
            <div className="border-l-2 border-teal-400 pl-4">
              <p className="text-xs font-semibold text-teal-700">当前需要</p>
              <p className="mt-2 text-base leading-8 text-slate-700">{demand.stuck}</p>
            </div>
          ) : null}
          {demand.tags.length ? (
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="关联方向">
              <span className="mr-1 text-xs font-semibold text-slate-400">关联方向</span>
              {demand.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-white px-3 py-1 text-slate-500 ring-1 ring-slate-200">{tag}</span>
              ))}
            </div>
          ) : null}
        </section>

        {claimStatus === 'claimed' ? (
          <p className="mt-6 rounded-[var(--radius-md)] bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
            已绑定这条线索，后续可以持续更新路径进展。
          </p>
        ) : null}
        {claimStatus === 'claiming' ? (
          <p className="mt-6 rounded-[var(--radius-md)] bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
            正在绑定这条线索…
          </p>
        ) : null}
        {claimStatus === 'error' ? (
          <p className="mt-6 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            绑定链接已失效或不匹配。
          </p>
        ) : null}
        {shouldShowClaimLogin ? (
          <section className="mt-8 rounded-[var(--radius-md)] border border-teal-200 bg-teal-50/70 p-5 shadow-[0_18px_44px_rgba(13,148,136,0.08)]">
            <p className="text-base font-semibold text-slate-950">
              {claimStatus === 'auth_error' ? '登录状态已过期' : '这条线索可以绑定到你的账号'}
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              {claimStatus === 'auth_error'
                ? '重新登录后就可以把这条线索绑定到你的账号，之后继续补充进展、复盘和下一步。'
                : '登录后可以把它绑定到你的账号，之后就能回来补充进展、复盘和下一步。'}
            </p>
            <div className="mt-4">
              <Link
                to={{ pathname: '/login', search: loginBindSearch }}
                state={{ from: claimReturnPath }}
                className="inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800"
              >
                登录并绑定
              </Link>
            </div>
          </section>
        ) : null}

        <section className="mt-12 rounded-[var(--radius-md)] border border-teal-100 bg-white p-5" aria-label="完整表单信息">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">完整表单信息</h2>
              <p className="mt-2 text-sm leading-7 text-slate-500">你提交时的原始内容。觉得不够清楚的话，可以在这里补全。</p>
            </div>
            {canRevealPrivate && privateOpen && privateDraftEntries.length ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPrivateEditOpen((value) => !value)}
                  className="inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white"
                >
                  {privateEditOpen ? '收起编辑' : '编辑完整信息'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPrivateOpen(false)
                    setPrivateEditOpen(false)
                  }}
                  className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-950 hover:ring-slate-300"
                >
                  收起完整信息
                </button>
              </div>
            ) : null}
          </div>
          {!canRevealPrivate ? (
            <p className="mt-5 rounded-[var(--radius-sm)] bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-500">
              登录并绑定这条线索，或使用管理员账号查看完整表单信息。
            </p>
          ) : !privateOpen ? (
              <button
                type="button"
                onClick={() => void revealPrivate()}
                className="mt-5 inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white"
              >
                显示完整信息
              </button>
          ) : privateDraftEntries.length ? (
            privateEditOpen ? (
              <form onSubmit={handlePrivateSubmit} className="mt-5 space-y-4">
                {privateDraftEntries.map((entry) => (
                  <label key={entry.key} className="block text-sm font-medium text-slate-700">
                    {entry.label}
                    <textarea
                      value={String(entry.value ?? '')}
                      onChange={(event) => setPrivateDraft((current) => ({ ...current, [entry.key]: event.target.value }))}
                      rows={String(entry.value ?? '').length > 80 ? 4 : 2}
                      className="mt-2 w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 text-sm leading-7"
                    />
                  </label>
                ))}
                {privateSaveStatus === 'error' ? <p className="text-sm text-red-600">保存失败，请确认更新权限。</p> : null}
                <button
                  type="submit"
                  disabled={privateSaveStatus === 'saving'}
                  className="inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {privateSaveStatus === 'saving' ? '保存中…' : '保存完整信息'}
                </button>
              </form>
            ) : (
              <div className="mt-5 divide-y divide-slate-100">
                {privateDraftEntries.map((entry) => (
                  <div key={entry.key} className="grid gap-2 py-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <div className="text-sm font-semibold text-slate-500">{entry.label}</div>
                    <div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{entry.displayValue}</div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="mt-4 text-sm leading-7 text-slate-500">完整信息加载中…</p>
          )}
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold text-slate-950">路径进展</h2>
          <div aria-label="路径时间轴" className="mt-6 overflow-x-auto pb-2">
            <ol className="flex min-w-[42rem] items-start">
              {pathProgress.map((stage, index) => {
                const reached = index <= timelineIndex
                return (
                  <li key={`timeline-${stage.key}-${index}`} className="relative flex flex-1 flex-col items-center text-center">
                    {index > 0 ? <span className={`absolute left-[-50%] top-3 h-0.5 w-full ${reached ? 'bg-teal-600' : 'bg-slate-200'}`} /> : null}
                    <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-[#fbfdfc] ${reached ? 'bg-teal-700 text-white' : 'bg-white text-slate-400 ring-[#fbfdfc]'}`}>
                      {index + 1}
                    </span>
                    <span className={`mt-2 text-sm font-medium ${index === timelineIndex ? 'text-teal-700' : reached ? 'text-slate-800' : 'text-slate-400'}`}>{stage.label}</span>
                  </li>
                )
              })}
            </ol>
          </div>

          {assistant ? <AssistantPanel assistant={assistant} className="mt-6 lg:hidden" /> : null}

          {!canUpdate ? (
            <section className="mt-6 rounded-[var(--radius-md)] border border-slate-200 bg-white p-5">
              <h3 className="text-lg font-semibold text-slate-950">更新权限</h3>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                {currentUser
                  ? '这条线索还没有绑定到当前账号。只有提出者本人或管理员可以更新路径。'
                  : '登录并绑定后，就可以在这里持续更新这条线索。'}
              </p>
            </section>
          ) : null}

          <div aria-label="路径进展列表" className="mt-7 space-y-5">
            {pathProgress.map((stage, stageIndex) => {
              const stageUpdates = updatesByStage[stage.key] ?? []
              const stageAssistant = getStageAssistant(assistant, stage.key)
              return (
                <article
                  key={`${stage.key}-${stageIndex}`}
                  aria-label={`${stage.label}阶段`}
                  className={`rounded-[var(--radius-md)] border bg-white p-5 ${stage.status === 'current' ? 'border-teal-300 shadow-[0_18px_40px_rgba(13,148,136,0.08)]' : 'border-slate-200'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-teal-700">{String(stageIndex + 1).padStart(2, '0')} / {statusLabel(stage.status)}</p>
                      <h3 className="mt-2 text-xl font-semibold text-slate-950">{stage.label}</h3>
                    </div>
                    {canUpdate ? (
                      <button
                        type="button"
                        onClick={() => startStageComposer(stage.key)}
                        className="inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white"
                      >
                        {stage.key === 'submitted' && stage.status === 'needs_input' ? '补充回答' : '更新'}
                      </button>
                    ) : null}
                  </div>
                  {stage.summary ? (
                    <p className="mt-4 text-sm leading-7 text-slate-600">{stage.summary}</p>
                  ) : null}
                  {stage.emotion_note ? <p className="mt-2 text-sm leading-7 text-slate-700">{stage.emotion_note}</p> : null}
                  {stageAssistant?.ai_draft_answer || stageAssistant?.follow_up_questions?.length || stageAssistant?.next_step ? (
                    <section className="mt-5 rounded-[var(--radius-sm)] border border-teal-100 bg-teal-50/60 p-4">
                      <p className="text-xs font-semibold text-teal-700">AI 生成参考</p>
                      {stageAssistant.ai_draft_answer ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{stageAssistant.ai_draft_answer}</p>
                      ) : null}
                      {stageAssistant.follow_up_questions?.length ? (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-slate-500">继续追问</p>
                          <div className="mt-1 space-y-1 text-sm leading-6 text-slate-600">
                            {stageAssistant.follow_up_questions.map((question) => <p key={question}>{question}</p>)}
                          </div>
                        </div>
                      ) : null}
                      {stageAssistant.next_step ? (
                        <p className="mt-3 text-sm leading-6 text-teal-800">下一步：{stageAssistant.next_step}</p>
                      ) : null}
                    </section>
                  ) : null}

                  {stageUpdates.length ? (
                    <div className="mt-5 space-y-3">
                      {stageUpdates.map((update) => (
                        <div key={update.id} className="rounded-[var(--radius-sm)] bg-slate-50 p-4">
                          {(() => {
                            const isPending = update.id.startsWith('pending-')
                            const links = getUpdateArtifactsByType(update, 'link')
                            const tools = getUpdateArtifactsByType(update, 'tool')
                            return (
                              <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs font-semibold text-slate-500">
                              {update.week_label || '阶段记录'} · {isPending ? '正在保存…' : statusLabel(update.stage_status)}
                            </div>
                            {canUpdate ? (
                              <button
                                type="button"
                                onClick={() => startEditUpdate(update)}
                                className="text-sm font-semibold text-teal-700"
                              >
                                编辑
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-2 text-base font-semibold text-slate-950">{update.summary}</p>
                          {links.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {links.map((artifact, artifactIndex) => (
                                artifact.url ? (
                                  <a
                                    key={`${artifact.url}-${artifactIndex}`}
                                    href={artifact.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="relative z-20 rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-teal-100 hover:ring-teal-300"
                                  >
                                    {artifact.label || '文档/网页链接'}
                                  </a>
                                ) : null
                              ))}
                            </div>
                          ) : null}
                          {tools.length ? (
                            <p className="mt-2 text-sm leading-7 text-slate-600">
                              <span className="font-semibold text-slate-700">正在使用的工具：</span>
                              {tools.map((artifact) => artifact.label).filter(Boolean).join(' / ')}
                            </p>
                          ) : null}
                          {update.progress ? <p className="mt-2 text-sm leading-7 text-slate-600">{update.progress}</p> : null}
                          {update.emotion_note ? <p className="mt-2 text-sm leading-7 text-slate-600">反思&感想：{update.emotion_note}</p> : null}
                          {update.blockers ? <p className="mt-2 text-sm leading-7 text-slate-600">遇到的问题：{update.blockers}</p> : null}
                          {update.next_steps ? <p className="mt-2 text-sm leading-7 text-slate-500">下一步：{update.next_steps}</p> : null}
                              </>
                            )
                          })()}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {activeComposerStage === stage.key ? progressForm : null}
                </article>
              )
            })}
          </div>
        </section>
        </div>

        {assistant ? (
          <aside className="hidden lg:sticky lg:top-24 lg:block" aria-label="右侧智能助手">
            <AssistantPanel assistant={assistant} />
          </aside>
        ) : null}
      </main>
    </div>
  )
}
