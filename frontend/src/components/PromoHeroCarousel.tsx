import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export interface PromoHeroStyle {
  background: string
  borderColor: string
  glowLeft: string
  glowRight: string
  shimmer: string
  chipBackground?: string
  chipBorder?: string
  chipColor?: string
  actionBackground?: string
  actionBorder?: string
  actionColor?: string
}

export interface PromoHeroTrack {
  id: string
  eyebrow: string
  title: string
  description: string
  style: PromoHeroStyle
  titleTo?: string
  action?: {
    label: string
    to?: string
    href?: string
  }
}

interface PromoHeroCarouselProps {
  tracks: PromoHeroTrack[]
  autoplayMs?: number
  className?: string
}

const DEFAULT_CHIP_BACKGROUND = 'rgba(255,255,255,0.52)'
const DEFAULT_CHIP_BORDER = 'rgba(255,255,255,0.55)'
const DEFAULT_CHIP_COLOR = 'rgba(100,116,139,0.9)'
const DEFAULT_ACTION_BACKGROUND = 'rgba(255,255,255,0.5)'
const DEFAULT_ACTION_BORDER = 'rgba(148,163,184,0.34)'
const DEFAULT_ACTION_COLOR = '#334155'

export default function PromoHeroCarousel({
  tracks,
  autoplayMs = 5000,
  className = '',
}: PromoHeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex((prev) => (tracks.length === 0 ? 0 : Math.min(prev, tracks.length - 1)))
  }, [tracks.length])

  useEffect(() => {
    if (tracks.length <= 1) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev === tracks.length - 1 ? 0 : prev + 1))
    }, autoplayMs)
    return () => window.clearInterval(timer)
  }, [autoplayMs, tracks.length])

  if (tracks.length === 0) {
    return null
  }

  const activeTrack = tracks[activeIndex]
  const chipBackground = activeTrack.style.chipBackground ?? DEFAULT_CHIP_BACKGROUND
  const chipBorder = activeTrack.style.chipBorder ?? DEFAULT_CHIP_BORDER
  const chipColor = activeTrack.style.chipColor ?? DEFAULT_CHIP_COLOR
  const actionBackground = activeTrack.style.actionBackground ?? DEFAULT_ACTION_BACKGROUND
  const actionBorder = activeTrack.style.actionBorder ?? DEFAULT_ACTION_BORDER
  const actionColor = activeTrack.style.actionColor ?? DEFAULT_ACTION_COLOR

  const goPrev = () => {
    setActiveIndex((prev) => (prev === 0 ? tracks.length - 1 : prev - 1))
  }

  const goNext = () => {
    setActiveIndex((prev) => (prev === tracks.length - 1 ? 0 : prev + 1))
  }

  const titleContent = (
    <>
      <h2 className="mt-5 max-w-2xl whitespace-pre-line text-[2.35rem] font-serif font-semibold leading-[0.94] sm:mt-7 sm:text-5xl sm:leading-[0.98] lg:text-[4.4rem]">
        <span style={{ color: '#1f2937', textShadow: '0 1px 0 rgba(255,255,255,0.65)' }}>
          {activeTrack.title}
        </span>
      </h2>
      <p
        className="mt-4 max-w-md text-[13px] leading-6 sm:mt-6 sm:max-w-lg sm:text-[15px] sm:leading-7"
        style={{ color: '#64748b' }}
      >
        {activeTrack.description}
      </p>
    </>
  )

  return (
    <section
      className={`relative h-full min-h-[14rem] overflow-hidden rounded-[28px] border px-5 py-6 sm:min-h-[16rem] sm:rounded-[32px] sm:px-8 sm:py-10 lg:min-h-[17rem] lg:px-12 lg:py-12 ${className}`.trim()}
      style={{
        background: activeTrack.style.background,
        borderColor: activeTrack.style.borderColor,
        boxShadow: '0 24px 60px rgba(148, 163, 184, 0.14)',
      }}
    >
      <div
        className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
        style={{ background: activeTrack.style.glowLeft }}
      />
      <div
        className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
        style={{ background: activeTrack.style.glowRight }}
      />
      <div
        className="animate-soft-shimmer pointer-events-none absolute inset-y-0 left-[-12%] w-[28%]"
        style={{ background: activeTrack.style.shimmer }}
      />
      <div
        className="pointer-events-none absolute inset-x-10 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)' }}
      />

      <div className="grid h-full min-h-[inherit] gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
        <div key={activeTrack.id} className="animate-stage-enter-left flex h-full min-h-[inherit] max-w-3xl flex-col justify-between">
          <div>
            <span
              className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]"
              style={{
                color: chipColor,
                backgroundColor: chipBackground,
                backdropFilter: 'blur(12px)',
                border: `1px solid ${chipBorder}`,
              }}
            >
              {activeTrack.eyebrow}
            </span>

            {activeTrack.titleTo ? (
              <Link
                to={activeTrack.titleTo}
                className="mt-5 block max-w-2xl rounded-2xl outline-none ring-offset-2 transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-indigo-300 motion-reduce:transition-none sm:mt-7"
              >
                {titleContent}
              </Link>
            ) : titleContent}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
            {activeTrack.action ? (
              activeTrack.action.to ? (
                <Link
                  to={activeTrack.action.to}
                  className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
                  style={{
                    borderColor: actionBorder,
                    color: actionColor,
                    backgroundColor: actionBackground,
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  {activeTrack.action.label}
                  <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
                </Link>
              ) : activeTrack.action.href ? (
                <a
                  href={activeTrack.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
                  style={{
                    borderColor: actionBorder,
                    color: actionColor,
                    backgroundColor: actionBackground,
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  {activeTrack.action.label}
                  <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
                </a>
              ) : null
            ) : null}

            {tracks.length > 1 ? (
              <div className="relative z-10 ml-1 flex items-center gap-2">
                {tracks.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className="h-2.5 rounded-full transition-all duration-300"
                    style={{
                      width: index === activeIndex ? '2rem' : '0.625rem',
                      backgroundColor: index === activeIndex ? actionColor : 'rgba(148,163,184,0.42)',
                    }}
                    aria-label={`切换到 ${track.title.replace('\n', '')}`}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {tracks.length > 1 ? (
          <div className="relative z-10 flex items-center justify-end gap-3 lg:pt-1">
            <button
              type="button"
              onClick={goPrev}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:h-12 sm:w-12 sm:text-base"
              style={{
                borderColor: actionBorder,
                backgroundColor: actionBackground,
                color: actionColor,
                backdropFilter: 'blur(10px)',
              }}
              aria-label="上一个板块"
            >
              ←
            </button>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:h-12 sm:w-12 sm:text-base"
              style={{
                borderColor: actionBorder,
                backgroundColor: actionBackground,
                color: actionColor,
                backdropFilter: 'blur(10px)',
              }}
              aria-label="下一个板块"
            >
              →
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
