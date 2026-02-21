import { ReactNode, useRef, useEffect } from 'react'

export interface TabItem {
  id: string
  label: string
  content: ReactNode
}

export interface TabPanelProps {
  tabs: TabItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
  /** 当 activeId 等于此值时，内容区高度随内容变化；否则使用统一固定高度 */
  autoHeightTabId?: string
}

export default function TabPanel({ tabs, activeId, onChange, className = '', autoHeightTabId }: TabPanelProps) {
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const prevIndexRef = useRef(-1)
  const currentIndex = tabs.findIndex((t) => t.id === activeId)
  const direction = prevIndexRef.current < 0 ? 'none' : currentIndex > prevIndexRef.current ? 'right' : 'left'

  useEffect(() => {
    prevIndexRef.current = currentIndex
  }, [currentIndex])

  const animateClass =
    direction === 'right'
      ? 'animate-slide-in-right'
      : direction === 'left'
        ? 'animate-slide-in-left'
        : 'animate-fade-in'

  return (
    <div className={className}>
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-serif transition-colors -mb-px flex-shrink-0 touch-manipulation ${
              activeId === tab.id
                ? 'text-black font-medium border-b-2 border-black'
                : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className={
          activeId === autoHeightTabId ? 'h-auto' : 'h-[400px] overflow-hidden'
        }
      >
        <div
          key={activeId}
          className={
            activeId === autoHeightTabId
              ? animateClass
              : `h-full flex flex-col min-h-0 ${animateClass}`
          }
        >
          <div
            className={
              activeId === autoHeightTabId
                ? ''
                : 'flex-1 min-h-0 overflow-hidden flex flex-col'
            }
          >
            {activeTab?.content}
          </div>
        </div>
      </div>
    </div>
  )
}
