import { useEffect, useMemo, useRef, useState } from 'react'
import { skillsApi, AssignableSkill } from '../api/client'
import {
  groupBySourceAndCategory,
  filterSkillsBySearch,
  getSkillSectionId as getSectionId,
} from '../utils/skills'

export interface UseSkillGridOptions {
  sectionIdPrefix?: string
}

export function useSkillGrid(options: UseSkillGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const [skills, setSkills] = useState<AssignableSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    skillsApi
      .listAssignable()
      .then((res) => setSkills(Array.isArray(res.data) ? res.data : []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [])

  const filteredSkills = useMemo(
    () => filterSkillsBySearch(skills, search),
    [skills, search]
  )

  const grouped = useMemo(() => groupBySourceAndCategory(filteredSkills), [filteredSkills])

  const sourceOrder = useMemo(
    () =>
      Object.keys(grouped).sort((a, b) =>
        a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)
      ),
    [grouped]
  )

  const tocTree = useMemo(() => {
    const t: Record<string, { id: string; label: string }[]> = {}
    for (const source of sourceOrder) {
      const cats = grouped[source]
      const catKeys = Object.keys(cats).sort((a, b) =>
        a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)
      )
      t[source] = catKeys.map((catId) => {
        const items = cats[catId]
        const catName = items[0]?.category_name || catId || '未分类'
        const sectionId = `${sectionIdPrefix}-${source}-${catId || '_'}`.replace(/\s+/g, '-')
        return { id: sectionId, label: catName }
      })
    }
    return t
  }, [grouped, sourceOrder, sectionIdPrefix])

  const scrollToSection = (id: string) => {
    const el = sectionRefs.current[id]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const getSkillSectionId = (skill: AssignableSkill) =>
    getSectionId(skill, sectionIdPrefix)

  return {
    skills: filteredSkills,
    allSkills: skills,
    filteredSkills,
    grouped,
    sourceOrder,
    loading,
    search,
    setSearch,
    tocTree,
    sectionRefs,
    scrollToSection,
    getSkillSectionId,
  }
}
