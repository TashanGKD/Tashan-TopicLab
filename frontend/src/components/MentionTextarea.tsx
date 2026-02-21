import { useEffect, useRef, useState } from 'react'
import { TopicExpert } from '../api/client'

interface Props {
  value: string
  onChange: (value: string) => void
  experts: TopicExpert[]
  placeholder?: string
  disabled?: boolean
}

export default function MentionTextarea({
  value,
  onChange,
  experts,
  placeholder = '发表帖子… 输入 @ 可提及角色',
  disabled = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownIndex, setDropdownIndex] = useState(0)
  const mentionStartRef = useRef<number>(-1)

  const getMentionQuery = (text: string, cursor: number): string | null => {
    const before = text.slice(0, cursor)
    const match = before.match(/@(\w*)$/)
    return match ? match[1] : null
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    onChange(text)
    const cursor = e.target.selectionStart ?? text.length
    const query = getMentionQuery(text, cursor)
    if (query !== null) {
      mentionStartRef.current = cursor - query.length - 1
      setShowDropdown(true)
      setDropdownIndex(0)
    } else {
      setShowDropdown(false)
    }
  }

  const filteredExperts = (() => {
    if (!showDropdown) return []
    const cursor = textareaRef.current?.selectionStart ?? value.length
    const query = getMentionQuery(value, cursor) ?? ''
    return experts.filter(
      e =>
        e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.label.toLowerCase().includes(query.toLowerCase())
    )
  })()

  const insertMention = (expert: TopicExpert) => {
    const cursor = textareaRef.current?.selectionStart ?? value.length
    const before = value.slice(0, mentionStartRef.current)
    const after = value.slice(cursor)
    const inserted = `@${expert.name} `
    const newValue = before + inserted + after
    onChange(newValue)
    setShowDropdown(false)
    setTimeout(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        const pos = before.length + inserted.length
        ta.setSelectionRange(pos, pos)
      }
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || filteredExperts.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDropdownIndex(i => (i + 1) % filteredExperts.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDropdownIndex(i => (i - 1 + filteredExperts.length) % filteredExperts.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertMention(filteredExperts[dropdownIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
      />

      {showDropdown && filteredExperts.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 sm:right-auto z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] sm:min-w-[220px] max-w-[min(100vw-2rem,280px)] overflow-hidden mb-1">
          {filteredExperts.map((expert, idx) => (
            <div
              key={expert.name}
              onMouseDown={e => { e.preventDefault(); insertMention(expert) }}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                idx === dropdownIndex ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'
              }`}
            >
              <span className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {expert.label.charAt(0)}
              </span>
              <div>
                <div className="text-sm font-medium text-gray-900">{expert.label}</div>
                <div className="text-xs text-gray-400">@{expert.name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
