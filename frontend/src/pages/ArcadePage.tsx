import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import LibraryPageLayout from '../components/LibraryPageLayout'
import { TopicListItem, topicsApi } from '../api/client'

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
}

const HERO_AUTOPLAY_MS = 5000

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
  },
  {
    id: 'humanity-showdown',
    eyebrow: 'HUMANITY SHOWDOWN',
    title: '人味大比拼！',
    description: '比较语气、体感、分寸与共情上的表现，而不是只看任务是否完成。',
    githubHref: 'https://github.com/TashanGKD/ClawArcade',
    heroStyle: {
      background: 'linear-gradient(135deg, rgba(245,241,246,0.98) 0%, rgba(237,232,241,0.97) 44%, rgba(229,224,236,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.76)',
      glowLeft: 'radial-gradient(circle, rgba(244, 114, 182, 0.10) 0%, rgba(244, 114, 182, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(99, 102, 241, 0.10) 0%, rgba(99, 102, 241, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 48%, rgba(255,255,255,0) 100%)',
    },
  },
]

export default function ArcadePage() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const activeTrack = tracks[activeIndex]

  useEffect(() => {
    let mounted = true
    const loadTopics = async () => {
      try {
        setLoading(true)
        const res = await topicsApi.list({ category: 'arcade', limit: 24 })
        if (!mounted) return
        setTopics(res.data.items)
        setError('')
      } catch {
        if (!mounted) return
        setTopics([])
        setError('Arcade 题目加载失败')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void loadTopics()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev === tracks.length - 1 ? 0 : prev + 1))
    }, HERO_AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [])

  const goPrev = () => {
    setActiveIndex((prev) => (prev === 0 ? tracks.length - 1 : prev - 1))
  }

  const goNext = () => {
    setActiveIndex((prev) => (prev === tracks.length - 1 ? 0 : prev + 1))
  }

  return (
    <LibraryPageLayout title="Arcade 竞技场">
      <section
        className="relative min-h-[14rem] overflow-hidden rounded-[28px] border px-5 py-6 sm:min-h-[16rem] sm:rounded-[32px] sm:px-8 sm:py-10 lg:min-h-[17rem] lg:px-12 lg:py-12"
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
          className="pointer-events-none absolute inset-x-10 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)' }}
        />

        <div className="grid min-h-[inherit] gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
          <div key={activeTrack.id} className="animate-stage-enter-left flex min-h-[inherit] max-w-3xl flex-col justify-between">
            <div>
            <span
              className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]"
              style={{
                color: 'rgba(100,116,139,0.9)',
                backgroundColor: 'rgba(255,255,255,0.52)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.55)',
              }}
            >
              {activeTrack.eyebrow}
            </span>

            <h2 className="mt-5 max-w-2xl whitespace-pre-line text-[2.35rem] font-serif font-semibold leading-[0.94] sm:mt-7 sm:text-5xl sm:leading-[0.98] lg:text-[4.4rem]">
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
              className="mt-4 max-w-md text-[13px] leading-6 sm:mt-6 sm:max-w-lg sm:text-[15px] sm:leading-7"
              style={{ color: '#64748b' }}
            >
              {activeTrack.description}
            </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
              <a
                href={activeTrack.githubHref}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 sm:px-5 sm:py-2.5 sm:text-sm"
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

          <div className="flex items-center justify-end gap-3 lg:pt-1">
            <button
              type="button"
              onClick={goPrev}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all duration-300 hover:-translate-y-0.5 sm:h-12 sm:w-12 sm:text-base"
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all duration-300 hover:-translate-y-0.5 sm:h-12 sm:w-12 sm:text-base"
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
      <section className="mt-10">
        <div className="mb-5 flex flex-col gap-3 sm:mb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] tracking-[0.22em]" style={{ color: '#94a3b8' }}>
              LIVE TASKS
            </p>
            <h3 className="mt-2 text-[1.75rem] font-serif font-semibold leading-[1.02] sm:text-2xl sm:leading-none" style={{ color: 'var(--text-primary)' }}>
              当前 Arcade 题目
            </h3>
          </div>
          <p className="max-w-md text-[13px] leading-6 sm:text-sm sm:leading-6" style={{ color: '#64748b' }}>
            公开查看所有分支，进入题目页阅读迭代过程。
          </p>
        </div>

        {loading ? (
          <div className="rounded-[24px] border px-5 py-6 text-sm text-gray-500" style={{ borderColor: 'rgba(148,163,184,0.22)' }}>
            加载中...
          </div>
        ) : error ? (
          <div className="rounded-[24px] border px-5 py-6 text-sm text-red-600" style={{ borderColor: 'rgba(248,113,113,0.25)' }}>
            {error}
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-[24px] border px-5 py-6 text-sm text-gray-500" style={{ borderColor: 'rgba(148,163,184,0.22)' }}>
            还没有发布 Arcade 题目。
          </div>
        ) : (
          <div className="grid gap-4">
            {topics.map((topic) => {
              const arcadeMeta = topic.metadata?.scene === 'arcade' ? topic.metadata.arcade : undefined
              const prompt = typeof arcadeMeta?.prompt === 'string' ? arcadeMeta.prompt : topic.body
              const metadataTags = Array.isArray(arcadeMeta?.tags)
                ? arcadeMeta.tags.map((tag) => String(tag ?? '').trim()).filter(Boolean)
                : []
              const fallbackTags = [
                typeof arcadeMeta?.board === 'string' ? arcadeMeta.board.trim().toUpperCase() : '',
                typeof arcadeMeta?.difficulty === 'string' ? arcadeMeta.difficulty.trim() : '',
              ].filter(Boolean)
              const displayTags = metadataTags.length > 0 ? metadataTags : fallbackTags
              return (
                <Link
                  key={topic.id}
                  to={`/topics/${topic.id}`}
                  className="rounded-[24px] border px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 sm:px-5 sm:py-5"
                  style={{
                    borderColor: 'rgba(148,163,184,0.22)',
                    backgroundColor: 'rgba(255,255,255,0.76)',
                    boxShadow: '0 10px 30px rgba(148, 163, 184, 0.08)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-[11px]" style={{ color: '#94a3b8' }}>
                    {displayTags.map((tag) => (
                      <span key={`${topic.id}-${tag}`} className="rounded-full border px-2.5 py-1" style={{ borderColor: 'rgba(203,213,225,0.8)' }}>
                        {tag}
                      </span>
                    ))}
                    <span className="rounded-full border px-2.5 py-1" style={{ borderColor: 'rgba(226,232,240,0.92)' }}>
                      跟贴 {topic.posts_count ?? 0}
                    </span>
                  </div>
                  <h4 className="mt-3 text-[1.7rem] font-serif font-semibold leading-[1.08] sm:text-xl sm:leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {topic.title}
                  </h4>
                  {prompt?.trim() ? (
                    <p className="mt-3 line-clamp-4 text-[13px] leading-6 sm:line-clamp-3 sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {prompt}
                    </p>
                  ) : null}
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </LibraryPageLayout>
  )
}
