import { useExpertGrid } from '../hooks/useExpertGrid'
import SourceCategoryToc from './SourceCategoryToc'
import ResizableToc from './ResizableToc'
import ExpertCard from './ExpertCard'
import { sourceDisplayName, perspectiveDisplayName } from '../utils/experts'
import type { ExpertInfo } from '../api/client'

interface ExpertGridProps {
  layout?: 'page' | 'embed'
  placeholder?: string
  maxHeight?: string
  onExpertClick: (expert: ExpertInfo) => void
}

export default function ExpertGrid(props: ExpertGridProps) {
  const {
    layout = 'page',
    placeholder = '搜索角色名称、描述、领域...',
    maxHeight = '400px',
    onExpertClick,
  } = props

  const sectionIdPrefix = layout === 'embed' ? 'expert-section' : 'section'
  const {
    filteredExperts,
    grouped,
    sourceOrder,
    loading,
    search,
    setSearch,
    tocTree,
    sectionRefs,
    scrollToSection,
  } = useExpertGrid({ sectionIdPrefix })

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
      {!loading && filteredExperts.length === 0 && (
        <p className="text-gray-400 font-serif text-sm">
          {search ? '无匹配角色' : '暂无角色配置'}
        </p>
      )}

      {!loading && filteredExperts.length > 0 && (
        <div
          className={`flex ${layout === 'embed' ? 'gap-0 border border-gray-200 rounded-xl overflow-hidden' : 'gap-8'}`}
          style={layout === 'embed' ? { maxHeight } : undefined}
        >
          <div
            className={
              layout === 'embed'
                ? 'hidden sm:flex flex-shrink-0'
                : 'hidden md:flex flex-shrink-0'
            }
          >
            <ResizableToc
              defaultWidth={layout === 'embed' ? 128 : 176}
              minWidth={layout === 'embed' ? 100 : 120}
              maxWidth={layout === 'embed' ? 280 : 360}
              maxHeight={
                layout === 'embed' ? maxHeight : 'calc(100vh - 6rem)'
              }
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
                    <div
                      key={source}
                      className="border border-gray-200 rounded-xl overflow-hidden"
                    >
                      <div
                        id={`source-${source}`}
                        ref={(el) => {
                          sectionRefs.current[`source-${source}`] = el
                        }}
                        className="bg-gray-50 px-4 py-3 border-b border-gray-200 scroll-mt-6"
                      >
                        <h2 className="text-sm font-serif font-semibold text-black uppercase tracking-wide">
                          {sourceDisplayName(source)}
                        </h2>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {catKeys.map((catId) => {
                          const items = cats[catId]
                          const catName = items[0]?.perspective
                            ? perspectiveDisplayName(items[0].perspective)
                            : catId || '研究员'
                          const sectionId = `section-${source}-${catId || '_'}`.replace(
                            /\s+/g,
                            '-'
                          )
                          return (
                            <div
                              key={catId || '_'}
                              id={sectionId}
                              ref={(el) => {
                                sectionRefs.current[sectionId] = el
                              }}
                              className="p-4 scroll-mt-6"
                            >
                              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                {catName}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {items.map((e) => (
                                  <ExpertCard
                                    key={e.name}
                                    expert={e}
                                    onClick={onExpertClick}
                                    descriptionLines={2}
                                    showName
                                  />
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
