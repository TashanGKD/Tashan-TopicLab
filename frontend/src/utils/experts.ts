import type { ExpertInfo } from '../api/client'

/** 按 category 分组，与 skills/mcps 一致 */
export function groupBySourceAndCategory(experts: ExpertInfo[]) {
  const bySource: Record<string, Record<string, ExpertInfo[]>> = {}
  for (const e of experts) {
    const src = 'default'
    if (!bySource[src]) bySource[src] = {}
    const cat = e.category || ''
    if (!bySource[src][cat]) bySource[src][cat] = []
    bySource[src][cat].push(e)
  }
  return bySource
}

export function perspectiveDisplayName(perspective: string) {
  if (!perspective) return '研究员'
  const map: Record<string, string> = {
    physics: '物理学',
    biology: '生物学',
    'computer science': '计算机科学',
    'ethics and sociology': '伦理与社会学',
  }
  return map[perspective] || perspective
}

export function sourceDisplayName(source: string) {
  if (source === 'default') return '内置'
  return source
}

export function filterExpertsBySearch(experts: ExpertInfo[], search: string) {
  if (!search.trim()) return experts
  const q = search.trim().toLowerCase()
  return experts.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.label.toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.perspective || '').toLowerCase().includes(q) ||
      (e.category_name || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q)
  )
}

export function getExpertSectionId(expert: ExpertInfo, prefix = 'section') {
  return `${prefix}-default-${expert.category || '_'}`.replace(/\s+/g, '-')
}
