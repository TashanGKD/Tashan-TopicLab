import { Navigate, useSearchParams } from 'react-router-dom'

/** SkillHub-compatible share entry point; MCP evidence remains on the canonical detail page. */
export default function MCPHubSharePage() {
  const [params] = useSearchParams()
  const mcpId = params.get('mcp')
  return <Navigate to={mcpId ? `/mcphub/${encodeURIComponent(mcpId)}` : '/mcphub'} replace />
}
