import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Post } from '../api/client'
import ReactionButton from './ReactionButton'
import { isVideoMediaSrc, resolveTopicImageSrc } from '../utils/topicImage'
import { getArcadeKind, getArcadeScore } from '../utils/arcade'

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
  onDelete?: (post: Post) => void
  onLike?: (post: Post) => void
  onShare?: (post: Post) => void
  canDelete?: (post: Post) => boolean
  canLike?: boolean
  pendingLikePostIds?: Set<string>
}

function getBranchRootId(post: Post): string {
  return post.root_post_id ?? post.id
}

function getLatestBranchScore(posts: Post[]): number | null {
  for (let index = posts.length - 1; index >= 0; index -= 1) {
    const score = getArcadeScore(posts[index])
    if (score != null) {
      return score
    }
  }
  return null
}

function getRankMedal(rank: number): string | null {
  if (rank === 0) return '🥇'
  if (rank === 1) return '🥈'
  if (rank === 2) return '🥉'
  return null
}

export default function ArcadeBranchTimeline({
  posts,
  onDelete,
  onLike,
  onShare,
  canDelete,
  canLike = true,
  pendingLikePostIds,
}: Props) {
  if (posts.length === 0) {
    return <p className="text-sm font-serif text-gray-400">暂无分支</p>
  }

  const byId = Object.fromEntries(posts.map((post) => [post.id, post]))
  const roots = posts
    .filter((post) => !post.in_reply_to_id || !byId[post.in_reply_to_id])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const branches = roots.map((root) => {
    const branchPosts = posts
      .filter((post) => getBranchRootId(post) === root.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const latest = branchPosts[branchPosts.length - 1] ?? root
    const latestScore = getLatestBranchScore(branchPosts)
    const submissions = branchPosts.filter((post) => getArcadeKind(post) === 'submission').length
    const evaluations = branchPosts.filter((post) => getArcadeKind(post) === 'evaluation').length
    return { root, branchPosts, latest, latestScore, submissions, evaluations }
  }).sort((a, b) => {
    if (a.latestScore != null && b.latestScore != null && a.latestScore !== b.latestScore) {
      return b.latestScore - a.latestScore
    }
    if (a.latestScore != null && b.latestScore == null) {
      return -1
    }
    if (a.latestScore == null && b.latestScore != null) {
      return 1
    }
    return b.latest.created_at.localeCompare(a.latest.created_at)
  })

  return (
    <div className="space-y-3">
      {branches.map(({ root, branchPosts, latest, latestScore, submissions, evaluations }, branchIndex) => {
        const latestKind = getArcadeKind(latest)
        const rankMedal = getRankMedal(branchIndex)
        return (
          <section
            key={root.id}
            className="overflow-hidden rounded-[1.15rem] border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {rankMedal ? (
                  <span className="text-lg leading-none" aria-label={`第 ${branchIndex + 1} 名`}>
                    {rankMedal}
                  </span>
                ) : null}
                <span className="font-serif text-[1.55rem] leading-none text-black">{root.author}</span>
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
                  {submissions} 次提交 / {evaluations} 次评测
                </span>
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
                  {latestKind === 'evaluation' ? '评测已返回' : '等待评测'}
                </span>
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
                  {latestScore != null ? latestScore.toFixed(4) : 'Pending'}
                </span>
                <span className="text-xs text-gray-400">
                  latest {new Date(latest.created_at).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="relative">
                <div className="absolute bottom-0 left-[0.82rem] top-0 hidden w-px bg-gray-200 sm:block" />
                <div className="space-y-2.5">
                  {branchPosts.map((post, index) => {
                    const isSystem = post.author_type === 'system'
                    const kind = getArcadeKind(post)
                    const score = getArcadeScore(post)
                    const likesCount = post.interaction?.likes_count ?? 0
                    const sharesCount = post.interaction?.shares_count ?? 0
                    const liked = post.interaction?.liked ?? false
                    const liking = pendingLikePostIds?.has(post.id) ?? false
                    const isLatest = latest.id === post.id
                    return (
                      <CompactArcadeEntry
                        key={post.id}
                        post={post}
                        index={index}
                        isSystem={isSystem}
                        kind={kind}
                        score={score}
                        isLatest={isLatest}
                        onDelete={onDelete}
                        canDelete={canDelete}
                        onLike={onLike}
                        onShare={onShare}
                        canLike={canLike}
                        likesCount={likesCount}
                        sharesCount={sharesCount}
                        liked={liked}
                        liking={liking}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CompactArcadeEntry({
  post,
  index,
  isSystem,
  kind,
  score,
  isLatest,
  onDelete,
  canDelete,
  onLike,
  onShare,
  canLike,
  likesCount,
  sharesCount,
  liked,
  liking,
}: {
  post: Post
  index: number
  isSystem: boolean
  kind: string
  score: number | null
  isLatest: boolean
  onDelete?: (post: Post) => void
  canDelete?: (post: Post) => boolean
  onLike?: (post: Post) => void
  onShare?: (post: Post) => void
  canLike: boolean
  likesCount: number
  sharesCount: number
  liked: boolean
  liking: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const needsClamp = post.body.length > 220

  return (
    <article
      id={`post-${post.id}`}
      className="group relative pl-0 sm:pl-9"
    >
      <div className={`absolute left-0 top-2.5 hidden h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold sm:flex ${
        isSystem
          ? 'border-gray-300 bg-gray-100 text-gray-700'
          : 'border-gray-300 bg-white text-gray-700'
      }`}>
        {isSystem ? '评' : `v${index + 1}`}
      </div>
      <div className={`overflow-hidden rounded-[0.95rem] border px-3 py-2.5 transition-all duration-200 ${
        kind === 'evaluation'
          ? 'border-gray-200 bg-gray-50/80 shadow-sm'
          : 'border-gray-200 bg-white shadow-sm'
      }`}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-black">{isSystem ? '评测员' : post.author}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${
              kind === 'evaluation'
                ? 'bg-gray-200 text-gray-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {kind === 'evaluation' ? 'Evaluation' : 'Submission'}
            </span>
            {isLatest ? (
              <span className="rounded-full bg-black px-2 py-0.5 text-[11px] text-white">Latest</span>
            ) : null}
            {score != null ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-600">{score.toFixed(4)}</span>
            ) : null}
            <span className="text-xs text-gray-400">
              {new Date(post.created_at).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {onDelete && canDelete?.(post) ? (
              <button
                type="button"
                onClick={() => onDelete(post)}
                className="ml-auto rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                aria-label={`删除 ${isSystem ? '评测员' : post.author} 的帖子`}
              >
                删除
              </button>
            ) : null}
          </div>

          <div className="rounded-[0.8rem] border border-gray-100 bg-white px-3 py-2.5">
            <div className={`markdown-content markdown-content-compact arcade-post-body text-sm text-gray-700 ${
              !expanded && needsClamp ? 'max-h-24 overflow-hidden' : ''
            }`}>
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
                          className="max-h-[20rem] w-full rounded-lg bg-black/90"
                          src={resolvedSrc}
                          aria-label={alt || 'video'}
                        />
                      )
                    }
                    return <img {...props} src={resolvedSrc} alt={alt} loading="lazy" />
                  },
                }}
              >
                {post.body}
              </ReactMarkdown>
            </div>
            {needsClamp ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 text-xs text-gray-500 hover:text-black"
              >
                {expanded ? '收起' : '展开'}
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              <span className="text-xs text-gray-500">点赞 {likesCount}</span>
            )}
            {onShare ? (
              <ReactionButton
                label="分享"
                count={sharesCount}
                icon={<ShareIcon />}
                subtle
                onClick={() => onShare(post)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}
