/**
 * 通用资源工具函数，供 skills、mcps、moderatorModes 等复用。
 * 消除 groupBySourceAndCategory、filterBySearch、getSectionId 的重复实现。
 */

export interface ResourceItem {
  source?: string
  category?: string
  category_name?: string
}

/** 按 source、category 分组 */
export function groupBySourceAndCategory<T extends ResourceItem>(
  items: T[]
): Record<string, Record<string, T[]>> {
  const bySource: Record<string, Record<string, T[]>> = {}
  for (const item of items) {
    const src = item.source || 'default'
    if (!bySource[src]) bySource[src] = {}
    const cat = item.category || ''
    if (!bySource[src][cat]) bySource[src][cat] = []
    bySource[src][cat].push(item)
  }
  return bySource
}

/** 生成 sectionId */
export function getSectionId<T extends ResourceItem>(item: T, prefix = 'section'): string {
  return `${prefix}-${item.source || 'default'}-${item.category || '_'}`.replace(/\s+/g, '-')
}

/** 创建按关键词过滤函数 */
export function createFilterBySearch<T>(
  getSearchableFields: (item: T) => (string | undefined)[]
) {
  return (items: T[], search: string): T[] => {
    if (!search.trim()) return items
    const q = search.trim().toLowerCase()
    return items.filter((item) =>
      getSearchableFields(item).some((f) => (f || '').toLowerCase().includes(q))
    )
  }
}

/** 资源来源显示名 */
export function sourceDisplayName(source: string) {
  if (source === 'default') return '内置'
  return source
}
