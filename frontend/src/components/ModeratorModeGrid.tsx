import { useMemo } from 'react'
import { useModeratorModeGrid } from '../hooks/useModeratorModeGrid'
import SourceCategoryToc from './SourceCategoryToc'
import ResizableToc from './ResizableToc'
import ModeratorModeCard, { ModeratorModeChip } from './ModeratorModeCard'
import { sourceDisplayName } from '../utils/moderatorModes'
import type { AssignableModeratorMode } from '../api/client'

interface ModeratorModeGridViewProps {
  mode: 'view'
  layout?: 'page' | 'embed'
  placeholder?: string
  maxHeight?: string
  onModeClick: (mode: AssignableModeratorMode) => void
}

interface ModeratorModeGridSelectProps {
  mode: 'select'
  value: string[]
  onChange: (ids: string[]) => void
  onModeClick?: (mode: AssignableModeratorMode) => void
  layout?: 'page' | 'embed'
  placeholder?: string
  maxHeight?: string
}

type ModeratorModeGridProps = ModeratorModeGridViewProps | ModeratorModeGridSelectProps

export default function ModeratorModeGrid(props: ModeratorModeGridProps) {
  const {
    layout = 'page',
    placeholder = '搜索讨论方式名称、描述、分类...',
    maxHeight = '400px',
  } = props

  const sectionIdPrefix = layout === 'embed' ? 'mode-section' : 'section'
  const {
    allModes,
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
  } = useModeratorModeGrid({ sectionIdPrefix })

  const selectedSet = useMemo(
    () => (props.mode === 'select' ? new Set(props.value) : new Set<string>()),
    [props.mode, props.mode === 'select' ? props.value : []]
  )

  const modeById = useMemo(() => Object.fromEntries(allModes.map((m) => [m.id, m])), [allModes])

  const selectedModes =
    props.mode === 'select'
      ? props.value.map((id) => modeById[id]).filter(Boolean)
      : []

  const addMode =
    props.mode === 'select'
      ? (id: string) => {
          if (selectedSet.has(id)) return
          props.onChange([id])
        }
      : undefined

  const removeMode =
    props.mode === 'select'
      ? (id: string) => {
          props.onChange(props.value.filter((x) => x !== id))
        }
      : undefined

  const renderCard = (m: AssignableModeratorMode) =>
    props.mode === 'view' ? (
      <ModeratorModeCard
        key={m.id}
        mode={m}
        onClick={props.onModeClick}
        descriptionLines={layout === 'page' ? 2 : 1}
        showId={layout === 'page'}
      />
    ) : (
      <ModeratorModeCard
        key={m.id}
        mode={m}
        isSelected={selectedSet.has(m.id)}
        onToggle={(mode) =>
          selectedSet.has(mode.id) ? removeMode!(mode.id) : addMode!(mode.id)
        }
        onDetailClick={props.mode === 'select' ? props.onModeClick : undefined}
      />
    )

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-serif placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
      />

      {loading && <p className="text-gray-400 font-serif text-sm">加载中...</p>}
      {!loading && filteredModes.length === 0 && (
        <p className="text-gray-400 font-serif text-sm">{search ? '无匹配模式' : '暂无讨论方式'}</p>
      )}

      {props.mode === 'select' && selectedModes.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-full mb-1">
            已选讨论方式（点击跳转）
          </span>
          {selectedModes.map((m) => (
            <ModeratorModeChip
              key={m.id}
              mode={m}
              onRemove={() => removeMode!(m.id)}
              onClick={() => scrollToSection(getModeratorModeSectionId(m))}
            />
          ))}
        </div>
      )}

      {!loading && filteredModes.length > 0 && (
        <div
          className={`flex ${layout === 'embed' ? 'gap-0 border border-gray-200 rounded-xl overflow-hidden' : 'gap-8'}`}
          style={layout === 'embed' ? { maxHeight } : undefined}
        >
          <div className={layout === 'embed' ? 'hidden sm:flex flex-shrink-0' : 'hidden md:flex flex-shrink-0'}>
            <ResizableToc
              defaultWidth={layout === 'embed' ? 128 : 176}
              minWidth={layout === 'embed' ? 100 : 120}
              maxWidth={layout === 'embed' ? 280 : 360}
              maxHeight={layout === 'embed' ? maxHeight : 'calc(100vh - 6rem)'}
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
          <div
            className={`flex-1 min-w-0 ${layout === 'embed' ? 'overflow-auto pl-3' : ''}`}
            style={layout === 'embed' ? { maxHeight } : undefined}
          >
            {layout === 'page' ? (
              <div className="space-y-8">
                {sourceOrder.map((source) => {
                  const cats = grouped[source]
                  const catKeys = Object.keys(cats).sort((a, b) =>
                    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)
                  )
                  return (
                    <div key={source} className="border border-gray-200 rounded-xl overflow-hidden">
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
                          const catName = items[0]?.category_name || catId || '未分类'
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
                              <div className="flex flex-wrap gap-2">
                                {items.map((m) => renderCard(m))}
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
              <div className="space-y-4">
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
                          const sectionId = `${sectionIdPrefix}-${source}-${catId || '_'}`.replace(/\s+/g, '-')
                          return (
                            <div
                              key={catId || '_'}
                              id={sectionId}
                              ref={(el) => { sectionRefs.current[sectionId] = el }}
                              className="p-3 scroll-mt-6"
                            >
                              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                {items[0]?.category_name || catId || '未分类'}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {items.map((m) => renderCard(m))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
