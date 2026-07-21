import { useEffect, useMemo, useState } from 'react'

import type { CriticCapabilities, CriticEvaluationJob } from '../../api/client'
import { skillHubApi } from '../../api/client'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked', 'unverifiable'])
const REVIEW_STEPS = [
  ['validation', '规范与安全'],
  ['behavior', '内容质量'],
  ['triggers', '适用边界'],
  ['verdict', '采用结论'],
] as const

const DEFAULT_TARGETS = {
  skill: 'https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring',
  mcp: 'https://github.com/upstash/context7',
} as const

const EVALUATION_CALLS = [
  { kind: 'reasoning', title: '使用方式与任务设计' },
  { kind: 'execution', title: '代表任务执行' },
  { kind: 'evidence', title: '触发边界核验' },
  { kind: 'result', title: 'CriticAgent 结论' },
] as const

const TRACE_KIND_LABELS: Record<string, string> = {
  status: '处理中',
  reasoning: '判断摘要',
  execution: '执行结果',
  evidence: '核验结果',
  result: '最终结论',
  error: '错误信息',
}

const STEP_CALL_INDEX: Record<string, number> = {
  validation: 0,
  behavior: 1,
  triggers: 2,
  verdict: 3,
}

type TraceEvent = NonNullable<CriticEvaluationJob['trace']>[number]

function callIndexForEvent(event: TraceEvent) {
  if (event.kind === 'reasoning') return 0
  if (event.kind === 'execution') return 1
  if (event.kind === 'evidence') return 2
  if (event.kind === 'result') return 3
  return STEP_CALL_INDEX[event.step] ?? -1
}

function jobIdOf(job: CriticEvaluationJob | null) {
  return job?.job_id || job?.id || ''
}

export default function CriticWorkbench() {
  const [targets, setTargets] = useState({ ...DEFAULT_TARGETS })
  const [submittedKind, setSubmittedKind] = useState<'skill' | 'mcp'>('skill')
  const [capabilities, setCapabilities] = useState<CriticCapabilities | null>(null)
  const [job, setJob] = useState<CriticEvaluationJob | null>(null)
  const [loadingKind, setLoadingKind] = useState<'skill' | 'mcp' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    skillHubApi.getCriticCapabilities()
      .then((response) => {
        if (alive) setCapabilities(response.data)
      })
      .catch(() => {
        if (alive) {
          setCapabilities({
            worker_available: false,
            supported_kinds: ['skill', 'mcp'],
            supported_depths: ['standard'],
            message: '评测能力状态暂不可用',
          })
        }
      })
    return () => {
      alive = false
    }
  }, [])

  const activeJobId = jobIdOf(job)
  useEffect(() => {
    if (!activeJobId || TERMINAL_STATUSES.has(String(job?.status || ''))) return
    let alive = true
    let fallbackTimer: number | null = null
    const controller = new AbortController()
    const refresh = () => {
      skillHubApi.getCriticEvaluation(activeJobId)
        .then((response) => {
          if (alive) setJob(response.data)
        })
        .catch(() => {
          if (alive) setError('评测状态刷新失败，请稍后重试')
          if (fallbackTimer != null) window.clearInterval(fallbackTimer)
        })
    }
    const startFallback = () => {
      if (!alive || fallbackTimer != null) return
      refresh()
      fallbackTimer = window.setInterval(refresh, 1500)
    }
    skillHubApi.streamCriticEvaluation(
      activeJobId,
      { onJob: (nextJob) => { if (alive) setJob(nextJob) } },
      controller.signal,
    ).catch(() => {
      if (alive) startFallback()
    })
    return () => {
      alive = false
      controller.abort()
      if (fallbackTimer != null) window.clearInterval(fallbackTimer)
    }
  }, [activeJobId])

  const statusLabel = useMemo(() => {
    if (!job) return '等待提交'
    if (job.status === 'completed') return job.verdict ? `已完成 · ${job.verdict}` : '评测已完成'
    if (job.status === 'failed') return job.message || '评测失败'
    if (job.status === 'blocked') return job.message || '评测受阻'
    if (job.status === 'unverifiable') return job.message || '当前无法验证'
    if (job.status === 'running') return '正在评测'
    return '已进入评测队列'
  }, [job])

  const completedSteps = new Set(job?.progress?.completed_steps ?? [])
  const currentStep = job?.progress?.current_step
  const currentStepLabel = REVIEW_STEPS.find(([key]) => key === currentStep)?.[1] ?? '等待开始'
  const currentStepIndex = Math.max(0, REVIEW_STEPS.findIndex(([key]) => key === currentStep))
  const completedCount = job?.status === 'completed' ? REVIEW_STEPS.length : completedSteps.size
  const terminal = TERMINAL_STATUSES.has(String(job?.status || ''))
  const visualProgress = terminal
    ? completedCount
    : Math.max(completedCount, currentStepIndex + 0.3)
  const progressMessage = job?.progress?.message
    || (job?.status === 'completed' ? '评测证据已封存，可以查看结论' : '任务已提交，正在准备来源检查')
  const trace = useMemo(() => {
    const seen = new Set<string>()
    return (job?.trace ?? []).filter((event) => {
      const signature = JSON.stringify([event.step, event.kind, event.title, event.summary, event.details ?? []])
      if (seen.has(signature)) return false
      seen.add(signature)
      return true
    })
  }, [job?.trace])
  const callEventGroups = useMemo(() => EVALUATION_CALLS.map((_, index) => (
    trace.filter((event) => callIndexForEvent(event) === index)
  )), [trace])
  const callEvents = useMemo(() => EVALUATION_CALLS.map((call, index) => (
    [...callEventGroups[index]].reverse().find((event) => event.kind === call.kind)
  )), [callEventGroups])
  const completedCallCount = callEvents.filter(Boolean).length
  const failureEvent = useMemo(() => [...trace].reverse().find((event) => event.kind === 'error'), [trace])
  const failedCallIndex = failureEvent ? callIndexForEvent(failureEvent) : -1
  const activeCallIndex = terminal ? -1 : (STEP_CALL_INDEX[String(currentStep || '')] ?? 0)
  const runtimeEvents = useMemo(() => trace.filter((event) => (
    callIndexForEvent(event) === -1
  )), [trace])
  const failedCall = EVALUATION_CALLS.find((_, index) => index === failedCallIndex)
  const terminalCallFailure = terminal && job?.status !== 'completed' && failedCall != null
  const displayedStepLabel = terminalCallFailure ? failedCall.title : currentStepLabel
  const displayedProgress = terminalCallFailure ? completedCallCount : visualProgress

  const submit = async (kind: 'skill' | 'mcp') => {
    const target = targets[kind].trim()
    if (!target || !capabilities?.worker_available) return
    setLoadingKind(kind)
    setSubmittedKind(kind)
    setError(null)
    setJob(null)
    try {
      const response = await skillHubApi.submitCriticEvaluation({ kind, target })
      setJob(response.data)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '提交评测失败'
      setError(message.includes('401') ? '请先登录后再提交评测' : message)
    } finally {
      setLoadingKind(null)
    }
  }

  return (
    <section
      className="mt-5 overflow-hidden border-y sm:rounded-lg sm:border"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
      aria-labelledby="critic-workbench-title"
    >
      <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
            <h3 id="critic-workbench-title" className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
              评测 Skill 与 MCP
            </h3>
            <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              登录后可提交公开仓库评测；仓库内容与任务摘要会发送给 SCNet 模型，并实施调用配额保护。
            </p>
            </div>
            <span
              className="inline-flex items-center gap-2 pt-1 text-xs font-medium"
              style={{ color: capabilities == null ? 'var(--text-tertiary)' : capabilities.worker_available ? '#047857' : '#b45309' }}
            >
              <span
                className={`h-2 w-2 rounded-full ${capabilities == null ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: capabilities == null ? '#94a3b8' : capabilities.worker_available ? '#10b981' : '#f59e0b' }}
              />
              {capabilities == null ? '正在连接评测服务' : capabilities.worker_available ? '评测服务可用' : '评测服务暂不可用'}
            </span>
          </div>

          {job ? (
            <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-y py-3" style={{ borderColor: 'var(--border-default)' }}>
              <div className="min-w-0">
                <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                  正在评测 {String(job.kind || submittedKind).toUpperCase()}
                </p>
                <p className="mt-0.5 break-all text-sm" style={{ color: 'var(--text-primary)' }}>
                  {job.target || targets[submittedKind]}
                </p>
              </div>
              {terminal ? (
                <button
                  type="button"
                  onClick={() => {
                    setJob(null)
                    setError(null)
                  }}
                  className="shrink-0 text-xs font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
                >
                  评测其他项目
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 grid divide-y border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0" style={{ borderColor: 'var(--border-default)' }}>
            {([
              {
                kind: 'skill' as const,
                title: 'Skill 评测',
                label: 'Skill 仓库地址',
                placeholder: 'https://github.com/owner/repo/tree/main/skills/example',
              },
              {
                kind: 'mcp' as const,
                title: 'MCP 评测',
                label: 'MCP 仓库地址或包名',
                placeholder: '@scope/mcp-server 或 https://github.com/owner/mcp-server',
              },
            ]).map((entry) => (
              <form
                key={entry.kind}
                className="min-w-0 py-4 first:pr-0 last:pl-0 sm:first:pr-4 sm:last:pl-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submit(entry.kind)
                }}
              >
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{entry.title}</div>
                <label className="mt-2 block">
                  <span className="sr-only">{entry.label}</span>
                  <input
                    aria-label={entry.label}
                    value={targets[entry.kind]}
                    maxLength={2048}
                    onChange={(event) => setTargets((current) => ({ ...current, [entry.kind]: event.target.value }))}
                    placeholder={entry.placeholder}
                    className="h-11 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)' }}
                  />
                </label>
                <button
                  type="submit"
                  aria-label={`开始 ${entry.title}`}
                  disabled={loadingKind !== null || !targets[entry.kind].trim() || !capabilities?.worker_available}
                  className="mt-3 h-10 w-full rounded-md bg-indigo-700 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loadingKind === entry.kind ? '提交中' : `评测 ${entry.kind === 'skill' ? 'Skill' : 'MCP'}`}
                </button>
              </form>
            ))}
            </div>
          )}
          {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
          {job ? (
            <div
              role="status"
              aria-label="评测实时进度"
              aria-live="polite"
              className="mt-3 border-l-2 border-indigo-600 bg-indigo-50/70 px-3 py-2.5"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-indigo-950">
                    {!terminal ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-indigo-600" /> : null}
                    实时评测过程
                  </span>
                  <span className="text-indigo-700">已完成 {completedCallCount} / {EVALUATION_CALLS.length} 次评测调用</span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-indigo-700">
                  {displayedStepLabel} · {progressMessage}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-indigo-100" aria-hidden="true">
                  <div
                    className="h-full bg-indigo-600 transition-[width] duration-500"
                    style={{ width: `${Math.round((displayedProgress / REVIEW_STEPS.length) * 100)}%` }}
                  />
                </div>
                <ol
                  role="log"
                  aria-label="四步评测过程"
                  aria-live="polite"
                  className="mt-2 divide-y divide-indigo-100 border-y border-indigo-100"
                >
                  {EVALUATION_CALLS.map((call, index) => {
                    const completedEvent = callEvents[index] as TraceEvent | undefined
                    const callTrace = callEventGroups[index]
                    const failed = index === failedCallIndex
                    const active = index === activeCallIndex
                    const pendingMessage = index === 0
                      ? '等待规范与安全检查完成'
                      : `等待${EVALUATION_CALLS[index - 1].title}完成`
                    return (
                      <li key={call.kind} className="flex min-w-0 gap-3 py-3">
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${active ? 'animate-pulse' : ''}`}
                          style={{
                            borderColor: failed ? '#dc2626' : completedEvent ? '#059669' : active ? '#4f46e5' : '#cbd5e1',
                            backgroundColor: failed ? '#fef2f2' : completedEvent ? '#ecfdf5' : active ? '#eef2ff' : '#f8fafc',
                            color: failed ? '#b91c1c' : completedEvent ? '#047857' : active ? '#4338ca' : '#64748b',
                          }}
                          aria-hidden="true"
                        >
                          {failed ? '×' : completedEvent ? '✓' : index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className="text-sm font-semibold text-indigo-950">{call.title}</span>
                            <span className="text-[11px] font-medium" style={{ color: failed ? '#b91c1c' : completedEvent ? '#047857' : active ? '#4338ca' : '#64748b' }}>
                              {failed ? '未完成' : completedEvent ? '已完成' : active ? '进行中' : '等待中'}
                            </span>
                          </div>
                          {callTrace.length ? (
                            <div className="mt-2 space-y-2" aria-label={`${call.title}流式记录`}>
                              {callTrace.map((event) => (
                                <div
                                  key={`${event.sequence}-${event.kind}`}
                                  className="border-l-2 pl-3"
                                  style={{ borderColor: event.kind === 'error' ? '#dc2626' : event.kind === 'status' ? '#a5b4fc' : '#6366f1' }}
                                >
                                  {event.kind !== 'status' ? (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                                      <span className="font-semibold" style={{ color: event.kind === 'error' ? '#b91c1c' : '#4338ca' }}>
                                        {TRACE_KIND_LABELS[event.kind] || '过程记录'}
                                      </span>
                                      {event.title !== call.title ? <span style={{ color: '#64748b' }}>{event.title}</span> : null}
                                    </div>
                                  ) : null}
                                  <p className={`${event.kind === 'status' ? '' : 'mt-0.5'} break-words whitespace-pre-wrap text-xs leading-5`} style={{ color: event.kind === 'error' ? '#991b1b' : '#312e81' }}>
                                    {event.summary}
                                  </p>
                                  {event.details?.length ? (
                                    event.kind === 'error' ? (
                                      <div className="mt-1 space-y-1 text-xs leading-5 text-red-800">
                                        {event.details.map((detail, detailIndex) => (
                                          <p key={`${event.sequence}-${detailIndex}`} className="break-words whitespace-pre-wrap before:mr-1.5 before:content-['·']">
                                            {detail}
                                          </p>
                                        ))}
                                      </div>
                                    ) : (
                                      <details className="group mt-1 text-xs leading-5 text-indigo-800">
                                        <summary className="w-fit cursor-pointer select-none font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4">
                                          查看详细证据
                                        </summary>
                                        <div className="mt-2 space-y-1 border-l border-indigo-100 pl-3">
                                          {event.details.map((detail, detailIndex) => (
                                            <p key={`${event.sequence}-${detailIndex}`} className="break-words whitespace-pre-wrap before:mr-1.5 before:content-['·']">
                                              {detail}
                                            </p>
                                          ))}
                                        </div>
                                      </details>
                                    )
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-0.5 break-words text-xs leading-5" style={{ color: failed ? '#991b1b' : '#64748b' }}>
                              {active ? progressMessage : pendingMessage}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
                {runtimeEvents.length ? (
                  <div className="mt-3 border-t border-indigo-100 pt-3 text-xs text-indigo-800" aria-label="其他评测记录">
                    <p className="font-semibold text-indigo-950">其他评测记录</p>
                    <div className="mt-2 space-y-2 border-l border-indigo-200 pl-3 leading-5">
                      {runtimeEvents.map((event) => (
                        <div key={`${event.sequence}-${event.kind}`}>
                          <p className="font-medium text-indigo-950">{event.title}</p>
                          <p className="break-words text-indigo-700">{event.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {job?.status === 'completed' ? (
          <section className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }} aria-label="评测结论">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>评测结论</h4>
              <span className="text-sm font-medium text-emerald-700">{statusLabel}</span>
            </div>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
              {`${String(job.kind || submittedKind).toUpperCase()} · 标准评测${job.score != null ? ` · 得分 ${job.score}` : ''}`}
            </p>
            {job?.report_url ? (
              <a href={job.report_url} className="mt-3 inline-block text-xs font-medium text-indigo-700 underline underline-offset-4">
                查看评测证据
              </a>
            ) : null}
            {job?.dimensions?.length ? (
              <dl className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
                {job.dimensions.map((dimension) => (
                  <div key={dimension.key}>
                    <dt className="flex items-center justify-between gap-3 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      <span>{dimension.label}</span>
                      <span style={{ color: dimension.status === 'passed' ? '#047857' : '#b45309' }}>
                        {dimension.status === 'passed' ? '通过' : dimension.status === 'failed' ? '未通过' : '需核验'}
                      </span>
                    </dt>
                    <dd className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{dimension.summary}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {job?.limitations?.length ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                <span className="font-semibold">适用边界：</span>{job.limitations.join('；')}
              </div>
            ) : null}
          </section>
          ) : null}
      </div>
    </section>
  )
}
