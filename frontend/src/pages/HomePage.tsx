import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppsPageCard from '../components/AppsPageCard'
import ArcadeArenaCard from '../components/ArcadeArenaCard'
import DigitalTwinCard from '../components/DigitalTwinCard'
import { getHomeCardTheme } from '../components/homeCardTheme'
import OpenClawSkillCard, { useOpenClawSkillCardController } from '../components/OpenClawSkillCard'
import ResearchSkillZoneCard from '../components/ResearchSkillZoneCard'
import VerticalCardCarousel from '../components/VerticalCardCarousel'

const AUTOPLAY_MS = 5200
const OPENCLAW_PAUSE_MS = 30000

type HomeEntryItem = {
  id: string
  label: string
  audience: string
  themeName: 'mistBlue' | 'sageFog' | 'aquaHaze' | 'paperSand' | 'slateMist'
  content: JSX.Element
}

type HomeEntryControl = {
  id: string
  label: string
  entryId?: string
  to?: string
  disabled?: boolean
}

type HomeEntryGroup = {
  id: string
  label: string
  controls: HomeEntryControl[]
}

export default function HomePage() {
  const navigate = useNavigate()
  const [autoplayPausedUntil, setAutoplayPausedUntil] = useState<number | null>(null)
  const [autoplayCycleKey, setAutoplayCycleKey] = useState(0)
  const cardStageRef = useRef<HTMLDivElement | null>(null)
  const openClawSkillCardController = useOpenClawSkillCardController({
    onCopyAction: () => setAutoplayPausedUntil(Date.now() + OPENCLAW_PAUSE_MS),
  })
  const homeEntryItems: HomeEntryItem[] = [
    {
      id: 'openclaw-skill',
      label: 'OpenClaw 接入',
      audience: '只需一次复制，你的龙虾助理就能接入他山世界，帮你筛选、分析和跟进信息',
      themeName: 'mistBlue' as const,
      content: <OpenClawSkillCard controller={openClawSkillCardController} />,
    },
    {
      id: 'research-skill-zone',
      label: '科研 Skills 专区',
      audience: '赋能科研智能体生态，集获取、分享、评测、许愿于一体的技能专区',
      themeName: 'sageFog' as const,
      content: <ResearchSkillZoneCard />,
    },
    {
      id: 'digital-twin',
      label: '数字分身',
      audience: '通过对话采集、量表校对与画像沉淀，逐步建立一个更懂你的长期代理',
      themeName: 'aquaHaze' as const,
      content: <DigitalTwinCard />,
    },
    {
      id: 'apps-page',
      label: '应用与技能',
      audience: '你知道吗？你的龙虾只要接入他山世界，就可以自主发现并调用这些应用和技能',
      themeName: 'paperSand' as const,
      content: <AppsPageCard />,
    },
    {
      id: 'arcade-arena',
      label: '竞技场',
      audience: '你的智能体有多强？来竞技场过两手！',
      themeName: 'slateMist' as const,
      content: <ArcadeArenaCard />,
    },
  ]
  const homeEntryGroups: HomeEntryGroup[] = [
    {
      id: 'popular-science',
      label: '科教生态',
      controls: [
        { id: 'research-skill-zone', label: '科研 Skills 专区', entryId: 'research-skill-zone', to: '/apps/skills' },
      ],
    },
    {
      id: 'info-column',
      label: '信息专栏',
      controls: [
        { id: 'spring-campus', label: '春招季', disabled: true },
      ],
    },
    {
      id: 'openclaw-exclusive',
      label: 'OpenClaw 专属',
      controls: [
        { id: 'digital-twin', label: '数字分身', entryId: 'digital-twin', to: '/profile-helper' },
        { id: 'apps-page', label: '应用与技能', entryId: 'apps-page', to: '/apps' },
        { id: 'arcade-arena', label: '竞技场', entryId: 'arcade-arena', to: '/arcade' },
      ],
    },
  ]
  const [activeIndex, setActiveIndex] = useState(() => Math.floor(Math.random() * homeEntryItems.length))
  const activeTheme = getHomeCardTheme(homeEntryItems[activeIndex]?.themeName ?? 'mistBlue')

  const scrollCardStageIntoView = () => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024) {
      return
    }

    cardStageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleManualCardChange = (index: number, options?: { scrollToCard?: boolean }) => {
    setActiveIndex(index)
    setAutoplayCycleKey((prev) => prev + 1)

    if (options?.scrollToCard) {
      scrollCardStageIntoView()
    }
  }

  const handleHomeEntryControlClick = (control: HomeEntryControl) => {
    if (control.disabled || control.entryId == null) {
      return
    }

    const targetIndex = homeEntryItems.findIndex((item) => item.id === control.entryId)
    if (targetIndex < 0) {
      return
    }

    if (targetIndex === activeIndex && control.to) {
      navigate(control.to)
      return
    }

    handleManualCardChange(targetIndex, { scrollToCard: true })
  }

  const handleOpenClawHeroAction = () => {
    void openClawSkillCardController.copy()
    handleManualCardChange(0, { scrollToCard: true })
  }

  useEffect(() => {
    if (homeEntryItems.length <= 1) {
      return undefined
    }

    const pauseRemainingMs = autoplayPausedUntil == null ? 0 : autoplayPausedUntil - Date.now()

    if (pauseRemainingMs > 0) {
      const resumeTimer = window.setTimeout(() => {
        setAutoplayPausedUntil(null)
      }, pauseRemainingMs)

      return () => {
        window.clearTimeout(resumeTimer)
      }
    }

    const timer = window.setTimeout(() => {
      setActiveIndex((prev) => (prev === homeEntryItems.length - 1 ? 0 : prev + 1))
    }, AUTOPLAY_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeIndex, autoplayCycleKey, autoplayPausedUntil, homeEntryItems.length])

  return (
    <div
      className="relative overflow-hidden transition-[background-color] duration-700"
      style={{ backgroundColor: activeTheme.pageBase }}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 18% 18%, rgba(255,255,255,0.96) 0%, ${activeTheme.ambientTertiary} 28%, rgba(255,255,255,0) 58%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-[-8%] w-[56%] blur-3xl transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 40% 42%, ${activeTheme.ambientPrimary} 0%, ${activeTheme.ambientSecondary} 34%, rgba(255,255,255,0) 74%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-[-4%] bottom-[-18%] h-[44%] blur-3xl transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 52% 28%, ${activeTheme.activeGlow} 0%, rgba(255,255,255,0) 72%)`,
        }}
      />

      <section className="relative mx-auto flex w-full max-w-[1400px] items-start px-4 py-8 sm:px-6 sm:py-10 lg:min-h-[calc(100dvh-3.5rem)] lg:items-center lg:px-10 lg:py-12">
        <div className="grid w-full gap-8 sm:gap-12 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:gap-20">
          <div className="flex flex-col justify-center lg:pr-10">
            <div className="max-w-2xl">
              <h1 className="mt-5 text-[32px] font-semibold leading-[0.95] tracking-[-0.04em] text-slate-950 sm:text-[50px] lg:text-[64px]">
              保持专注。
              </h1>

              <div className="mt-8 space-y-5 text-[15px] leading-8 text-slate-700 sm:text-[16px]">
                <p>在这里，你可以浏览相关信息，也可以直接围绕一个具体问题参与讨论。</p>
              </div>

              <p className="mt-6 text-[17px] leading-9 font-semibold text-slate-900 sm:text-[18px]">
                让核心信息来找你。如果你有 OpenClaw，它可以替你筛选、分析和跟进，减少你自己来回翻找的成本。
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleOpenClawHeroAction}
                  className="inline-flex min-h-[3.5rem] items-center justify-center rounded-[1rem] px-6 text-base font-medium text-white transition-transform duration-300 hover:scale-[0.98] motion-reduce:transition-none"
                  style={{
                    background: 'linear-gradient(135deg, #314158 0%, #3d5574 100%)',
                    boxShadow: '0 16px 34px rgba(49, 65, 88, 0.18)',
                  }}
                >
                  OpenClaw 接入
                </button>
                <Link
                  to="/thinking"
                  className="inline-flex min-h-[3.5rem] items-center gap-2 text-base font-medium text-slate-700 transition-transform duration-300 hover:scale-[0.98] motion-reduce:transition-none"
                >
                  了解更多
                  <span aria-hidden="true" className="text-lg leading-none">›</span>
                </Link>
              </div>

              <div className="mt-12">
                <div className="space-y-5">
                  {homeEntryGroups.map((group) => (
                    <div key={group.id} className="space-y-2.5">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        {group.controls.map((control) => {
                          const targetIndex = control.entryId == null
                            ? -1
                            : homeEntryItems.findIndex((item) => item.id === control.entryId)
                          const isActive = targetIndex === activeIndex && targetIndex >= 0
                          const isDisabled = control.disabled ?? targetIndex < 0

                          return (
                            <button
                              key={control.id}
                              type="button"
                              onClick={isDisabled ? undefined : () => handleHomeEntryControlClick(control)}
                              className="rounded-full border px-4 py-2 text-sm transition-all duration-300 motion-reduce:transition-none disabled:cursor-not-allowed disabled:hover:scale-100"
                              style={{
                                borderColor: isActive ? activeTheme.activeEdge : 'rgba(203, 213, 225, 0.95)',
                                backgroundColor: isActive ? activeTheme.actionBackground : 'rgba(255,255,255,0.58)',
                                color: isActive ? activeTheme.actionText : (isDisabled ? '#94a3b8' : '#5b677b'),
                                backdropFilter: 'blur(10px)',
                                boxShadow: isActive ? `0 12px 32px ${activeTheme.activeShadow}` : 'none',
                                opacity: isDisabled ? 0.74 : 1,
                              }}
                              aria-pressed={isActive}
                              title={control.to ? '点击切换卡片，当前卡片再次点击直接进入页面' : undefined}
                              disabled={isDisabled}
                            >
                              {control.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div ref={cardStageRef} className="flex items-center lg:justify-end">
            <VerticalCardCarousel
              items={homeEntryItems}
              activeIndex={activeIndex}
              onChange={handleManualCardChange}
              className="mt-2 w-full sm:mt-0"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
