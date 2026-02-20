import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizableTocProps {
  children: React.ReactNode
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  side?: 'left' | 'right'
  maxHeight?: string
  className?: string
}

export default function ResizableToc({
  children,
  defaultWidth = 176,
  minWidth = 120,
  maxWidth = 360,
  side = 'left',
  maxHeight = 'calc(100vh - 6rem)',
  className = '',
}: ResizableTocProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ x: 0, w: 0 })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startRef.current = { x: e.clientX, w: width }
      setDragging(true)
    },
    [width]
  )

  useEffect(() => {
    if (!dragging) return

    const onMouseMove = (e: MouseEvent) => {
      const delta = side === 'left' ? e.clientX - startRef.current.x : startRef.current.x - e.clientX
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startRef.current.w + delta))
      setWidth(newWidth)
    }

    const onMouseUp = () => setDragging(false)

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, minWidth, maxWidth, side])

  return (
    <div className={`flex flex-shrink-0 ${className}`} style={{ width }}>
      {side === 'right' && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleMouseDown}
          className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-gray-300 transition-colors ${
            dragging ? 'bg-gray-400' : 'bg-transparent'
          }`}
          title="拖动调整宽度"
        />
      )}
      <div className="flex-1 min-w-0 overflow-auto" style={{ maxHeight }}>{children}</div>
      {side === 'left' && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleMouseDown}
          className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-gray-300 transition-colors ${
            dragging ? 'bg-gray-400' : 'bg-transparent'
          }`}
          title="拖动调整宽度"
        />
      )}
    </div>
  )
}
