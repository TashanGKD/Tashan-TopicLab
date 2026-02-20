import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AssignableSkill } from '../api/client'

interface SkillDetailModalProps {
  skill: AssignableSkill
  content: string | null
  loading: boolean
  onClose: () => void
}

export default function SkillDetailModal({ skill, content, loading, onClose }: SkillDetailModalProps) {
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
          <h3 className="text-lg font-serif font-semibold text-black">{skill.name}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-black text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-4 overflow-auto flex-1">
          {loading && <p className="text-gray-500">加载中...</p>}
          {!loading && content && (
            <div className="markdown-content text-sm text-gray-700 font-serif">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
