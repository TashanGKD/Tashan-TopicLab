import type { AssignableModeratorMode } from '../api/client'
import ResourceDetailModal from './ResourceDetailModal'

interface ModeratorModeDetailModalProps {
  mode: AssignableModeratorMode
  content: string | null
  loading: boolean
  onClose: () => void
}

export default function ModeratorModeDetailModal({
  mode,
  content,
  loading,
  onClose,
}: ModeratorModeDetailModalProps) {
  return (
    <ResourceDetailModal title={mode.name} onClose={onClose}>
      {loading && <p className="text-gray-500">加载中...</p>}
      {!loading && content && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">主持人提示词</p>
          <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </ResourceDetailModal>
  )
}
