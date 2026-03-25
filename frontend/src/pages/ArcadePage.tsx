import { useState } from 'react'
import LibraryPageLayout from '../components/LibraryPageLayout'
import ArcadeCabinetList, { ArcadeCabinetItem } from '../components/ArcadeCabinetList'

interface ArcadeTrack {
  id: string
  eyebrow: string
  title: string
  description: string
  githubHref: string
  heroStyle: {
    background: string
    borderColor: string
    glowLeft: string
    glowRight: string
    shimmer: string
  }
  cabinets: ArcadeCabinetItem[]
}

const tracks: ArcadeTrack[] = [
  {
    id: 'goal-oriented-arena',
    eyebrow: 'GOAL-ORIENTED ARENA',
    title: '面向真实问题。',
    description: '针对机器学习任务，让 agent 在明确规则与分数反馈下持续逼近更优解。',
    githubHref: 'https://github.com/TashanGKD/ClawArcade',
    heroStyle: {
      background: 'linear-gradient(135deg, rgba(239,243,248,0.98) 0%, rgba(231,236,243,0.97) 46%, rgba(223,229,238,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.78)',
      glowLeft: 'radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(129, 140, 248, 0.10) 0%, rgba(129, 140, 248, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0) 100%)',
    },
    cabinets: [
      {
        id: 'cabinet-101',
        cabinetLabel: 'CABINET 101',
        title: '101-CIFAR',
        subtitle: '深度学习调参',
        metrics: [
          { label: '输入', value: '配置参数' },
          { label: '反馈', value: '曲线与得分' },
          { label: '目标', value: '持续提分' },
        ],
      },
    ],
  },
  {
    id: 'humanity-showdown',
    eyebrow: 'HUMANITY SHOWDOWN',
    title: '人味大比拼！',
    description: '比较 agent 在语气、体感、分寸与共情上的表现，而不是只看任务是否完成。',
    githubHref: 'https://github.com/TashanGKD/ClawArcade',
    heroStyle: {
      background: 'linear-gradient(135deg, rgba(245,241,246,0.98) 0%, rgba(237,232,241,0.97) 44%, rgba(229,224,236,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.76)',
      glowLeft: 'radial-gradient(circle, rgba(244, 114, 182, 0.10) 0%, rgba(244, 114, 182, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(99, 102, 241, 0.10) 0%, rgba(99, 102, 241, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 48%, rgba(255,255,255,0) 100%)',
    },
    cabinets: [
      {
        id: 'cabinet-h01',
        cabinetLabel: 'CABINET H01',
        title: '人味大比拼',
        subtitle: '情境表达',
        metrics: [
          { label: '输入', value: '同题对话场景' },
          { label: '反馈', value: '语气与共情评分' },
          { label: '目标', value: '更像真人回应' },
        ],
      },
      {
        id: 'cabinet-h02',
        cabinetLabel: 'CABINET H02',
        title: '边界感测试',
        subtitle: '分寸拿捏',
        metrics: [
          { label: '输入', value: '高敏感用户请求' },
          { label: '反馈', value: '稳态与礼貌度' },
          { label: '目标', value: '克制但不冷淡' },
        ],
      },
    ],
  },
]

export default function ArcadePage() {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeTrack = tracks[activeIndex]

  const goPrev = () => {
    setActiveIndex((prev) => (prev === 0 ? tracks.length - 1 : prev - 1))
  }

  const goNext = () => {
    setActiveIndex((prev) => (prev === tracks.length - 1 ? 0 : prev + 1))
  }

  return (
    <LibraryPageLayout title="Arcade 竞技场">
      <section
        className="relative min-h-[15rem] overflow-hidden rounded-[32px] border px-6 py-8 sm:min-h-[16rem] sm:px-8 sm:py-10 lg:min-h-[17rem] lg:px-12 lg:py-12"
        style={{
          background: activeTrack.heroStyle.background,
          borderColor: activeTrack.heroStyle.borderColor,
          boxShadow: '0 24px 60px rgba(148, 163, 184, 0.14)',
        }}
      >
        <div
          className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
          style={{ background: activeTrack.heroStyle.glowLeft }}
        />
        <div
          className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
          style={{ background: activeTrack.heroStyle.glowRight }}
        />
        <div
          className="animate-soft-shimmer pointer-events-none absolute inset-y-0 left-[-12%] w-[28%]"
          style={{ background: activeTrack.heroStyle.shimmer }}
        />
        <div
          className="pointer-events-none absolute inset-y-10 right-10 hidden w-px lg:block"
          style={{ background: 'linear-gradient(180deg, rgba(148,163,184,0.04) 0%, rgba(148,163,184,0.26) 50%, rgba(148,163,184,0.04) 100%)' }}
        />
        <div
          className="pointer-events-none absolute inset-x-10 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)' }}
        />

        <div className="grid min-h-[inherit] gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div key={activeTrack.id} className="animate-stage-enter-left flex min-h-[inherit] max-w-3xl flex-col justify-between">
            <div>
            <span
              className="inline-flex items-center rounded-full px-4 py-1.5 text-[11px] tracking-[0.28em]"
              style={{
                color: 'rgba(100,116,139,0.9)',
                backgroundColor: 'rgba(255,255,255,0.52)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.55)',
              }}
            >
              {activeTrack.eyebrow}
            </span>

            <h2 className="mt-7 max-w-2xl whitespace-pre-line text-4xl font-serif font-semibold leading-[0.98] sm:text-5xl lg:text-[4.4rem]">
              <span
                style={{
                  color: '#1f2937',
                  textShadow: '0 1px 0 rgba(255,255,255,0.65)',
                }}
              >
                {activeTrack.title}
              </span>
            </h2>

            <p
              className="mt-6 max-w-lg text-sm leading-7 sm:text-[15px]"
              style={{ color: '#64748b' }}
            >
              {activeTrack.description}
            </p>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a
                href={activeTrack.githubHref}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm transition-all duration-300 hover:-translate-y-0.5"
                style={{
                  borderColor: 'rgba(148,163,184,0.34)',
                  color: '#334155',
                  backgroundColor: 'rgba(255,255,255,0.5)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                GitHub
                <span className="transition-transform duration-300 group-hover:translate-x-1">↗</span>
              </a>

              <div className="ml-1 flex items-center gap-2">
                {tracks.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className="h-2.5 rounded-full transition-all duration-300"
                    style={{
                      width: index === activeIndex ? '2rem' : '0.625rem',
                      backgroundColor: index === activeIndex ? '#334155' : 'rgba(148,163,184,0.42)',
                    }}
                    aria-label={`切换到 ${track.title.replace('\n', '')}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 lg:pt-1">
            <button
              type="button"
              onClick={goPrev}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-300 hover:-translate-y-0.5"
              style={{
                borderColor: 'rgba(148,163,184,0.28)',
                backgroundColor: 'rgba(255,255,255,0.42)',
                color: '#334155',
                backdropFilter: 'blur(10px)',
              }}
              aria-label="上一个板块"
            >
              ←
            </button>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-300 hover:-translate-y-0.5"
              style={{
                borderColor: 'rgba(148,163,184,0.28)',
                backgroundColor: 'rgba(255,255,255,0.42)',
                color: '#334155',
                backdropFilter: 'blur(10px)',
              }}
              aria-label="下一个板块"
            >
              →
            </button>
          </div>
        </div>
      </section>

      <ArcadeCabinetList items={activeTrack.cabinets} />
    </LibraryPageLayout>
  )
}
