import type {
  ComponentPropsWithoutRef,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { Link } from 'react-router-dom'

import type {
  SkillHubCluster,
  SkillHubDiscipline,
  SkillHubSkillSummary,
} from '../../api/client'

function joinClasses(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ')
}

const PANEL_STYLE = {
  borderColor: 'var(--border-default)',
  backgroundColor: 'var(--bg-container)',
  boxShadow: 'var(--shadow-sm)',
} as const

const INSET_STYLE = {
  borderColor: 'var(--border-default)',
  backgroundColor: 'var(--bg-page)',
} as const

const INPUT_STYLE = {
  borderColor: 'var(--border-default)',
  backgroundColor: 'var(--bg-page)',
  color: 'var(--text-primary)',
} as const

export function formatCompactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

export function compatibilityLabel(level: string) {
  if (level === 'runtime_full') return 'OpenClaw Ready'
  if (level === 'runtime_partial') return 'Runtime Partial'
  if (level === 'install') return 'CLI Install'
  return 'Metadata'
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

export function buildAppUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}

export function skillHubSkillPublicPageUrl(slug: string): string {
  const enc = encodeURIComponent(slug)
  const raw = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')
  const base = raw === '' || raw === '/' ? '' : raw.startsWith('/') ? raw : `/${raw}`
  const path = `${base}/apps/skills/${enc}`.replace(/\/+/g, '/')
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`
}

const SKILL_SHARE_SHORT_MAX = 200

export function formatSkillHubShareClipboard(skill: Pick<SkillHubSkillSummary, 'name' | 'summary' | 'tagline'>, slug: string): string {
  const url = skillHubSkillPublicPageUrl(slug)
  const raw = (skill.tagline?.trim() || skill.summary.trim() || '（暂无简介）').replace(/\s+/g, ' ')
  const short = raw.length > SKILL_SHARE_SHORT_MAX ? `${raw.slice(0, SKILL_SHARE_SHORT_MAX - 1)}…` : raw
  return `【他山世界应用 / skill 分享】${skill.name}，\n${short}\n${url}`
}

export function AppsPanel({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={joinClasses('rounded-[28px] border p-5', className)} style={PANEL_STYLE}>
      {children}
    </section>
  )
}

export function AppsInsetCard({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={joinClasses('rounded-2xl border px-4 py-3', className)} style={INSET_STYLE}>
      {children}
    </div>
  )
}

export function AppsMetricCard({
  label,
  value,
  valueSize = 'lg',
}: {
  label: string
  value: string
  valueSize?: 'lg' | 'xl'
}) {
  return (
    <AppsInsetCard>
      <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div
        className={valueSize === 'xl' ? 'mt-2 text-xl font-serif font-semibold' : 'mt-2 text-lg font-serif font-semibold'}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </div>
    </AppsInsetCard>
  )
}

export function AppsStatusCard({
  tone = 'default',
  className = '',
  children,
}: {
  tone?: 'default' | 'error'
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={joinClasses('rounded-2xl border px-4 py-3 text-sm', className)}
      style={tone === 'error'
        ? { borderColor: 'var(--border-default)', color: 'var(--accent-error)' }
        : { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
    >
      {children}
    </div>
  )
}

export function AppsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
      {children}
    </label>
  )
}

export function AppsInput(props: ComponentPropsWithoutRef<'input'>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={joinClasses('w-full rounded-2xl border px-4 py-3 text-sm', className)} style={INPUT_STYLE} />
}

export function AppsTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={joinClasses('w-full rounded-2xl border px-4 py-3 text-sm leading-6', className)} style={INPUT_STYLE} />
}

export function AppsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props
  return <select {...rest} className={joinClasses('w-full rounded-2xl border px-4 py-3 text-sm', className)} style={INPUT_STYLE} />
}

export function AppsPillButton({
  children,
  variant = 'primary',
  className = '',
  to,
  href,
  state,
  type = 'button',
  ...rest
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary'
  className?: string
  to?: string
  href?: string
  state?: unknown
} & Omit<ComponentPropsWithoutRef<'button'>, 'children'>) {
  const sharedClassName = joinClasses('rounded-full border px-4 py-2 text-sm font-medium', className)
  const style = variant === 'primary'
    ? { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }
    : { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }

  if (to) {
    return (
      <Link to={to} state={state} className={sharedClassName} style={style}>
        {children}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={sharedClassName} style={style}>
        {children}
      </a>
    )
  }

  return (
    <button {...rest} type={type} className={sharedClassName} style={style}>
      {children}
    </button>
  )
}

export function AppsAuthPrompt({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  eyebrow: string
  title: string
  description: ReactNode
  primaryAction: ReactNode
  secondaryAction?: ReactNode
}) {
  return (
    <AppsPanel className="p-6">
      <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>{eyebrow}</div>
      <h2 className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {primaryAction}
        {secondaryAction}
      </div>
    </AppsPanel>
  )
}

export function AppsSkillCard({
  skill,
  actions,
  statsText,
  variant = 'default',
  icon,
  tagLimit,
}: {
  skill: SkillHubSkillSummary
  actions?: ReactNode
  statsText?: string
  variant?: 'default' | 'catalog'
  icon?: ReactNode
  tagLimit?: number
}) {
  const priceLabel = skill.price_points > 0 ? `${skill.price_points} pts` : 'Free'
  const statsLine = statsText ?? `应用评分 ${skill.avg_rating.toFixed(1)} · 评测 ${formatCompactNumber(skill.total_reviews)} · 下载 ${formatCompactNumber(skill.total_downloads)} · 点数 ${priceLabel}`
  const visibleTags = skill.tags.slice(0, tagLimit ?? (variant === 'catalog' ? 6 : 4))

  if (variant === 'catalog') {
    return (
      <article
        className="mb-4 break-inside-avoid rounded-[var(--radius-xl)] border p-5 sm:p-6"
        style={{
          borderColor: 'var(--border-default)',
          backgroundColor: 'var(--bg-container)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="flex items-start gap-4">
          {icon ? (
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{
                background: 'linear-gradient(180deg, rgba(241,245,249,0.95) 0%, rgba(226,232,240,0.92) 100%)',
                color: 'var(--text-primary)',
              }}
            >
              {icon}
            </div>
          ) : null}
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
                {compatibilityLabel(skill.compatibility_level)}
              </span>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
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
              {statsLine}
            </p>
            {visibleTags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-xs"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {actions}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <article
      className="rounded-[20px] border p-4"
      style={{
        borderColor: 'var(--border-default)',
        backgroundColor: 'var(--bg-container)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: skill.openclaw_ready ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148,163,184,0.14)',
                color: skill.openclaw_ready ? '#047857' : '#475569',
              }}
            >
              {compatibilityLabel(skill.compatibility_level)}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
            >
              {skill.cluster_name}
            </span>
          </div>
          <Link
            to={`/apps/skills/${skill.slug}`}
            className="mt-2 block text-lg font-serif font-semibold leading-snug transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-primary)' }}
          >
            {skill.name}
          </Link>
          {skill.tagline ? (
            <p className="mt-0.5 text-[13px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              {skill.tagline}
            </p>
          ) : null}
          <p className="mt-2 text-[13px] leading-snug sm:text-sm sm:leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {skill.summary}
          </p>
        </div>
        {actions ? (
          <div className="shrink-0 justify-self-end self-start pt-0.5">{actions}</div>
        ) : null}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {visibleTags.map((tag) => (
          <span
            key={tag}
            className="rounded-full px-2 py-0.5 text-[10px]"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          >
            {tag}
          </span>
        ))}
      </div>
      <p className="mt-2.5 text-[12px] leading-5 sm:text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
        {statsLine}
      </p>
    </article>
  )
}

export function CategoryStrip({
  disciplines,
  activeKey,
  onChange,
}: {
  disciplines: SkillHubDiscipline[]
  activeKey: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange('')}
        className="rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{
          borderColor: activeKey === '' ? '#0d9488' : 'var(--border-default)',
          backgroundColor: activeKey === '' ? '#0d9488' : 'var(--bg-container)',
          color: activeKey === '' ? '#fff' : 'var(--text-primary)',
        }}
      >
        全部学科
      </button>
      {disciplines.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className="rounded-full border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: activeKey === item.key ? '#0d9488' : 'var(--border-default)',
            backgroundColor: activeKey === item.key ? '#0d9488' : 'var(--bg-container)',
            color: activeKey === item.key ? '#fff' : 'var(--text-primary)',
          }}
        >
          {item.name}
        </button>
      ))}
    </div>
  )
}

export function ClusterStrip({
  clusters,
  activeKey,
  onChange,
}: {
  clusters: SkillHubCluster[]
  activeKey: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange('')}
        aria-label="筛选研究领域：全部"
        className="rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{
          borderColor: activeKey === '' ? '#0d9488' : 'var(--border-default)',
          backgroundColor: activeKey === '' ? '#0d9488' : 'var(--bg-container)',
          color: activeKey === '' ? '#fff' : 'var(--text-primary)',
        }}
      >
        全部领域
      </button>
      {clusters.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          aria-label={`筛选研究领域：${item.title}`}
          className="rounded-full border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: activeKey === item.key ? '#0d9488' : 'var(--border-default)',
            backgroundColor: activeKey === item.key ? '#0d9488' : 'var(--bg-container)',
            color: activeKey === item.key ? '#fff' : 'var(--text-primary)',
          }}
        >
          {item.title}
        </button>
      ))}
    </div>
  )
}
