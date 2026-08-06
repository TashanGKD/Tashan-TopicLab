import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  mcpHubApi,
  type ScienceMcpCatalogItem,
  type ScienceMcpCatalogMeta,
  type ScienceMcpFinderResponse,
  type ScienceMcpFinderResult,
} from '../api/client'
import McpTaxonomyWorkbench from '../components/apps/McpTaxonomyWorkbench'
import CriticWorkbench from '../components/apps/CriticWorkbench'
import ResearchHubSwitch from '../components/apps/ResearchHubSwitch'
import { AppsInput, AppsStatusCard } from '../components/apps/appsShared'
import { formatInfoPageStatus, formatMcpLicense, formatMcpLicenseSource, formatMcpNarrative, getMcpPurpose } from '../utils/mcpHubPresentation'

const READINESS_LABELS = {
  trusted: { label: '可信', color: '#047857', background: '#ecfdf5' },
  provisional: { label: '待验证', color: '#b45309', background: '#fffbeb' },
}

type FinderPhase = 'understanding' | 'matching' | 'ranking'

const FINDER_PHASES: Array<{ key: FinderPhase; label: string }> = [
  { key: 'understanding', label: '理解需求' },
  { key: 'matching', label: '匹配 MCP' },
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
              <span className={`block h-1.5 rounded-full ${active ? 'animate-pulse' : ''}`} style={{ backgroundColor: reached ? '#0f766e' : 'var(--border-default)' }} />
              <span className="mt-1.5 block truncate text-xs font-medium" style={{ color: reached ? '#0f766e' : 'var(--text-tertiary)' }}>{item.label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function finderResultSourceLabel(result: ScienceMcpFinderResponse) {
  if (result.driver.mode === 'model') return 'AI 已完成科研路径理解与候选复核。'
  if (result.driver.mode === 'model_route_local_rank') return 'AI 已完成科研路径理解；候选顺序由目录匹配完成。'
  if (result.driver.configured) return 'AI 服务本次未完成；当前结果来自目录匹配。'
  return '当前结果来自目录匹配。'
}

function isTrusted(item: ScienceMcpCatalogItem) {
  return item.readiness === 'trusted' || item.status === 'verified_source' || item.evidence_scope === 'source_reviewed'
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

function McpRow({ item, selected, onSelect }: { item: ScienceMcpCatalogItem; selected: boolean; onSelect: () => void }) {
  const readiness = item.readiness === 'trusted' || isTrusted(item) ? READINESS_LABELS.trusted : READINESS_LABELS.provisional
  const toolNames = item.capability_evidence?.tool_names ?? []
  const toolCount = item.capability_evidence?.tool_count || toolNames.length
  const toolCountLabel = item.capability_evidence?.tool_count_kind === 'at_least' ? `至少 ${toolCount} 个` : `${toolCount} 个`
  const capabilityPreview = toolNames.length
    ? `工具：${toolNames.slice(0, 4).join('、')}${toolCount > toolNames.length ? ` 等 ${toolCountLabel}` : toolNames.length > 4 ? ` 等 ${toolNames.length} 项` : ''}`
    : item.capability_evidence?.capability_mode === 'tool_count'
      ? `提供 ${toolCountLabel}工具`
      : null
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
          {item.rank ? <span className="text-xs font-semibold tabular-nums text-purple-700">#{item.rank}</span> : null}
          <h3 className="break-words text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</h3>
          <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ color: readiness.color, backgroundColor: readiness.background }}>
            {readiness.label}
          </span>
        </div>
        <div className="mt-1 text-base font-semibold" style={{ color: '#0f766e' }}>{item.function}</div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{getMcpPurpose(item)}</p>
        {item.recommendation_reason ? (
          <p className="mt-2 border-l-2 border-purple-500 pl-2.5 text-sm leading-6" style={{ color: '#5b21b6' }}>
            {item.recommendation_reason}
          </p>
        ) : null}
          {capabilityPreview ? <p className="mt-2 line-clamp-1 text-xs leading-5" style={{ color: toolNames.length ? '#0f766e' : 'var(--text-tertiary)' }}>{capabilityPreview}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{Math.round(item.quality_score)}</div>
          <div className="text-[10px] tracking-wide" style={{ color: 'var(--text-tertiary)' }}>资料完整度</div>
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

function McpCatalogDetail({ item }: { item: ScienceMcpCatalogItem | null }) {
  if (!item) return <AppsStatusCard>从左侧选择一个 MCP 查看详细信息。</AppsStatusCard>
  const readiness = item.readiness === 'trusted' || isTrusted(item) ? READINESS_LABELS.trusted : READINESS_LABELS.provisional
  const toolNames = item.capability_evidence?.tool_names ?? []
  const capabilityMode = item.capability_evidence?.capability_mode || (toolNames.length ? 'tool_list' : 'task_description')
  const toolCount = item.capability_evidence?.tool_count || toolNames.length
  const toolCountLabel = item.capability_evidence?.tool_count_kind === 'at_least' ? `至少 ${toolCount} 个` : `${toolCount} 个`
  const purpose = getMcpPurpose(item)
  const capabilityLabels = [...new Set((toolNames.length ? toolNames : item.capabilities ?? [])
    .map((value) => String(value).trim())
    .filter((value) => value && value.length <= 64 && !/^https?:\/\//i.test(value)))]
  const sourceFacts = [
    ['框架', item.framework],
    ['许可证', formatMcpLicense(item)],
    ['版本', item.latest_version],
    ['传输方式', item.transport?.join('、')],
    ['安装提示', item.install_command],
  ].filter(([, value]) => value)
  const licenseEvidenceUrl = item.license_evidence?.final_url || item.license_evidence?.source_url || item.source_verification?.final_url || item.source_url
  const licenseEvidenceStatus = item.license_evidence?.license_status || item.license_status
  const licenseEvidenceStatusLabel = licenseEvidenceStatus === 'identified'
    ? '已识别'
    : licenseEvidenceStatus === 'referenced'
      ? '许可证原文已记录，名称未识别'
      : licenseEvidenceStatus === 'unavailable'
        ? '来源暂不可访问'
        : '名称未识别'
  return (
    <aside
      role="region"
      aria-label={`MCP 详情：${item.name}`}
      className="self-start rounded-lg border p-4 xl:sticky xl:top-20"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>MCP 详情</div>
          <h3 className="mt-1 break-words text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</h3>
          <div className="mt-1 text-base font-semibold" style={{ color: '#0f766e' }}>{item.function}</div>
        </div>
        <span className="shrink-0 rounded px-2 py-1 text-xs font-medium" style={{ color: readiness.color, backgroundColor: readiness.background }}>
          {readiness.label}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{purpose}</p>
      {item.recommendation_reason ? (
        <p className="mt-3 border-l-2 border-purple-500 pl-3 text-sm leading-6" style={{ color: '#5b21b6' }}>
          <span className="font-semibold">推荐理由：</span>{item.recommendation_reason}
        </p>
      ) : null}
      <dl className="mt-4 divide-y text-sm" style={{ borderColor: 'var(--border-default)' }}>
        {[
          ['领域', `${item.domain} / ${item.subdomain}`],
          ['研究阶段', item.stage],
          ['功能分工', item.function],
          ['具体任务', formatMcpNarrative(item.task) || '未细分'],
        ].map(([term, value]) => (
          <div key={term} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2.5">
            <dt style={{ color: 'var(--text-tertiary)' }}>{term}</dt>
            <dd className="break-words" style={{ color: 'var(--text-primary)' }}>{value}</dd>
          </div>
        ))}
      </dl>
      {item.classification_rationale ? (
        <div className="mt-4 border-l-2 border-teal-600 pl-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold">适用说明：</span>{formatMcpNarrative(item.classification_rationale)}
        </div>
      ) : null}
      {capabilityLabels.length || capabilityMode === 'tool_count' ? <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>可用能力</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {capabilityLabels.slice(0, 8).map((capability) => (
            <span key={capability} className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'rgba(13,148,136,0.08)', color: '#0f766e' }}>{capability}</span>
          ))}
          {capabilityLabels.length > 8 ? <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>另有 {capabilityLabels.length - 8} 项</span> : null}
        </div>
        {capabilityMode === 'tool_count' ? <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>项目说明列出 {toolCountLabel}工具。</p> : null}
      </div> : null}
      <details open className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
        <summary className="cursor-pointer text-sm font-semibold text-teal-700">来源与使用信息</summary>
        {sourceFacts.length ? (
          <dl className="mt-2 space-y-1.5 text-xs">
            {sourceFacts.map(([term, value]) => <div key={term} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"><dt style={{ color: 'var(--text-tertiary)' }}>{term}</dt><dd className="break-words" style={{ color: 'var(--text-secondary)' }}>{value}</dd></div>)}
          </dl>
        ) : null}
        {licenseEvidenceUrl ? (
          <div className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
            <span>许可证：{licenseEvidenceStatusLabel}；</span>
            <a href={licenseEvidenceUrl} target="_blank" rel="noreferrer" className="text-teal-700 underline underline-offset-2">查看出处</a>
          </div>
        ) : null}
        {item.license_raw ? <p className="mt-2 line-clamp-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>许可证原文：{item.license_raw}</p> : null}
        <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>来源信息：{formatInfoPageStatus(item.information_status?.info_page ?? (item.info_page_fetched ? 'extracted' : 'not_attempted'))}；许可证出处：{formatMcpLicenseSource(item)}。</p>
      </details>
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/mcphub/${encodeURIComponent(item.id)}`}
            className="text-sm font-medium text-teal-700 underline underline-offset-4"
          >
            打开完整详情
          </Link>
          <a href={item.source_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-teal-700 underline underline-offset-4">
            查看来源仓库
          </a>
        </div>
        <p className="mt-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
          目录信息来自公开来源；采用前请结合来源说明与评测结果判断。
        </p>
      </div>
    </aside>
  )
}

export default function MCPHubPage() {
  const [finderQuery, setFinderQuery] = useState('')
  const [domain, setDomain] = useState('生命科学')
  // Keep the SkillHub three-dimensional entry point, but choose a route that
  // actually contains active MCP records instead of showing an empty graph.
  const [stage, setStage] = useState('分析验证')
  const [functionGroup, setFunctionGroup] = useState('分析推断')
  const [sortMode, setSortMode] = useState<'organized' | 'evidence' | 'tools' | 'name'>('organized')
  const [meta, setMeta] = useState<ScienceMcpCatalogMeta | null>(null)
  const [items, setItems] = useState<ScienceMcpCatalogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [graphItems, setGraphItems] = useState<ScienceMcpCatalogItem[]>([])
  const [graphTotal, setGraphTotal] = useState(0)
  const [graphLoading, setGraphLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBrowseItem, setSelectedBrowseItem] = useState<ScienceMcpCatalogItem | null>(null)
  const [selectedSearchItem, setSelectedSearchItem] = useState<ScienceMcpFinderResult | null>(null)
  const [searchResult, setSearchResult] = useState<ScienceMcpFinderResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchStatus, setSearchStatus] = useState<string | null>(null)
  const [searchPhase, setSearchPhase] = useState<FinderPhase>('understanding')
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const graphSyncRouteRef = useRef('生命科学|分析验证|分析推断')
  const catalogResultsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let alive = true
    mcpHubApi.getMeta()
      .then((response) => { if (alive) setMeta(response.data) })
      .catch(() => { if (alive) setError('科研 MCP 目录信息加载失败') })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    const routeKey = `${domain}|${stage}|${functionGroup}`
    const syncGraph = graphSyncRouteRef.current === routeKey
    const timer = window.setTimeout(() => {
      setLoading(true)
      if (syncGraph) setGraphLoading(true)
      setError(null)
      mcpHubApi.list({
        domain: domain || undefined,
        stage: stage || undefined,
        function: functionGroup || undefined,
        sort: sortMode,
        limit: 24,
        offset: 0,
      }).then((response) => {
        if (!alive) return
        setItems(response.data.list)
        setTotal(response.data.total)
        setSelectedBrowseItem((current) => response.data.list.find((item) => item.id === current?.id) || response.data.list[0] || null)
        if (syncGraph) {
          setGraphItems(response.data.list)
          setGraphTotal(response.data.total)
          setGraphLoading(false)
          if (graphSyncRouteRef.current === routeKey) graphSyncRouteRef.current = ''
        }
      }).catch(() => {
        if (alive) setError('科研 MCP 目录加载失败')
      }).finally(() => {
        if (alive) {
          setLoading(false)
          if (syncGraph) setGraphLoading(false)
        }
      })
    }, 120)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [domain, stage, functionGroup, sortMode])

  const loadMore = async () => {
    if (loading || loadingMore || searchResult || items.length >= total) return
    setLoadingMore(true)
    try {
      const response = await mcpHubApi.list({
        domain: domain || undefined,
        stage: stage || undefined,
        function: functionGroup || undefined,
        sort: sortMode,
        limit: 24,
        offset: items.length,
      })
      setItems((current) => [...current, ...response.data.list.filter((item) => !current.some((existing) => existing.id === item.id))])
    } catch {
      setError('更多科研 MCP 暂时加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const clearSearchResult = () => {
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
    setSearchResult(null)
    setSelectedSearchItem(null)
    setSearching(false)
    setSearchStatus(null)
    setSearchPhase('understanding')
    setSearchError(null)
  }

  const runSearch = async () => {
    const cleanQuery = finderQuery.trim()
    if (!cleanQuery) return
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    setDomain('')
    setStage('')
    setFunctionGroup('')
    setSortMode('organized')
    setSearching(true)
    setSearchStatus('正在理解科研需求')
    setSearchPhase('understanding')
    setSearchError(null)
    setSelectedSearchItem(null)
    setSearchResult({
      query: cleanQuery,
      route: { domain: null, stage: null, function: null, search_terms: [], rationale: '' },
      results: [],
      total: 0,
      ranking: { criteria: [] },
      driver: { orchestrator: '', provider: '', model: '', mode: 'streaming', configured: true, message: '' },
    })
    catalogResultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    try {
      await mcpHubApi.streamScienceMcps(
        { query: cleanQuery, limit: 5 },
        {
          onStatus: ({ message }) => {
            setSearchStatus(message)
            if (message.includes('复核') || message.includes('匹配')) setSearchPhase('matching')
          },
          onRoute: (route) => {
            setSearchPhase('matching')
            setSearchResult((current) => current ? { ...current, route } : current)
          },
          onResult: (result) => {
            setSearchPhase('ranking')
            setSearchStatus('正在生成推荐列表')
            setSearchResult((current) => {
              if (!current || current.results.some((item) => item.id === result.id)) return current
              const results = [...current.results, result]
              return { ...current, results, total: Math.max(current.total, results.length) }
            })
            setSelectedSearchItem((current) => current ?? result)
          },
          onDone: (payload) => {
            setSearchResult((current) => ({ ...payload, results: current?.results ?? [] }))
            setSearchStatus('推荐完成')
          },
        },
        controller.signal,
      )
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSearchResult(null)
        setSelectedSearchItem(null)
        setSearchError('搜索暂时不可用，请稍后重试。')
      }
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null
        setSearching(false)
      }
    }
  }

  const visibleItems = searchResult?.results ?? items
  const visibleTotal = searchResult ? searchResult.results.length : total
  const selectedItem = searchResult ? selectedSearchItem : selectedBrowseItem

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-page)' }}>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        <ResearchHubSwitch active="mcp" />
        <section>
          <h2 className="text-2xl font-serif font-semibold leading-tight sm:text-3xl" style={{ color: 'var(--text-primary)' }}>科研 MCP Hub</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            收录科研 MCP，按领域、研究阶段与功能分工搜索与浏览。
          </p>
          <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
            进入详情可收藏、提交评议并查看完整一手来源；候选提交会先进入待核对队列。
          </p>
        </section>

        <CriticWorkbench />

        <McpTaxonomyWorkbench
          meta={meta}
          selection={{ domain: domain || null, stage: stage || null, function: functionGroup || null }}
          items={graphItems}
          total={graphTotal}
          loading={graphLoading}
          onExplore={(route) => {
            clearSearchResult()
            graphSyncRouteRef.current = `${route.domain ?? ''}|${route.stage ?? ''}|${route.function ?? ''}`
            setLoading(true)
            setItems([])
            setDomain(route.domain ?? '')
            setStage(route.stage ?? '')
            setFunctionGroup(route.function ?? '')
            setSelectedBrowseItem(null)
          }}
        />

        <section ref={catalogResultsRef} className="mt-5 scroll-mt-20 space-y-3 border-b pb-5" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {searching ? `正在推荐 · 已找到 ${visibleItems.length} 项` : searchResult ? `推荐结果 ${visibleTotal} 项` : '科研 MCP 目录'}
              </h3>
              <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
                {searchResult ? searchResult.route.rationale : `当前路径命中 ${total} 项，可继续筛选或打开详情。`}
              </p>
              {searchResult?.ranking?.criteria.length ? (
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
                  排序：{searchResult.ranking.criteria.map((criterion) => criterion.label).join(' → ')}
                </p>
              ) : null}
              {searchResult && !searching ? (
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
                  {finderResultSourceLabel(searchResult)}
                </p>
              ) : null}
            </div>
            {searchResult && !searching ? (
              <button type="button" onClick={clearSearchResult} className="text-sm font-medium text-teal-700 underline underline-offset-4">返回目录</button>
            ) : null}
          </div>
          <FilterRail label="领域" value={domain} options={meta?.dimensions.domains ?? []} onChange={(value) => { clearSearchResult(); setDomain(value) }} />
          <FilterRail label="阶段" value={stage} options={meta?.dimensions.stages ?? []} onChange={(value) => { clearSearchResult(); setStage(value) }} />
          <FilterRail label="功能" value={functionGroup} options={meta?.dimensions.functions ?? []} onChange={(value) => { clearSearchResult(); setFunctionGroup(value) }} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {searchResult ? `当前推荐 ${visibleItems.length} 项` : `当前显示 ${items.length ? `1–${items.length}` : 0} / ${total} 项`}
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span>排列</span>
              <select
                aria-label="目录排列方式"
                value={sortMode}
                onChange={(event) => { clearSearchResult(); setSortMode(event.target.value as typeof sortMode) }}
                className="rounded-md border px-2 py-1.5 text-xs"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
              >
                <option value="organized">按领域路径</option>
                <option value="evidence">按资料核对</option>
                <option value="tools">按工具数量</option>
                <option value="name">按名称</option>
              </select>
            </label>
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); void runSearch() }}
            className="flex flex-col gap-2 border-t pt-4 sm:flex-row"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <label className="min-w-0 flex-1">
              <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>搜索科研需求</span>
              <AppsInput
                aria-label="描述科研需求"
                value={finderQuery}
                onChange={(event) => setFinderQuery(event.target.value)}
                placeholder="例如：单细胞类型注释 / predict protein structure"
                className="h-11 w-full rounded-md py-0 leading-10 outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={searching || !finderQuery.trim()}
              className="h-11 shrink-0 self-end rounded-md bg-teal-700 px-5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? '正在搜索…' : '搜索科研 MCP'}
            </button>
          </form>
          <p className="text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
            输入研究对象、数据类型或预期产物，我们会结合科研分类为你推荐合适的 MCP。
          </p>
          {searchError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm" style={{ color: 'var(--accent-error)' }}>
              <span>{searchError}</span>
              <button type="button" onClick={() => void runSearch()} className="font-medium underline underline-offset-4">重新搜索</button>
            </div>
          ) : null}
          {searching && searchStatus ? <FinderStreamProgress phase={searchPhase} status={searchStatus} count={searchResult?.results.length ?? 0} /> : null}
        </section>

        <section aria-label="科研 MCP 目录结果" className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_21rem]">
          <div className="space-y-2.5">
            {error && !searchResult ? <AppsStatusCard tone="error">{error}</AppsStatusCard> : null}
            {searching && visibleItems.length === 0 ? (
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
            {visibleItems.map((item) => (
              <McpRow
                key={item.id}
                item={item}
                selected={selectedItem?.id === item.id}
                onSelect={() => searchResult ? setSelectedSearchItem(item) : setSelectedBrowseItem(item)}
              />
            ))}
            {!searching && !loading && (!error || searchResult) && visibleItems.length === 0 ? (
              <AppsStatusCard className="py-8">
                {searchResult ? '没有找到匹配结果，请补充研究对象、当前阶段或期望产物后再搜索。' : '当前路径下没有匹配项，请减少一个筛选条件。'}
              </AppsStatusCard>
            ) : null}
            {loading && !searchResult ? <AppsStatusCard>正在读取内置目录…</AppsStatusCard> : null}
            {!searchResult && !loading && items.length < total ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full rounded-lg border px-4 py-3 text-sm font-medium transition-colors hover:border-teal-400 disabled:cursor-wait disabled:opacity-60"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: '#0f766e' }}
              >
                {loadingMore ? '正在整理下一批…' : `继续查看（还剩 ${total - items.length} 项）`}
              </button>
            ) : null}
          </div>
          <McpCatalogDetail item={selectedItem} />
        </section>
      </div>
    </div>
  )
}
