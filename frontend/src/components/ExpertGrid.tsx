import { useMemo } from 'react'
import { useExpertGrid } from '../hooks/useExpertGrid'
import SourceCategoryToc from './SourceCategoryToc'
import ResizableToc from './ResizableToc'
import MobileSourceCategoryToc from './MobileSourceCategoryToc'
import ExpertCard, { ExpertChip } from './ExpertCard'
import { sourceDisplayName } from '../utils/experts'
import type { ExpertInfo } from '../api/client'

interface ExpertGridViewProps {
  mode?: 'view'
  layout?: 'page' | 'embed'
  placeholder?: string
  maxHeight?: string
  fillHeight?: boolean
  onExpertClick: (expert: ExpertInfo) => void
}

interface ExpertGridSelectProps {
  mode: 'select'
  layout?: 'page' | 'embed'
  placeholder?: string
  maxHeight?: string
  fillHeight?: boolean
  value: string[]
  onChange: (names: string[]) => void
  onExpertClick?: (expert: ExpertInfo) => void
  selectedExperts: { name: string; label: string }[]
  onEdit?: (name: string) => void
  onShare?: (name: string) => void
}

type ExpertGridProps = ExpertGridViewProps | ExpertGridSelectProps

function renderGridContent(
  props: ExpertGridProps,
  grouped: Record<string, Record<string, ExpertInfo[]>>,
  sourceOrder: string[],
  sectionIdPrefix: string,
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
) {
  const isSelect = props.mode === 'select'
  return (
    <>
      {sourceOrder.map((source) => {
        const cats = grouped[source]
        const catKeys = Object.keys(cats).sort((a, b) =>
          a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)
        )
        return (
          <div key={source} className="border-b border-gray-100 last:border-b-0">
            <div
              id={`source-${source}`}
              ref={(el) => { sectionRefs.current[`source-${source}`] = el }}
              className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 sticky top-0 z-10 scroll-mt-6"
            >
              <h3 className="text-xs font-serif font-semibold text-black uppercase tracking-wide">
                {sourceDisplayName(source)}
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {catKeys.map((catId) => {
                const items = cats[catId]
                const catName = items[0]?.category_name || catId || '学者'
                const sectionId = `${sectionIdPrefix}-${source}-${catId || '_'}`.replace(/\s+/g, '-')
                return (
                  <div
                    key={catId || '_'}
                    id={sectionId}
                    ref={(el) => { sectionRefs.current[sectionId] = el }}
                    className="p-3 scroll-mt-6"
                  >
                    <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      {catName}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                      {items.map((e) =>
                        !isSelect ? (
                          <ExpertCard
                            key={e.name}
                            expert={e}
                            mode="view"
                            onClick={(props as ExpertGridViewProps).onExpertClick}
                            descriptionLines={2}
                            showName
                          />
                        ) : (
                          <ExpertCard
                            key={e.name}
                            expert={e}
                            mode="select"
                            isSelected={(props as ExpertGridSelectProps).value.includes(e.name)}
                            onToggle={(expert) => {
                              const p = props as ExpertGridSelectProps
                              if (p.value.includes(expert.name)) {
                                p.onChange(p.value.filter((x: string) => x !== expert.name))
                              } else {
                                p.onChange([...p.value, expert.name])
                              }
                            }}
                            onDetailClick={(props as ExpertGridSelectProps).onExpertClick}
                          />
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

export default function ExpertGrid(props: ExpertGridProps) {
  const {
    mode = 'view',
    layout = 'page',
    placeholder = '搜索角色名称、描述、领域...',
    maxHeight = '400px',
    fillHeight = false,
  } = props

  const sectionIdPrefix = layout === 'embed' ? 'expert-section' : 'section'
  const {
    allExperts,
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
  } = useExpertGrid({ sectionIdPrefix })

  const expertByName = useMemo(() => Object.fromEntries(allExperts.map((e) => [e.name, e])), [allExperts])

  const mobileTocData = useMemo(() => {
    const sources = sourceOrder.map((s) => ({
      id: `source-${s}`,
      label: sourceDisplayName(s),
    }))
    const categoriesBySource: Record<string, { id: string; label: string; sourceId: string }[]> = {}
    for (const source of sourceOrder) {
      const sid = `source-${source}`
      categoriesBySource[sid] = (tocTree[source] || []).map((c) => ({
        id: c.id,
        label: c.label,
        sourceId: sid,
      }))
    }
    return { sources, categoriesBySource }
  }, [tocTree, sourceOrder])

  const isFill = layout === 'embed' && fillHeight
  const rootClass = isFill ? 'flex flex-col h-full min-h-0' : 'space-y-3'
  const gridHeightStyle = isFill ? undefined : layout === 'embed' ? { maxHeight } : undefined

  const searchInput = (
    <input
      type="text"
      placeholder={placeholder}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className={
        isFill
          ? 'w-full flex-shrink-0 bg-gray-50 border-0 border-b border-gray-100 rounded-none px-3 py-2 text-sm font-serif placeholder-gray-400 focus:outline-none focus:border-gray-300 transition-colors'
          : 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-serif placeholder-gray-400 focus:border-black focus:outline-none transition-colors'
      }
    />
  )

  const selectedChipsSection =
    props.mode === 'select' && (props as ExpertGridSelectProps).selectedExperts.length > 0 ? (
      <div
        className={
          layout === 'embed' && filteredExperts.length > 0
            ? 'flex flex-wrap gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex-shrink-0 max-h-28 overflow-y-auto overflow-x-hidden'
            : 'flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200'
        }
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-full mb-1">
          已选角色（点击跳转）
        </span>
        {(props as ExpertGridSelectProps).selectedExperts.map((e) => (
          <ExpertChip
            key={e.name}
            expert={e}
            onRemove={() => {
              const p = props as ExpertGridSelectProps
              p.onChange(p.value.filter((x) => x !== e.name))
            }}
            onEdit={(props as ExpertGridSelectProps).onEdit ? () => (props as ExpertGridSelectProps).onEdit!(e.name) : undefined}
            onShare={(props as ExpertGridSelectProps).onShare ? () => (props as ExpertGridSelectProps).onShare!(e.name) : undefined}
            onClick={() => {
              const full = expertByName[e.name]
              scrollToSection(getExpertSectionId(full || { name: e.name, perspective: '' } as ExpertInfo))
            }}
          />
        ))}
      </div>
    ) : null

  return (
    <div className={rootClass}>
      {!isFill && searchInput}

      {selectedChipsSection && !(layout === 'embed' && filteredExperts.length > 0) && selectedChipsSection}

      {loading && <p className="text-gray-400 font-serif text-sm">加载中...</p>}
      {!loading && filteredExperts.length === 0 && (
        <p className="text-gray-400 font-serif text-sm">
          {search ? '无匹配角色' : '暂无角色配置'}
        </p>
      )}

      {!loading && filteredExperts.length > 0 && (
        <div
          className={
            layout === 'embed' && selectedChipsSection
              ? `flex flex-col border border-gray-200 rounded-lg overflow-hidden ${isFill ? 'flex-1 min-h-0' : ''}`
              : `flex ${layout === 'embed' ? 'gap-0 border border-gray-200 rounded-lg overflow-hidden' : 'gap-8'} ${isFill ? 'flex-1 min-h-0' : ''}`
          }
          style={gridHeightStyle}
        >
          {layout === 'embed' && selectedChipsSection && selectedChipsSection}
          <div
            className={
              layout === 'embed' && selectedChipsSection
                ? 'flex flex-1 min-h-0 min-w-0 overflow-x-hidden items-start'
                : layout === 'embed'
                  ? 'flex gap-0 flex-1 min-h-0 min-w-0 overflow-x-hidden items-start'
                  : 'flex gap-8 flex-1 min-h-0 min-w-0 overflow-x-hidden items-start'
            }
          >
          <div className={layout === 'embed' ? 'hidden sm:flex flex-shrink-0 self-start' : 'hidden md:flex flex-shrink-0 self-start'}>
            <ResizableToc
              defaultWidth={layout === 'embed' ? 128 : 176}
              minWidth={layout === 'embed' ? 100 : 120}
              maxWidth={layout === 'embed' ? 280 : 360}
              maxHeight={layout === 'embed' ? (isFill ? '100%' : maxHeight) : 'calc(100vh - 6rem)'}
              className={layout === 'page' ? 'sticky top-20 self-start' : ''}
            >
              <SourceCategoryToc
                tree={tocTree}
                sourceOrder={sourceOrder}
                sourceDisplayName={sourceDisplayName}
                onNavigate={scrollToSection}
                className="py-2"
              />
            </ResizableToc>
          </div>
          <div className={`flex-1 min-w-0 flex flex-col min-h-0 ${layout === 'embed' ? 'pl-3' : ''}`}>
            {layout === 'embed' && isFill && <div className="flex-shrink-0">{searchInput}</div>}
            {mobileTocData.sources.length > 0 && (
              <MobileSourceCategoryToc
                sources={mobileTocData.sources}
                categoriesBySource={mobileTocData.categoriesBySource}
                sourceOrder={sourceOrder}
                onNavigate={scrollToSection}
                visibleClass={layout === 'embed' ? 'sm:hidden' : 'md:hidden'}
              />
            )}
            <div className={`flex-1 min-h-0 ${layout === 'embed' ? 'overflow-auto' : ''}`}>
              {layout === 'page' ? (
                <div className="space-y-8">
                  {sourceOrder.map((source) => {
                    const cats = grouped[source]
                    const catKeys = Object.keys(cats).sort((a, b) =>
                      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)
                    )
                    return (
                      <div key={source} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div
                          id={`source-${source}`}
                          ref={(el) => { sectionRefs.current[`source-${source}`] = el }}
                          className="bg-gray-50 px-4 py-3 border-b border-gray-200 scroll-mt-6"
                        >
                          <h2 className="text-sm font-serif font-semibold text-black uppercase tracking-wide">
                            {sourceDisplayName(source)}
                          </h2>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {catKeys.map((catId) => {
                            const items = cats[catId]
                            const catName = items[0]?.category_name || catId || '学者'
                            const sectionId = `section-${source}-${catId || '_'}`.replace(/\s+/g, '-')
                            return (
                              <div
                                key={catId || '_'}
                                id={sectionId}
                                ref={(el) => { sectionRefs.current[sectionId] = el }}
                                className="p-4 scroll-mt-6"
                              >
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                  {catName}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                                  {items.map((e) =>
                                    mode === 'view' ? (
                                      <ExpertCard
                                        key={e.name}
                                        expert={e}
                                        mode="view"
                                        onClick={(props as ExpertGridViewProps).onExpertClick}
                                        descriptionLines={2}
                                        showName
                                      />
                                    ) : (
                                      <ExpertCard
                                        key={e.name}
                                        expert={e}
                                        mode="select"
                                        isSelected={(props as ExpertGridSelectProps).value.includes(e.name)}
                                        onToggle={(expert) => {
                                          const p = props as ExpertGridSelectProps
                                          if (p.value.includes(expert.name)) {
                                            p.onChange(p.value.filter((x) => x !== expert.name))
                                          } else {
                                            p.onChange([...p.value, expert.name])
                                          }
                                        }}
                                        onDetailClick={(props as ExpertGridSelectProps).onExpertClick}
                                      />
                                    )
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                renderGridContent(props, grouped, sourceOrder, sectionIdPrefix, sectionRefs)
              )}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
