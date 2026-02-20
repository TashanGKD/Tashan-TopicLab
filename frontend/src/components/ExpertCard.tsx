import type { ExpertInfo } from '../api/client'

interface ExpertCardProps {
  expert: ExpertInfo
  descriptionLines?: 1 | 2
  showName?: boolean
  onClick?: (expert: ExpertInfo) => void
}

export default function ExpertCard({
  expert,
  descriptionLines = 1,
  showName = false,
  onClick,
}: ExpertCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(expert)}
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
