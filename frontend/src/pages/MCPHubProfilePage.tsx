import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { mcpHubApi, type ScienceMcpProfile, type ScienceMcpTask } from '../api/client'
import {
  AppsInput,
  AppsInsetCard,
  AppsPillButton,
  AppsStatusCard,
  AppsTextarea,
} from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'

const STAT_LABELS: Record<string, string> = {
  favorites: '收藏',
  reviews: '评议',
  wishes: '需求',
  submissions: '推荐',
  collections: '集合',
}

export default function MCPHubProfilePage() {
  const [profile, setProfile] = useState<ScienceMcpProfile | null>(null)
  const [tasks, setTasks] = useState<ScienceMcpTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [collectionTitle, setCollectionTitle] = useState('')
  const [collectionDescription, setCollectionDescription] = useState('')
  const [collectionBusy, setCollectionBusy] = useState(false)
  const [collectionMessage, setCollectionMessage] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([mcpHubApi.getProfile(), mcpHubApi.listTasks()])
      .then(([profileResponse, tasksResponse]) => {
        setProfile(profileResponse.data)
        setTasks(tasksResponse.data.tasks)
      })
      .catch(() => setError('登录后可以查看个人收藏、集合和社区贡献。'))
  }, [])

  const createCollection = async () => {
    if (!collectionTitle.trim() || collectionBusy) return
    setCollectionBusy(true)
    setCollectionMessage(null)
    try {
      const response = await mcpHubApi.createCollection({
        title: collectionTitle.trim(),
        description: collectionDescription.trim(),
      })
      setProfile((current) => current ? { ...current, collections: [response.data, ...current.collections] } : current)
      setCollectionTitle('')
      setCollectionDescription('')
      setCollectionMessage('集合已创建。')
    } catch {
      setCollectionMessage('集合创建失败，请确认登录状态后重试。')
    } finally {
      setCollectionBusy(false)
    }
  }

  return (
    <ImmersiveAppShell
      title="我的科研 MCP Hub"
      subtitle="管理收藏、评议、集合、科研需求与候选提交，社区记录不会改变活动目录规模。"
      backTo="/mcphub"
      backLabel="科研 MCP Hub"
    >
        {error ? <div className="mt-5"><AppsStatusCard tone="error">{error}</AppsStatusCard></div> : null}
        {profile ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {Object.entries(profile.stats).map(([key, value]) => (
                <div key={key} className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{STAT_LABELS[key] ?? '社区记录'}</div>
                  <div className="mt-1 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                </div>
              ))}
            </div>
            <section className="mt-5 rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
              <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>我的收藏</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.favorites.length ? profile.favorites.map((item) => (
                  <Link key={item.mcp_id} to={`/mcphub/${encodeURIComponent(item.mcp_id)}`} className="rounded-full border px-3 py-1 text-xs text-teal-700">{item.mcp_id}</Link>
                )) : <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>还没有收藏。</span>}
              </div>
            </section>
            <section className="mt-5 rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>我的集合</h2>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>把关注的科研 MCP 按研究任务整理成可复用的集合。</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {profile.collections.length ? profile.collections.map((collection) => (
                  <AppsInsetCard key={collection.id} className="p-3">
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{collection.title}</div>
                    {collection.description ? <div className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{collection.description}</div> : null}
                    <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>{collection.items.length} 个 MCP · {collection.visibility === 'public' ? '公开' : '私有'}</div>
                  </AppsInsetCard>
                )) : <AppsStatusCard>还没有集合。</AppsStatusCard>}
              </div>
              <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AppsInput aria-label="集合名称" value={collectionTitle} onChange={(event) => setCollectionTitle(event.target.value)} placeholder="例如：蛋白结构研究工具" className="h-10 rounded-md py-2" />
                  <AppsTextarea aria-label="集合说明" value={collectionDescription} onChange={(event) => setCollectionDescription(event.target.value)} placeholder="说明这个集合服务的研究任务" rows={2} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <AppsPillButton type="button" onClick={() => void createCollection()} disabled={collectionBusy || !collectionTitle.trim()} className="disabled:cursor-not-allowed disabled:opacity-50">{collectionBusy ? '创建中…' : '新建集合'}</AppsPillButton>
                  {collectionMessage ? <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{collectionMessage}</span> : null}
                </div>
              </div>
            </section>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>我的评议</h2>
                <div className="mt-3 space-y-2">
                  {profile.reviews.length ? profile.reviews.map((review) => (
                    <AppsInsetCard key={review.id} className="p-3">
                      <div className="flex justify-between gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}><span>{review.mcp_id}</span><span>{review.rating}/5</span></div>
                      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{review.content}</p>
                    </AppsInsetCard>
                  )) : <AppsStatusCard>还没有提交评议。</AppsStatusCard>}
                </div>
              </section>
              <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>我的需求与推荐</h2>
                <div className="mt-3 space-y-2">
                  {profile.wishes.map((wish) => (
                    <AppsInsetCard key={`wish-${wish.id}`} className="p-3"><div className="font-medium" style={{ color: 'var(--text-primary)' }}>{wish.title}</div><div className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{wish.content}</div><div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>需求 · {wish.status}</div></AppsInsetCard>
                  ))}
                  {profile.submissions.map((submission) => (
                    <AppsInsetCard key={`submission-${String(submission.id)}`} className="p-3"><div className="font-medium" style={{ color: 'var(--text-primary)' }}>{String(submission.name || '未命名候选')}</div><div className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{String(submission.summary || submission.canonical_url || '')}</div><div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>候选 · {submission.status === 'accepted' ? '已收录' : submission.status === 'rejected' ? '未收录' : '审核中'}</div></AppsInsetCard>
                  ))}
                  {!profile.wishes.length && !profile.submissions.length ? <AppsStatusCard>还没有发布需求或提交候选。</AppsStatusCard> : null}
                </div>
              </section>
            </div>
            <section className="mt-5 rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
              <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>社区贡献</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {tasks.map((task) => (
                  <div key={task.task_key} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-default)' }}>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{task.description}</div>
                    <div className="mt-2 text-xs" style={{ color: task.completed ? '#0f766e' : 'var(--text-tertiary)' }}>{task.completed ? '已完成' : '可以参与'}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
    </ImmersiveAppShell>
  )
}
