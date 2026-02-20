import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResourceItem } from '../utils/resourceUtils'
import { groupBySourceAndCategory } from '../utils/resourceUtils'

export interface UseResourceGridOptions<T extends ResourceItem> {
  sectionIdPrefix?: string
  listItems: () => Promise<T[]>
  filterBySearch: (items: T[], search: string) => T[]
}

/**
 * 通用资源 Grid Hook，供 useSkillGrid、useMCPGrid、useModeratorModeGrid 复用。
 * 消除 list + filter + group + toc 的重复逻辑。
 */
export function useResourceGrid<T extends ResourceItem>(options: UseResourceGridOptions<T>) {
  const { sectionIdPrefix = 'section', listItems, filterBySearch } = options
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    listItems()
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [listItems])

  const filteredItems = useMemo(() => filterBySearch(items, search), [items, search, filterBySearch])

  const grouped = useMemo(() => groupBySourceAndCategory(filteredItems), [filteredItems])

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
        const groupItems = cats[catId]
        const catName = groupItems[0]?.category_name || catId || '未分类'
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

  const getItemSectionId = (item: T) =>
    `${sectionIdPrefix}-${item.source || 'default'}-${item.category || '_'}`.replace(/\s+/g, '-')

  return {
    items: filteredItems,
    allItems: items,
    grouped,
    sourceOrder,
    loading,
    search,
    setSearch,
    tocTree,
    sectionRefs,
    scrollToSection,
    getItemSectionId,
  }
}
