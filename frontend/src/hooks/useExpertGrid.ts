import { useEffect, useMemo, useRef, useState } from 'react'
import { expertsApi, ExpertInfo } from '../api/client'
import {
  groupBySourceAndCategory,
  filterExpertsBySearch,
  getExpertSectionId as getSectionId,
} from '../utils/experts'

export interface UseExpertGridOptions {
  sectionIdPrefix?: string
}

export function useExpertGrid(options: UseExpertGridOptions = {}) {
  const { sectionIdPrefix = 'section' } = options
  const [experts, setExperts] = useState<ExpertInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    expertsApi
      .list()
      .then((res) => setExperts(Array.isArray(res.data) ? res.data : []))
      .catch(() => setExperts([]))
      .finally(() => setLoading(false))
  }, [])

  const filteredExperts = useMemo(
    () => filterExpertsBySearch(experts, search),
    [experts, search]
  )

  const grouped = useMemo(() => groupBySourceAndCategory(filteredExperts), [filteredExperts])

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
        const catName = items[0]?.category_name || catId || '学者'
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

  const getExpertSectionId = (expert: ExpertInfo) => getSectionId(expert, sectionIdPrefix)

  return {
    experts: filteredExperts,
    allExperts: experts,
    filteredExperts,
    grouped,
    sourceOrder,
    loading,
    search,
    setSearch,
    tocTree,
    sectionRefs,
    scrollToSection,
    getExpertSectionId,
  }
}
