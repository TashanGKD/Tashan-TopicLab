import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Post } from '../api/client'

interface Props {
  posts: Post[]
  onReply?: (post: Post) => void
  canReply?: boolean
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
  canReply?: boolean
): ReactNode[] {
  const nodes: ReactNode[] = []
  const children = childrenMap[post.id] || []

  nodes.push(
    <PostCard
      key={post.id}
      post={post}
      parent={post.in_reply_to_id ? byId[post.in_reply_to_id] : undefined}
      depth={depth}
      onReply={onReply}
      canReply={canReply}
    />
  )

  for (const child of children) {
    nodes.push(...renderThread(child, childrenMap, byId, depth + 1, onReply, canReply))
  }
  return nodes
}

export default function PostThread({ posts, onReply, canReply = true }: Props) {
  if (posts.length === 0) {
    return <p className="text-gray-400 text-sm font-serif">暂无帖子</p>
  }

  const { roots, childrenMap } = buildThread(posts)
  const byId = Object.fromEntries(posts.map(p => [p.id, p]))

  const nodes: ReactNode[] = []
  for (const root of roots) {
    nodes.push(...renderThread(root, childrenMap, byId, 0, onReply, canReply))
  }

  return <div className="space-y-0">{nodes}</div>
}

function PostCard({
  post,
  parent,
  depth,
  onReply,
  canReply,
}: {
  post: Post
  parent?: Post
  depth: number
  onReply?: (post: Post) => void
  canReply?: boolean
}) {
  const isAgent = post.author_type === 'agent'
  const isPending = post.status === 'pending'
  const isFailed = post.status === 'failed'
  const displayName = isAgent ? (post.expert_label ?? post.author) : post.author
  const parentDisplayName = parent ? (parent.author_type === 'agent' ? (parent.expert_label ?? parent.author) : parent.author) : ''
  const isReply = depth > 0
  const indentPx = Math.min(depth * 16, 64)
  const initial = displayName.charAt(0).toUpperCase()

  return (
    <div
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
        <div className="flex items-center gap-2 mb-1">
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
              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-600">专家</span>
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
          {canReply && onReply && (
            <button
              type="button"
              onClick={() => onReply(post)}
              className="text-xs text-gray-400 hover:text-black px-1.5 py-0.5"
            >
              回复
            </button>
          )}
        </div>

        {/* Body */}
        <div className="markdown-content text-sm text-gray-700 leading-relaxed pl-8">
          {isPending ? (
            <div className="flex items-center gap-2 text-gray-400 text-xs">
              <span className="w-3 h-3 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              <span>思考中...</span>
            </div>
          ) : isFailed ? (
            <p className="text-gray-400 text-xs">发送失败</p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  )
}
