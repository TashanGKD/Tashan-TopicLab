import { useEffect, useRef, useState } from 'react'

import type {
  ScienceSkillCatalogItem,
  ScienceSkillCatalogMeta,
  ScienceSkillFinderResponse,
  ScienceSkillFinderResult,
} from '../api/client'
import { skillHubApi } from '../api/client'
import CriticWorkbench from '../components/apps/CriticWorkbench'
import FindScienceWorkbench from '../components/apps/FindScienceWorkbench'
import {
  AppsInput,
  AppsStatusCard,
} from '../components/apps/appsShared'

const READINESS_LABELS: Record<string, { label: string; color: string; background: string }> = {
  trusted: { label: '可信', color: '#047857', background: '#ecfdf5' },
  provisional: { label: '待验证', color: '#b45309', background: '#fffbeb' },
  restricted: { label: '受限', color: '#b91c1c', background: '#fef2f2' },
}

function FilterRail({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-start">
      <div className="pt-1.5 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        <button
          type="button"
          aria-label={`${label}：全部`}
          aria-pressed={value === ''}
          onClick={() => onChange('')}
          className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium"
          style={value === ''
            ? { borderColor: '#0f766e', backgroundColor: '#0f766e', color: '#fff' }
            : { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
        >
          全部
        </button>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`${label}：${option}`}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={value === option
              ? { borderColor: '#0f766e', backgroundColor: '#0f766e', color: '#fff' }
              : { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

type CatalogDisplayItem = ScienceSkillCatalogItem | ScienceSkillFinderResult

type FinderPhase = 'understanding' | 'matching' | 'ranking'

const FINDER_PHASES: Array<{ key: FinderPhase; label: string }> = [
  { key: 'understanding', label: '理解需求' },
  { key: 'matching', label: '匹配技能' },
  { key: 'ranking', label: '生成推荐' },
]

function FinderStreamProgress({ phase, status, count }: { phase: FinderPhase; status: string; count: number }) {
  const activeIndex = FINDER_PHASES.findIndex((item) => item.key === phase)
  return (
    <div
      role="status"
      aria-label="推荐进度"
      aria-live="polite"
      className="rounded-md border px-4 py-3"
      style={{ borderColor: 'rgba(13, 148, 136, 0.28)', backgroundColor: 'rgba(13, 148, 136, 0.045)' }}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span style={{ color: 'var(--text-secondary)' }}>{status}</span>
        <strong className="shrink-0 font-semibold text-teal-700">已找到 {count} 项</strong>
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-2" aria-label="推荐阶段">
        {FINDER_PHASES.map((item, index) => {
          const reached = index <= activeIndex
          const active = index === activeIndex
          return (
            <li key={item.key} className="min-w-0">
              <span
                className={`block h-1.5 rounded-full ${active ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: reached ? '#0f766e' : 'var(--border-default)' }}
              />
              <span
                className="mt-1.5 block truncate text-xs font-medium"
                style={{ color: reached ? '#0f766e' : 'var(--text-tertiary)' }}
              >
                {item.label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function CatalogRow({ item, selected, onSelect }: { item: CatalogDisplayItem; selected: boolean; onSelect: () => void }) {
  const readiness = READINESS_LABELS[item.readiness] || READINESS_LABELS.provisional
  return (
    <button
      type="button"
      onClick={onSelect}
      className="block w-full rounded-lg border p-4 text-left transition-colors hover:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-600/25"
      style={{
        borderColor: selected ? '#0f766e' : 'var(--border-default)',
        backgroundColor: selected ? 'rgba(13, 148, 136, 0.055)' : 'var(--bg-container)',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {'rank' in item && item.rank ? <span className="text-xs font-semibold tabular-nums text-purple-700">#{item.rank}</span> : null}
            <h3 className="break-words text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</h3>
            <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ color: readiness.color, backgroundColor: readiness.background }}>
              {readiness.label}
            </span>
          </div>
          <div className="mt-1 text-base font-semibold" style={{ color: '#0f766e' }}>{item.function}</div>
          <p className="mt-1.5 line-clamp-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{item.summary}</p>
          {'recommendation_reason' in item && item.recommendation_reason ? (
            <p className="mt-2 border-l-2 border-purple-500 pl-2.5 text-sm leading-6" style={{ color: '#5b21b6' }}>
              {item.recommendation_reason}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{item.quality_score}</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>质量分</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <span>{item.domain} / {item.subdomain}</span>
        <span>{item.stage}</span>
        <span>{item.function}</span>
      </div>
    </button>
  )
}

function CatalogDetail({ item }: { item: CatalogDisplayItem | null }) {
  if (!item) {
    return <AppsStatusCard>从左侧选择一个 Skill 查看详细信息。</AppsStatusCard>
  }
  const readiness = READINESS_LABELS[item.readiness] || READINESS_LABELS.provisional
  const repositoryUrl = item.source_repository.startsWith('http')
    ? item.source_repository
    : `https://github.com/${item.source_repository}`
  return (
    <aside
      role="region"
      aria-label={`技能详情：${item.name}`}
      className="self-start rounded-lg border p-4 xl:sticky xl:top-20"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>技能详情</div>
          <h3 className="mt-1 break-words text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</h3>
          <div className="mt-1 text-base font-semibold" style={{ color: '#0f766e' }}>{item.function}</div>
        </div>
        <span className="shrink-0 rounded px-2 py-1 text-xs font-medium" style={{ color: readiness.color, backgroundColor: readiness.background }}>
          {readiness.label}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{item.summary}</p>
      {'recommendation_reason' in item && item.recommendation_reason ? (
        <p className="mt-3 border-l-2 border-purple-500 pl-3 text-sm leading-6" style={{ color: '#5b21b6' }}>
          <span className="font-semibold">推荐理由：</span>{item.recommendation_reason}
        </p>
      ) : null}
      <dl className="mt-4 divide-y text-sm" style={{ borderColor: 'var(--border-default)' }}>
        {[
          ['领域', `${item.domain} / ${item.subdomain}`],
          ['研究阶段', item.stage],
          ['功能分工', item.function],
          ['具体任务', item.task || '未细分'],
        ].map(([term, value]) => (
          <div key={term} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2.5">
            <dt style={{ color: 'var(--text-tertiary)' }}>{term}</dt>
            <dd className="break-words" style={{ color: 'var(--text-primary)' }}>{value}</dd>
          </div>
        ))}
      </dl>
      {item.classification_rationale ? (
        <div className="mt-4 border-l-2 border-teal-600 pl-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
          {item.classification_rationale}
        </div>
      ) : null}
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
        <a href={repositoryUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-teal-700 underline underline-offset-4">
          查看来源仓库
        </a>
        <div className="mt-2 break-all font-mono text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>{item.source_path}</div>
        <p className="mt-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
          目录信息来自公开来源；采用前请结合来源说明与评测结果判断。
        </p>
      </div>
    </aside>
  )
}

export default function AppsSkillLibraryPage() {
  const [finderQuery, setFinderQuery] = useState('')
  const [domain, setDomain] = useState('生命科学')
  const [stage, setStage] = useState('执行采集')
  const [functionGroup, setFunctionGroup] = useState('模拟建模')
  const [catalogMeta, setCatalogMeta] = useState<ScienceSkillCatalogMeta | null>(null)
  const [catalogSkills, setCatalogSkills] = useState<ScienceSkillCatalogItem[]>([])
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [graphSkills, setGraphSkills] = useState<ScienceSkillCatalogItem[]>([])
  const [graphTotal, setGraphTotal] = useState(0)
  const [graphLoading, setGraphLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selectedBrowseSkill, setSelectedBrowseSkill] = useState<ScienceSkillCatalogItem | null>(null)
  const [selectedFinderSkill, setSelectedFinderSkill] = useState<ScienceSkillFinderResult | null>(null)
  const [finderResult, setFinderResult] = useState<ScienceSkillFinderResponse | null>(null)
  const [finderStreaming, setFinderStreaming] = useState(false)
  const [finderStatus, setFinderStatus] = useState<string | null>(null)
  const [finderPhase, setFinderPhase] = useState<FinderPhase>('understanding')
  const [finderError, setFinderError] = useState<string | null>(null)
  const finderAbortRef = useRef<AbortController | null>(null)
  const graphSyncRouteRef = useRef('生命科学|执行采集|模拟建模')
  const catalogResultsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    skillHubApi.getScienceCatalogMeta()
      .then((response) => {
        if (alive) setCatalogMeta(response.data)
      })
      .catch(() => {
        if (alive) setCatalogError('科研 Skill 目录元数据加载失败')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    const routeKey = `${domain}|${stage}|${functionGroup}`
    const syncGraph = graphSyncRouteRef.current === routeKey
    const timer = window.setTimeout(() => {
      setCatalogLoading(true)
      if (syncGraph) setGraphLoading(true)
      setCatalogError(null)
      skillHubApi.listScienceCatalog({
        domain: domain || undefined,
        stage: stage || undefined,
        function: functionGroup || undefined,
        limit: 24,
        offset: 0,
      }).then((response) => {
        if (!alive) return
        setCatalogSkills(response.data.list)
        setCatalogTotal(response.data.total)
        setSelectedBrowseSkill((current) => response.data.list.find((item) => item.id === current?.id) || response.data.list[0] || null)
        if (syncGraph) {
          setGraphSkills(response.data.list)
          setGraphTotal(response.data.total)
          setGraphLoading(false)
          if (graphSyncRouteRef.current === routeKey) graphSyncRouteRef.current = ''
        }
      }).catch(() => {
        if (alive) setCatalogError('科研 Skill 目录加载失败')
      }).finally(() => {
        if (alive) {
          setCatalogLoading(false)
          if (syncGraph) setGraphLoading(false)
        }
      })
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [domain, stage, functionGroup])

  const visibleSkills = finderResult?.results ?? catalogSkills
  const visibleTotal = finderResult ? finderResult.results.length : catalogTotal
  const selectedCatalogSkill = finderResult ? selectedFinderSkill : selectedBrowseSkill
  const clearFinderResult = () => {
    finderAbortRef.current?.abort()
    finderAbortRef.current = null
    setFinderResult(null)
    setSelectedFinderSkill(null)
    setFinderStreaming(false)
    setFinderStatus(null)
    setFinderPhase('understanding')
    setFinderError(null)
  }

  const runFinderSearch = async () => {
    const cleanQuery = finderQuery.trim()
    if (!cleanQuery) return
    finderAbortRef.current?.abort()
    const controller = new AbortController()
    finderAbortRef.current = controller
    setDomain('')
    setStage('')
    setFunctionGroup('')
    setFinderStreaming(true)
    setFinderStatus('正在理解科研需求')
    setFinderPhase('understanding')
    setFinderError(null)
    setSelectedFinderSkill(null)
    setFinderResult({
      query: cleanQuery,
      route: { domain: null, stage: null, function: null, search_terms: [], rationale: '' },
      results: [],
      total: 0,
      ranking: { criteria: [] },
      driver: { orchestrator: '', provider: '', model: '', mode: 'streaming', configured: true, message: '' },
    })
    catalogResultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    try {
      await skillHubApi.streamScienceSkills(
        { query: cleanQuery, limit: 5 },
        {
          onStatus: ({ message }) => {
            setFinderStatus(message)
            if (message.includes('复核') || message.includes('匹配')) setFinderPhase('matching')
          },
          onRoute: (route) => {
            setFinderPhase('matching')
            setFinderResult((current) => current ? { ...current, route } : current)
          },
          onResult: (result) => {
            setFinderPhase('ranking')
            setFinderStatus('正在生成推荐列表')
            setFinderResult((current) => {
              if (!current || current.results.some((item) => item.id === result.id)) return current
              const results = [...current.results, result]
              return { ...current, results, total: Math.max(current.total, results.length) }
            })
            setSelectedFinderSkill((current) => current ?? result)
          },
          onDone: (payload) => {
            setFinderResult((current) => ({ ...payload, results: current?.results ?? [] }))
            setFinderStatus('推荐完成')
          },
        },
        controller.signal,
      )
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFinderResult(null)
        setSelectedFinderSkill(null)
        setFinderError('搜索暂时不可用，请稍后重试。')
      }
    } finally {
      if (finderAbortRef.current === controller) {
        finderAbortRef.current = null
        setFinderStreaming(false)
      }
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-page)' }}>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
      <section>
        <h1 className="text-[2rem] font-serif font-semibold leading-tight sm:text-[2.5rem]" style={{ color: 'var(--text-primary)' }}>
          科研 SkillHub
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          收录上千项科研技能，按领域、研究阶段与功能分工搜索与浏览。
        </p>
      </section>

      <CriticWorkbench />

      <FindScienceWorkbench
        meta={catalogMeta}
        exploreSkills={graphSkills}
        exploreTotal={graphTotal}
        exploreLoading={graphLoading}
        onExplore={(route) => {
          clearFinderResult()
          graphSyncRouteRef.current = `${route.domain ?? ''}|${route.stage ?? ''}|${route.function ?? ''}`
          setCatalogLoading(true)
          setCatalogSkills([])
          setDomain(route.domain ?? '')
          setStage(route.stage ?? '')
          setFunctionGroup(route.function ?? '')
          setSelectedBrowseSkill(null)
        }}
      />

      <section ref={catalogResultsRef} className="mt-5 scroll-mt-20 space-y-3 border-b pb-5" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {finderStreaming
                ? `正在推荐 · 已找到 ${visibleSkills.length} 项`
                : finderResult
                  ? `推荐结果 ${visibleTotal} 项`
                  : '科研技能目录'}
            </h3>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
              {finderResult
                ? finderResult.route.rationale
                : `当前路径命中 ${catalogTotal} 项；质量与证据状态按目录记录显示。`}
            </p>
            {finderResult?.ranking?.criteria.length ? (
              <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
                排序：{finderResult.ranking.criteria.map((criterion) => criterion.label).join(' → ')}
              </p>
            ) : null}
          </div>
          {finderResult && !finderStreaming ? (
            <button type="button" onClick={clearFinderResult} className="text-sm font-medium text-teal-700 underline underline-offset-4">
              返回目录
            </button>
          ) : null}
        </div>
        <FilterRail label="领域" value={domain} options={catalogMeta?.dimensions.domains ?? []} onChange={(value) => { clearFinderResult(); setDomain(value) }} />
        <FilterRail label="阶段" value={stage} options={catalogMeta?.dimensions.stages ?? []} onChange={(value) => { clearFinderResult(); setStage(value) }} />
        <FilterRail label="功能" value={functionGroup} options={catalogMeta?.dimensions.functions ?? []} onChange={(value) => { clearFinderResult(); setFunctionGroup(value) }} />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void runFinderSearch()
          }}
          className="flex flex-col gap-2 border-t pt-4 sm:flex-row"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <label className="min-w-0 flex-1">
            <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>搜索科研需求</span>
            <AppsInput
              aria-label="描述科研需求"
              value={finderQuery}
              maxLength={2000}
              onChange={(event) => setFinderQuery(event.target.value)}
              placeholder="例如：单细胞类型注释 / predict protein structure"
              className="h-11 w-full rounded-md py-0 leading-10 outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={finderStreaming || !finderQuery.trim()}
            className="h-11 shrink-0 self-end rounded-md bg-teal-700 px-5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {finderStreaming ? '正在推荐…' : '搜索科研技能'}
          </button>
        </form>
        <p className="text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
          未登录时仅使用本地目录匹配；登录后会将这段科研需求发送给 SCNet 模型进行语义复核。
        </p>
        {finderError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm" style={{ color: 'var(--accent-error)' }}>
            <span>{finderError}</span>
            <button type="button" onClick={() => void runFinderSearch()} className="font-medium underline underline-offset-4">重新搜索</button>
          </div>
        ) : null}
        {finderStreaming && finderStatus ? (
          <FinderStreamProgress phase={finderPhase} status={finderStatus} count={finderResult?.results.length ?? 0} />
        ) : null}
      </section>

      <section aria-label="科研技能目录结果" className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_21rem]">
        <div className="space-y-2.5">
          {catalogError && !finderResult ? <AppsStatusCard tone="error">{catalogError}</AppsStatusCard> : null}
          {finderStreaming && visibleSkills.length === 0 ? (
            <div
              className="rounded-lg border px-4 py-5"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
            >
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-teal-600" aria-hidden="true" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>正在等待首条推荐</span>
              </div>
              <div className="mt-4 space-y-2" aria-hidden="true">
                <div className="h-3 w-2/5 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ) : null}
          {visibleSkills.map((item) => (
            <CatalogRow
              key={item.id}
              item={item}
              selected={selectedCatalogSkill?.id === item.id}
              onSelect={() => {
                if (finderResult) {
                  setSelectedFinderSkill(item as ScienceSkillFinderResult)
                } else {
                  setSelectedBrowseSkill(item as ScienceSkillCatalogItem)
                }
              }}
            />
          ))}
          {!finderStreaming && !catalogLoading && (!catalogError || finderResult) && visibleSkills.length === 0 ? (
            <AppsStatusCard className="py-8">
              {finderResult
                ? '没有找到可靠匹配。请补充研究对象、当前阶段或期望产物后再搜索。'
                : '当前路径下没有匹配项，请减少一个筛选条件。'}
            </AppsStatusCard>
          ) : null}
          {catalogLoading && !finderResult ? <AppsStatusCard>正在读取内置目录…</AppsStatusCard> : null}
        </div>
        <CatalogDetail item={selectedCatalogSkill} />
      </section>
      </div>
    </div>
  )
}
