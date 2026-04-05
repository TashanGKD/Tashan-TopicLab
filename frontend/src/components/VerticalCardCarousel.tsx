import { type ReactNode, useEffect, useRef, useState } from 'react'
import { getHomeCardTheme, type HomeCardThemeName } from './homeCardTheme'

export interface VerticalCardCarouselItem {
  id: string
  label: string
  audience: string
  themeName: HomeCardThemeName
  content: ReactNode
}

interface VerticalCardCarouselProps {
  items: VerticalCardCarouselItem[]
  activeIndex: number
  onChange: (index: number) => void
  className?: string
}

function getRelativeIndex(index: number, activeIndex: number, total: number) {
  const forward = (index - activeIndex + total) % total
  const backward = (activeIndex - index + total) % total

  if (forward === 0) {
    return 0
  }

  return forward <= backward ? forward : -backward
}

export default function VerticalCardCarousel({
  items,
  activeIndex,
  onChange,
  className = '',
}: VerticalCardCarouselProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const previousActiveIndexRef = useRef(activeIndex)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [mobileAnimationClassName, setMobileAnimationClassName] = useState('animate-fade-in')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches)

    syncPreference()
    mediaQuery.addEventListener('change', syncPreference)

    return () => {
      mediaQuery.removeEventListener('change', syncPreference)
    }
  }, [])

  useEffect(() => {
    if (items.length <= 1) {
      return undefined
    }

    const goPrev = () => {
      onChange(activeIndex === 0 ? items.length - 1 : activeIndex - 1)
    }

    const goNext = () => {
      onChange(activeIndex === items.length - 1 ? 0 : activeIndex + 1)
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

    const container = containerRef.current
    container?.addEventListener('touchstart', handleTouchStart, { passive: true })
    container?.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      container?.removeEventListener('touchstart', handleTouchStart)
      container?.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeIndex, items.length, onChange])

  useEffect(() => {
    if (prefersReducedMotion || items.length <= 1) {
      setMobileAnimationClassName('')
      previousActiveIndexRef.current = activeIndex
      return
    }

    const previousActiveIndex = previousActiveIndexRef.current

    if (previousActiveIndex === activeIndex) {
      setMobileAnimationClassName('animate-fade-in')
      return
    }

    const total = items.length
    const forward = (activeIndex - previousActiveIndex + total) % total
    const backward = (previousActiveIndex - activeIndex + total) % total

    setMobileAnimationClassName(forward <= backward ? 'animate-stage-enter-right' : 'animate-stage-enter-left')
    previousActiveIndexRef.current = activeIndex
  }, [activeIndex, items.length, prefersReducedMotion])

  if (items.length === 0) {
    return null
  }

  const transitionDuration = prefersReducedMotion ? '0ms' : '520ms'
  const activeItem = items[activeIndex] ?? items[0]
  const activeTheme = getHomeCardTheme(activeItem.themeName)

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <div className="relative lg:hidden" aria-label="首页卡片轮播舞台">
        <div
          className="pointer-events-none absolute inset-x-[8%] top-[4%] h-40 rounded-full blur-3xl transition-all duration-700"
          style={{
            background: `radial-gradient(circle, ${activeTheme.activeGlow} 0%, rgba(255,255,255,0) 72%)`,
          }}
        />
        <div key={activeItem?.id} className={`relative z-10 ${mobileAnimationClassName}`.trim()}>
          <div
            className="rounded-[2rem] transition-all duration-700"
            style={{
              boxShadow: `0 0 0 1px ${activeTheme.activeEdge}, 0 28px 72px ${activeTheme.activeShadow}, 0 0 64px ${activeTheme.activeGlow}`,
            }}
          >
            <div className="relative overflow-hidden rounded-[2rem]">
              {!prefersReducedMotion ? (
                <div
                  className="animate-card-specular-sweep pointer-events-none absolute inset-y-0 left-[-18%] w-[42%]"
                  style={{
                    background: 'linear-gradient(110deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.1) 34%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0.12) 64%, rgba(255,255,255,0) 100%)',
                    mixBlendMode: 'screen',
                  }}
                />
              ) : null}
              {activeItem?.content}
            </div>
          </div>
        </div>
      </div>

      <div
        className="relative hidden h-[34rem] overflow-visible lg:block"
        aria-label="首页卡片轮播舞台"
      >
        <div
          className="pointer-events-none absolute inset-x-[12%] top-[8%] h-[72%] rounded-full blur-3xl transition-all duration-700"
          style={{
            background: `radial-gradient(circle, ${activeTheme.ambientPrimary} 0%, rgba(255,255,255,0) 72%)`,
          }}
        />
        <div
          className="pointer-events-none absolute right-[8%] top-[12%] h-[56%] w-[52%] rounded-full border blur-[1px] transition-all duration-700"
          style={{
            borderColor: activeTheme.activeEdge,
            background: `linear-gradient(180deg, ${activeTheme.ambientTertiary} 0%, rgba(255,255,255,0.12) 100%)`,
          }}
        />
        <div
          className="pointer-events-none absolute bottom-[10%] left-[10%] h-[46%] w-[42%] rounded-full blur-2xl transition-all duration-700"
          style={{
            background: `radial-gradient(circle, ${activeTheme.ambientSecondary} 0%, rgba(255,255,255,0) 75%)`,
          }}
        />

        {items.map((item, index) => {
          const relativeIndex = getRelativeIndex(index, activeIndex, items.length)
          const itemTheme = getHomeCardTheme(item.themeName)

          let transform = 'translate3d(0%, 0%, 0px) rotate(0deg) scale(1)'
          let opacity = 1
          let zIndex = 30
          let filter = 'none'

          if (relativeIndex === 1) {
            transform = 'translate3d(22%, -16%, -120px) rotate(10deg) scale(0.92)'
            opacity = 0.74
            zIndex = 20
            filter = 'none'
          } else if (relativeIndex === -1) {
            transform = 'translate3d(14%, 18%, -90px) rotate(-7deg) scale(0.94)'
            opacity = 0.66
            zIndex = 10
            filter = 'none'
          } else if (relativeIndex !== 0) {
            transform = 'translate3d(28%, 0%, -180px) rotate(12deg) scale(0.88)'
            opacity = 0.18
            zIndex = 0
            filter = 'none'
          }

          return (
            <div
              key={item.id}
              className="absolute inset-0 flex items-center justify-center lg:justify-end"
              style={{ zIndex }}
            >
              <div
                className="w-[min(84vw,20rem)] origin-center sm:w-[22rem] lg:w-[28rem]"
                style={{
                  opacity,
                  filter,
                  transform,
                  transitionDuration,
                  transitionProperty: 'transform, opacity, filter',
                  transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                  pointerEvents: relativeIndex === 0 ? 'auto' : 'none',
                }}
                aria-hidden={relativeIndex !== 0}
              >
                <div
                  className="rounded-[2.25rem]"
                  style={{
                    transform: relativeIndex === 0 ? 'scale(1.015)' : 'scale(1)',
                    transitionDuration,
                    transitionProperty: 'transform, box-shadow',
                    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow:
                      relativeIndex === 0
                        ? `0 0 0 1px ${itemTheme.activeEdge}, 0 30px 78px ${itemTheme.activeShadow}, 0 0 72px ${itemTheme.activeGlow}`
                        : 'none',
                  }}
                >
                  <div className="relative overflow-hidden rounded-[2.25rem]">
                    {relativeIndex !== 0 ? (
                      <div
                        className="pointer-events-none absolute inset-0 transition-all duration-700"
                        style={{
                          background: `linear-gradient(145deg, ${activeTheme.activeGlow} 0%, rgba(255,255,255,0) 64%)`,
                          opacity: relativeIndex === 1 || relativeIndex === -1 ? 0.34 : 0.18,
                          mixBlendMode: 'screen',
                        }}
                      />
                    ) : null}
                    {relativeIndex === 0 && !prefersReducedMotion ? (
                      <div
                        className="animate-card-specular-sweep pointer-events-none absolute inset-y-0 left-[-16%] w-[38%]"
                        style={{
                          background: 'linear-gradient(110deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.1) 34%, rgba(255,255,255,0.72) 50%, rgba(255,255,255,0.12) 64%, rgba(255,255,255,0) 100%)',
                          mixBlendMode: 'screen',
                        }}
                      />
                    ) : null}
                    {relativeIndex === 0 ? (
                      <div
                        className="pointer-events-none absolute inset-0 transition-all duration-700"
                        style={{
                          boxShadow: `inset 0 1px 0 ${itemTheme.activeEdge}, inset 0 0 0 1px rgba(255,255,255,0.16)`,
                        }}
                      />
                    ) : null}
                    {item.content}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
