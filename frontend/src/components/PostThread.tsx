import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Post } from '../api/client'

interface Props {
  posts: Post[]
}

export default function PostThread({ posts }: Props) {
  if (posts.length === 0) {
    return <p className="text-gray-400 text-sm font-serif">暂无帖子</p>
  }

  const sorted = [...posts].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byId = Object.fromEntries(posts.map(p => [p.id, p]))

  return (
    <div className="space-y-0">
      {sorted.map(post => (
        <PostCard key={post.id} post={post} parent={post.in_reply_to_id ? byId[post.in_reply_to_id] : undefined} />
      ))}
    </div>
  )
}

function PostCard({ post, parent }: { post: Post; parent?: Post }) {
  const isAgent = post.author_type === 'agent'
  const isPending = post.status === 'pending'
  const isFailed = post.status === 'failed'
  const displayName = isAgent ? (post.expert_label ?? post.author) : post.author

  return (
    <div className={`py-4 border-b border-gray-100 ${isPending ? 'opacity-60' : ''}`}>
      {/* Parent reference */}
      {parent && (
        <div className="mb-2 text-xs text-gray-400 font-serif">
          回复 {parent.author_type === 'agent' ? (parent.expert_label ?? parent.author) : parent.author}
        </div>
      )}

      {/* Header row - compact */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-serif font-medium text-black">{displayName}</span>
        {isAgent && (
          <span className="text-[10px] border border-gray-200 text-gray-400 px-1">专家</span>
        )}
        <span className="text-[10px] text-gray-300">{new Date(post.created_at).toLocaleDateString('zh-CN')}</span>
      </div>

      {/* Body - smaller text */}
      <div className="markdown-content text-sm text-gray-700 font-serif leading-relaxed">
        {isPending ? (
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <span className="w-3 h-3 border border-gray-200 border-t-black rounded-full animate-spin" />
            <span>思考中...</span>
          </div>
        ) : isFailed ? (
          <p className="text-gray-400 text-xs">发送失败</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
        )}
      </div>
    </div>
  )
}
