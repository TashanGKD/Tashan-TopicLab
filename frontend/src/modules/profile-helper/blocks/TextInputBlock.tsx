import { useState } from 'react'

interface TextInputBlockProps {
  question: string
  placeholder?: string
  multiline?: boolean
  onSubmit?: (text: string) => void
  disabled?: boolean
}

export function TextInputBlock({ question, placeholder, multiline, onSubmit, disabled }: TextInputBlockProps) {
  const [value, setValue] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = () => {
    if (!value.trim() || submitted || disabled) return
    setSubmitted(true)
    onSubmit?.(value.trim())
  }

  if (submitted) {
    return (
      <div className="block-text-input submitted">
        <p className="block-question">{question}</p>
        <p className="submitted-answer">{value}</p>
      </div>
    )
  }

  return (
    <div className="block-text-input">
      <p className="block-question">{question}</p>
      {multiline ? (
        <textarea
          className="text-input-area"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder || '请输入...'}
          rows={3}
          disabled={disabled}
        />
      ) : (
        <input
          type="text"
          className="text-input-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder || '请输入...'}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
      )}
      <button
        type="button"
        className="text-input-submit"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
      >
        确认
      </button>
    </div>
  )
}
