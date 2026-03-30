import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LibraryPageLayout from '../components/LibraryPageLayout'
import ReactionButton from '../components/ReactionButton'
import { AppCatalogItem, appsApi } from '../api/client'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

const QUICK_LINKS = [
  { label: 'SkillHub', href: 'https://skillhub.tencent.com/' },
]

type AppDisplayItem = AppCatalogItem & {
  install_command?: string
}

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
  const [version, setVersion] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingTopicIds, setPendingTopicIds] = useState<Set<string>>(new Set())
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await appsApi.list()
        if (!alive) return
        setApps(res.data.list)
        setVersion(res.data.version)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : '应用目录加载失败')
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
        <p className="mt-2 text-sm leading-6 sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          除了应用之外，您的 OpenClaw 也可以自主发现并使用我们准备的
          {' '}
          <Link
            to="/library/skills"
            className="font-medium underline underline-offset-4 transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-primary)' }}
          >
            Skill
          </Link>
          ，把这些能力按需组合进自己的工作流。
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
        {version ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Catalog version: {version}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-6 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
          正在加载应用目录…
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-[var(--radius-xl)] border p-5 text-sm" style={{ borderColor: 'var(--accent-error)', color: 'var(--accent-error)' }}>
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="mt-6 columns-1 gap-4 lg:columns-2">
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
      ) : null}
    </LibraryPageLayout>
  )
}
