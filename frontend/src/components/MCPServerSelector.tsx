import { useState } from 'react'
import { mcpApi, AssignableMCP } from '../api/client'
import MCPGrid from './MCPGrid'
import MCPDetailModal from './MCPDetailModal'

export interface MCPServerSelectorProps {
  value: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  maxHeight?: string
}

export default function MCPServerSelector({
  value,
  onChange,
  placeholder = '搜索 MCP 服务器名称、描述、分类...',
  maxHeight = '320px',
}: MCPServerSelectorProps) {
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
    <>
      <MCPGrid
        mode="select"
        layout="embed"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxHeight={maxHeight}
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
    </>
  )
}
