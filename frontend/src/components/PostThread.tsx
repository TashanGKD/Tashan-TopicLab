import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Post } from '../api/client'
import DefaultAvatar from './DefaultAvatar'
import ReactionButton from './ReactionButton'
import { isVideoMediaSrc, resolveTopicImageSrc } from '../utils/topicImage'
import { getArcadeKind } from '../utils/arcade'

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
  compactLongPosts?: boolean
}

interface ThreadEntry {
  post: Post
  parent?: Post
  depth: number
  canLoadMoreReplies: boolean
  loadingReplies: boolean
  remainingReplies: number
}

const INITIAL_VISIBLE_POSTS = 24
const VISIBLE_POSTS_STEP = 20

function cleanPostDisplayName(name: string | null | undefined) {
  const raw = (name ?? '').trim()
  if (!raw) return '参与者'
  const guestMatch = raw.match(/^OpenClaw\s+Guest\s+([^'\s]+)(?:'s)?(?:\s+openclaw)?/i)
  if (guestMatch) return `来访者 ${guestMatch[1]}`
  if (/^openclaw$/i.test(raw)) return '我这边'
  return raw.replace(/\s*'s\s+openclaw$/i, '').trim()
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

function flattenThread(
  post: Post,
  childrenMap: Record<string, Post[]>,
  byId: Record<string, Post>,
  depth: number,
  replyLoadingPostIds?: Set<string>,
  replyNextCursorByPostId?: Record<string, string | null | undefined>,
): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  const children = childrenMap[post.id] || []
  const replyCount = post.reply_count ?? 0
  const loadedChildrenCount = children.length
  const canLoadMoreReplies = replyCount > loadedChildrenCount || Boolean(replyNextCursorByPostId?.[post.id])
  const loadingReplies = replyLoadingPostIds?.has(post.id) ?? false

  entries.push({
    post,
    parent: post.in_reply_to_id ? byId[post.in_reply_to_id] : undefined,
    depth,
    canLoadMoreReplies,
    loadingReplies,
    remainingReplies: Math.max(replyCount - loadedChildrenCount, 0),
  })

  for (const child of children) {
    entries.push(...flattenThread(
      child,
      childrenMap,
      byId,
      depth + 1,
      replyLoadingPostIds,
      replyNextCursorByPostId,
    ))
  }
  return entries
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
  compactLongPosts = false,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_POSTS)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_POSTS)
  }, [posts.length])

  const { roots, childrenMap } = buildThread(posts)
  const byId = Object.fromEntries(posts.map(p => [p.id, p]))

  const entries: ThreadEntry[] = []
  for (const root of roots) {
    entries.push(...flattenThread(
      root,
      childrenMap,
      byId,
      0,
      replyLoadingPostIds,
      replyNextCursorByPostId,
    ))
  }

  const visibleEntries = entries.slice(0, visibleCount)
  const hasMoreEntries = visibleCount < entries.length

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMoreEntries) {
      return
    }
    const observer = new IntersectionObserver((observerEntries) => {
      if (observerEntries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((prev) => Math.min(prev + VISIBLE_POSTS_STEP, entries.length))
      }
    }, { rootMargin: '320px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [entries.length, hasMoreEntries])

  if (posts.length === 0) {
    return <p className="text-gray-400 text-sm font-serif">暂无帖子</p>
  }

  return (
    <div className="space-y-0">
      {visibleEntries.map((entry) => (
        <PostCard
          key={entry.post.id}
          post={entry.post}
          parent={entry.parent}
          depth={entry.depth}
          onReply={onReply}
          onDelete={onDelete}
          onLike={onLike}
          onShare={onShare}
          canReply={canReply}
          canDelete={canDelete}
          canLike={canLike}
          pendingLikePostIds={pendingLikePostIds}
          onLoadReplies={onLoadReplies}
          canLoadMoreReplies={entry.canLoadMoreReplies}
          loadingReplies={entry.loadingReplies}
          remainingReplies={entry.remainingReplies}
          compactLongPosts={compactLongPosts}
        />
      ))}
      {hasMoreEntries ? (
        <div ref={sentinelRef} className="py-4 text-center">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => Math.min(prev + VISIBLE_POSTS_STEP, entries.length))}
            className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:border-gray-300 hover:text-black"
          >
            继续加载更多帖子
          </button>
        </div>
      ) : null}
    </div>
  )
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
  compactLongPosts,
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
  compactLongPosts?: boolean
}) {
  const isAgent = post.author_type === 'agent'
  const isSystem = post.author_type === 'system'
  const isPending = post.status === 'pending'
  const isFailed = post.status === 'failed'
  const arcadeKind = getArcadeKind(post)
  const displayName = isSystem ? '评测员' : cleanPostDisplayName(isAgent ? (post.expert_label ?? post.author) : post.author)
  const parentDisplayName = parent
    ? (parent.author_type === 'system'
        ? '评测员'
        : parent.author_type === 'agent'
          ? cleanPostDisplayName(parent.expert_label ?? parent.author)
          : cleanPostDisplayName(parent.author))
    : ''
  const isReply = depth > 0
  const indentPx = Math.min(depth * 12, 36)
  const showDelete = !isPending && !isFailed && !!onDelete && !!canDelete?.(post)
  const likesCount = post.interaction?.likes_count ?? 0
  const sharesCount = post.interaction?.shares_count ?? 0
  const liked = post.interaction?.liked ?? false
  const liking = pendingLikePostIds?.has(post.id) ?? false
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const plainTextBody = post.body.replace(/!\[[^\]]*]\(([^)]+)\)/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1').replace(/[*_`>#-]/g, '').trim()
  const shouldKeepCollapsed = compactLongPosts && !isPending && !isFailed && depth === 0 && plainTextBody.length > 360
  const initialRenderRichBody = compactLongPosts
    ? isPending || isFailed || depth > 0 || !shouldKeepCollapsed
    : isPending || isFailed || depth > 0
  const [renderRichBody, setRenderRichBody] = useState(initialRenderRichBody)
  const summaryLength = compactLongPosts ? 190 : 220
  const summary = plainTextBody.length > summaryLength ? `${plainTextBody.slice(0, summaryLength)}...` : plainTextBody

  useEffect(() => {
    if (shouldKeepCollapsed) {
      return
    }
    if (renderRichBody || !bodyRef.current) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRenderRichBody(true)
      }
    }, { rootMargin: '160px 0px' })
    observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [renderRichBody, shouldKeepCollapsed])

  return (
    <div
      id={`post-${post.id}`}
      className={`group relative ${isAgent ? 'topiclink-post-agent' : 'topiclink-post-person'} ${isPending ? 'opacity-60' : ''} ${
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
          <DefaultAvatar
            name={displayName}
            kind={isAgent ? 'openclaw' : 'person'}
            className="topiclink-post-avatar h-8 w-8 shrink-0 shadow-[0_8px_18px_rgba(42,59,49,0.12)] ring-2 ring-white"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-black">{displayName}</span>
              {isSystem ? <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">记录</span> : null}
              {arcadeKind === 'submission' && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-600">提交</span>
              )}
              {arcadeKind === 'evaluation' && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">评测</span>
              )}
              <span className="shrink-0 text-[11px] text-gray-400">
                {new Date(post.created_at).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {parent && isReply ? (
              <p className="mt-1 text-[11px] text-gray-400">回复 {parentDisplayName}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {showDelete ? (
              <button
                type="button"
                onClick={() => onDelete(post)}
                className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded px-2 py-1 text-xs text-gray-400 touch-manipulation hover:text-red-600"
                aria-label={`删除 ${displayName} 的帖子`}
              >
                删除
              </button>
            ) : null}
            {canReply && onReply && (
              <button
                type="button"
                onClick={() => onReply(post)}
                className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded px-2 py-1 text-xs text-gray-400 touch-manipulation hover:text-black"
                aria-label={`回复 ${displayName}`}
              >
                回复
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          className="markdown-content markdown-content-compact cursor-text text-sm text-gray-700 pl-6 sm:pl-8"
          onClick={() => setRenderRichBody(true)}
        >
          {isPending ? (
            <div className="flex items-center gap-2 text-gray-400 text-xs">
              <span className="w-3 h-3 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              <span>思考中...</span>
            </div>
          ) : isFailed ? (
            <p className="text-gray-400 text-xs">发送失败</p>
          ) : !renderRichBody ? (
            <div>
              <p className="whitespace-pre-wrap">{summary || post.body}</p>
              {plainTextBody.length > summaryLength ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setRenderRichBody(true)
                  }}
                  className="mt-2 text-xs text-gray-500 hover:text-black"
                >
                  展开全文
                </button>
              ) : null}
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                img: ({ src = '', alt = '', ...props }) => {
                  const resolvedSrc = resolveTopicImageSrc(post.topic_id, src, { format: 'webp', quality: 82 })
                  if (isVideoMediaSrc(resolvedSrc)) {
                    return (
                      <video
                        controls
                        preload="metadata"
                        className="max-h-[28rem] w-full rounded-lg bg-black/90"
                        src={resolvedSrc}
                        aria-label={alt || 'video'}
                      />
                    )
                  }
                  return (
                    <img
                      {...props}
                      src={resolvedSrc}
                      alt={alt}
                      loading="lazy"
                    />
                  )
                },
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
