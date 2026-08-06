import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { mcpHubApi, type ScienceMcpWish } from '../api/client'
import {
  AppsInput,
  AppsInsetCard,
  AppsPanel,
  AppsPillButton,
  AppsTextarea,
} from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

export default function MCPHubWishesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [wishes, setWishes] = useState<ScienceMcpWish[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [domain, setDomain] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const isLoggedIn = Boolean(tokenManager.get())

  const requireLogin = () => {
    if (isLoggedIn) return true
    toast.error('请先登录后再发布或支持科研需求')
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
    return false
  }

  const refresh = async () => {
    try {
      const response = await mcpHubApi.listWishes()
      setWishes(response.data.list)
    } catch (error) {
      handleApiError(error, '加载科研需求失败')
    }
  }

  useEffect(() => { void refresh() }, [])

  const submit = async () => {
    if (!requireLogin() || !title.trim() || !content.trim()) return
    try {
      await mcpHubApi.createWish({ title: title.trim(), content: content.trim(), taxonomy: domain.trim() ? { domain: domain.trim() } : undefined })
      setTitle('')
      setContent('')
      setDomain('')
      setMessage('科研需求已发布。')
      await refresh()
    } catch (error) {
      handleApiError(error, '发布科研需求失败')
    }
  }

  const vote = async (wish: ScienceMcpWish) => {
    if (!requireLogin()) return
    try {
      await mcpHubApi.voteWish(wish.id)
      await refresh()
    } catch (error) {
      handleApiError(error, '支持科研需求失败')
    }
  }

  return (
    <ImmersiveAppShell
      title="科研 MCP 需求墙"
      subtitle="记录尚未找到合适工具的科研对象、数据类型和研究任务，邀请社区一起补充线索。"
      backTo="/mcphub"
      backLabel="科研 MCP Hub"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <AppsPanel>
          <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>提交科研需求</h2>
          {!isLoggedIn ? (
            <AppsInsetCard className="mt-4 text-sm leading-6">
              登录后可以发布需求、支持其他研究者的想法，让需求被更多研究者看到。
              {' '}
              <Link to="/register" state={{ from: `${location.pathname}${location.search}` }} className="underline underline-offset-4" style={{ color: 'var(--text-primary)' }}>去注册</Link>
            </AppsInsetCard>
          ) : null}
          <div className="mt-4 space-y-3">
            <AppsInput aria-label="愿望标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：蛋白结构对接与结果解释 MCP" />
            <AppsInput aria-label="一级领域" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="一级领域，可留空" />
            <AppsTextarea aria-label="愿望内容" value={content} onChange={(event) => setContent(event.target.value)} rows={6} placeholder="说明科研对象、数据、动作和预期产物…" />
            <AppsPillButton type="button" onClick={() => void submit()}>发布需求</AppsPillButton>
            {message ? <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{message}</div> : null}
          </div>
        </AppsPanel>

        <AppsPanel>
          <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>热门科研需求</h2>
          <div className="mt-4 space-y-3">
            {wishes.length === 0 ? <AppsInsetCard>还没有需求；可以先提交一个明确的研究对象与任务。</AppsInsetCard> : wishes.map((wish) => (
              <AppsInsetCard key={wish.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{wish.title}</div>
                    <div className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{wish.content}</div>
                    <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {wish.author.display_name || '匿名研究者'} · {wish.domain || '待归类'} / {wish.subdomain || '待归类'}
                    </div>
                  </div>
                  <AppsPillButton type="button" variant="secondary" onClick={() => void vote(wish)} className="shrink-0 px-3 py-1.5 text-xs">支持 {wish.votes_count}</AppsPillButton>
                </div>
              </AppsInsetCard>
            ))}
          </div>
        </AppsPanel>
      </div>
    </ImmersiveAppShell>
  )
}
