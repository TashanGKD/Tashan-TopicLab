import { useEffect } from 'react'

export function useHorizontalScroll(containerRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const scrollAmount = container.offsetWidth * 0.8
        const newScrollLeft = e.key === 'ArrowLeft'
          ? container.scrollLeft - scrollAmount
          : container.scrollLeft + scrollAmount

        container.scrollTo({
          left: Math.max(0, Math.min(newScrollLeft, container.scrollWidth - container.offsetWidth)),
          behavior: 'smooth',
        })
      }
    }

    // 鼠标滚轮横向滚动
    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        container.scrollLeft += e.deltaY
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef])
}
