import { useState } from 'react'

export interface MobileTocSource {
  id: string
  label: string
}

export interface MobileTocCategory {
  id: string
  label: string
  sourceId: string
}

export interface MobileSourceCategoryTocProps {
  sources: MobileTocSource[]
  categoriesBySource: Record<string, MobileTocCategory[]>
  sourceOrder: string[]
  onNavigate: (id: string) => void
  visibleClass?: string
}

export default function MobileSourceCategoryToc({
  sources,
  categoriesBySource,
  sourceOrder,
  onNavigate,
  visibleClass = 'md:hidden',
}: MobileSourceCategoryTocProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    sourceOrder[0] ? `source-${sourceOrder[0]}` : null
  )

  const categories = selectedSourceId
    ? categoriesBySource[selectedSourceId] ?? []
    : sourceOrder.flatMap((s) => categoriesBySource[`source-${s}`] ?? [])

  const selectedSourceLabel = sources.find((s) => s.id === selectedSourceId)?.label ?? ''

  const scrollRowClass = 'relative overflow-x-auto scrollbar-hide'
  const scrollFadeClass =
    'pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent'

  return (
    <div className={`${visibleClass} flex-shrink-0 py-2 border-b border-gray-100 space-y-3`}>
      {/* 源 - 一级：选择来源，切换下方分类 */}
      <div>
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
          来源
        </div>
        <div className={scrollRowClass}>
          <div className="flex gap-2 min-w-max px-1 pr-4">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSourceId(s.id)}
                className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors touch-manipulation font-medium ${
                  selectedSourceId === s.id
                    ? 'bg-black text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className={scrollFadeClass} aria-hidden />
        </div>
      </div>
      {/* 分类 - 二级：点击跳转到对应区块 */}
      {categories.length > 0 && (
        <div className="pl-3 border-l-2 border-gray-200">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
            {selectedSourceLabel ? `${selectedSourceLabel} · 分类` : '分类'}
          </div>
          <div className={scrollRowClass}>
            <div className="flex gap-2 min-w-max px-1 pr-4">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onNavigate(c.id)}
                  className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 whitespace-nowrap transition-colors touch-manipulation"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className={scrollFadeClass} aria-hidden />
          </div>
        </div>
      )}
    </div>
  )
}
