import type { AssignableModeratorMode } from '../api/client'

export function groupBySourceAndCategory(modes: AssignableModeratorMode[]) {
  const bySource: Record<string, Record<string, AssignableModeratorMode[]>> = {}
  for (const m of modes) {
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

export function filterModeratorModesBySearch(modes: AssignableModeratorMode[], search: string) {
  if (!search.trim()) return modes
  const q = search.trim().toLowerCase()
  return modes.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q) ||
      (m.category_name || '').toLowerCase().includes(q) ||
      (m.category || '').toLowerCase().includes(q) ||
      (m.source || '').toLowerCase().includes(q) ||
      (m.convergence_strategy || '').toLowerCase().includes(q)
  )
}

export function getModeratorModeSectionId(mode: AssignableModeratorMode, prefix = 'section') {
  return `${prefix}-${mode.source || 'default'}-${mode.category || '_'}`.replace(/\s+/g, '-')
}
