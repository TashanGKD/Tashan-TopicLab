import { useEffect, useMemo, useRef, useState } from 'react'
import { mcpApi, AssignableMCP } from '../api/client'
import {
  groupBySourceAndCategory,
  filterMcpsBySearch,
  getMcpSectionId as getSectionId,
} from '../utils/mcps'

export interface UseMCPGridOptions {
  sectionIdPrefix?: string
}

export function useMCPGrid(options: UseMCPGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const [mcps, setMcps] = useState<AssignableMCP[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    mcpApi
      .listAssignable()
      .then((res) => setMcps(Array.isArray(res.data) ? res.data : []))
      .catch(() => setMcps([]))
      .finally(() => setLoading(false))
  }, [])

  const filteredMcps = useMemo(
    () => filterMcpsBySearch(mcps, search),
    [mcps, search]
  )

  const grouped = useMemo(() => groupBySourceAndCategory(filteredMcps), [filteredMcps])

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

  const getMcpSectionId = (mcp: AssignableMCP) =>
    getSectionId(mcp, sectionIdPrefix)

  return {
    mcps: filteredMcps,
    allMcps: mcps,
    filteredMcps,
    grouped,
    sourceOrder,
    loading,
    search,
    setSearch,
    tocTree,
    sectionRefs,
    scrollToSection,
    getMcpSectionId,
  }
}
