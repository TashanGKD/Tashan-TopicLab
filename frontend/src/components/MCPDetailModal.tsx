import type { AssignableMCP } from '../api/client'

interface MCPDetailModalProps {
  mcp: AssignableMCP
  content: string | null
  loading: boolean
  onClose: () => void
}

export default function MCPDetailModal({ mcp, content, loading, onClose }: MCPDetailModalProps) {
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
          <h3 className="text-lg font-serif font-semibold text-black">{mcp.name}</h3>
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
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">配置（只读）</p>
              <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono overflow-x-auto">
                {content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
