import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type {
  ScienceSkillCatalogItem,
  ScienceSkillCatalogMeta,
  ScienceSkillFinderResult,
  ScienceSkillRoute,
} from '../../api/client'


type RouteSelection = Pick<ScienceSkillRoute, 'domain' | 'stage' | 'function'>
type RouteKey = keyof RouteSelection
type NodeRegistrar = (id: string, element: HTMLElement | null) => void

type GraphEdge = {
  id: string
  kind: 'domain' | 'stage' | 'function' | 'skill'
  path: string
  tone: string
  active: boolean
  hot: boolean
}

const GRAPH_COLUMNS = [
  { key: 'domain', title: '领域', tone: '#0f766e', soft: '#f0fdfa' },
  { key: 'stage', title: '研究阶段', tone: '#2563eb', soft: '#eff6ff' },
  { key: 'function', title: '功能分工', tone: '#9f1239', soft: '#fff1f2' },
] as const

const DEFAULT_SELECTION: RouteSelection = {
  domain: '生命科学',
  stage: '执行采集',
  function: '模拟建模',
}

function readinessLabel(value: string) {
  if (value === 'trusted') return '可信'
  if (value === 'restricted') return '受限'
  return '待复核'
}

function sourceReviewLabel(value: string) {
  if (value === 'manual_confirmed' || value === 'model_assisted_full_source_review') return '已复核原文'
  if (value === 'metadata_reviewed') return '已核对目录信息'
  return '来源待核对'
}

function GraphConnections({ edges, hasFocus }: { edges: GraphEdge[]; hasFocus: boolean }) {
  return (
    <svg
      data-testid="science-graph-connections"
      className="pointer-events-none absolute inset-0 z-0 hidden h-full w-full overflow-visible lg:block"
      aria-hidden="true"
    >
      <defs>
        <filter id="skill-route-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {edges.map((edge) => {
        const emphasized = edge.active || edge.hot
        const muted = hasFocus && !emphasized
        const flowing = edge.active && edge.kind !== 'skill'
        const candidate = edge.active && edge.kind === 'skill'
        return (
          <path
            key={edge.id}
            data-edge-id={edge.id}
            data-edge-kind={edge.kind}
            data-active={edge.active ? 'true' : 'false'}
            data-hot={edge.hot ? 'true' : 'false'}
            d={edge.path}
            fill="none"
            stroke={emphasized ? edge.tone : '#94a3b8'}
            strokeWidth={candidate ? 1.5 : emphasized ? 2.2 : 1}
            strokeLinecap="round"
            opacity={muted ? 0.06 : candidate ? 0.68 : emphasized ? 0.92 : 0.24}
            filter={flowing ? 'url(#skill-route-glow)' : undefined}
            className={flowing ? 'skill-route-flow' : candidate ? 'skill-candidate-pulse' : 'transition-all duration-200'}
          />
        )
      })}
    </svg>
  )
}

function edgePath(
  kind: GraphEdge['kind'],
  from: DOMRect,
  to: DOMRect,
  container: DOMRect,
) {
  const relative = (value: number, origin: number) => value - origin
  if (kind === 'stage') {
    const x1 = relative(from.left + from.width / 2, container.left)
    const y1 = relative(from.bottom, container.top)
    const x2 = relative(to.left + to.width / 2, container.left)
    const y2 = relative(to.top, container.top)
    const bend = Math.max(30, Math.abs(y2 - y1) * 0.45)
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
  }

  const x1 = relative(from.right, container.left)
  const y1 = relative(from.top + from.height / 2, container.top)
  const x2 = relative(to.left, container.left)
  const y2 = relative(to.top + to.height / 2, container.top)
  const distance = Math.abs(x2 - x1)
  const bend = kind === 'skill' ? Math.max(8, distance * 0.45) : Math.max(28, distance * 0.46)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function TaxonomyBranch({
  nodeType,
  title,
  tone,
  soft,
  options,
  value,
  side,
  dense = false,
  hoveredNode,
  registerNode,
  onNodeFocus,
  onSelect,
}: {
  nodeType: 'domain' | 'function'
  title: string
  tone: string
  soft: string
  options: string[]
  value: string | null
  side: 'left' | 'right'
  dense?: boolean
  hoveredNode: string | null
  registerNode: NodeRegistrar
  onNodeFocus: (id: string | null) => void
  onSelect: (value: string) => void
}) {
  return (
    <section className="relative z-10 min-w-0 lg:self-center" role="group" aria-label={`${title}星簇`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tone }} aria-hidden />
          <h4 className="truncate text-sm font-semibold" style={{ color: tone }}>{title}</h4>
        </div>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{options.length}</span>
      </div>
      <div className={`grid grid-cols-2 gap-1.5 lg:grid-cols-1 ${dense ? 'xl:gap-1' : ''}`}>
        {options.map((option) => {
          const active = value === option
          const nodeId = `${nodeType}:${option}`
          const selectionDimmed = Boolean(value && !active)
          const hoverDimmed = Boolean(hoveredNode && hoveredNode !== nodeId && !active)
          const dimmed = selectionDimmed || hoverDimmed
          return (
            <div
              key={option}
              className={`relative flex min-w-0 items-center transition-all duration-200 ${side === 'left' ? 'lg:flex-row-reverse' : ''}`}
              style={{ opacity: selectionDimmed ? 0.3 : dimmed ? 0.42 : 1, transform: active ? 'translateX(0)' : undefined }}
            >
              <button
                ref={(element) => registerNode(nodeId, element)}
                type="button"
                aria-label={`知识图${title}：${option}`}
                aria-pressed={active}
                data-route-state={active ? 'selected' : selectionDimmed ? 'dimmed' : 'available'}
                onClick={() => onSelect(option)}
                onMouseEnter={() => onNodeFocus(nodeId)}
                onMouseLeave={() => onNodeFocus(null)}
                onFocus={() => onNodeFocus(nodeId)}
                onBlur={() => onNodeFocus(null)}
                className={`relative z-10 flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-white px-2.5 text-left text-xs leading-4 transition-all duration-200 hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 ${dense ? 'min-h-8 py-1' : 'min-h-9 py-1.5'}`}
                style={active
                  ? { borderColor: tone, backgroundColor: soft, color: tone, boxShadow: `0 0 0 1px ${tone}22` }
                  : { borderColor: `${tone}55`, color: 'var(--text-secondary)' }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full border"
                  style={active ? { borderColor: tone, backgroundColor: tone } : { borderColor: tone, backgroundColor: '#fff' }}
                  aria-hidden
                />
                <span className="min-w-0 truncate">{option}</span>
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ResearchStageHub({
  options,
  value,
  hoveredNode,
  registerNode,
  onNodeFocus,
  onSelect,
}: {
  options: string[]
  value: string | null
  hoveredNode: string | null
  registerNode: NodeRegistrar
  onNodeFocus: (id: string | null) => void
  onSelect: (value: string) => void
}) {
  const tone = '#2563eb'
  return (
    <section className="relative z-10 min-w-0" role="group" aria-label="研究阶段星簇">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
          <h4 className="truncate text-sm font-semibold text-blue-700">研究阶段</h4>
        </div>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{options.length}</span>
      </div>
      <div className="relative grid grid-cols-2 gap-1.5 lg:grid-cols-1">
        {options.map((option) => {
          const active = value === option
          const nodeId = `stage:${option}`
          const selectionDimmed = Boolean(value && !active)
          const hoverDimmed = Boolean(hoveredNode && hoveredNode !== nodeId && !active)
          const dimmed = selectionDimmed || hoverDimmed
          return (
            <button
              ref={(element) => registerNode(nodeId, element)}
              key={option}
              type="button"
              aria-label={`知识图研究阶段：${option}`}
              aria-pressed={active}
              data-route-state={active ? 'selected' : selectionDimmed ? 'dimmed' : 'available'}
              onClick={() => onSelect(option)}
              onMouseEnter={() => onNodeFocus(nodeId)}
              onMouseLeave={() => onNodeFocus(null)}
              onFocus={() => onNodeFocus(nodeId)}
              onBlur={() => onNodeFocus(null)}
              className="relative z-10 flex min-h-9 min-w-0 items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-left text-xs leading-4 transition-all duration-200 hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              style={{
                ...(active
                  ? { borderColor: tone, backgroundColor: '#eff6ff', color: tone, boxShadow: `0 0 0 1px ${tone}22` }
                  : { borderColor: '#93c5fd', color: 'var(--text-secondary)' }),
                opacity: selectionDimmed ? 0.3 : dimmed ? 0.42 : 1,
              }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full border"
                style={active ? { borderColor: tone, backgroundColor: tone } : { borderColor: tone, backgroundColor: '#fff' }}
                aria-hidden
              />
              <span className="min-w-0 truncate">{option}</span>
            </button>
          )
        })}
      </div>
      <div
        data-testid="stage-mobile-connector"
        className="mx-auto h-6 border-l lg:hidden"
        style={{ borderColor: value ? tone : '#94a3b8' }}
        aria-hidden
      />
      <div
        ref={(element) => registerNode('hub', element)}
        className={`relative z-10 mx-auto flex aspect-square w-24 items-center justify-center rounded-full border bg-white px-3 text-center text-sm font-semibold shadow-sm transition-all duration-300 lg:w-28 ${value ? 'skill-hub-pulse' : ''}`}
        style={{ borderColor: value ? tone : '#94a3b8', color: 'var(--text-primary)' }}
      >
        科研需求
      </div>
    </section>
  )
}

function MobileFlowConnector({ active }: { active: boolean }) {
  return <div className="mx-auto h-7 border-l lg:hidden" style={{ borderColor: active ? '#64748b' : '#cbd5e1' }} aria-hidden />
}

export default function FindScienceWorkbench({
  meta,
  exploreSkills,
  exploreTotal,
  exploreLoading,
  onExplore,
}: {
  meta: ScienceSkillCatalogMeta | null
  exploreSkills: ScienceSkillCatalogItem[]
  exploreTotal: number
  exploreLoading: boolean
  onExplore: (route: RouteSelection) => void
}) {
  const [selection, setSelection] = useState<RouteSelection>(DEFAULT_SELECTION)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const resultRegionRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const columns = useMemo(() => [
    meta?.dimensions.domains ?? [],
    meta?.dimensions.stages ?? [],
    meta?.dimensions.functions ?? [],
  ], [meta])
  const activeSteps = GRAPH_COLUMNS.filter((column) => Boolean(selection[column.key])).length
  const graphSkills = useMemo<ScienceSkillFinderResult[]>(() => activeSteps === 3
    ? exploreSkills.slice(0, 6).map((item, index) => ({ ...item, rank: index + 1 }))
    : [], [activeSteps, exploreSkills])
  const defaultPreviewSkillId = activeSteps === 3 ? graphSkills[0]?.id ?? null : null
  const focusedSkillId = selectedSkillId ?? defaultPreviewSkillId

  const registerNode: NodeRegistrar = (id, element) => {
    if (element) nodeRefs.current.set(id, element)
    else nodeRefs.current.delete(id)
  }

  useLayoutEffect(() => {
    const graph = graphRef.current
    const hub = nodeRefs.current.get('hub')
    if (!graph || !hub) return

    const measure = () => {
      const containerRect = graph.getBoundingClientRect()
      const nextEdges: GraphEdge[] = []
      const append = (
        id: string,
        kind: GraphEdge['kind'],
        fromId: string,
        toId: string,
        tone: string,
        active: boolean,
      ) => {
        const from = nodeRefs.current.get(fromId)
        const to = nodeRefs.current.get(toId)
        if (!from || !to) return
        nextEdges.push({
          id,
          kind,
          path: edgePath(kind, from.getBoundingClientRect(), to.getBoundingClientRect(), containerRect),
          tone,
          active,
          hot: hoveredNode === fromId || hoveredNode === toId,
        })
      }

      for (const domain of meta?.dimensions.domains ?? []) {
        append(`domain:${domain}`, 'domain', `domain:${domain}`, 'hub', '#0f766e', selection.domain === domain)
      }
      for (const stage of meta?.dimensions.stages ?? []) {
        append(`stage:${stage}`, 'stage', `stage:${stage}`, 'hub', '#2563eb', selection.stage === stage)
      }
      for (const fn of meta?.dimensions.functions ?? []) {
        append(`function:${fn}`, 'function', 'hub', `function:${fn}`, '#be123c', selection.function === fn)
      }
      if (graphSkills.length > 0 && selection.function) {
        for (const item of graphSkills) {
          append(
            `skill:${item.id}`,
            'skill',
            `function:${selection.function}`,
            `skill:${item.id}`,
            '#7e22ce',
            focusedSkillId ? focusedSkillId === item.id : true,
          )
        }
      }
      setEdges(nextEdges)
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resizeObserver?.observe(graph)
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [focusedSkillId, graphSkills, hoveredNode, meta, selection.domain, selection.function, selection.stage])

  const selectNode = (key: RouteKey, value: string) => {
    const nextSelection = {
      ...selection,
      [key]: selection[key] === value ? null : value,
    }
    setSelection(nextSelection)
    setSelectedSkillId(null)
    onExplore(nextSelection)
  }

  const resetGraph = () => {
    const empty = { domain: null, stage: null, function: null }
    setSelection(empty)
    setSelectedSkillId(null)
    onExplore(empty)
  }

  const showSkillBranch = activeSteps === 3
  const selectedSkill = graphSkills.find((item) => item.id === focusedSkillId) ?? null
  const selectedSourceUrl = selectedSkill?.source_repository
    ? (selectedSkill.source_repository.startsWith('http')
        ? selectedSkill.source_repository
        : `https://github.com/${selectedSkill.source_repository}`)
    : null

  return (
    <section
      className="mt-5 overflow-hidden rounded-lg border"
      style={{ borderColor: '#cbd5e1', backgroundColor: 'var(--bg-container)' }}
      aria-labelledby="science-wiki-title"
    >
      <div className="border-b px-4 py-4 sm:px-5" style={{ borderColor: 'var(--border-default)', backgroundColor: '#f8fafc' }}>
        <h3 id="science-wiki-title" className="text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
          科研技能 Wiki
        </h3>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          默认示例：生命科学 → 执行采集 → 模拟建模。也可点选节点逐层浏览其他路径。
        </p>
      </div>

      <div
        className="relative p-4 sm:p-5"
        style={{
          backgroundColor: '#fbfdff',
          backgroundImage: 'radial-gradient(circle, #cbd5e1 0.7px, transparent 0.8px)',
          backgroundSize: '18px 18px',
        }}
      >
        <style>{`
          @keyframes skillRouteFlow {
            to { stroke-dashoffset: -36; }
          }
          @keyframes skillHubPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.14); }
            50% { box-shadow: 0 0 0 10px rgba(37, 99, 235, 0); }
          }
          @keyframes skillLeafReveal {
            from { opacity: 0; transform: translateX(-10px); }
            to { opacity: 1; transform: translateX(0); }
          }
          @keyframes skillCandidatePulse {
            0%, 100% { opacity: 0.42; }
            50% { opacity: 0.76; }
          }
          .skill-route-flow {
            stroke-dasharray: 8 10;
            animation: skillRouteFlow 1.4s linear infinite;
          }
          .skill-candidate-pulse { animation: skillCandidatePulse 2s ease-in-out infinite; }
          .skill-hub-pulse { animation: skillHubPulse 2.4s ease-in-out infinite; }
          .skill-leaf-reveal { animation: skillLeafReveal 360ms ease-out both; }
          @media (prefers-reduced-motion: reduce) {
            .skill-route-flow, .skill-candidate-pulse, .skill-hub-pulse, .skill-leaf-reveal { animation: none; }
          }
        `}</style>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>点选节点浏览，逐层缩小技能范围</p>
          <button
            type="button"
            onClick={resetGraph}
            className="text-xs underline underline-offset-4 disabled:no-underline disabled:opacity-40"
            style={{ color: 'var(--text-secondary)' }}
            disabled={activeSteps === 0}
          >
            查看全图
          </button>
        </div>

        {activeSteps === 3 && graphSkills.length > 0 ? (
          <button
            type="button"
            aria-label={`查看 ${exploreTotal} 项匹配技能`}
            onClick={() => resultRegionRef.current?.focus()}
            className="mb-5 flex w-full items-center justify-between rounded-md border border-purple-200 bg-purple-50 px-3 py-2.5 text-sm font-semibold text-purple-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30 lg:hidden"
          >
            <span>查看匹配技能</span>
            <span className="tabular-nums">{exploreTotal} 项 ↓</span>
          </button>
        ) : null}

        <div
          role="status"
          aria-label="当前筛选路径"
          className="mb-5 grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-stretch overflow-hidden rounded-md border bg-white/80"
          style={{ borderColor: '#cbd5e1' }}
        >
          {GRAPH_COLUMNS.map((column, index) => {
            const value = selection[column.key]
            return (
              <div
                key={column.key}
                className={`min-w-0 px-2.5 py-2 sm:px-3 ${index > 0 ? 'border-l' : ''}`}
                style={{ borderColor: '#e2e8f0' }}
              >
                <div className="text-[10px] font-medium" style={{ color: column.tone }}>{column.title}</div>
                <div
                  className="mt-0.5 truncate text-xs font-semibold"
                  style={{ color: value ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                >
                  {value ?? '待选择'}
                </div>
              </div>
            )
          })}
          <div className="flex min-w-12 items-center justify-center border-l px-2 text-xs font-semibold tabular-nums" style={{ borderColor: '#e2e8f0', color: activeSteps === 3 ? '#0f766e' : 'var(--text-tertiary)' }}>
            {activeSteps} / 3
          </div>
        </div>

        <div
          ref={graphRef}
          role="group"
          aria-label="科研能力沙漏图"
          className={`relative isolate grid grid-cols-1 items-start ${showSkillBranch
            ? 'lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.68fr)_minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-5'
            : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)_minmax(0,1.15fr)] lg:gap-7'}`}
        >
          <GraphConnections edges={edges} hasFocus={Boolean(hoveredNode)} />
          <TaxonomyBranch
            nodeType="domain"
            title="领域"
            tone="#0f766e"
            soft="#f0fdfa"
            options={columns[0]}
            value={selection.domain}
            side="right"
            hoveredNode={hoveredNode}
            registerNode={registerNode}
            onNodeFocus={setHoveredNode}
            onSelect={(value) => selectNode('domain', value)}
          />
          <MobileFlowConnector active={Boolean(selection.domain)} />
          <ResearchStageHub
            options={columns[1]}
            value={selection.stage}
            hoveredNode={hoveredNode}
            registerNode={registerNode}
            onNodeFocus={setHoveredNode}
            onSelect={(value) => selectNode('stage', value)}
          />
          <MobileFlowConnector active={Boolean(selection.stage)} />
          <TaxonomyBranch
            nodeType="function"
            title="功能分工"
            tone="#9f1239"
            soft="#fff1f2"
            options={columns[2]}
            value={selection.function}
            side="left"
            dense
            hoveredNode={hoveredNode}
            registerNode={registerNode}
            onNodeFocus={setHoveredNode}
            onSelect={(value) => selectNode('function', value)}
          />

          {showSkillBranch ? (
            <>
              <MobileFlowConnector active={graphSkills.length > 0} />
              <section
                ref={resultRegionRef}
                role="region"
                aria-label="科研技能筛选结果"
                aria-live="polite"
                tabIndex={-1}
                className="skill-leaf-reveal relative z-10 scroll-mt-16 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30 lg:ml-2 lg:self-center"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-purple-700" aria-hidden />
                    <h4 className="truncate text-sm font-semibold text-purple-800">匹配技能</h4>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{exploreTotal} 项</span>
                    <button
                      type="button"
                      onClick={resetGraph}
                      className="text-xs font-medium underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30"
                      style={{ color: '#0f766e' }}
                    >
                      返回全图
                    </button>
                  </div>
                </div>
                <p className="mb-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                  已按三维路径筛选，以下技能采用固定规则稳定排序。
                </p>
                {activeSteps === 3 ? (
                  <p className="mb-3 rounded border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
                    排序：功能偏好 → 可信状态 → 质量分 → 名称
                  </p>
                ) : null}
                {exploreLoading ? (
                  <div role="status" className="border-l-2 bg-white/80 px-3 py-3 text-sm" style={{ borderColor: '#7e22ce', color: 'var(--text-secondary)' }}>
                    正在展开 Skill 叶节点…
                  </div>
                ) : graphSkills.length > 0 ? (
                  <>
                    <div className="relative grid gap-1.5" role="group" aria-label="Skill 叶节点">
                      {graphSkills.map((item, index) => {
                        const nodeId = `skill:${item.id}`
                        const active = focusedSkillId === item.id
                        const dimmed = Boolean(hoveredNode && hoveredNode !== nodeId && !active)
                        return (
                        <div
                          key={item.id}
                          className="relative min-w-0 transition-opacity duration-200"
                          style={{ opacity: dimmed ? 0.34 : 1 }}
                        >
                          <div
                            className="skill-leaf-reveal flex min-w-0 items-center"
                            style={{ animationDelay: `${index * 55}ms` }}
                          >
                          <button
                            ref={(element) => registerNode(nodeId, element)}
                            type="button"
                            aria-label={`查看技能：${item.name}`}
                            aria-pressed={active}
                            onClick={() => setSelectedSkillId(active ? null : item.id)}
                            onMouseEnter={() => setHoveredNode(nodeId)}
                            onMouseLeave={() => setHoveredNode(null)}
                            onFocus={() => setHoveredNode(nodeId)}
                            onBlur={() => setHoveredNode(null)}
                            className="min-h-10 min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-left transition-all duration-200 hover:-translate-y-px hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                            style={active
                              ? { borderColor: '#7e22ce', backgroundColor: '#faf5ff' }
                              : { borderColor: '#d8b4fe' }}
                          >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-[11px] font-semibold tabular-nums" style={{ color: '#7e22ce' }}>#{item.rank ?? index + 1}</span>
                                <div className="truncate text-sm font-semibold" style={{ color: '#6b21a8' }}>{item.name}</div>
                              </div>
                              <div className="mt-1 truncate text-sm font-semibold" style={{ color: '#0f766e' }}>{item.function}</div>
                              <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                              <span className="truncate">{item.task || item.subdomain}</span>
                              {item.ranking_signals ? <span className="shrink-0 tabular-nums">匹配 {item.ranking_signals.task_match}</span> : null}
                            </div>
                          </button>
                          </div>
                        </div>
                      )})}
                    </div>
                    {selectedSkill ? (
                      <section
                        className="mt-3 border-l-2 bg-white/90 px-3 py-3"
                        style={{ borderColor: '#7e22ce' }}
                        aria-label={`技能详情：${selectedSkill.name}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h5 className="min-w-0 truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedSkill.name}</h5>
                          <span className="shrink-0 text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{selectedSkill.quality_score} 分</span>
                        </div>
                        <div className="mt-1 text-base font-semibold" style={{ color: '#0f766e' }}>{selectedSkill.function}</div>
                        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{selectedSkill.summary}</p>
                        {selectedSkill.recommendation_reason ? (
                          <p className="mt-2 text-xs leading-5" style={{ color: '#5b21b6' }}>
                            <span className="font-semibold">推荐理由：</span>{selectedSkill.recommendation_reason}
                          </p>
                        ) : null}
                        <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {selectedSkill.domain} / {selectedSkill.subdomain}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          <span>
                            {readinessLabel(selectedSkill.ranking_signals?.readiness ?? selectedSkill.readiness)} · {' '}
                            {sourceReviewLabel(selectedSkill.ranking_signals?.source_review ?? selectedSkill.review_status)}
                          </span>
                          {selectedSourceUrl ? (
                            <a href={selectedSourceUrl} target="_blank" rel="noreferrer" className="font-medium text-purple-800 underline underline-offset-4">
                              查看来源
                            </a>
                          ) : null}
                        </div>
                      </section>
                    ) : null}
                  </>
                ) : (
                  <div role="status" className="border-l-2 bg-amber-50 px-4 py-3" style={{ borderColor: '#d97706' }}>
                    <h4 className="text-sm font-semibold" style={{ color: '#92400e' }}>没有找到可靠匹配</h4>
                    <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                      请补充研究对象、当前阶段或期望产物后再搜索。
                    </p>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>

      </div>
    </section>
  )
}
