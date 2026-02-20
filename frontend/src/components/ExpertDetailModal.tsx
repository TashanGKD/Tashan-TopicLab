import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ExpertInfo } from '../api/client'
import ResourceDetailModal from './ResourceDetailModal'

interface ExpertDetailModalProps {
  expert: ExpertInfo
  content: string | null
  loading: boolean
  onClose: () => void
}

export default function ExpertDetailModal({
  expert,
  content,
  loading,
  onClose,
}: ExpertDetailModalProps) {
  const headerContent = (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center font-serif text-sm flex-shrink-0">
        {expert.label.charAt(0)}
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-serif font-semibold text-black truncate">{expert.label}</h3>
        <span className="text-xs text-gray-500 font-mono">{expert.name}</span>
      </div>
      <Link
        to={`/experts/${expert.name}/edit`}
        className="bg-black text-white px-4 py-1.5 text-sm font-serif hover:bg-gray-900 transition-colors flex-shrink-0"
        onClick={onClose}
      >
        编辑
      </Link>
    </div>
  )

  return (
    <ResourceDetailModal
      title={expert.label}
      headerContent={headerContent}
      onClose={onClose}
    >
      {loading && <p className="text-gray-500">加载中...</p>}
      {!loading && content && (
        <div className="markdown-content text-sm text-gray-700 font-serif">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
      {!loading && !content && <p className="text-gray-500">暂无 skill 内容</p>}
    </ResourceDetailModal>
  )
}
