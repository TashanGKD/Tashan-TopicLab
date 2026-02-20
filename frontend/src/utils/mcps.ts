import type { AssignableMCP } from '../api/client'

export function groupBySourceAndCategory(mcps: AssignableMCP[]) {
  const bySource: Record<string, Record<string, AssignableMCP[]>> = {}
  for (const m of mcps) {
    const src = m.source || 'default'
    if (!bySource[src]) bySource[src] = {}
    const cat = m.category || ''
    if (!bySource[src][cat]) bySource[src][cat] = []
    bySource[src][cat].push(m)
  }
  return bySource
}

export function sourceDisplayName(source: string) {
  if (source === 'default') return '内置'
  return source
}

export function filterMcpsBySearch(mcps: AssignableMCP[], search: string) {
  if (!search.trim()) return mcps
  const q = search.trim().toLowerCase()
  return mcps.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q) ||
      (m.category_name || '').toLowerCase().includes(q) ||
      (m.category || '').toLowerCase().includes(q) ||
      (m.source || '').toLowerCase().includes(q)
  )
}

export function getMcpSectionId(mcp: AssignableMCP, prefix = 'section') {
  return `${prefix}-${mcp.source || 'default'}-${mcp.category || '_'}`.replace(/\s+/g, '-')
}
