import { ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import FeedbackBubble from './FeedbackBubble'
import { useMobileChromeHidden } from '../hooks/useMobileChromeHidden'

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

type FloatingActionButtonProps = {
  ariaLabel: string
  children: ReactNode
  className?: string
  onClick?: () => void
  to?: string
  iconColorClassName?: string
  style?: React.CSSProperties
}

/** 与全站主操作相同的玻璃拟态圆形按钮，可在沉浸式子页复用 */
export function FloatingActionButton({ ariaLabel, children, className = '', onClick, to, iconColorClassName = 'text-slate-700 hover:text-slate-900', style }: FloatingActionButtonProps) {
  const baseClassName = `relative flex h-12 w-12 items-center justify-center rounded-full border shadow-md transition-all duration-300 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${iconColorClassName} ${className}`.trim()
  const defaultStyle = {
    background: 'linear-gradient(180deg, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.42) 100%)',
    borderColor: 'rgba(255,255,255,0.26)',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.32)',
    backdropFilter: 'blur(16px) saturate(1.2)',
  } as const

  const inner = (
    <>
      <span
        className="pointer-events-none absolute inset-[3px] rounded-full"
        aria-hidden
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.04) 100%)' }}
      />
      {children}
    </>
  )

  if (to) {
    return (
      <Link to={to} aria-label={ariaLabel} className={baseClassName} style={style ?? defaultStyle}>
        {inner}
      </Link>
    )
  }

  return (
    <button type="button" aria-label={ariaLabel} className={baseClassName} style={style ?? defaultStyle} onClick={onClick}>
      {inner}
    </button>
  )
}

function ScrollToBottomButton() {
  const location = useLocation()
  const [canScrollToBottom, setCanScrollToBottom] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const isTopicDetailPage = /^\/topics\/[^/]+$/.test(location.pathname)
  const autoScrollSessionRef = useRef(0)
  const lastAutoScrollYRef = useRef(0)
  const touchStartYRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isTopicDetailPage) {
      setCanScrollToBottom(false)
      return
    }

    const updateState = () => {
      const remaining = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
      setCanScrollToBottom(remaining > 160)
    }

    updateState()
    window.addEventListener('scroll', updateState, { passive: true })
    window.addEventListener('resize', updateState)
    return () => {
      window.removeEventListener('scroll', updateState)
      window.removeEventListener('resize', updateState)
    }
  }, [isTopicDetailPage])

  useEffect(() => {
    if (!scrolling) {
      return
    }

    const sessionId = autoScrollSessionRef.current
    const cancelAutoScroll = () => {
      if (autoScrollSessionRef.current !== sessionId) {
        return
      }
      autoScrollSessionRef.current += 1
      setScrolling(false)
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < -4) {
        cancelAutoScroll()
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null
    }

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current
      const currentY = event.touches[0]?.clientY
      if (startY != null && currentY != null && currentY - startY > 10) {
        cancelAutoScroll()
      }
    }

    const handleTouchEnd = () => {
      touchStartYRef.current = null
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (event.key === ' ' && event.shiftKey)) {
        cancelAutoScroll()
      }
    }

    const handleScroll = () => {
      if (window.scrollY < lastAutoScrollYRef.current - 24) {
        cancelAutoScroll()
        return
      }
      lastAutoScrollYRef.current = window.scrollY
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll)
      touchStartYRef.current = null
    }
  }, [scrolling])

  if (!canScrollToBottom) {
    return null
  }

  return (
    <FloatingActionButton
      ariaLabel="滚动到页面底部"
      onClick={async () => {
        if (scrolling) {
          return
        }

        const sessionId = autoScrollSessionRef.current + 1
        autoScrollSessionRef.current = sessionId
        setScrolling(true)
        lastAutoScrollYRef.current = window.scrollY

        const bottomAnchor = document.getElementById('topic-detail-bottom-anchor')
        let lastScrollHeight = 0

        try {
          for (let attempt = 0; attempt < 8; attempt += 1) {
            if (autoScrollSessionRef.current !== sessionId) {
              break
            }

            if (bottomAnchor) {
              bottomAnchor.scrollIntoView({ behavior: 'smooth', block: 'end' })
            } else {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
            }

            await wait(360)

            if (autoScrollSessionRef.current !== sessionId) {
              break
            }

            const currentScrollHeight = document.documentElement.scrollHeight
            const remaining = currentScrollHeight - window.innerHeight - window.scrollY
            lastAutoScrollYRef.current = window.scrollY

            if (remaining <= 24 && Math.abs(currentScrollHeight - lastScrollHeight) <= 8) {
              break
            }

            lastScrollHeight = currentScrollHeight
          }
        } finally {
          if (autoScrollSessionRef.current === sessionId) {
            setScrolling(false)
          }
        }
      }}
      className={`md:hidden ${scrolling ? 'opacity-70' : ''}`}
    >
      <svg className="relative h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="m7.25 8.25 4.75 4.75 4.75-4.75" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="m7.25 12.75 4.75 4.75 4.75-4.75" />
      </svg>
    </FloatingActionButton>
  )
}

export default function FloatingActions() {
  const mobileChromeHidden = useMobileChromeHidden()

  return (
    <div
      className={`fixed right-[max(1rem,env(safe-area-inset-right))] z-[35] flex flex-col items-center gap-3 transition-all duration-300 ease-out ${
        mobileChromeHidden ? 'translate-y-[calc(8rem+env(safe-area-inset-bottom))] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
      }`}
      style={{
        bottom: 'calc(6rem + env(safe-area-inset-bottom))',
      }}
    >
      <FeedbackBubble
        renderTrigger={(open) => (
          <FloatingActionButton ariaLabel="打开反馈" onClick={open}>
            <svg className="relative h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <path
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-4-.8L3 20l1.2-3.6A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </FloatingActionButton>
        )}
      />
      <ScrollToBottomButton />
    </div>
  )
}
