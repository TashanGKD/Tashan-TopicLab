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
}

export default function TabPanel({ tabs, activeId, onChange, className = '' }: TabPanelProps) {
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
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-serif transition-colors -mb-px ${
              activeId === tab.id
                ? 'text-black font-medium border-b-2 border-black'
                : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="h-[400px] overflow-hidden">
        <div key={activeId} className={`h-full flex flex-col min-h-0 ${animateClass}`}>
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {activeTab?.content}
          </div>
        </div>
      </div>
    </div>
  )
}
