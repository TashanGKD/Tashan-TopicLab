import { useState, useRef, useEffect, useCallback } from 'react'

interface InfoTooltipProps {
  term: string       // 触发词（显示在页面上）
  title?: string     // 悬浮窗标题（默认同 term）
  content: string    // 悬浮窗内容（支持换行 \n）
  className?: string
}

/**
 * InfoTooltip：鼠标悬停或点击弹出科普说明浮层。
 * - 桌面端：hover 即展开，移开即关闭
 * - 移动端：点击切换，点击外部关闭
 */
export function InfoTooltip({ term, title, content, className = '' }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  // 点击外部关闭
  const handleOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setVisible(false)
    }
  }, [])

  useEffect(() => {
    if (visible) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [visible, handleOutside])

  return (
    <span
      ref={ref}
      className={`info-tooltip-wrap ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible((v) => !v)}
    >
      <span className="info-tooltip-trigger">
        {term}
        <span className="info-tooltip-icon" aria-label="说明">ⓘ</span>
      </span>

      {visible && (
        <span className="info-tooltip-popup" role="tooltip">
          <strong className="info-tooltip-title">{title || term}</strong>
          {content.split('\n').map((line, i) => (
            line ? <span key={i} className="info-tooltip-line">{line}</span> : <span key={i} className="info-tooltip-spacer" />
          ))}
        </span>
      )}
    </span>
  )
}
