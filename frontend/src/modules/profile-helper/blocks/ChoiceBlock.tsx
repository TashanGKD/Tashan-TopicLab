import { useRef, useState } from 'react'
import type { ChoiceOption } from '../types'

interface ChoiceBlockProps {
  question: string
  options: ChoiceOption[]
  onSelect?: (option: ChoiceOption, extraText?: string) => void
  disabled?: boolean
}

export function ChoiceBlock({ question, options, onSelect, disabled }: ChoiceBlockProps) {
  const [selected, setSelected] = useState<string | null>(null)
  // 当某选项有 text_prompt 且被点击时，展示内联输入框
  const [inlineOption, setInlineOption] = useState<ChoiceOption | null>(null)
  const [inlineText, setInlineText] = useState('')
  const inlineRef = useRef<HTMLInputElement>(null)

  const handleClick = (opt: ChoiceOption) => {
    if (disabled || selected) return

    if (opt.text_prompt) {
      // 有 text_prompt → 展示内联输入框，不立即发送
      setInlineOption(opt)
      setTimeout(() => inlineRef.current?.focus(), 50)
      return
    }

    // 普通选项 → 立即发送
    setSelected(opt.id)
    onSelect?.(opt)
  }

  const handleInlineSubmit = () => {
    if (!inlineOption || !inlineText.trim()) return
    setSelected(inlineOption.id)
    // 把选项标签 + 用户填写内容合并成消息
    onSelect?.(inlineOption, inlineText.trim())
  }

  const isLocked = !!(disabled || selected)

  return (
    <div className="block-choice">
      <p className="block-question">{question}</p>
      <div className="choice-options">
        {options.map((opt) => {
          const isSelected = selected === opt.id
          const isInlineActive = inlineOption?.id === opt.id && !selected

          return (
            <div key={opt.id} className="choice-btn-group">
              <button
                type="button"
                className={`choice-btn ${isSelected ? 'selected' : ''} ${isLocked ? 'disabled' : ''}`}
                onClick={() => handleClick(opt)}
                disabled={isLocked}
              >
                <span className="choice-label">{opt.label}</span>
                {opt.description && <span className="choice-desc">{opt.description}</span>}
              </button>

              {/* 内联输入框：仅在该选项有 text_prompt 且被激活时显示 */}
              {isInlineActive && (
                <div className="choice-inline-input">
                  <input
                    ref={inlineRef}
                    type="text"
                    className="choice-inline-field"
                    value={inlineText}
                    onChange={(e) => setInlineText(e.target.value)}
                    placeholder={opt.text_prompt}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleInlineSubmit()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="choice-inline-submit"
                    onClick={handleInlineSubmit}
                    disabled={!inlineText.trim()}
                  >
                    确认
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
