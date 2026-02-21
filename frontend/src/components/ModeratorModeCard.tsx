import type { AssignableModeratorMode } from '../api/client'
import { sourceDisplayName } from '../utils/moderatorModes'

const CARD_CLASS = 'flex sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors w-full min-w-0 sm:min-w-[180px] sm:max-w-[280px] sm:w-auto'

interface ModeratorModeCardViewProps {
  mode: AssignableModeratorMode
  onClick: (mode: AssignableModeratorMode) => void
  descriptionLines?: 1 | 2
  showId?: boolean
}

interface ModeratorModeCardSelectProps {
  mode: AssignableModeratorMode
  isSelected: boolean
  onToggle: (mode: AssignableModeratorMode) => void
  onDetailClick?: (mode: AssignableModeratorMode) => void
  descriptionLines?: 1 | 2
  showId?: boolean
}

export default function ModeratorModeCard(props: ModeratorModeCardViewProps | ModeratorModeCardSelectProps) {
  const { mode, descriptionLines = 1, showId = false } = props

  if ('onClick' in props) {
    return (
      <button
        type="button"
        onClick={() => props.onClick(mode)}
        className="flex flex-col gap-1 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-colors w-full min-w-0 sm:min-w-[200px] sm:max-w-[280px] sm:w-auto text-left cursor-pointer"
      >
        <span className="text-sm font-serif font-medium text-black block truncate">{mode.name}</span>
        {mode.description && (
          <span className={`text-xs text-gray-500 ${descriptionLines === 2 ? 'line-clamp-2' : 'line-clamp-1'}`}>
            {mode.description}
          </span>
        )}
        {mode.num_rounds != null && (
          <span className="text-[10px] text-gray-400">默认 {mode.num_rounds} 轮</span>
        )}
        {showId && <span className="text-[10px] text-gray-400 font-mono">{mode.id}</span>}
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
        onClick={onDetailClick ? () => onDetailClick(mode) : undefined}
        onKeyDown={
          onDetailClick
            ? (e) => e.key === 'Enter' && onDetailClick(mode)
            : undefined
        }
        role={onDetailClick ? 'button' : undefined}
        tabIndex={onDetailClick ? 0 : undefined}
        title={onDetailClick ? '点击查看详情' : undefined}
      >
        <span className="text-sm font-serif font-medium text-black block truncate">{mode.name}</span>
        {mode.description && (
          <span className="text-xs text-gray-500 line-clamp-1">{mode.description}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onToggle(mode)}
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
          isSelected
            ? 'bg-gray-400 text-white hover:bg-gray-500'
            : 'bg-black text-white hover:bg-gray-800'
        }`}
        aria-label={isSelected ? '移除' : '添加'}
        title={isSelected ? '取消选择' : '选择此模式'}
      >
        {isSelected ? '×' : '+'}
      </button>
    </div>
  )
}

export function ModeratorModeChip({
  mode,
  onRemove,
  onClick,
}: {
  mode: AssignableModeratorMode
  onRemove: () => void
  onClick: () => void
}) {
  const meta = `${sourceDisplayName(mode.source || 'default')}${(mode.category_name || mode.category) ? ` · ${mode.category_name || mode.category}` : ''}`
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      title={meta ? `${mode.name} · ${meta}` : mode.name}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-gray-100 border border-gray-200 hover:bg-gray-200 cursor-pointer sm:flex sm:gap-2 sm:px-3 sm:py-2 sm:rounded-lg sm:min-w-[180px] sm:max-w-[280px] sm:w-auto sm:bg-white sm:hover:border-gray-400 sm:hover:bg-gray-50"
    >
      <div className="flex-1 min-w-0 text-left flex flex-col sm:block">
        <span className="font-serif font-medium text-black truncate max-w-[100px] sm:max-w-none sm:block">{mode.name}</span>
        <span className="hidden sm:block text-[10px] text-gray-400">
          {meta}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="flex-shrink-0 w-5 h-5 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium text-gray-400 hover:text-black hover:bg-gray-200 transition-colors touch-manipulation"
        aria-label="移除"
      >
        ×
      </button>
    </span>
  )
}
