import { useState } from 'react'
import { mcpApi, AssignableMCP } from '../api/client'
import MCPGrid from '../components/MCPGrid'
import MCPDetailModal from '../components/MCPDetailModal'

export default function MCPLibrary() {
  const [detailMcp, setDetailMcp] = useState<AssignableMCP | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openMcpDetail = async (m: AssignableMCP) => {
    setDetailMcp(m)
    setDetailContent(null)
    setDetailLoading(true)
    try {
      const res = await mcpApi.getContent(m.id)
      setDetailContent(res.data.content)
    } catch {
      setDetailContent('（加载失败）')
    } finally {
      setDetailLoading(false)
    }
  }

  const closeMcpDetail = () => {
    setDetailMcp(null)
    setDetailContent(null)
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-serif font-bold text-black">MCP 库</h1>
        </div>

        <MCPGrid
          mode="view"
          layout="page"
          onMcpClick={openMcpDetail}
        />
      </div>

      {detailMcp && (
        <MCPDetailModal
          mcp={detailMcp}
          content={detailContent}
          loading={detailLoading}
          onClose={closeMcpDetail}
        />
      )}
    </div>
  )
}
