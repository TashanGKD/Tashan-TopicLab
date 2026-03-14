import { Link } from 'react-router-dom'
import { FavoriteCategory, TopicListItem, getTopicCategoryMeta } from '../api/client'
import FavoriteCategoryPicker from './FavoriteCategoryPicker'
import ReactionButton from './ReactionButton'
import { getTopicPreviewImageSrc } from '../utils/topicImage'

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
  const previewImageSrc = getTopicPreviewImageSrc(topic, {
    width: 128,
    height: 128,
    quality: 72,
    format: 'webp',
  })

  return (
    <div className="relative rounded-lg border border-gray-200 p-4 transition-colors hover:border-black active:bg-gray-50 sm:p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/topics/${topic.id}`} className="block">
            <h3 className="mb-2 text-base font-serif font-semibold text-black">{topic.title}</h3>
          </Link>
        </div>
        {canDelete && onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(topic.id)}
            className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 transition-colors hover:border-red-500 hover:bg-red-50"
          >
            删除话题
          </button>
        ) : null}
      </div>

      <div className="flex items-start gap-4">
        <Link to={`/topics/${topic.id}`} className="flex min-w-0 flex-1 items-start gap-4">
          <div className="min-w-0 flex-1">
            {topic.body?.trim() ? (
              <p className="mb-3 line-clamp-2 text-sm font-serif text-gray-600">
                {topic.body.slice(0, 150)}{topic.body.length > 150 ? '...' : ''}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-serif text-gray-400">
              {categoryMeta ? <span>板块：{categoryMeta.name}</span> : null}
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
          {previewImageSrc ? (
            <div className="mt-0.5 h-16 w-16 flex-shrink-0 self-start overflow-hidden rounded-md border border-gray-100 sm:h-20 sm:w-20">
              <img
                src={previewImageSrc}
                alt={`${topic.title} 预览图`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : null}
        </Link>
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
