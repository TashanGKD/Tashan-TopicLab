import type { AssignableSkill } from '../api/client'

export function groupBySourceAndCategory(skills: AssignableSkill[]) {
  const bySource: Record<string, Record<string, AssignableSkill[]>> = {}
  for (const s of skills) {
    const src = s.source || 'default'
    if (!bySource[src]) bySource[src] = {}
    const cat = s.category || ''
    if (!bySource[src][cat]) bySource[src][cat] = []
    bySource[src][cat].push(s)
  }
  return bySource
}

export function sourceDisplayName(source: string) {
  if (source === 'default') return '内置'
  return source
}

export function filterSkillsBySearch(skills: AssignableSkill[], search: string) {
  if (!search.trim()) return skills
  const q = search.trim().toLowerCase()
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.category_name || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q) ||
      (s.source || '').toLowerCase().includes(q)
  )
}

export function getSkillSectionId(skill: AssignableSkill, prefix = 'section') {
  return `${prefix}-${skill.source || 'default'}-${skill.category || '_'}`.replace(/\s+/g, '-')
}
