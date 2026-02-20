import type { AssignableMCP } from '../api/client'
import ResourceDetailModal from './ResourceDetailModal'

interface MCPDetailModalProps {
  mcp: AssignableMCP
  content: string | null
  loading: boolean
  onClose: () => void
}

export default function MCPDetailModal({ mcp, content, loading, onClose }: MCPDetailModalProps) {
  return (
    <ResourceDetailModal title={mcp.name} onClose={onClose}>
      {loading && <p className="text-gray-500">加载中...</p>}
      {!loading && content && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">配置（只读）</p>
          <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </ResourceDetailModal>
  )
}
