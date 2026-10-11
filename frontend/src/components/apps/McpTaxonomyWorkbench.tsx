import { useMemo } from 'react'

import type {
  ScienceMcpCatalogItem,
  ScienceMcpCatalogMeta,
  ScienceSkillCatalogItem,
  ScienceSkillCatalogMeta,
} from '../../api/client'
import FindScienceWorkbench, {
  type ScienceWorkbenchRouteSelection,
} from './FindScienceWorkbench'

export type McpRouteSelection = ScienceWorkbenchRouteSelection

function toSkillMeta(meta: ScienceMcpCatalogMeta | null): ScienceSkillCatalogMeta | null {
  if (!meta) return null
  const source = meta.source ?? {}
  return {
    schema: meta.schema,
    total: meta.total,
    source_skill_count: meta.total,
    excluded_non_scientific_count: 0,
    dimensions: meta.dimensions,
    source: {
      repository: String(source.repository ?? 'Tashan TopicLab'),
      path: String(source.path ?? 'science-mcp-catalog.json'),
      sha256: String(source.sha256 ?? ''),
    },
  }
}

function toSkillItem(item: ScienceMcpCatalogItem): ScienceSkillCatalogItem {
  const trusted = item.status === 'verified_source' || item.evidence_scope === 'source_reviewed'
  return {
    id: item.id,
    name: item.name,
    summary: item.summary,
    domain: item.domain,
    subdomain: item.subdomain,
    stage: item.stage,
    function: item.function,
    task: item.task || item.function,
    classification_rationale: item.classification_rationale,
    quality_score: trusted ? 90 : 70,
    readiness: trusted ? 'trusted' : 'provisional',
    review_status: item.evidence_scope,
    source_repository: item.source_url,
    source_path: item.source_url,
    source_verification: {
      status: item.evidence_scope,
      checked_at: item.reviewed_at ?? null,
      observed_path: item.source_url,
      evidence_report_sha256: null,
      review_required: !trusted,
    },
  }
}

export default function McpTaxonomyWorkbench({
  meta,
  selection,
  items,
  total,
  loading,
  onExplore,
}: {
  meta: ScienceMcpCatalogMeta | null
  selection: McpRouteSelection
  items: ScienceMcpCatalogItem[]
  total: number
  loading: boolean
  onExplore: (route: McpRouteSelection) => void
}) {
  const skillMeta = toSkillMeta(meta)
  const skillItems = useMemo(() => items.map(toSkillItem), [items])

  return (
    <FindScienceWorkbench
      meta={skillMeta}
      exploreSkills={skillItems}
      exploreTotal={total}
      exploreLoading={loading}
      selection={selection}
      initialSelection={selection}
      onExplore={onExplore}
      labels={{
        title: '按研究路径浏览 MCP',
        description: '依次选择研究领域、阶段和功能，查看适合当前任务的 MCP。',
        resourceName: 'MCP',
        resourcePlural: 'MCP',
        resourceAriaName: 'MCP',
        showQualityScore: false,
      }}
    />
  )
}
