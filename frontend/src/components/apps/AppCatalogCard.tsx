import type { ReactNode } from 'react'

import type { AppCatalogItem } from '../../api/client'
import ReactionButton from '../ReactionButton'
import { formatCompactNumber } from './appsShared'

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

interface AppCatalogCardProps {
  app: AppCatalogItem & { install_command?: string }
  icon: ReactNode
  pendingLike: boolean
  pendingTopic: boolean
  onToggleLike: () => void
  onOpenTopic: () => void
  onOpenFeedback: () => void
  links: Array<{ href: string; label: string; primary: boolean }>
}

export default function AppCatalogCard({
  app,
  icon,
  pendingLike,
  pendingTopic,
  onToggleLike,
  onOpenTopic,
  onOpenFeedback,
  links,
}: AppCatalogCardProps) {
  const ia = app.interaction
  const favoritesCount = ia?.favorites_count ?? 0
  const sharesCount = ia?.shares_count ?? 0
  const postsCount = app.linked_topic_posts_count
  const appFooterPlain = [
    `收藏 ${formatCompactNumber(favoritesCount)}`,
    `分享 ${formatCompactNumber(sharesCount)}`,
    typeof postsCount === 'number' ? `话题帖 ${formatCompactNumber(postsCount)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

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
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: 'linear-gradient(180deg, rgba(241,245,249,0.95) 0%, rgba(226,232,240,0.92) 100%)',
            color: 'var(--text-primary)',
          }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                {app.name}
              </h2>
              {app.builtin ? (
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                  已内置
                </span>
              ) : null}
              {app.command ? (
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                  {app.command}
                </span>
              ) : null}
            </div>
            <ReactionButton
              label="点赞"
              count={ia?.likes_count ?? 0}
              active={ia?.liked ?? false}
              pending={pendingLike}
              icon={<HeartIcon />}
              subtle
              hideLabel={false}
              className="-mr-1 -mt-0.5 shrink-0 sm:-mt-px"
              onClick={onToggleLike}
            />
          </div>
          {app.install_command ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border px-3 py-2"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-tertiary)' }}>
                安装
              </span>
              <code className="font-mono text-xs sm:text-sm" style={{ color: 'var(--text-primary)' }}>
                {app.install_command}
              </code>
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
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {links.map((link) => (
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
            onClick={onOpenTopic}
            disabled={pendingTopic}
            className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            {pendingTopic ? '打开中…' : '进入话题'}
          </button>
          <button
            type="button"
            onClick={onOpenFeedback}
            className="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            评价应用
          </button>
        </div>
        <p
          className="min-w-0 flex-1 text-right text-xs tabular-nums leading-5 sm:text-right"
          style={{ color: 'var(--text-tertiary)' }}
          aria-label={appFooterPlain}
        >
          {appFooterPlain}
        </p>
      </div>
    </article>
  )
}
