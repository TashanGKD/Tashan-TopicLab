import { FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { tokenManager, type User } from '../api/auth'
import { inspirationApi, type InspirationDemand, type InspirationDemandUpdateRequest } from '../api/client'

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

const stageOptions = [
  { key: 'defined', label: '问题定义' },
  { key: 'tooling', label: '工具选择' },
  { key: 'demo', label: 'Demo 验证' },
  { key: 'mvp', label: 'MVP/复盘' },
]

function normalizePathProgress(pathProgress?: InspirationDemand['path_progress']) {
  return (pathProgress ?? []).map((stage) => {
    if (stage.key !== 'interview' && stage.label !== '人工访谈') return stage
    return {
      ...stage,
      key: 'defined',
      label: '问题定义',
      summary: stage.summary?.replace('等待下一次访谈或共创更新。', '等待下一次共创更新。') || '等待下一次共创更新。',
      emotion_note: stage.emotion_note?.replace('有人愿意把问题留在这里。', '有人愿意把这件事继续往前推。') || stage.emotion_note,
    }
  })
}

export default function InspirationNeedDetailPage() {
  const { slug = '' } = useParams()
  const location = useLocation()
  const [currentUser, setCurrentUser] = useState<User | null>(() => tokenManager.getUser())
  const [demand, setDemand] = useState<InspirationDemand | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [privateOpen, setPrivateOpen] = useState(false)
  const [claimStatus, setClaimStatus] = useState<'idle' | 'claiming' | 'claimed' | 'error'>('idle')
  const [updateDraft, setUpdateDraft] = useState<InspirationDemandUpdateRequest>(initialUpdate)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  useEffect(() => {
    const syncUser = () => setCurrentUser(tokenManager.getUser())
    window.addEventListener('auth-change', syncUser)
    window.addEventListener('storage', syncUser)
    return () => {
      window.removeEventListener('auth-change', syncUser)
      window.removeEventListener('storage', syncUser)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const claimToken = new URLSearchParams(location.search).get('claim_token')
    setStatus('loading')

    if (claimToken && currentUser) {
      setClaimStatus('claiming')
      inspirationApi.claimDemand(slug, claimToken)
        .then((response) => {
          if (cancelled) return
          setDemand(response.data.demand)
          setStatus('ready')
          setClaimStatus('claimed')
        })
        .catch(() => {
          if (cancelled) return
          setClaimStatus('error')
          setStatus('error')
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

  async function revealPrivate() {
    if (!demand) return
    setPrivateOpen(true)
    if (demand.private) return
    try {
      const response = await inspirationApi.getDemand(demand.slug, { includePrivate: true })
      setDemand(response.data.demand)
    } catch {
      setPrivateOpen(false)
    }
  }

  async function handleUpdateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!demand || !updateDraft.summary.trim()) return
    setUpdateStatus('saving')
    try {
      const response = await inspirationApi.createUpdate(demand.slug, updateDraft)
      setDemand((current) => current ? {
        ...current,
        updates: [response.data.update, ...(current.updates ?? [])],
        path_progress: (current.path_progress ?? []).map((stage) => (
          stage.key === response.data.update.stage_key
            ? { ...stage, status: response.data.update.stage_status || 'done', summary: response.data.update.summary, emotion_note: response.data.update.emotion_note }
            : stage
        )),
      } : current)
      setUpdateDraft(initialUpdate)
      setUpdateStatus('idle')
    } catch {
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

  const privateEntries = Object.entries(demand.private ?? {})
  const review = demand.llm_review
  const canRevealPrivate = Boolean(demand.can_view_private)
  const canUpdate = Boolean(demand.can_update)
  const pathProgress = normalizePathProgress(demand.path_progress)

  return (
    <div className="bg-white px-5 py-14 text-slate-950 sm:px-8 lg:py-20">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(18rem,0.38fr)]">
        <main>
          <Link to="/inspiration-co-creation" className="text-sm font-semibold text-teal-700">← 返回共创线索</Link>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-teal-50 px-3 py-1 font-medium text-teal-700">{demand.stage}</span>
            <span className="text-slate-400">{demand.slug}</span>
          </div>
          <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">{demand.title}</h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600">{demand.summary}</p>
          {demand.stuck ? (
            <p className="mt-6 border-l-2 border-teal-400 pl-4 text-base leading-8 text-slate-700">{demand.stuck}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            {demand.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-500 ring-1 ring-slate-200">{tag}</span>
            ))}
          </div>
          {claimStatus === 'claimed' ? (
            <p className="mt-6 rounded-[var(--radius-md)] bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
              已绑定这条线索，后续可以持续更新路径进展。
            </p>
          ) : null}
          {claimStatus === 'error' ? (
            <p className="mt-6 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              绑定链接已失效或不匹配。
            </p>
          ) : null}

          <section className="mt-14">
            <h2 className="text-2xl font-semibold text-slate-950">路径进展</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {pathProgress.map((stage, stageIndex) => (
                <article
                  key={`${stage.key}-${stageIndex}`}
                  className={`rounded-[var(--radius-md)] border p-4 ${stage.status === 'done' ? 'border-teal-200 bg-teal-50/70' : stage.status === 'current' ? 'border-teal-300 bg-white shadow-[0_18px_40px_rgba(13,148,136,0.1)]' : 'border-slate-200 bg-slate-50/70'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-950">{stage.label}</h3>
                    <span className="text-xs font-semibold text-teal-700">
                      {stage.status === 'done' ? '已完成' : stage.status === 'current' ? '进行中' : '待开始'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{stage.summary}</p>
                  {stage.emotion_note ? <p className="mt-3 text-sm leading-7 text-slate-700">{stage.emotion_note}</p> : null}
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="space-y-8">
          {review ? (
            <section className="rounded-[var(--radius-md)] border border-slate-200 bg-[#fbfdfc] p-5">
              <h2 className="text-lg font-semibold text-slate-950">预分析</h2>
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
            </section>
          ) : null}

          {canRevealPrivate ? (
            <section className="rounded-[var(--radius-md)] border border-teal-100 bg-teal-50/40 p-5" aria-label="完整表单信息">
              <h2 className="text-lg font-semibold text-slate-950">完整表单信息</h2>
              {!privateOpen ? (
                <button
                  type="button"
                  onClick={() => void revealPrivate()}
                  className="mt-4 inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white"
                >
                  显示完整信息
                </button>
              ) : privateEntries.length ? (
                <div className="mt-4 space-y-4">
                  {privateEntries.map(([label, value]) => (
                    <div key={label}>
                      <div className="text-xs font-semibold text-slate-500">{label}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{String(value)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm leading-7 text-slate-500">完整信息加载中…</p>
              )}
            </section>
          ) : null}

          {canUpdate ? (
            <section className="rounded-[var(--radius-md)] border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-950">添加进展</h2>
              <form onSubmit={handleUpdateSubmit} className="mt-4 space-y-4">
                <input
                  value={updateDraft.week_label}
                  onChange={(event) => setUpdateDraft((current) => ({ ...current, week_label: event.target.value }))}
                  placeholder="2026-W21"
                  className="min-h-10 w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 text-sm"
                />
                <label className="block text-sm font-medium text-slate-700">
                  路径阶段
                  <select
                    aria-label="路径阶段"
                    value={updateDraft.stage_key}
                    onChange={(event) => setUpdateDraft((current) => ({ ...current, stage_key: event.target.value }))}
                    className="mt-2 min-h-10 w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 text-sm"
                  >
                    {stageOptions.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  阶段状态
                  <select
                    aria-label="阶段状态"
                    value={updateDraft.stage_status}
                    onChange={(event) => setUpdateDraft((current) => ({ ...current, stage_status: event.target.value as InspirationDemandUpdateRequest['stage_status'] }))}
                    className="mt-2 min-h-10 w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 text-sm"
                  >
                    <option value="done">已完成</option>
                    <option value="current">进行中</option>
                    <option value="pending">待开始</option>
                  </select>
                </label>
                <input
                  value={updateDraft.summary}
                  onChange={(event) => setUpdateDraft((current) => ({ ...current, summary: event.target.value }))}
                  placeholder="本次进展摘要"
                  className="min-h-10 w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 text-sm"
                />
                <textarea
                  value={updateDraft.progress}
                  onChange={(event) => setUpdateDraft((current) => ({ ...current, progress: event.target.value }))}
                  rows={3}
                  placeholder="进展记录"
                  className="w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 text-sm leading-7"
                />
                <textarea
                  value={updateDraft.emotion_note}
                  onChange={(event) => setUpdateDraft((current) => ({ ...current, emotion_note: event.target.value }))}
                  rows={2}
                  placeholder="给提出者看的进展反馈"
                  className="w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 text-sm leading-7"
                />
                <textarea
                  value={updateDraft.next_steps}
                  onChange={(event) => setUpdateDraft((current) => ({ ...current, next_steps: event.target.value }))}
                  rows={2}
                  placeholder="下一步"
                  className="w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 text-sm leading-7"
                />
                {updateStatus === 'error' ? <p className="text-sm text-red-600">保存失败，请确认管理员登录状态。</p> : null}
                <button
                  type="submit"
                  disabled={updateStatus === 'saving'}
                  className="inline-flex min-h-10 items-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {updateStatus === 'saving' ? '保存中…' : '保存进展'}
                </button>
              </form>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
