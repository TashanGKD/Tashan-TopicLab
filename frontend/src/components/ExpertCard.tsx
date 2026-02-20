import { useState } from 'react'
import type { ExpertInfo } from '../api/client'

const CARD_CLASS = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-w-[180px] max-w-[280px]'

interface ExpertCardViewProps {
  expert: ExpertInfo
  mode: 'view'
  descriptionLines?: 1 | 2
  showName?: boolean
  onClick: (expert: ExpertInfo) => void
}

interface ExpertCardSelectProps {
  expert: ExpertInfo
  mode: 'select'
  isSelected: boolean
  onToggle: (expert: ExpertInfo) => void
  onDetailClick?: (expert: ExpertInfo) => void
}

export type ExpertCardProps = ExpertCardViewProps | ExpertCardSelectProps

export default function ExpertCard(props: ExpertCardProps) {
  const { expert } = props

  if (props.mode === 'view') {
    const { descriptionLines = 1, showName = false, onClick } = props
    return (
      <button
        type="button"
        onClick={() => onClick(expert)}
        className="inline-flex flex-col gap-1 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-colors min-w-[200px] max-w-[280px] text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center font-serif text-xs flex-shrink-0">
            {expert.label.charAt(0)}
          </div>
          <span className="text-sm font-serif font-medium text-black block truncate">
            {expert.label}
          </span>
        </div>
        {expert.description && (
          <span
            className={`text-xs text-gray-500 ${
              descriptionLines === 2 ? 'line-clamp-2' : 'line-clamp-1'
            }`}
          >
            {expert.description}
          </span>
        )}
        {showName && (
          <span className="text-[10px] text-gray-400 font-mono">{expert.name}</span>
        )}
      </button>
    )
  }

  const { isSelected, onToggle, onDetailClick } = props
  return (
    <div
      className={`${CARD_CLASS} ${
        isSelected
          ? 'border-gray-400 bg-gray-100'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div
        className={`flex-1 min-w-0 text-left ${onDetailClick ? 'cursor-pointer' : ''}`}
        onClick={onDetailClick ? () => onDetailClick(expert) : undefined}
        onKeyDown={
          onDetailClick ? (e) => e.key === 'Enter' && onDetailClick(expert) : undefined
        }
        role={onDetailClick ? 'button' : undefined}
        tabIndex={onDetailClick ? 0 : undefined}
        title={onDetailClick ? '点击查看详情' : undefined}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center font-serif text-[10px] flex-shrink-0">
            {expert.label.charAt(0)}
          </div>
          <span className="text-sm font-serif font-medium text-black block truncate">
            {expert.label}
          </span>
        </div>
        {expert.description && (
          <span className="text-xs text-gray-500 line-clamp-1">{expert.description}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onToggle(expert)}
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
          isSelected ? 'bg-gray-400 text-white hover:bg-gray-500' : 'bg-black text-white hover:bg-gray-800'
        }`}
        aria-label={isSelected ? '移除' : '添加'}
        title={isSelected ? '从话题移除' : '添加到话题'}
      >
        {isSelected ? '×' : '+'}
      </button>
    </div>
  )
}

export function ExpertChip({
  expert,
  onRemove,
  onEdit,
  onShare,
  onClick,
}: {
  expert: { name: string; label: string }
  onRemove: () => void
  onEdit?: () => void
  onShare?: () => void
  onClick?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={`${CARD_CLASS} bg-white hover:border-gray-400 hover:bg-gray-50 cursor-pointer relative`}
    >
      <div className="flex-1 min-w-0 text-left">
        <span className="text-sm font-serif font-medium text-black block truncate">{expert.label}</span>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {(onEdit || onShare) && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200 text-xs"
              title="更多"
            >
              ⋮
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }}
                />
                <div className="absolute right-0 top-full mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[80px]">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEdit(); setMenuOpen(false) }}
                      className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100"
                    >
                      编辑
                    </button>
                  )}
                  {onShare && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onShare(); setMenuOpen(false) }}
                      className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100"
                    >
                      共享
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium text-gray-400 hover:text-black hover:bg-gray-200 transition-colors"
          aria-label="移除"
        >
          ×
        </button>
      </div>
    </span>
  )
}
