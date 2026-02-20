import { useCallback } from 'react'
import { moderatorModesApi, AssignableModeratorMode } from '../api/client'
import { useResourceGrid } from './useResourceGrid'
import { filterModeratorModesBySearch } from '../utils/moderatorModes'

export interface UseModeratorModeGridOptions {
  sectionIdPrefix?: string
}

export function useModeratorModeGrid(options: UseModeratorModeGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const listItems = useCallback(
    () =>
      moderatorModesApi
        .listAssignable()
        .then((res) => (Array.isArray(res.data) ? res.data : []))
        .catch(() => []),
    []
  )
  const result = useResourceGrid<AssignableModeratorMode>({
    sectionIdPrefix,
    listItems,
    filterBySearch: filterModeratorModesBySearch,
  })
  return {
    modes: result.items,
    allModes: result.allItems,
    filteredModes: result.items,
    grouped: result.grouped,
    sourceOrder: result.sourceOrder,
    loading: result.loading,
    search: result.search,
    setSearch: result.setSearch,
    tocTree: result.tocTree,
    sectionRefs: result.sectionRefs,
    scrollToSection: result.scrollToSection,
    getModeratorModeSectionId: result.getItemSectionId,
  }
}
