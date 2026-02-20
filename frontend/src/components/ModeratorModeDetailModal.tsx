import type { AssignableModeratorMode } from '../api/client'

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
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-serif font-semibold text-black">{mode.name}</h3>
            {mode.num_rounds != null && (
              <span className="text-xs text-gray-500">默认 {mode.num_rounds} 轮</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-black text-2xl leading-none"
          >
            ×
          </button>
        </div>
        {mode.convergence_strategy && (
          <div className="px-6 py-2 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">收敛策略</p>
            <p className="text-sm text-gray-700">{mode.convergence_strategy}</p>
          </div>
        )}
        <div className="px-6 py-4 overflow-auto flex-1">
          {loading && <p className="text-gray-500">加载中...</p>}
          {!loading && content && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">主持人提示词</p>
              <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                {content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
