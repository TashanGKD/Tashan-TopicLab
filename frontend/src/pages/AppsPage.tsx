import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LibraryPageLayout from '../components/LibraryPageLayout'
import ReactionButton from '../components/ReactionButton'
import { AppCatalogItem, appsApi, skillHubApi, type SkillHubSkillSummary } from '../api/client'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

const QUICK_LINKS = [
  { label: 'SkillHub', href: 'https://skillhub.tencent.com/' },
]

type AppDisplayItem = AppCatalogItem & {
  install_command?: string
}

interface SkillHeroStyle {
  background: string
  borderColor: string
  glowLeft: string
  glowRight: string
  shimmer: string
  chipBackground: string
  chipBorder: string
  chipColor: string
  actionBackground: string
  actionBorder: string
  actionColor: string
}

const APPS_SKILL_HERO = {
  eyebrow: 'RESEARCH SKILL ZONE',
  title: '科研技能专区',
  description:
    '集中收录可安装的科研 Skill：按一级学科与研究领域（Cluster）筛选，查看说明与 CLI 安装命令，并参与评测、许愿与发布。',
  style: {
    background: 'linear-gradient(135deg, rgba(238,247,240,0.98) 0%, rgba(226,241,229,0.98) 44%, rgba(214,234,220,0.98) 100%)',
    borderColor: 'rgba(167, 201, 180, 0.8)',
    glowLeft: 'radial-gradient(circle, rgba(34, 197, 94, 0.16) 0%, rgba(34, 197, 94, 0) 70%)',
    glowRight: 'radial-gradient(circle, rgba(20, 184, 166, 0.14) 0%, rgba(20, 184, 166, 0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(240,253,244,0.26) 48%, rgba(255,255,255,0) 100%)',
    chipBackground: 'rgba(255,255,255,0.58)',
    chipBorder: 'rgba(255,255,255,0.68)',
    chipColor: '#406255',
    actionBackground: 'rgba(255,255,255,0.52)',
    actionBorder: 'rgba(92,140,116,0.24)',
    actionColor: '#325445',
  } satisfies SkillHeroStyle,
}

const APPS_AI_TOPIC_HERO = {
  eyebrow: 'AI TOPIC LAB',
  title: 'AI 话题讨论专区',
  description: '集中浏览角色库、讨论方式与 MCP 等资源，为话题讨论与智能体协作提供素材与配置入口。',
  style: {
    background: 'linear-gradient(135deg, rgba(238,242,255,0.98) 0%, rgba(224,231,255,0.96) 44%, rgba(199,210,254,0.45) 100%)',
    borderColor: 'rgba(129, 140, 248, 0.65)',
    glowLeft: 'radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, rgba(99, 102, 241, 0) 70%)',
    glowRight: 'radial-gradient(circle, rgba(139, 92, 246, 0.16) 0%, rgba(139, 92, 246, 0) 72%)',
    shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(238,242,255,0.4) 48%, rgba(255,255,255,0) 100%)',
    chipBackground: 'rgba(255,255,255,0.58)',
    chipBorder: 'rgba(255,255,255,0.72)',
    chipColor: '#4338ca',
    actionBackground: 'rgba(255,255,255,0.52)',
    actionBorder: 'rgba(99,102,241,0.28)',
    actionColor: '#3730a3',
  } satisfies SkillHeroStyle,
}

const APPS_PROMO_AUTOPLAY_MS = 5000

type AppsPromoTrack = {
  id: string
  eyebrow: string
  title: string
  description: string
  style: SkillHeroStyle
  cta: { to: string; label: string }
}

const appsPromoTracks: AppsPromoTrack[] = [
  {
    id: 'research-skill',
    eyebrow: APPS_SKILL_HERO.eyebrow,
    title: APPS_SKILL_HERO.title,
    description: APPS_SKILL_HERO.description,
    style: APPS_SKILL_HERO.style,
    cta: { to: '/apps/skills', label: '进入科研技能专区' },
  },
  {
    id: 'ai-topic-library',
    eyebrow: APPS_AI_TOPIC_HERO.eyebrow,
    title: APPS_AI_TOPIC_HERO.title,
    description: APPS_AI_TOPIC_HERO.description,
    style: APPS_AI_TOPIC_HERO.style,
    cta: { to: '/library', label: '进入资源库' },
  },
]

function normalizeUrl(value?: string) {
  return (value || '').trim()
}

function getAppLinks(app: AppDisplayItem) {
  const docs = normalizeUrl(app.links?.docs)
  const repo = normalizeUrl(app.links?.repo)
  if (docs && repo && docs === repo) {
    return [{ href: docs, label: '文档 / GitHub', primary: true }]
  }

  return [
    docs ? { href: docs, label: '查看文档', primary: true } : null,
    repo ? { href: repo, label: 'GitHub', primary: false } : null,
  ].filter(Boolean) as Array<{ href: string; label: string; primary: boolean }>
}

function AppIcon({ kind }: { kind?: string }) {
  if (kind === 'spark') {
    return (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3.75l1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8-4.8-1.7 4.8-1.7 1.7-4.8z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.25 15.75l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75.75-2.25zM4.75 14.75l.55 1.65 1.65.55-1.65.55-.55 1.65-.55-1.65-1.65-.55 1.65-.55.55-1.65z" />
      </svg>
    )
  }

  return (
    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.75 17.25V6.75A1.75 1.75 0 016.5 5h11a1.75 1.75 0 011.75 1.75v10.5A1.75 1.75 0 0117.5 19h-11a1.75 1.75 0 01-1.75-1.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7.75 15.25l2.5-3 2.25 2 3.75-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7.75 9.25h.01M16.25 9.25h.01" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 16.25l-5.02-4.86a3.58 3.58 0 010-5.18 3.66 3.66 0 015.11 0L10 6.3l-.09-.09a3.66 3.66 0 015.11 0 3.58 3.58 0 010 5.18L10 16.25z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function formatCompatibilityTag(level: SkillHubSkillSummary['compatibility_level']) {
  if (level === 'runtime_full') return 'OpenClaw Ready'
  if (level === 'runtime_partial') return 'Runtime Partial'
  if (level === 'install') return 'CLI Install'
  return 'Metadata'
}

function openFeedbackDraft(app: AppDisplayItem) {
  window.dispatchEvent(new CustomEvent('open-feedback-draft', {
    detail: {
      scenario: app.openclaw?.review_feedback?.scenario ?? `apps:${app.id}`,
      body: app.openclaw?.review_feedback?.body_template ?? `我要评价应用 ${app.name}。\n`,
    },
  }))
}

export default function AppsPage() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<AppDisplayItem[]>([])
  const [researchSkills, setResearchSkills] = useState<SkillHubSkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingTopicIds, setPendingTopicIds] = useState<Set<string>>(new Set())
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<string>>(new Set())
  const [promoIndex, setPromoIndex] = useState(0)
  const activePromo = appsPromoTracks[promoIndex]
  const totalAppCount = apps.length + researchSkills.length
  const skillCardStatsText = `全站应用 ${totalAppCount} · 独立应用 ${apps.length} · 科研专区 ${researchSkills.length}`

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPromoIndex((prev) => (prev === appsPromoTracks.length - 1 ? 0 : prev + 1))
    }, APPS_PROMO_AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [])

  const goPrevPromo = () => {
    setPromoIndex((prev) => (prev === 0 ? appsPromoTracks.length - 1 : prev - 1))
  }

  const goNextPromo = () => {
    setPromoIndex((prev) => (prev === appsPromoTracks.length - 1 ? 0 : prev + 1))
  }

  useEffect(() => {
    let alive = true

    const loadAllSkills = async () => {
      const batchSize = 100
      let offset = 0
      let total = Number.POSITIVE_INFINITY
      const all: SkillHubSkillSummary[] = []

      while (offset < total) {
        const res = await skillHubApi.listSkills({ sort: 'hot', limit: batchSize, offset })
        const page = res.data.list ?? []
        total = res.data.total ?? page.length
        all.push(...page)
        if (page.length < batchSize) break
        offset += page.length
      }

      return all.sort((a, b) => {
        const diff = (b.total_downloads ?? 0) - (a.total_downloads ?? 0)
        if (diff !== 0) return diff
        return a.name.localeCompare(b.name)
      })
    }

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const [appsRes, skills] = await Promise.all([
          appsApi.list(),
          loadAllSkills(),
        ])
        if (!alive) return
        setApps(appsRes.data.list)
        setResearchSkills(skills)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : '应用总页加载失败')
      } finally {
        if (alive) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      alive = false
    }
  }, [])

  const openTopic = async (app: AppDisplayItem) => {
    setPendingTopicIds((prev) => new Set(prev).add(app.id))
    try {
      const res = await appsApi.ensureTopic(app.id)
      navigate(`/topics/${res.data.topic.id}`)
      toast.success('已打开对应话题')
    } catch (err) {
      handleApiError(err, '打开应用对应话题失败')
    } finally {
      setPendingTopicIds((prev) => {
        const next = new Set(prev)
        next.delete(app.id)
        return next
      })
    }
  }

  const toggleLike = async (app: AppDisplayItem) => {
    const nextEnabled = !(app.interaction?.liked ?? false)
    const previousInteraction = app.interaction ?? {
      likes_count: 0,
      shares_count: 0,
      favorites_count: 0,
      liked: false,
      favorited: false,
    }

    setPendingLikeIds((prev) => new Set(prev).add(app.id))
    setApps((prev) => prev.map((item) => {
      if (item.id !== app.id) return item
      return {
        ...item,
        interaction: {
          ...previousInteraction,
          likes_count: Math.max(0, (previousInteraction.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
          liked: nextEnabled,
        },
      }
    }))

    try {
      const res = await appsApi.like(app.id, nextEnabled)
      setApps((prev) => prev.map((item) => (
        item.id === app.id
          ? {
            ...item,
            interaction: res.data,
          }
          : item
      )))
    } catch (err) {
      setApps((prev) => prev.map((item) => (
        item.id === app.id
          ? {
            ...item,
            interaction: previousInteraction,
          }
          : item
      )))
      handleApiError(err, nextEnabled ? '应用点赞失败' : '取消应用点赞失败')
    } finally {
      setPendingLikeIds((prev) => {
        const next = new Set(prev)
        next.delete(app.id)
        return next
      })
    }
  }

  return (
    <LibraryPageLayout title="应用">
      <div className="max-w-5xl">
        <p className="text-sm leading-6 sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          我们准备了一系列 Claw Ready 应用，您的 OpenClaw 可以直接调用这些应用，帮助您完成更具体、更复杂的场景化任务。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <div className="mr-1 flex items-center gap-2 rounded-full border px-3 py-2" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)' }}>
            <span className="text-sm font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>Apps</span>
            <span className="text-xs font-serif" style={{ color: 'var(--text-tertiary)' }}>外部导航</span>
          </div>
          {QUICK_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              aria-label={link.label}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-serif font-semibold transition-colors"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
            >
              <span>{link.label}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="M7 13L13 7M8 7h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      </div>

      <section
        className="relative mt-6 min-h-[14rem] overflow-hidden rounded-[28px] border px-5 py-6 sm:min-h-[16rem] sm:rounded-[32px] sm:px-8 sm:py-10 lg:min-h-[17rem] lg:px-12 lg:py-12"
        style={{
          background: activePromo.style.background,
          borderColor: activePromo.style.borderColor,
          boxShadow: '0 24px 60px rgba(148, 163, 184, 0.14)',
        }}
      >
        <div
          className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
          style={{ background: activePromo.style.glowLeft }}
        />
        <div
          className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
          style={{ background: activePromo.style.glowRight }}
        />
        <div
          className="animate-soft-shimmer pointer-events-none absolute inset-y-0 left-[-12%] w-[28%]"
          style={{ background: activePromo.style.shimmer }}
        />
        <div
          className="pointer-events-none absolute inset-x-10 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)' }}
        />

        <div className="grid min-h-[inherit] gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
          <div key={activePromo.id} className="animate-stage-enter-left flex min-h-[inherit] max-w-3xl flex-col justify-between">
            <div>
              <span
                className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]"
                style={{
                  color: activePromo.style.chipColor,
                  backgroundColor: activePromo.style.chipBackground,
                  backdropFilter: 'blur(12px)',
                  border: `1px solid ${activePromo.style.chipBorder}`,
                }}
              >
                {activePromo.eyebrow}
              </span>

              {activePromo.id === 'ai-topic-library' ? (
                <Link
                  to="/library"
                  className="mt-5 block max-w-2xl rounded-2xl outline-none ring-offset-2 transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-indigo-300 motion-reduce:transition-none sm:mt-7"
                >
                  <h2 className="whitespace-pre-line text-[2.35rem] font-serif font-semibold leading-[0.94] sm:text-5xl sm:leading-[0.98] lg:text-[4.4rem]">
                    <span style={{ color: '#1f2937', textShadow: '0 1px 0 rgba(255,255,255,0.65)' }}>
                      {activePromo.title}
                    </span>
                  </h2>
                  <p
                    className="mt-4 max-w-md text-[13px] leading-6 sm:mt-6 sm:max-w-lg sm:text-[15px] sm:leading-7"
                    style={{ color: '#64748b' }}
                  >
                    {activePromo.description}
                  </p>
                </Link>
              ) : (
                <>
                  <h2 className="mt-5 max-w-2xl whitespace-pre-line text-[2.35rem] font-serif font-semibold leading-[0.94] sm:mt-7 sm:text-5xl sm:leading-[0.98] lg:text-[4.4rem]">
                    <span style={{ color: '#1f2937', textShadow: '0 1px 0 rgba(255,255,255,0.65)' }}>
                      {activePromo.title}
                    </span>
                  </h2>
                  <p
                    className="mt-4 max-w-md text-[13px] leading-6 sm:mt-6 sm:max-w-lg sm:text-[15px] sm:leading-7"
                    style={{ color: '#64748b' }}
                  >
                    {activePromo.description}
                  </p>
                </>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
              <Link
                to={activePromo.cta.to}
                className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
                style={{
                  borderColor: activePromo.style.actionBorder,
                  color: activePromo.style.actionColor,
                  backgroundColor: activePromo.style.actionBackground,
                  backdropFilter: 'blur(12px)',
                }}
              >
                {activePromo.cta.label}
                <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
              </Link>

              <div className="relative z-10 ml-1 flex items-center gap-2">
                {appsPromoTracks.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => setPromoIndex(index)}
                    className="h-2.5 rounded-full transition-all duration-300"
                    style={{
                      width: index === promoIndex ? '2rem' : '0.625rem',
                      backgroundColor: index === promoIndex ? activePromo.style.actionColor : 'rgba(148,163,184,0.42)',
                    }}
                    aria-label={`切换到 ${track.title.replace('\n', '')}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-end gap-3 lg:pt-1">
            <button
              type="button"
              onClick={goPrevPromo}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:h-12 sm:w-12 sm:text-base"
              style={{
                borderColor: activePromo.style.actionBorder,
                backgroundColor: activePromo.style.actionBackground,
                color: activePromo.style.actionColor,
                backdropFilter: 'blur(10px)',
              }}
              aria-label="上一个板块"
            >
              ←
            </button>
            <button
              type="button"
              onClick={goNextPromo}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:h-12 sm:w-12 sm:text-base"
              style={{
                borderColor: activePromo.style.actionBorder,
                backgroundColor: activePromo.style.actionBackground,
                color: activePromo.style.actionColor,
                backdropFilter: 'blur(10px)',
              }}
              aria-label="下一个板块"
            >
              →
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="mt-6 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
          正在加载…
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--accent-error)', color: 'var(--accent-error)' }}>
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="mt-8">
            <div>
              <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                应用
              </h2>
            </div>
            <div className="mt-5 columns-1 gap-4 lg:columns-2">
              {apps.map((app) => (
                <article
                  key={app.id}
                  className="mb-4 break-inside-avoid rounded-[var(--radius-xl)] border p-5 sm:p-6"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-container)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                      style={{
                        background: 'linear-gradient(180deg, rgba(241,245,249,0.95) 0%, rgba(226,232,240,0.92) 100%)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <AppIcon kind={app.icon} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {app.name}
                        </h2>
                        {app.builtin ? (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--bg-secondary)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            已内置
                          </span>
                        ) : null}
                        {app.command ? (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--bg-secondary)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {app.command}
                          </span>
                        ) : null}
                      </div>
                      {app.install_command ? (
                        <div className="mt-3 rounded-[var(--radius-md)] border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-tertiary)' }}>
                            安装
                          </p>
                          <p className="mt-1 font-mono text-xs sm:text-sm" style={{ color: 'var(--text-primary)' }}>
                            {app.install_command}
                          </p>
                        </div>
                      ) : null}
                      {app.summary ? (
                        <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
                          {app.summary}
                        </p>
                      ) : null}
                      {app.description ? (
                        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                          {app.description}
                        </p>
                      ) : null}
                      {app.tags?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {app.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full px-2.5 py-1 text-xs"
                              style={{
                                backgroundColor: 'var(--bg-secondary)',
                                color: 'var(--text-tertiary)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <ReactionButton
                      label="点赞"
                      count={app.interaction?.likes_count ?? 0}
                      active={app.interaction?.liked ?? false}
                      pending={pendingLikeIds.has(app.id)}
                      icon={<HeartIcon />}
                      subtle
                      onClick={() => void toggleLike(app)}
                    />
                    {getAppLinks(app).map((link) => (
                      <a
                        key={`${app.id}:${link.label}:${link.href}`}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${link.primary ? '' : 'border transition-colors'}`}
                        style={link.primary
                          ? {
                            backgroundColor: 'var(--text-primary)',
                            color: 'var(--bg-container)',
                          }
                          : {
                            borderColor: 'var(--border-default)',
                            color: 'var(--text-primary)',
                          }}
                      >
                        {link.label}
                      </a>
                    ))}
                    <button
                      type="button"
                      onClick={() => void openTopic(app)}
                      disabled={pendingTopicIds.has(app.id)}
                      className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
                      style={{
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {pendingTopicIds.has(app.id) ? '打开中…' : '进入话题'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openFeedbackDraft(app)}
                      className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
                      style={{
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      评价应用
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <div>
              <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                技能
              </h2>
            </div>
            <div className="mt-5 columns-1 gap-4 lg:columns-2">
              {researchSkills.map((skill) => (
                <article
                  key={skill.id}
                  className="mb-4 break-inside-avoid rounded-[var(--radius-xl)] border p-5 sm:p-6"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-container)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                      style={{
                        background: 'linear-gradient(180deg, rgba(241,245,249,0.95) 0%, rgba(226,232,240,0.92) 100%)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <AppIcon kind="spark" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {skill.name}
                        </h2>
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: skill.openclaw_ready ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-secondary)',
                            color: skill.openclaw_ready ? '#047857' : 'var(--text-secondary)',
                          }}
                        >
                          {formatCompatibilityTag(skill.compatibility_level)}
                        </span>
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {skill.category_name}
                        </span>
                      </div>
                      {skill.tagline ? (
                        <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
                          {skill.tagline}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                        {skill.summary}
                      </p>
                      <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-tertiary)' }}>
                        {skillCardStatsText}
                      </p>
                      {skill.tags?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {skill.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full px-2.5 py-1 text-xs"
                              style={{
                                backgroundColor: 'var(--bg-secondary)',
                                color: 'var(--text-tertiary)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
                      style={{
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                      onClick={() => navigate(`/apps/skills/${skill.slug}`)}
                    >
                      打开详情
                    </button>
                    <div className="inline-flex items-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                      {skill.cluster_name}
                    </div>
                  </div>
                </article>
              ))}
              {researchSkills.length === 0 ? (
                <div className="rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                  暂无可展示的科研应用。
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </LibraryPageLayout>
  )
}
