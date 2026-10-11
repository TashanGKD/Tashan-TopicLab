import { useEffect, useState } from 'react'

import { mcpHubApi } from '../api/client'
import { AppsStatusCard } from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'

export default function MCPHubLeaderboardPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { mcpHubApi.listLeaderboard().then((response) => setRows(response.data.list)).catch(() => setError('贡献榜加载失败')) }, [])
  return (
    <ImmersiveAppShell
      title="科研 MCP 贡献榜"
      subtitle="展示研究者在收藏、评议、需求和工具推荐方面的社区贡献。"
      backTo="/mcphub"
      backLabel="科研 MCP Hub"
    >
        {error ? <div className="mt-5"><AppsStatusCard tone="error">{error}</AppsStatusCard></div> : null}
        <div className="mt-5 space-y-2">
          {rows.length === 0 && !error ? <AppsStatusCard>还没有贡献记录。</AppsStatusCard> : rows.map((row, index) => (
            <article key={String(row.id)} className="flex items-center justify-between gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
              <div><div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>#{index + 1}</div><div className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{String(row.display_name || row.handle || '研究者')}</div></div>
              <div className="flex flex-wrap justify-end gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}><span>评议 {String(row.reviews || 0)}</span><span>收藏 {String(row.favorites || 0)}</span><span>愿望 {String(row.wishes || 0)}</span><span>提交 {String(row.submissions || 0)}</span></div>
            </article>
          ))}
        </div>
    </ImmersiveAppShell>
  )
}
