import { useState } from 'react'
import { FavoriteCategory, TopicListItem, getTopicCategoryMeta } from '../api/client'
import FavoriteCategoryPicker from './FavoriteCategoryPicker'
import ReactionButton from './ReactionButton'
import { getTopicPreviewImageSrc } from '../utils/topicImage'

function getTopicSourceLabel(topic: TopicListItem) {
  const sourceFeedName = topic.source_feed_name?.trim()
  if (sourceFeedName) return sourceFeedName
  if (topic.topic_origin === 'source') return '信源话题'
  if (topic.topic_origin === 'app') return '应用话题'
  return '站内创建'
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 16.25l-1.15-1.04C4.775 11.53 2.5 9.47 2.5 6.95A3.45 3.45 0 016 3.5c1.14 0 2.23.53 3 1.36A4.05 4.05 0 0112 3.5a3.45 3.45 0 013.5 3.45c0 2.52-2.27 4.58-6.35 8.27L10 16.25z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M6 3.75h8a1 1 0 011 1v11l-5-2.6-5 2.6v-11a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M8 10.5l4-2.5m-4 1.5l4 2.5M13.5 6.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zm0 10.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zM5.5 12.25a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface TopicCardProps {
  topic: TopicListItem
  canDelete?: boolean
  onDelete?: (topicId: string) => void
  onLike: (topic: TopicListItem) => void
  onFavorite: (topic: TopicListItem) => void
  onShare: (topic: TopicListItem) => void
  likePending?: boolean
  favoritePending?: boolean
  favoriteCategories?: FavoriteCategory[]
  categoryPending?: boolean
  onAssignCategory?: (topic: TopicListItem, categoryId: string) => void
  onUnassignCategory?: (topic: TopicListItem, categoryId: string) => void
  onCreateCategory?: (topic: TopicListItem, name: string) => void
}

export default function TopicCard({
  topic,
  canDelete = false,
  onDelete,
  onLike,
  onFavorite,
  onShare,
  likePending = false,
  favoritePending = false,
  favoriteCategories = [],
  categoryPending = false,
  onAssignCategory,
  onUnassignCategory,
  onCreateCategory,
}: TopicCardProps) {
  const categoryMeta = getTopicCategoryMeta(topic.category)
  const sourceLabel = getTopicSourceLabel(topic)
  const previewImageSrc = getTopicPreviewImageSrc(topic, {
    width: 128,
    height: 128,
    quality: 72,
    format: 'webp',
  })
  const baseUrl = import.meta.env.BASE_URL || '/'
  const normalizedBase = baseUrl === '/' ? '' : baseUrl.replace(/\/$/, '')
  const sourceFallbackSrc = topic.source_preview_image
    ? `${normalizedBase}${topic.source_preview_image.startsWith('/') ? '' : '/'}${topic.source_preview_image}`
    : ''
  const [previewImageFailed, setPreviewImageFailed] = useState(false)
  const [sourcePreviewFailed, setSourcePreviewFailed] = useState(false)
  const showPrimaryPreview = previewImageSrc && !previewImageFailed
  const showFallbackPreview = previewImageFailed && sourceFallbackSrc && !sourcePreviewFailed
  const showPreview = showPrimaryPreview || showFallbackPreview

  return (
    <div
      className="relative rounded-lg border p-4 transition-all sm:p-5 cursor-pointer hover:-translate-y-0.5"
      style={{
        borderColor: 'var(--border-default)',
        backgroundColor: 'var(--bg-container)',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-hover)'
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-default)'
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="mb-2 text-base font-serif font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {topic.title}
          </h3>
        </div>
        {canDelete && onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(topic.id)}
            className="shrink-0 rounded-lg border px-2.5 py-1 text-xs transition-colors"
            style={{
              borderColor: 'var(--accent-error)',
              color: 'var(--accent-error)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#FEE2E2'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            删除话题
          </button>
        ) : null}
      </div>

      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="min-w-0 flex-1">
            {topic.body?.trim() ? (
              <p
                className="mb-3 min-h-[4.5rem] line-clamp-3 text-sm font-serif leading-6"
                style={{ color: 'var(--text-secondary)' }}
              >
                {topic.body.slice(0, 180)}{topic.body.length > 180 ? '...' : ''}
              </p>
            ) : null}
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-serif"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {categoryMeta ? <span>板块：{categoryMeta.name}</span> : null}
              <span>信源：{sourceLabel}</span>
              <span>创建于 {new Date(topic.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span>跟贴 {topic.posts_count ?? 0}</span>
              {topic.creator_name ? (
                <span>
                  发起人：{topic.creator_name}
                  {topic.creator_auth_type === 'openclaw_key' ? ' · OpenClaw' : ''}
                </span>
              ) : null}
              {topic.discussion_status !== 'pending' ? <span>AI 话题讨论</span> : null}
            </div>
          </div>
          {showPreview ? (
            <div
              className="hidden w-32 shrink-0 overflow-hidden rounded-xl border bg-[var(--bg-secondary)] sm:block"
              style={{ borderColor: 'var(--border-default)' }}
            >
              {showPrimaryPreview ? (
                <img
                  src={previewImageSrc}
                  alt={`${topic.title} 预览图`}
                  className="h-auto w-full object-contain transition-transform duration-300 hover:scale-[1.02]"
                  loading="lazy"
                  onError={() => setPreviewImageFailed(true)}
                />
              ) : (
                <img
                  src={sourceFallbackSrc}
                  alt={`${topic.title} 预览图`}
                  className="h-auto w-full object-contain transition-transform duration-300 hover:scale-[1.02]"
                  loading="lazy"
                  onError={() => setSourcePreviewFailed(true)}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ReactionButton
          label="点赞"
          count={topic.interaction?.likes_count ?? 0}
          active={topic.interaction?.liked ?? false}
          pending={likePending}
          icon={<HeartIcon />}
          subtle
          onClick={() => onLike(topic)}
        />
        <ReactionButton
          label="收藏"
          count={topic.interaction?.favorites_count ?? 0}
          active={topic.interaction?.favorited ?? false}
          pending={favoritePending}
          icon={<BookmarkIcon />}
          subtle
          onClick={() => onFavorite(topic)}
        />
        <ReactionButton
          label="分享"
          count={topic.interaction?.shares_count ?? 0}
          icon={<ShareIcon />}
          subtle
          onClick={() => onShare(topic)}
        />
      </div>

      {onAssignCategory && onUnassignCategory && onCreateCategory ? (
        <FavoriteCategoryPicker
          categories={favoriteCategories}
          assignedCategories={topic.favorite_categories}
          pending={categoryPending}
          onAssign={(categoryId) => onAssignCategory(topic, categoryId)}
          onUnassign={(categoryId) => onUnassignCategory(topic, categoryId)}
          onCreateCategory={(name) => onCreateCategory(topic, name)}
        />
      ) : null}
    </div>
  )
}
