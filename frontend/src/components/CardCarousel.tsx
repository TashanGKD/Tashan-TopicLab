import { useEffect, useRef, useState } from 'react'

interface Card {
  id: string
  title: string
  description: string
  badge?: string
}

interface CardCarouselProps {
  cards: Card[]
  onCardSelect?: (card: Card, index: number) => void
}

export default function CardCarousel({ cards, onCardSelect }: CardCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isScrolling, setIsScrolling] = useState(false)

  // 计算卡片样式
  const getCardStyle = (index: number) => {
    const diff = index - activeIndex
    const isCenter = diff === 0

    return {
      transform: isCenter
        ? 'translateY(0px) scale(1.05)'
        : `translateY(24px) scale(0.95)`,
      zIndex: isCenter ? 10 : 5,
      opacity: isCenter ? 1 : 0.88,
      filter: isCenter ? 'none' : 'brightness(0.95)',
      transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    }
  }

  // 监听滚动
  const handleScroll = () => {
    if (!scrollContainerRef.current || isScrolling) return

    const container = scrollContainerRef.current
    const scrollLeft = container.scrollLeft
    const cardWidth = container.offsetWidth * 0.7 // 卡片宽度约为容器的 70%
    const newIndex = Math.round(scrollLeft / cardWidth)

    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < cards.length) {
      setActiveIndex(newIndex)
      onCardSelect?.(cards[newIndex], newIndex)
    }
  }

  // 滚动到指定卡片
  const scrollToCard = (index: number) => {
    if (!scrollContainerRef.current) return
    
    const container = scrollContainerRef.current
    const cardWidth = container.offsetWidth * 0.7
    const scrollPosition = index * cardWidth

    container.scrollTo({
      left: scrollPosition,
      behavior: 'smooth',
    })
  }

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && activeIndex > 0) {
        scrollToCard(activeIndex - 1)
      } else if (e.key === 'ArrowRight' && activeIndex < cards.length - 1) {
        scrollToCard(activeIndex + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex])

  return (
    <div className="relative w-full">
      {/* 渐变遮罩 - 表示可滚动 */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-20" />
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-20" />

      {/* 滚动容器 */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-[-20%] overflow-x-auto overflow-y-hidden scroll-smooth px-[20%] pb-8 pt-4 scrollbar-hide"
        style={{
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
        }}
        onScroll={handleScroll}
        onTouchStart={() => setIsScrolling(true)}
        onTouchEnd={() => setIsScrolling(false)}
      >
        {cards.map((card, index) => {
          const style = getCardStyle(index)
          const isActive = index === activeIndex

          return (
            <div
              key={card.id}
              className="relative flex-shrink-0 w-[280px] sm:w-[320px] md:w-[360px] scroll-snap-center"
              style={style}
              onClick={() => scrollToCard(index)}
            >
              {/* 卡片阴影层 */}
              <div
                className={`absolute inset-0 rounded-[28px] transition-all duration-300 ${
                  isActive
                    ? 'shadow-2xl shadow-slate-400/40'
                    : 'shadow-lg shadow-slate-300/20'
                }`}
              />

              {/* 卡片主体 */}
              <div
                className={`relative overflow-hidden rounded-[28px] border px-5 py-6 transition-all duration-300 ${
                  isActive
                    ? 'border-slate-200 bg-white'
                    : 'border-slate-300/80 bg-white/95'
                }`}
                style={{
                  boxShadow: isActive
                    ? '0 24px 60px rgba(148, 163, 184, 0.14)'
                    : '0 10px 30px rgba(148, 163, 184, 0.08)',
                }}
              >
                {/* 装饰性光晕 - 仅活动卡片显示 */}
                {isActive && (
                  <>
                    <div
                      className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 70%)',
                      }}
                    />
                    <div
                      className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(129, 140, 248, 0.1) 0%, rgba(129, 140, 248, 0) 72%)',
                      }}
                    />
                  </>
                )}

                {/* 卡片内容 */}
                <div className="relative">
                  {card.badge && (
                    <p className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] text-slate-600/90"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.52)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.55)',
                      }}
                    >
                      {card.badge}
                    </p>
                  )}

                  <h3
                    className={`mt-4 font-serif font-semibold leading-tight transition-colors ${
                      isActive
                        ? 'text-[2rem] text-slate-900'
                        : 'text-[1.75rem] text-slate-700'
                    }`}
                  >
                    {card.title}
                  </h3>

                  <p
                    className={`mt-3 text-sm leading-6 transition-colors ${
                      isActive
                        ? 'text-slate-600'
                        : 'text-slate-500'
                    }`}
                  >
                    {card.description}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 滚动指示器 */}
      <div className="mt-4 flex justify-center gap-2">
        {cards.map((_, index) => (
          <button
            key={index}
            onClick={() => scrollToCard(index)}
            className={`h-2 rounded-full transition-all duration-300 ${
              index === activeIndex
                ? 'w-8 bg-slate-900'
                : 'w-2 bg-slate-300 hover:bg-slate-400'
            }`}
            aria-label={`Scroll to card ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
