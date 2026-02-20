import { useCallback } from 'react'
import { skillsApi, AssignableSkill } from '../api/client'
import { useResourceGrid } from './useResourceGrid'
import { filterSkillsBySearch } from '../utils/skills'

export interface UseSkillGridOptions {
  sectionIdPrefix?: string
}

export function useSkillGrid(options: UseSkillGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const listItems = useCallback(
    () =>
      skillsApi
        .listAssignable()
        .then((res) => (Array.isArray(res.data) ? res.data : []))
        .catch(() => []),
    []
  )
  const result = useResourceGrid<AssignableSkill>({
    sectionIdPrefix,
    listItems,
    filterBySearch: filterSkillsBySearch,
  })
  return {
    skills: result.items,
    allSkills: result.allItems,
    filteredSkills: result.items,
    grouped: result.grouped,
    sourceOrder: result.sourceOrder,
    loading: result.loading,
    search: result.search,
    setSearch: result.setSearch,
    tocTree: result.tocTree,
    sectionRefs: result.sectionRefs,
    scrollToSection: result.scrollToSection,
    getSkillSectionId: result.getItemSectionId,
  }
}
