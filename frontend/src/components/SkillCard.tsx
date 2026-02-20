import type { AssignableSkill } from '../api/client'
import { sourceDisplayName } from '../utils/skills'

const CARD_CLASS = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-w-[180px] max-w-[280px]'

interface SkillCardBaseProps {
  skill: AssignableSkill
  descriptionLines?: 1 | 2
  showId?: boolean
}

interface SkillCardViewProps extends SkillCardBaseProps {
  mode: 'view'
  onClick: (skill: AssignableSkill) => void
}

interface SkillCardSelectProps extends SkillCardBaseProps {
  mode: 'select'
  isSelected: boolean
  onToggle: (skill: AssignableSkill) => void
  onDetailClick?: (skill: AssignableSkill) => void
}

export type SkillCardProps = SkillCardViewProps | SkillCardSelectProps

export default function SkillCard(props: SkillCardProps) {
  const { skill, descriptionLines = 1, showId = false } = props

  if (props.mode === 'view') {
    return (
      <button
        type="button"
        onClick={() => props.onClick(skill)}
        className={`inline-flex flex-col gap-1 px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-colors min-w-[200px] max-w-[280px] text-left cursor-pointer`}
      >
        <span className="text-sm font-serif font-medium text-black block truncate">{skill.name}</span>
        {skill.description && (
          <span className={`text-xs text-gray-500 ${descriptionLines === 2 ? 'line-clamp-2' : 'line-clamp-1'}`}>
            {skill.description}
          </span>
        )}
        {showId && <span className="text-[10px] text-gray-400 font-mono">{skill.id}</span>}
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
        onClick={onDetailClick ? () => onDetailClick(skill) : undefined}
        onKeyDown={
          onDetailClick
            ? (e) => e.key === 'Enter' && onDetailClick(skill)
            : undefined
        }
        role={onDetailClick ? 'button' : undefined}
        tabIndex={onDetailClick ? 0 : undefined}
        title={onDetailClick ? '点击查看详情' : undefined}
      >
        <span className="text-sm font-serif font-medium text-black block truncate">{skill.name}</span>
        {skill.description && (
          <span className="text-xs text-gray-500 line-clamp-1">{skill.description}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onToggle(skill)}
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
          isSelected
            ? 'bg-gray-400 text-white hover:bg-gray-500'
            : 'bg-black text-white hover:bg-gray-800'
        }`}
        aria-label={isSelected ? '移除' : '添加'}
        title={isSelected ? '从话题移除' : '添加到话题'}
      >
        {isSelected ? '×' : '+'}
      </button>
    </div>
  )
}

export function SkillChip({
  skill,
  onRemove,
  onClick,
}: {
  skill: AssignableSkill
  onRemove: () => void
  onClick: () => void
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`${CARD_CLASS} bg-white hover:border-gray-400 hover:bg-gray-50 cursor-pointer`}
    >
      <div className="flex-1 min-w-0 text-left">
        <span className="text-sm font-serif font-medium text-black block truncate">{skill.name}</span>
        <span className="text-[10px] text-gray-400">
          {sourceDisplayName(skill.source || 'default')}
          {(skill.category_name || skill.category) && ` · ${skill.category_name || skill.category}`}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium text-gray-400 hover:text-black hover:bg-gray-200 transition-colors"
        aria-label="移除"
      >
        ×
      </button>
    </span>
  )
}
