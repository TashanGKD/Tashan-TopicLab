import { useCallback } from 'react'
import { mcpApi, AssignableMCP } from '../api/client'
import { useResourceGrid } from './useResourceGrid'
import { filterMcpsBySearch } from '../utils/mcps'

export interface UseMCPGridOptions {
  sectionIdPrefix?: string
}

export function useMCPGrid(options: UseMCPGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const listItems = useCallback(
    () =>
      mcpApi
        .listAssignable()
        .then((res) => (Array.isArray(res.data) ? res.data : []))
        .catch(() => []),
    []
  )
  const result = useResourceGrid<AssignableMCP>({
    sectionIdPrefix,
    listItems,
    filterBySearch: filterMcpsBySearch,
  })
  return {
    mcps: result.items,
    allMcps: result.allItems,
    filteredMcps: result.items,
    grouped: result.grouped,
    sourceOrder: result.sourceOrder,
    loading: result.loading,
    search: result.search,
    setSearch: result.setSearch,
    tocTree: result.tocTree,
    sectionRefs: result.sectionRefs,
    scrollToSection: result.scrollToSection,
    getMcpSectionId: result.getItemSectionId,
  }
}
