import type { ExpertInfo } from '../api/client'

/** 按 perspective 分组：source 固定为 default，category 为 perspective */
export function groupBySourceAndCategory(experts: ExpertInfo[]) {
  const bySource: Record<string, Record<string, ExpertInfo[]>> = {}
  for (const e of experts) {
    const src = 'default'
    if (!bySource[src]) bySource[src] = {}
    const cat = e.perspective || ''
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
      (e.perspective || '').toLowerCase().includes(q)
  )
}

export function getExpertSectionId(expert: ExpertInfo, prefix = 'section') {
  return `${prefix}-default-${expert.perspective || '_'}`.replace(/\s+/g, '-')
}
