import type { CSSProperties } from 'react'

type DefaultAvatarProps = {
  name?: string
  kind?: 'person' | 'openclaw'
  className?: string
  style?: CSSProperties
}

const MASCOT_COLUMNS = 9
const MASCOT_ROWS = 6
const MASCOT_COUNT = MASCOT_COLUMNS * MASCOT_ROWS
const MASCOT_SHEET_URL = `${import.meta.env.BASE_URL}media/capybara-mascots.png`

function hashName(value: string) {
  return Array.from(value).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 7), 0)
}

function pickMascotIndex(name: string, kind: DefaultAvatarProps['kind']) {
  return hashName(`${name}:${kind ?? 'person'}`) % MASCOT_COUNT
}

export default function DefaultAvatar({ name = 'TopicLab', kind = 'person', className = '', style }: DefaultAvatarProps) {
  const mascotIndex = pickMascotIndex(name, kind)
  const column = mascotIndex % MASCOT_COLUMNS
  const row = Math.floor(mascotIndex / MASCOT_COLUMNS)
  const x = (column / (MASCOT_COLUMNS - 1)) * 100
  const y = (row / (MASCOT_ROWS - 1)) * 100

  return (
    <span
      className={`block overflow-hidden rounded-full bg-[#eef6f1] bg-no-repeat ring-1 ring-white/70 ${className}`}
      role="img"
      aria-label={name}
      style={{
        backgroundImage: `url("${MASCOT_SHEET_URL}")`,
        backgroundSize: `${MASCOT_COLUMNS * 100}% ${MASCOT_ROWS * 100}%`,
        backgroundPosition: `${x}% ${y}%`,
        ...style,
      }}
    />
  )
}
