import { useState } from 'react'
import { mcpApi, AssignableMCP } from '../api/client'
import MCPGrid from '../components/MCPGrid'
import MCPDetailModal from '../components/MCPDetailModal'
import LibraryPageLayout from '../components/LibraryPageLayout'

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
    <LibraryPageLayout title="MCP 库">
      <MCPGrid
        mode="view"
        layout="page"
        onMcpClick={openMcpDetail}
      />
      {detailMcp && (
        <MCPDetailModal
          mcp={detailMcp}
          content={detailContent}
          loading={detailLoading}
          onClose={closeMcpDetail}
        />
      )}
    </LibraryPageLayout>
  )
}
