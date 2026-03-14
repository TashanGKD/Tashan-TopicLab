import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FavoriteCategory, FavoriteCategoryRef } from '../api/client'

interface FavoriteCategoryPickerProps {
  categories: FavoriteCategory[]
  assignedCategories?: FavoriteCategoryRef[]
  pending?: boolean
  onAssign: (categoryId: string) => void
  onUnassign: (categoryId: string) => void
  onCreateCategory: (name: string) => void
}

export default function FavoriteCategoryPicker({
  categories,
  assignedCategories = [],
  pending = false,
  onAssign,
  onUnassign,
  onCreateCategory,
}: FavoriteCategoryPickerProps) {
  const [draftValue, setDraftValue] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputWrapRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const assignedIds = new Set(assignedCategories.map((item) => item.id))
  const availableCategories = categories.filter((item) => !assignedIds.has(item.id))

  const filteredCategories = useMemo(() => {
    const query = draftValue.trim().toLowerCase()
    if (!query) {
      return availableCategories.slice(0, 8)
    }
    return availableCategories
      .filter((item) => item.name.toLowerCase().includes(query))
      .slice(0, 8)
  }, [availableCategories, draftValue])

  useEffect(() => {
    setActiveIndex(0)
  }, [draftValue, open])

  useEffect(() => {
    const updatePosition = () => {
      const rect = inputWrapRef.current?.getBoundingClientRect()
      if (!rect) return
      setDropdownPosition({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      })
    }

    if (open) {
      updatePosition()
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const handleViewportChange = () => {
      if (open) {
        updatePosition()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open])

  const commitCreateOrAssign = (rawValue: string) => {
    const value = rawValue.trim()
    if (!value) return
    const matchedCategory = availableCategories.find((item) => item.name === value)
    if (matchedCategory) {
      onAssign(matchedCategory.id)
    } else {
      onCreateCategory(value)
    }
    setDraftValue('')
    setOpen(false)
  }

  const selectCategory = (categoryId: string) => {
    onAssign(categoryId)
    setDraftValue('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative z-30 mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 scrollbar-hide">
        <span className="shrink-0 text-[11px] font-medium tracking-[0.12em] text-gray-400">收藏分类</span>

        {assignedCategories.length > 0 ? assignedCategories.map((category) => (
          <button
            key={category.id}
            type="button"
            disabled={pending}
            onClick={() => onUnassign(category.id)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 text-xs text-gray-600 transition-colors duration-200 hover:border-gray-300 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            title={`移出 ${category.name}`}
          >
            <span>{category.name}</span>
            <span className="text-gray-400">×</span>
          </button>
        )) : (
          <span className="shrink-0 text-xs text-gray-400">未分类</span>
        )}

        <div ref={inputWrapRef} className="min-w-[150px] flex-[0.9_1_150px]">
          <div className="flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 focus-within:border-gray-400 focus-within:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] motion-reduce:transition-none">
            <input
              value={draftValue}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setDraftValue(event.target.value)
                setOpen(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setOpen(true)
                  setActiveIndex((prev) => Math.min(prev + 1, Math.max(filteredCategories.length - 1, 0)))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setOpen(true)
                  setActiveIndex((prev) => Math.max(prev - 1, 0))
                  return
                }
                if (event.key === 'Escape') {
                  setOpen(false)
                  return
                }
                if (event.key !== 'Enter') {
                  return
                }
                event.preventDefault()
                if (open && filteredCategories[activeIndex]) {
                  selectCategory(filteredCategories[activeIndex].id)
                  return
                }
                commitCreateOrAssign(draftValue)
              }}
              disabled={pending}
              placeholder={availableCategories.length > 0 ? '选择或输入分类名' : '输入分类名'}
              className="w-full min-w-0 border-0 bg-transparent p-0 text-sm text-gray-700 outline-none placeholder:text-gray-400"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen((prev) => !prev)}
              className="ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center text-gray-400 transition-colors duration-200 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed motion-reduce:transition-none"
              aria-label="切换收藏分类选项"
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
                <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {open ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
          }}
        >
          {filteredCategories.length > 0 ? (
            <div className="max-h-56 overflow-y-auto p-1.5">
              {filteredCategories.map((category, index) => {
                const active = index === activeIndex
                return (
                  <button
                    key={category.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCategory(category.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 motion-reduce:transition-none ${
                      active
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-black'
                    }`}
                  >
                    <span>{category.name}</span>
                    <span className="text-xs text-gray-400">{category.topics_count + category.source_articles_count}</span>
                  </button>
                )
              })}
            </div>
          ) : draftValue.trim() ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitCreateOrAssign(draftValue)}
              className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors duration-150 hover:bg-gray-50 motion-reduce:transition-none"
            >
              <div>
                <div className="text-sm font-medium text-gray-900">创建分类 “{draftValue.trim()}”</div>
                <div className="mt-0.5 text-xs text-gray-400">回车或点击后直接归入该分类</div>
              </div>
              <span className="rounded-full border border-gray-200 px-2 py-1 text-[11px] text-gray-500">新建</span>
            </button>
          ) : (
            <div className="px-3 py-3 text-sm text-gray-400">没有可加入的分类</div>
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
