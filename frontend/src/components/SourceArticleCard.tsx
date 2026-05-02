import { FavoriteCategory, sourceFeedApi, SourceFeedArticle } from '../api/client'
import FavoriteCategoryPicker from './FavoriteCategoryPicker'
import ReactionButton from './ReactionButton'

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

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getArticleTag(article: SourceFeedArticle) {
  const marker = `${article.source_feed_name} ${article.url}`.toLowerCase()
  if (article.source_type === 'worldweave-signal') {
    return '信号'
  }
  if (marker.includes('arxiv')) {
    return '论文'
  }
  return '新闻'
}

function getSourceMark(article: SourceFeedArticle) {
  const name = article.source_feed_name.trim()
  if (!name) {
    return '源'
  }
  return name[0]
}

interface SourceArticleCardProps {
  article: SourceFeedArticle
  onLike: (article: SourceFeedArticle) => void
  onFavorite: (article: SourceFeedArticle) => void
  onShare: (article: SourceFeedArticle) => void
  likePending?: boolean
  favoritePending?: boolean
  favoriteCategories?: FavoriteCategory[]
  categoryPending?: boolean
  onAssignCategory?: (article: SourceFeedArticle, categoryId: string) => void
  onUnassignCategory?: (article: SourceFeedArticle, categoryId: string) => void
  onCreateCategory?: (article: SourceFeedArticle, name: string) => void
}

export default function SourceArticleCard({
  article,
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
}: SourceArticleCardProps) {
  const liked = article.interaction?.liked ?? false
  const favorited = article.interaction?.favorited ?? false
  const likesCount = article.interaction?.likes_count ?? 0
  const sharesCount = article.interaction?.shares_count ?? 0
  const favoritesCount = article.interaction?.favorites_count ?? 0
  const isWorldWeaveSignal = article.source_type === 'worldweave-signal'

  return (
    <article
      className="group relative rounded-xl border p-4 transition-all cursor-pointer"
      style={{
        borderColor: 'var(--border-default)',
        backgroundColor: 'var(--bg-container)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-hover)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-default)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
            }}
          >
            {getSourceMark(article)}
          </div>
          <div
            className="min-w-0 truncate text-sm font-serif font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            {article.source_feed_name}
          </div>
        </div>
        <div
          className="rounded-lg px-2.5 py-1 text-xs font-serif"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-tertiary)',
          }}
        >
          {getArticleTag(article)}
        </div>
      </div>

      {article.pic_url && (
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer"
          className="mb-3 block aspect-[16/10] overflow-hidden rounded-xl border"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: 'var(--bg-secondary)',
          }}
        >
          <img
            src={sourceFeedApi.imageUrl(article.pic_url)}
            alt={article.title}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        </a>
      )}

      <a href={article.url} target="_blank" rel="noreferrer" className="block">
        <h2
          className="text-[16px] leading-[1.55] font-serif font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {article.title}
        </h2>
      </a>

      {article.description?.trim() && (
        <p
          className={`mt-3 text-[13px] leading-7 font-serif ${
            isWorldWeaveSignal ? '' : 'line-clamp-5'
          }`}
          style={{ color: 'var(--text-secondary)' }}
        >
          {article.description}
        </p>
      )}

      <div
        className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-serif"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <span>{formatDateTime(article.publish_time)} | {article.created_at.slice(0, 10)}</span>
        {article.url ? (
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium transition-colors hover:text-slate-900"
          >
            原文链接
          </a>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ReactionButton
          label="点赞"
          count={likesCount}
          active={liked}
          pending={likePending}
          icon={<HeartIcon />}
          subtle
          onClick={() => onLike(article)}
        />
        <ReactionButton
          label="收藏"
          count={favoritesCount}
          active={favorited}
          pending={favoritePending}
          icon={<BookmarkIcon />}
          subtle
          onClick={() => onFavorite(article)}
        />
        <ReactionButton
          label="分享"
          count={sharesCount}
          icon={<ShareIcon />}
          subtle
          onClick={() => onShare(article)}
        />
      </div>

      {onAssignCategory && onUnassignCategory && onCreateCategory ? (
        <FavoriteCategoryPicker
          categories={favoriteCategories}
          assignedCategories={article.favorite_categories}
          pending={categoryPending}
          onAssign={(categoryId) => onAssignCategory(article, categoryId)}
          onUnassign={(categoryId) => onUnassignCategory(article, categoryId)}
          onCreateCategory={(name) => onCreateCategory(article, name)}
        />
      ) : null}
    </article>
  )
}
