import { useMemo } from 'react'
import { useMCPGrid } from '../hooks/useMCPGrid'
import SourceCategoryToc from './SourceCategoryToc'
import ResizableToc from './ResizableToc'
import MCPCard, { MCPChip } from './MCPCard'
import { sourceDisplayName } from '../utils/mcps'
import type { AssignableMCP } from '../api/client'

interface MCPGridViewProps {
  mode: 'view'
  onMcpClick: (mcp: AssignableMCP) => void
}

interface MCPGridSelectProps {
  mode: 'select'
  value: string[]
  onChange: (ids: string[]) => void
  onMcpClick?: (mcp: AssignableMCP) => void
}

type MCPGridProps = (MCPGridViewProps | MCPGridSelectProps) & {
  layout?: 'page' | 'embed'
  placeholder?: string
  maxHeight?: string
  fillHeight?: boolean
}

export default function MCPGrid(props: MCPGridProps) {
  const {
    layout = 'page',
    placeholder = '搜索 MCP 服务器名称、描述、分类...',
    maxHeight = '400px',
    fillHeight = false,
  } = props

  const sectionIdPrefix = layout === 'embed' ? 'mcp-section' : 'section'
  const {
    allMcps,
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
  } = useMCPGrid({ sectionIdPrefix })

  const selectedSet = useMemo(
    () => (props.mode === 'select' ? new Set(props.value) : new Set<string>()),
    [props.mode, props.mode === 'select' ? props.value : []]
  )

  const mcpById = useMemo(() => Object.fromEntries(allMcps.map((m) => [m.id, m])), [allMcps])

  const selectedMcps =
    props.mode === 'select'
      ? props.value.map((id) => mcpById[id]).filter(Boolean)
      : []

  const addMcp =
    props.mode === 'select'
      ? (id: string) => {
          if (selectedSet.has(id)) return
          props.onChange([...props.value, id])
        }
      : undefined

  const removeMcp =
    props.mode === 'select'
      ? (id: string) => {
          props.onChange(props.value.filter((x) => x !== id))
        }
      : undefined

  const renderGridContent = () => (
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
                const catName = items[0]?.category_name || catId || '未分类'
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
                    <div className="flex flex-wrap gap-2">
                      {items.map((m) =>
                        props.mode === 'view' ? (
                          <MCPCard
                            key={m.id}
                            mcp={m}
                            mode="view"
                            onClick={props.onMcpClick}
                            descriptionLines={layout === 'page' ? 2 : 1}
                            showId={layout === 'page'}
                          />
                        ) : (
                          <MCPCard
                            key={m.id}
                            mcp={m}
                            mode="select"
                            isSelected={selectedSet.has(m.id)}
                            onToggle={(mcp) =>
                              selectedSet.has(mcp.id) ? removeMcp!(mcp.id) : addMcp!(mcp.id)
                            }
                            onDetailClick={props.mode === 'select' ? props.onMcpClick : undefined}
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

  const isFill = layout === 'embed' && fillHeight
  const rootClass = isFill ? 'flex flex-col h-full min-h-0' : 'space-y-3'
  const gridHeightStyle = isFill ? undefined : (layout === 'embed' ? { maxHeight } : undefined)

  const searchInput = (
    <input
      type="text"
      placeholder={placeholder}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className={
        isFill
          ? 'w-full flex-shrink-0 bg-gray-50 border-0 border-b border-gray-100 rounded-none px-3 py-2 text-sm font-serif placeholder-gray-400 focus:outline-none focus:ring-0 focus:border-gray-300'
          : 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-serif placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent'
      }
    />
  )

  const selectedChipsSection =
    props.mode === 'select' && selectedMcps.length > 0 ? (
      <div
        className={
          layout === 'embed' && filteredMcps.length > 0
            ? 'flex flex-wrap gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex-shrink-0'
            : 'flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200'
        }
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-full mb-1">
          已选 MCP 服务器（点击跳转）
        </span>
        {selectedMcps.map((m) => (
          <MCPChip
            key={m.id}
            mcp={m}
            onRemove={() => removeMcp!(m.id)}
            onClick={() => scrollToSection(getMcpSectionId(m))}
          />
        ))}
      </div>
    ) : null

  return (
    <div className={rootClass}>
      {!isFill && searchInput}

      {selectedChipsSection && !(layout === 'embed' && filteredMcps.length > 0) && selectedChipsSection}

      {loading && <p className="text-gray-400 font-serif text-sm">加载中...</p>}
      {!loading && filteredMcps.length === 0 && (
        <p className="text-gray-400 font-serif text-sm">{search ? '无匹配 MCP' : '暂无 MCP 配置'}</p>
      )}

      {!loading && filteredMcps.length > 0 && (
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
                ? 'flex flex-1 min-h-0 min-w-0'
                : layout === 'embed'
                  ? 'flex gap-0 flex-1 min-h-0'
                  : 'flex gap-8 flex-1 min-h-0'
            }
          >
          <div className={layout === 'embed' ? 'hidden sm:flex flex-shrink-0' : 'hidden md:flex flex-shrink-0'}>
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
          <div
            className={`flex-1 min-w-0 flex flex-col min-h-0 ${layout === 'embed' ? 'pl-3' : ''}`}
          >
            {layout === 'embed' && isFill && (
              <div className="flex-shrink-0">{searchInput}</div>
            )}
            <div
              className={`flex-1 min-h-0 ${layout === 'embed' ? 'overflow-auto' : ''}`}
            >
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
                                {items.map((m) =>
                                  props.mode === 'view' ? (
                                    <MCPCard
                                      key={m.id}
                                      mcp={m}
                                      mode="view"
                                      onClick={props.onMcpClick}
                                      descriptionLines={2}
                                      showId
                                    />
                                  ) : (
                                    <MCPCard
                                      key={m.id}
                                      mcp={m}
                                      mode="select"
                                      isSelected={selectedSet.has(m.id)}
                                      onToggle={(mcp) =>
                                        selectedSet.has(mcp.id) ? removeMcp!(mcp.id) : addMcp!(mcp.id)
                                      }
                                      onDetailClick={props.mode === 'select' ? props.onMcpClick : undefined}
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
              renderGridContent()
            )}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
