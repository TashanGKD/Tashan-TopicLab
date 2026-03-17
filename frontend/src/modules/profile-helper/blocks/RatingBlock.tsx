import { useState } from 'react'

interface RatingBlockProps {
  question: string
  minVal: number
  maxVal: number
  minLabel?: string
  maxLabel?: string
  onSelect?: (value: number) => void
  disabled?: boolean
}

export function RatingBlock({ question, minVal, maxVal, minLabel, maxLabel, onSelect, disabled }: RatingBlockProps) {
  const [selected, setSelected] = useState<number | null>(null)

  const values: number[] = []
  for (let i = minVal; i <= maxVal; i++) values.push(i)

  const handleClick = (val: number) => {
    if (disabled || selected !== null) return
    setSelected(val)
    onSelect?.(val)
  }

  return (
    <div className="block-rating">
      <p className="block-question">{question}</p>
      <div className="rating-row">
        {minLabel && <span className="rating-label">{minLabel}</span>}
        <div className="rating-buttons">
          {values.map((v) => (
            <button
              key={v}
              type="button"
              className={`rating-btn ${selected === v ? 'selected' : ''} ${disabled || selected !== null ? 'disabled' : ''}`}
              onClick={() => handleClick(v)}
              disabled={!!(disabled || selected !== null)}
            >
              {v}
            </button>
          ))}
        </div>
        {maxLabel && <span className="rating-label">{maxLabel}</span>}
      </div>
    </div>
  )
}
