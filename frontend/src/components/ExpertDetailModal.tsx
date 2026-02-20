import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ExpertInfo } from '../api/client'

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
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center font-serif text-sm flex-shrink-0">
              {expert.label.charAt(0)}
            </div>
            <div>
              <h3 className="text-lg font-serif font-semibold text-black">
                {expert.label}
              </h3>
              <span className="text-xs text-gray-500 font-mono">{expert.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/experts/${expert.name}/edit`}
              className="bg-black text-white px-4 py-1.5 text-sm font-serif hover:bg-gray-900 transition-colors"
              onClick={onClose}
            >
              编辑
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-black text-2xl leading-none"
            >
              ×
            </button>
          </div>
        </div>
        <div className="px-6 py-4 overflow-auto flex-1">
          {loading && <p className="text-gray-500">加载中...</p>}
          {!loading && content && (
            <div className="markdown-content text-sm text-gray-700 font-serif">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
          {!loading && !content && (
            <p className="text-gray-500">暂无 skill 内容</p>
          )}
        </div>
      </div>
    </div>
  )
}
