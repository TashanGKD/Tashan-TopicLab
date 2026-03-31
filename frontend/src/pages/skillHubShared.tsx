import { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type {
  SkillHubCollection,
  SkillHubCluster,
  SkillHubDiscipline,
  SkillHubSkillSummary,
  SkillHubTask,
} from '../api/client'

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

export function accentByCollection(accent: string) {
  if (accent === 'mint') {
    return {
      background: 'linear-gradient(135deg, rgba(236,253,245,0.98) 0%, rgba(220,252,231,0.94) 100%)',
      borderColor: 'rgba(74, 222, 128, 0.28)',
    }
  }
  return {
    background: 'linear-gradient(135deg, rgba(248,250,252,0.98) 0%, rgba(241,245,249,0.96) 100%)',
    borderColor: 'rgba(148,163,184,0.22)',
  }
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

/** 当前部署下科研技能专区详情页的绝对 URL（含 Vite `BASE_URL`）。 */
export function skillHubSkillPublicPageUrl(slug: string): string {
  const enc = encodeURIComponent(slug)
  const raw = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')
  const base = raw === '' || raw === '/' ? '' : raw.startsWith('/') ? raw : `/${raw}`
  const path = `${base}/apps/skills/${enc}`.replace(/\/+/g, '/')
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`
}

const SKILL_SHARE_SHORT_MAX = 200

/** 他山世界科研应用 / skill 分享用剪贴板正文：标题行 + 简短描述 + 链接。 */
export function formatSkillHubShareClipboard(skill: Pick<SkillHubSkillSummary, 'name' | 'summary' | 'tagline'>, slug: string): string {
  const url = skillHubSkillPublicPageUrl(slug)
  const raw = (skill.tagline?.trim() || skill.summary.trim() || '（暂无简介）').replace(/\s+/g, ' ')
  const short = raw.length > SKILL_SHARE_SHORT_MAX ? `${raw.slice(0, SKILL_SHARE_SHORT_MAX - 1)}…` : raw
  return `【他山世界应用 / skill 分享】${skill.name}，\n${short}\n${url}`
}

export function SkillCard({
  skill,
  actions,
  statsText,
}: {
  skill: SkillHubSkillSummary
  actions?: ReactNode
  statsText?: string
}) {
  const priceLabel = skill.price_points > 0 ? `${skill.price_points} pts` : 'Free'
  const statsLine = statsText ?? `应用评分 ${skill.avg_rating.toFixed(1)} · 评测 ${formatCompactNumber(skill.total_reviews)} · 下载 ${formatCompactNumber(skill.total_downloads)} · 点数 ${priceLabel}`

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
        {skill.tags.slice(0, 4).map((tag) => (
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

export function ClusterGrid({
  clusters,
  activeKey,
  onChange,
}: {
  clusters: SkillHubCluster[]
  activeKey: string
  onChange: (key: string) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {clusters.map((cluster) => {
        const active = activeKey === cluster.key
        return (
          <button
            key={cluster.key}
            type="button"
            onClick={() => onChange(active ? '' : cluster.key)}
            className="rounded-[22px] border p-4 text-left transition-transform hover:-translate-y-0.5"
            style={{
              borderColor: active ? '#0d9488' : 'var(--border-default)',
              backgroundColor: active ? 'rgba(13, 148, 136, 0.06)' : 'var(--bg-container)',
            }}
          >
            <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>
              cluster
            </div>
            <div className="mt-2 text-base font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
              {cluster.title}
            </div>
            <div className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {cluster.summary}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function CollectionRail({ collections }: { collections: SkillHubCollection[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {collections.map((collection) => {
        const accent = accentByCollection(collection.accent)
        return (
          <section
            key={collection.id}
            className="rounded-[28px] border p-5"
            style={{
              background: accent.background,
              borderColor: accent.borderColor,
            }}
          >
            <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>
              collection
            </div>
            <div className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
              {collection.title}
            </div>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {collection.description}
            </p>
            <div className="mt-4 space-y-2">
              {collection.skills.map((skill) => (
                <Link
                  key={skill.id}
                  to={`/apps/skills/${skill.slug}`}
                  className="block rounded-2xl border px-4 py-3 transition-colors hover:bg-white/70"
                  style={{ borderColor: 'rgba(255,255,255,0.62)', backgroundColor: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)' }}
                >
                    <div className="font-medium">{skill.name}</div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    科研应用展示，底层能力形态为 skill
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function TaskBoard({ tasks }: { tasks: SkillHubTask[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {tasks.map((task) => (
        <article
          key={task.task_key}
          className="rounded-[22px] border p-4"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {task.title}
            </div>
            <span
              className="rounded-full px-2 py-1 text-[11px]"
              style={{
                backgroundColor: task.completed ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-secondary)',
                color: task.completed ? '#047857' : 'var(--text-secondary)',
              }}
            >
              {task.completed ? '已完成' : `${task.progress_count}/${task.goal_count}`}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            {task.description}
          </p>
          <div className="mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            奖励 {task.points_reward} points
          </div>
        </article>
      ))}
    </div>
  )
}
