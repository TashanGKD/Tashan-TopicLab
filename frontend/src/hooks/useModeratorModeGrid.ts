import { useEffect, useMemo, useRef, useState } from 'react'
import { moderatorModesApi, AssignableModeratorMode } from '../api/client'
import {
  groupBySourceAndCategory,
  filterModeratorModesBySearch,
  getModeratorModeSectionId as getSectionId,
} from '../utils/moderatorModes'

export interface UseModeratorModeGridOptions {
  sectionIdPrefix?: string
}

export function useModeratorModeGrid(options: UseModeratorModeGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const [modes, setModes] = useState<AssignableModeratorMode[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    moderatorModesApi
      .listAssignable()
      .then((res) => setModes(Array.isArray(res.data) ? res.data : []))
      .catch(() => setModes([]))
      .finally(() => setLoading(false))
  }, [])

  const filteredModes = useMemo(
    () => filterModeratorModesBySearch(modes, search),
    [modes, search]
  )

  const grouped = useMemo(() => groupBySourceAndCategory(filteredModes), [filteredModes])

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

  const getModeratorModeSectionId = (mode: AssignableModeratorMode) =>
    getSectionId(mode, sectionIdPrefix)

  return {
    modes: filteredModes,
    allModes: modes,
    filteredModes,
    grouped,
    sourceOrder,
    loading,
    search,
    setSearch,
    tocTree,
    sectionRefs,
    scrollToSection,
    getModeratorModeSectionId,
  }
}
