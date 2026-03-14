import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ReactionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  count?: number
  active?: boolean
  pending?: boolean
  icon: ReactNode
  subtle?: boolean
  hideLabel?: boolean
}

export default function ReactionButton({
  label,
  count = 0,
  active = false,
  pending = false,
  icon,
  subtle = false,
  hideLabel = true,
  className = '',
  disabled,
  ...props
}: ReactionButtonProps) {
  const toneClass = active
    ? 'text-black'
    : subtle
      ? 'text-gray-400 hover:text-gray-700'
      : 'text-gray-500 hover:text-black'

  return (
    <button
      type="button"
      aria-label={pending ? `${label}处理中` : label}
      disabled={disabled || pending}
      className={`group inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-1 py-1 text-sm transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-black/15 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[34px] ${toneClass} ${className}`.trim()}
      {...props}
    >
      <span className="flex h-6 w-6 items-center justify-center transition-transform duration-200 group-hover:scale-[1.03]">
        {icon}
      </span>
      {hideLabel ? <span className="sr-only">{label}</span> : <span className="font-medium tracking-[0.01em]">{pending ? '处理中...' : label}</span>}
      <span className={`text-[11px] font-medium tabular-nums sm:text-xs ${active ? 'text-black' : 'text-inherit'}`}>
        {pending ? '...' : count}
      </span>
    </button>
  )
}
