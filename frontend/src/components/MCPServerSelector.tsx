import { useCallback } from 'react'
import { mcpApi, AssignableMCP } from '../api/client'
import { useResourceDetail } from '../hooks/useResourceDetail'
import MCPGrid from './MCPGrid'
import MCPDetailModal from './MCPDetailModal'

export interface MCPServerSelectorProps {
  value: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  maxHeight?: string
  fillHeight?: boolean
}

export default function MCPServerSelector({
  value,
  onChange,
  placeholder = '搜索 MCP 服务器名称、描述、分类...',
  maxHeight = '320px',
  fillHeight = false,
}: MCPServerSelectorProps) {
  const fetchContent = useCallback(async (m: AssignableMCP) => {
    const res = await mcpApi.getContent(m.id)
    return res.data.content
  }, [])
  const { detailItem: detailMcp, detailContent, detailLoading, openDetail: openMcpDetail, closeDetail: closeMcpDetail } =
    useResourceDetail(fetchContent)

  return (
    <>
      <MCPGrid
        mode="select"
        layout="embed"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxHeight={fillHeight ? undefined : maxHeight}
        fillHeight={fillHeight}
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
