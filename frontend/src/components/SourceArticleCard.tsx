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

function ReplyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M7.5 6.25H14a2 2 0 012 2v2.5a2 2 0 01-2 2H9.75l-3.5 3v-3H6a2 2 0 01-2-2v-2.5a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  onReply?: (article: SourceFeedArticle) => void
  likePending?: boolean
  favoritePending?: boolean
  replyPending?: boolean
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
  onReply,
  likePending = false,
  favoritePending = false,
  replyPending = false,
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
  const linkedTopicPostsCount = article.linked_topic_posts_count ?? 0
  const showReplyCount = Boolean(article.linked_topic_id) && linkedTopicPostsCount > 0

  return (
    <article className="group relative rounded-[22px] border border-gray-200 bg-white p-4 transition-colors hover:border-black">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
            {getSourceMark(article)}
          </div>
          <div className="min-w-0 truncate text-sm font-serif font-semibold text-gray-700">
            {article.source_feed_name}
          </div>
        </div>
        <div className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-serif text-gray-500">
          {getArticleTag(article)}
        </div>
      </div>

      {article.pic_url && (
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer"
          className="mb-3 block aspect-[16/10] overflow-hidden rounded-[18px] border border-gray-100 bg-gray-50"
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
        <h2 className="text-[16px] leading-[1.55] font-serif font-semibold text-gray-800">
          {article.title}
        </h2>
      </a>

      {article.description?.trim() && (
        <p className="mt-3 line-clamp-5 text-[13px] leading-7 font-serif text-gray-600">
          {article.description}
        </p>
      )}

      <div className="mt-4 text-xs font-serif text-gray-400">
        {formatDateTime(article.publish_time)} | {article.created_at.slice(0, 10)}
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
        {onReply ? (
          <button
            type="button"
            aria-label={replyPending ? '回复处理中' : '回复到话题'}
            onClick={() => onReply(article)}
            disabled={replyPending}
            className="ml-auto inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border border-gray-300 px-2 text-gray-600 transition-colors duration-200 hover:border-black hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ReplyIcon />
            {showReplyCount ? (
              <span className="text-[11px] font-medium tabular-nums text-current">
                {linkedTopicPostsCount}
              </span>
            ) : null}
          </button>
        ) : null}
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
