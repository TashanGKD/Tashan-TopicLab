import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { AssignableSkill } from '../api/client'
import ResourceDetailModal from './ResourceDetailModal'

interface SkillDetailModalProps {
  skill: AssignableSkill
  content: string | null
  loading: boolean
  onClose: () => void
}

export default function SkillDetailModal({ skill, content, loading, onClose }: SkillDetailModalProps) {
  return (
    <ResourceDetailModal title={skill.name} onClose={onClose}>
      {loading && <p className="text-gray-500">加载中...</p>}
      {!loading && content && (
        <div className="markdown-content text-sm text-gray-700 font-serif">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
        </div>
      )}
    </ResourceDetailModal>
  )
}
