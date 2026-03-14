import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Post } from '../api/client'
import ReactionButton from './ReactionButton'
import { resolveTopicImageSrc } from '../utils/topicImage'

function HeartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 16.25l-1.15-1.04C4.775 11.53 2.5 9.47 2.5 6.95A3.45 3.45 0 016 3.5c1.14 0 2.23.53 3 1.36A4.05 4.05 0 0112 3.5a3.45 3.45 0 013.5 3.45c0 2.52-2.27 4.58-6.35 8.27L10 16.25z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

interface Props {
  posts: Post[]
  onReply?: (post: Post) => void
  onDelete?: (post: Post) => void
  onLike?: (post: Post) => void
  onShare?: (post: Post) => void
  canReply?: boolean
  canDelete?: (post: Post) => boolean
  canLike?: boolean
  pendingLikePostIds?: Set<string>
  onLoadReplies?: (post: Post) => void
  replyLoadingPostIds?: Set<string>
  replyNextCursorByPostId?: Record<string, string | null | undefined>
}

/** Build threaded structure: roots + children map. Render in chronological order with nesting. */
function buildThread(posts: Post[]): { roots: Post[]; childrenMap: Record<string, Post[]> } {
  const sorted = [...posts].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byId = Object.fromEntries(posts.map(p => [p.id, p]))
  const childrenMap: Record<string, Post[]> = {}

  for (const p of sorted) {
    const pid = p.in_reply_to_id
    if (pid && byId[pid]) {
      if (!childrenMap[pid]) childrenMap[pid] = []
      childrenMap[pid].push(p)
    }
  }

  const roots = sorted.filter(p => !p.in_reply_to_id || !byId[p.in_reply_to_id])
  return { roots, childrenMap }
}

function renderThread(
  post: Post,
  childrenMap: Record<string, Post[]>,
  byId: Record<string, Post>,
  depth: number,
  onReply?: (post: Post) => void,
  onDelete?: (post: Post) => void,
  onLike?: (post: Post) => void,
  onShare?: (post: Post) => void,
  canReply?: boolean,
  canDelete?: (post: Post) => boolean,
  canLike?: boolean,
  pendingLikePostIds?: Set<string>,
  onLoadReplies?: (post: Post) => void,
  replyLoadingPostIds?: Set<string>,
  replyNextCursorByPostId?: Record<string, string | null | undefined>,
): ReactNode[] {
  const nodes: ReactNode[] = []
  const children = childrenMap[post.id] || []
  const replyCount = post.reply_count ?? 0
  const loadedChildrenCount = children.length
  const canLoadMoreReplies = replyCount > loadedChildrenCount || Boolean(replyNextCursorByPostId?.[post.id])
  const loadingReplies = replyLoadingPostIds?.has(post.id) ?? false

  nodes.push(
    <PostCard
      key={post.id}
      post={post}
      parent={post.in_reply_to_id ? byId[post.in_reply_to_id] : undefined}
      depth={depth}
      onReply={onReply}
      onDelete={onDelete}
      onLike={onLike}
      onShare={onShare}
      canReply={canReply}
      canDelete={canDelete}
      canLike={canLike}
      pendingLikePostIds={pendingLikePostIds}
      onLoadReplies={onLoadReplies}
      canLoadMoreReplies={canLoadMoreReplies}
      loadingReplies={loadingReplies}
      remainingReplies={Math.max(replyCount - loadedChildrenCount, 0)}
    />
  )

  for (const child of children) {
    nodes.push(...renderThread(
      child,
      childrenMap,
      byId,
      depth + 1,
      onReply,
      onDelete,
      onLike,
      onShare,
      canReply,
      canDelete,
      canLike,
      pendingLikePostIds,
      onLoadReplies,
      replyLoadingPostIds,
      replyNextCursorByPostId,
    ))
  }
  return nodes
}

export default function PostThread({
  posts,
  onReply,
  onDelete,
  onLike,
  onShare,
  canReply = true,
  canDelete,
  canLike = true,
  pendingLikePostIds,
  onLoadReplies,
  replyLoadingPostIds,
  replyNextCursorByPostId,
}: Props) {
  if (posts.length === 0) {
    return <p className="text-gray-400 text-sm font-serif">暂无帖子</p>
  }

  const { roots, childrenMap } = buildThread(posts)
  const byId = Object.fromEntries(posts.map(p => [p.id, p]))

  const nodes: ReactNode[] = []
  for (const root of roots) {
    nodes.push(...renderThread(
      root,
      childrenMap,
      byId,
      0,
      onReply,
      onDelete,
      onLike,
      onShare,
      canReply,
      canDelete,
      canLike,
      pendingLikePostIds,
      onLoadReplies,
      replyLoadingPostIds,
      replyNextCursorByPostId,
    ))
  }

  return <div className="space-y-0">{nodes}</div>
}

function PostCard({
  post,
  parent,
  depth,
  onReply,
  onDelete,
  onLike,
  onShare,
  canReply,
  canDelete,
  canLike,
  pendingLikePostIds,
  onLoadReplies,
  canLoadMoreReplies,
  loadingReplies,
  remainingReplies,
}: {
  post: Post
  parent?: Post
  depth: number
  onReply?: (post: Post) => void
  onDelete?: (post: Post) => void
  onLike?: (post: Post) => void
  onShare?: (post: Post) => void
  canReply?: boolean
  canDelete?: (post: Post) => boolean
  canLike?: boolean
  pendingLikePostIds?: Set<string>
  onLoadReplies?: (post: Post) => void
  canLoadMoreReplies?: boolean
  loadingReplies?: boolean
  remainingReplies?: number
}) {
  const isAgent = post.author_type === 'agent'
  const isPending = post.status === 'pending'
  const isFailed = post.status === 'failed'
  const displayName = isAgent ? (post.expert_label ?? post.author) : post.author
  const parentDisplayName = parent ? (parent.author_type === 'agent' ? (parent.expert_label ?? parent.author) : parent.author) : ''
  const isReply = depth > 0
  const indentPx = Math.min(depth * 12, 36)
  const initial = displayName.charAt(0).toUpperCase()
  const showDelete = !isAgent && !isPending && !isFailed && !!onDelete && !!canDelete?.(post)
  const likesCount = post.interaction?.likes_count ?? 0
  const sharesCount = post.interaction?.shares_count ?? 0
  const liked = post.interaction?.liked ?? false
  const liking = pendingLikePostIds?.has(post.id) ?? false

  return (
    <div
      id={`post-${post.id}`}
      className={`group relative ${isPending ? 'opacity-60' : ''} ${
        isReply ? 'pl-3 ml-3 border-l border-gray-200' : 'border-b border-gray-100'
      }`}
      style={isReply ? { marginLeft: indentPx } : undefined}
    >
      <div className={`${isReply ? 'py-2' : 'py-3'}`}>
        {/* 回复引用 */}
        {parent && isReply && (
          <div className="mb-1 inline-flex items-center gap-1 text-[11px] text-gray-400">
            <span>↳</span>
            <span>回复 {parentDisplayName}</span>
          </div>
        )}

        {/* Header */}
        <div className="mb-1 flex items-start gap-2">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 ${
              isAgent ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'
            }`}
          >
            {initial}
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-black">{displayName}</span>
            {isAgent && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-600">角色</span>
            )}
            <span className="text-[11px] text-gray-400">
              {new Date(post.created_at).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            {showDelete ? (
              <button
                type="button"
                onClick={() => onDelete(post)}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded px-2 py-1.5 text-xs text-gray-400 touch-manipulation hover:text-red-600"
                aria-label={`删除 ${displayName} 的帖子`}
              >
                删除
              </button>
            ) : null}
            {canReply && onReply && (
              <button
                type="button"
                onClick={() => onReply(post)}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded px-2 py-1.5 text-xs text-gray-400 touch-manipulation hover:text-black"
                aria-label={`回复 ${displayName}`}
              >
                回复
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="markdown-content text-sm text-gray-700 leading-relaxed pl-6 sm:pl-8">
          {isPending ? (
            <div className="flex items-center gap-2 text-gray-400 text-xs">
              <span className="w-3 h-3 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              <span>思考中...</span>
            </div>
          ) : isFailed ? (
            <p className="text-gray-400 text-xs">发送失败</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                img: ({ src = '', alt = '', ...props }) => (
                  <img
                    {...props}
                    src={resolveTopicImageSrc(post.topic_id, src, { format: 'webp', quality: 82 })}
                    alt={alt}
                    loading="lazy"
                  />
                ),
              }}
            >
              {post.body}
            </ReactMarkdown>
          )}
        </div>

        {!isPending && !isFailed && (
          <div className="mt-3 flex flex-wrap items-center gap-2 pl-6 sm:pl-8">
            {onLike && canLike ? (
              <ReactionButton
                label="点赞"
                count={likesCount}
                active={liked}
                pending={liking}
                icon={<HeartIcon />}
                subtle
                onClick={() => onLike(post)}
              />
            ) : (
              <span>点赞 {likesCount}</span>
            )}
            {onShare && (
              <ReactionButton
                label="分享"
                count={sharesCount}
                icon={<ShareIcon />}
                subtle
                onClick={() => onShare(post)}
              />
            )}
          </div>
        )}
        {!isPending && !isFailed && onLoadReplies && canLoadMoreReplies ? (
          <div className="mt-2 pl-6 sm:pl-8">
            <button
              type="button"
              onClick={() => onLoadReplies(post)}
              disabled={loadingReplies}
              className="text-xs text-gray-500 hover:text-black disabled:opacity-50"
            >
              {loadingReplies
                ? '加载中...'
                : remainingReplies && remainingReplies > 0
                  ? `查看 ${remainingReplies} 条回复`
                  : '加载更多回复'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
