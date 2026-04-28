import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LibraryPageLayout from '../components/LibraryPageLayout'
import PromoHeroCarousel, { type PromoHeroTrack } from '../components/PromoHeroCarousel'
import AppCatalogCard from '../components/apps/AppCatalogCard'
import { AppsSkillCard, CategoryStrip, ClusterStrip } from '../components/apps/appsShared'
import { AppCatalogItem, appsApi, skillHubApi, type SkillHubCategoriesResponse, type SkillHubSkillSummary } from '../api/client'
import { handleApiError } from '../utils/errorHandler'
import { filterAppsPageSkills, sortAppsPageSkills } from '../utils/skillHubRanking'
import { toast } from '../utils/toast'

const QUICK_LINKS = [
  { label: 'SkillHub', href: 'https://skillhub.tencent.com/' },
]

type AppDisplayItem = AppCatalogItem & {
  install_command?: string
}

const APPS_SKILL_HERO = {
  eyebrow: 'RESEARCH SKILL ZONE',
  title: '科研技能专区',
  description:
    '集中收录可安装的科研 Skill：按一级学科与研究领域（Cluster）筛选，查看说明、售价与 CLI 安装命令，并参与评测、许愿与发布。',
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
  },
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
  },
}

const APPS_PROMO_AUTOPLAY_MS = 5000
const SKILL_BATCH_SIZE = 24

const appsPromoTracks: PromoHeroTrack[] = [
  {
    id: 'research-skill',
    eyebrow: APPS_SKILL_HERO.eyebrow,
    title: APPS_SKILL_HERO.title,
    description: APPS_SKILL_HERO.description,
    style: APPS_SKILL_HERO.style,
    action: { to: '/apps/skills', label: '进入科研技能专区' },
  },
  {
    id: 'ai-topic-library',
    eyebrow: APPS_AI_TOPIC_HERO.eyebrow,
    title: APPS_AI_TOPIC_HERO.title,
    description: APPS_AI_TOPIC_HERO.description,
    style: APPS_AI_TOPIC_HERO.style,
    titleTo: '/library',
    action: { to: '/library', label: '进入资源库' },
  },
]

function normalizeUrl(value?: string) {
  return (value || '').trim()
}

function getAppLinks(app: AppDisplayItem) {
  const docs = normalizeUrl(app.links?.docs)
  const repo = normalizeUrl(app.links?.repo)
  const linkLabels = (app as AppDisplayItem & { link_labels?: { docs?: string; repo?: string; combined?: string } }).link_labels
  const docsLabel = linkLabels?.docs || '查看文档'
  const repoLabel = linkLabels?.repo || 'GitHub'
  if (docs && repo && docs === repo) {
    return [{ href: docs, label: linkLabels?.combined || '文档 / GitHub', primary: true }]
  }

  return [
    docs ? { href: docs, label: docsLabel, primary: true } : null,
    repo ? { href: repo, label: repoLabel, primary: false } : null,
  ].filter(Boolean) as Array<{ href: string; label: string; primary: boolean }>
}

function AppIcon({ kind }: { kind?: string }) {
  if (kind === 'thesis-skills') {
    return (
      <img
        src={`${import.meta.env.BASE_URL}media/apps/thesis-skills.jpg`}
        alt=""
        aria-hidden
        className="h-12 w-12 rounded-2xl object-cover"
      />
    )
  }

  if (kind === 'prisma') {
    return (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 16.5L12 4l8 12.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 16.5h10" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="2.3" fill="currentColor" />
      </svg>
    )
  }

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

function openFeedbackDraft(app: AppDisplayItem) {
  window.dispatchEvent(new CustomEvent('open-feedback-draft', {
    detail: {
      scenario: app.openclaw?.review_feedback?.scenario ?? `apps:${app.id}`,
      body: app.openclaw?.review_feedback?.body_template ?? `我要评价应用 ${app.name}。\n`,
    },
  }))
}

function estimateTextBlockHeight(text: string, charsPerLine: number, lineHeight: number) {
  if (!text.trim()) return 0
  return Math.ceil(text.trim().length / charsPerLine) * lineHeight
}

function splitIntoMasonryColumns<T>(items: T[], estimateHeight: (item: T) => number) {
  return items.reduce<[{ items: T[]; height: number }, { items: T[]; height: number }]>(
    (columns, item) => {
      const nextHeight = estimateHeight(item)
      const targetIndex = columns[0].height <= columns[1].height ? 0 : 1
      columns[targetIndex].items.push(item)
      columns[targetIndex].height += nextHeight
      return columns
    },
    [
      { items: [], height: 0 },
      { items: [], height: 0 },
    ],
  )
}

function estimateAppCardHeight(app: AppDisplayItem) {
  const summary = app.summary ?? ''
  const description = app.description ?? ''
  const installCommand = app.install_command ?? ''
  const tags = app.tags ?? []

  return (
    260
    + estimateTextBlockHeight(summary, 26, 28)
    + estimateTextBlockHeight(description, 28, 28)
    + estimateTextBlockHeight(installCommand, 34, 24)
    + tags.length * 12
  )
}

function estimateSkillCardHeight(skill: SkillHubSkillSummary) {
  const summary = skill.summary ?? ''
  const tagline = skill.tagline ?? ''
  const tags = skill.tags ?? []
  const capabilities = skill.capabilities ?? []

  return (
    280
    + estimateTextBlockHeight(summary, 28, 28)
    + estimateTextBlockHeight(tagline, 30, 24)
    + (tags.length + capabilities.length) * 10
  )
}

export default function AppsPage() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<AppDisplayItem[]>([])
  const [researchSkills, setResearchSkills] = useState<SkillHubSkillSummary[]>([])
  const [skillCategories, setSkillCategories] = useState<SkillHubCategoriesResponse | null>(null)
  const [skillCategoryFilter, setSkillCategoryFilter] = useState('')
  const [skillClusterFilter, setSkillClusterFilter] = useState('')
  const [appsLoading, setAppsLoading] = useState(true)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [skillsLoading, setSkillsLoading] = useState(true)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [pendingTopicIds, setPendingTopicIds] = useState<Set<string>>(new Set())
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<string>>(new Set())
  const [leftAppColumn, rightAppColumn] = useMemo(
    () => splitIntoMasonryColumns(apps, estimateAppCardHeight).map((column) => column.items) as [AppDisplayItem[], AppDisplayItem[]],
    [apps],
  )
  const filteredResearchSkills = useMemo(
    () => filterAppsPageSkills(researchSkills, {
      categoryKey: skillCategoryFilter,
      clusterKey: skillClusterFilter,
    }),
    [researchSkills, skillCategoryFilter, skillClusterFilter],
  )
  const [leftSkillColumn, rightSkillColumn] = useMemo(
    () => splitIntoMasonryColumns(filteredResearchSkills, estimateSkillCardHeight).map((column) => column.items) as [SkillHubSkillSummary[], SkillHubSkillSummary[]],
    [filteredResearchSkills],
  )

  useEffect(() => {
    let alive = true

    const mergeSkillBatch = (prev: SkillHubSkillSummary[], page: SkillHubSkillSummary[]) => {
      const seen = new Set(prev.map((item) => item.id))
      return sortAppsPageSkills([...prev, ...page.filter((item) => !seen.has(item.id))])
    }

    const loadApps = async () => {
      try {
        setAppsLoading(true)
        setAppsError(null)
        const appsRes = await appsApi.list()
        if (!alive) return
        setApps(appsRes.data.list)
      } catch (err) {
        if (!alive) return
        setAppsError(err instanceof Error ? err.message : '应用列表加载失败')
      } finally {
        if (alive) {
          setAppsLoading(false)
        }
      }
    }

    const loadSkillCategories = async () => {
      try {
        const categoriesRes = await skillHubApi.listCategories()
        if (!alive) return
        setSkillCategories(categoriesRes.data)
      } catch (err) {
        if (!alive) return
        setSkillsError(err instanceof Error ? err.message : '技能分类加载失败')
      }
    }

    const loadSkillBatches = async () => {
      try {
        setSkillsLoading(true)
        setSkillsError(null)
        setResearchSkills([])

        let offset = 0
        let total = Number.POSITIVE_INFINITY

        while (alive && offset < total) {
          const res = await skillHubApi.listSkills({ sort: 'new', limit: SKILL_BATCH_SIZE, offset })
          if (!alive) return
          const page = res.data.list ?? []
          total = res.data.total ?? offset + page.length
          setResearchSkills((prev) => mergeSkillBatch(prev, page))

          if (page.length < SKILL_BATCH_SIZE) {
            break
          }
          offset += page.length
        }
      } catch (err) {
        if (!alive) return
        setSkillsError(err instanceof Error ? err.message : '技能列表加载失败')
      } finally {
        if (alive) {
          setSkillsLoading(false)
        }
      }
    }

    void loadApps()
    void loadSkillCategories()
    void loadSkillBatches()
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

      <PromoHeroCarousel tracks={appsPromoTracks} autoplayMs={APPS_PROMO_AUTOPLAY_MS} className="mt-6" />

      {appsLoading ? (
        <div className="mt-6 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
          应用加载中…
        </div>
      ) : null}

      {appsError ? (
        <div className="mt-6 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--accent-error)', color: 'var(--accent-error)' }}>
          {appsError}
        </div>
      ) : null}

      {!appsLoading && !appsError ? (
        <section className="mt-8">
            <div>
              <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                应用
              </h2>
            </div>
            <div className="mt-5 lg:hidden">
              {apps.map((app) => (
                <AppCatalogCard
                  key={app.id}
                  app={app}
                  icon={<AppIcon kind={app.icon} />}
                  pendingLike={pendingLikeIds.has(app.id)}
                  pendingTopic={pendingTopicIds.has(app.id)}
                  onToggleLike={() => void toggleLike(app)}
                  onOpenTopic={() => void openTopic(app)}
                  onOpenFeedback={() => openFeedbackDraft(app)}
                  links={getAppLinks(app)}
                />
              ))}
            </div>
            <div className="mt-5 hidden gap-5 lg:grid lg:grid-cols-2">
              <div>
                {leftAppColumn.map((app) => (
                  <AppCatalogCard
                    key={app.id}
                    app={app}
                    icon={<AppIcon kind={app.icon} />}
                    pendingLike={pendingLikeIds.has(app.id)}
                    pendingTopic={pendingTopicIds.has(app.id)}
                    onToggleLike={() => void toggleLike(app)}
                    onOpenTopic={() => void openTopic(app)}
                    onOpenFeedback={() => openFeedbackDraft(app)}
                    links={getAppLinks(app)}
                  />
                ))}
              </div>
              <div>
                {rightAppColumn.map((app) => (
                  <AppCatalogCard
                    key={app.id}
                    app={app}
                    icon={<AppIcon kind={app.icon} />}
                    pendingLike={pendingLikeIds.has(app.id)}
                    pendingTopic={pendingTopicIds.has(app.id)}
                    onToggleLike={() => void toggleLike(app)}
                    onOpenTopic={() => void openTopic(app)}
                    onOpenFeedback={() => openFeedbackDraft(app)}
                    links={getAppLinks(app)}
                  />
                ))}
              </div>
            </div>
        </section>
      ) : null}

      <section className="mt-8">
            <div>
              <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                技能
              </h2>
            </div>
            <div className="mt-5 space-y-5 rounded-[var(--radius-xl)] border p-4 sm:p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
              <section className="space-y-2">
                <p className="text-xs font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                  一级学科
                </p>
                <CategoryStrip
                  disciplines={skillCategories?.disciplines ?? []}
                  activeKey={skillCategoryFilter}
                  onChange={setSkillCategoryFilter}
                />
              </section>

              <section className="space-y-2">
                <p className="text-xs font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                  研究领域（Cluster）
                </p>
                <ClusterStrip
                  clusters={skillCategories?.clusters ?? []}
                  activeKey={skillClusterFilter}
                  onChange={setSkillClusterFilter}
                />
              </section>
            </div>
            {skillsError ? (
              <div className="mt-5 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--accent-error)', color: 'var(--accent-error)' }}>
                {skillsError}
              </div>
            ) : null}
            <div className="mt-5 lg:hidden">
              {filteredResearchSkills.map((skill) => (
                <AppsSkillCard
                  key={skill.id}
                  skill={skill}
                  variant="catalog"
                  icon={<AppIcon kind="spark" />}
                  actions={(
                    <>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                        onClick={() => navigate(`/apps/skills/${skill.slug}`)}
                      >
                        打开详情
                      </button>
                      <div className="inline-flex items-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                        {skill.cluster_name}
                      </div>
                    </>
                  )}
                />
              ))}
            </div>
            <div className="mt-5 hidden gap-5 lg:grid lg:grid-cols-2">
              <div>
                {leftSkillColumn.map((skill) => (
                  <AppsSkillCard
                    key={skill.id}
                    skill={skill}
                    variant="catalog"
                    icon={<AppIcon kind="spark" />}
                    actions={(
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                          onClick={() => navigate(`/apps/skills/${skill.slug}`)}
                        >
                          打开详情
                        </button>
                        <div className="inline-flex items-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                          {skill.cluster_name}
                        </div>
                      </>
                    )}
                  />
                ))}
              </div>
              <div>
                {rightSkillColumn.map((skill) => (
                  <AppsSkillCard
                    key={skill.id}
                    skill={skill}
                    variant="catalog"
                    icon={<AppIcon kind="spark" />}
                    actions={(
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                          onClick={() => navigate(`/apps/skills/${skill.slug}`)}
                        >
                          打开详情
                        </button>
                        <div className="inline-flex items-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                          {skill.cluster_name}
                        </div>
                      </>
                    )}
                  />
                ))}
              </div>
            </div>
            {filteredResearchSkills.length === 0 ? (
              <div className="mt-5 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                {skillsLoading ? '技能加载中…' : '暂无可展示的科研应用。'}
              </div>
            ) : null}
            {skillsLoading && filteredResearchSkills.length > 0 ? (
              <div className="mt-5 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                技能加载中…
              </div>
            ) : null}
      </section>
    </LibraryPageLayout>
  )
}
