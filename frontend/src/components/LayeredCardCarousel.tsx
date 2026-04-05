import { type ReactNode, useEffect, useRef, useState } from 'react'

export interface LayeredCardCarouselItem {
  id: string
  content: ReactNode
}

interface LayeredCardCarouselProps {
  items: LayeredCardCarouselItem[]
  className?: string
}

export default function LayeredCardCarousel({
  items,
  className = '',
}: LayeredCardCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  useEffect(() => {
    setActiveIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    if (items.length <= 1) {
      return undefined
    }

    const stage = stageRef.current
    if (!stage) {
      return undefined
    }

    const goPrev = () => {
      setActiveIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1))
    }

    const goNext = () => {
      setActiveIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1))
    }

    let wheelLock = false

    const handleWheel = (event: WheelEvent) => {
      const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (Math.abs(primaryDelta) < 18) {
        return
      }
      event.preventDefault()
      if (wheelLock) {
        return
      }
      wheelLock = true
      if (primaryDelta > 0) {
        goNext()
      } else {
        goPrev()
      }
      window.setTimeout(() => {
        wheelLock = false
      }, 260)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrev()
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchStartXRef.current = event.touches[0]?.clientX ?? null
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const startX = touchStartXRef.current
      const endX = event.changedTouches[0]?.clientX ?? null
      touchStartXRef.current = null
      if (startX == null || endX == null) {
        return
      }
      const deltaX = startX - endX
      if (Math.abs(deltaX) < 36) {
        return
      }
      if (deltaX > 0) {
        goNext()
      } else {
        goPrev()
      }
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    stage.addEventListener('touchstart', handleTouchStart, { passive: true })
    stage.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      stage.removeEventListener('wheel', handleWheel)
      stage.removeEventListener('touchstart', handleTouchStart)
      stage.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [items.length])

  if (items.length === 0) {
    return null
  }

  const getCardStyle = (index: number) => {
    const diff = index - activeIndex
    if (diff === 0) {
      return {
        transform: 'translate3d(0, 0, 0)',
        zIndex: 20,
        opacity: 1,
        pointerEvents: 'auto' as const,
      }
    }

    if (Math.abs(diff) === 1) {
      const direction = diff > 0 ? 1 : -1
      return {
        transform: `translate3d(calc(${direction} * min(31vw, 21rem)), 0, 0)`,
        zIndex: 10,
        opacity: 0.66,
        pointerEvents: 'none' as const,
      }
    }

    const direction = diff > 0 ? 1 : -1
    return {
      transform: `translate3d(calc(${direction} * min(42vw, 30rem)), 0, 0)`,
      zIndex: 0,
      opacity: 0,
      pointerEvents: 'none' as const,
    }
  }

  return (
    <div className={className}>
      <div
        ref={stageRef}
        className="relative overflow-x-hidden overflow-y-visible px-2 sm:px-6"
        aria-label="首页卡片轮播"
      >
        <div className="relative h-[34rem] sm:h-[35rem] lg:h-[36rem]">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div
                className="h-[34rem] w-[min(88vw,24rem)] overflow-hidden transition-all duration-500 ease-out sm:h-[35rem] sm:w-[min(86vw,38rem)] lg:h-[36rem] lg:w-[80%] lg:max-w-[58rem]"
                style={getCardStyle(index)}
                aria-hidden={index !== activeIndex}
              >
                {item.content}
              </div>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-12 sm:w-20 lg:w-28" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-30 w-12 sm:w-20 lg:w-28" />
      </div>

      {items.length > 1 ? (
        <>
          <div className="mt-1 flex justify-center gap-2">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === activeIndex
                    ? 'w-8 bg-slate-900'
                    : 'w-2 bg-slate-300 hover:bg-slate-400'
                }`}
                aria-label={`切换到第 ${index + 1} 张卡片`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
