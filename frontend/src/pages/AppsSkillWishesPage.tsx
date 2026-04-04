import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubWish } from '../api/client'
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

export default function AppsSkillWishesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [wishes, setWishes] = useState<SkillHubWish[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [categoryKey, setCategoryKey] = useState('')
  const isLoggedIn = Boolean(tokenManager.get())

  const requireLogin = () => {
    if (isLoggedIn) return true
    toast.error('请先登录后再发布或支持需求')
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
    return false
  }

  const load = async () => {
    try {
      const res = await skillHubApi.listWishes()
      setWishes(res.data.list)
    } catch (err) {
      handleApiError(err, '加载许愿墙失败')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const submit = async () => {
    if (!requireLogin()) return
    if (!title.trim() || !content.trim()) return
    try {
      await skillHubApi.createWish({ title, content, category_key: categoryKey || undefined })
      setTitle('')
      setContent('')
      setCategoryKey('')
      await load()
    } catch (err) {
      handleApiError(err, '创建许愿失败')
    }
  }

  const vote = async (wishId: number) => {
    if (!requireLogin()) return
    try {
      await skillHubApi.voteWish(wishId, true)
      await load()
    } catch (err) {
      handleApiError(err, '投票失败')
    }
  }

  return (
    <ImmersiveAppShell title="许愿墙" subtitle="发布你需要的科研 Skill，让需求进入榜单、任务系统与后续的他山石激励链路。">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <AppsPanel>
          <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>投递需求</h2>
          {!isLoggedIn ? (
            <AppsInsetCard className="mt-4 text-sm">
              登录后可以发布需求、给愿望投票，并把需求沉淀进 SkillHub 社区任务与后续的他山石激励流程。
              {' '}
              <Link to="/register" state={{ from: `${location.pathname}${location.search}` }} className="underline underline-offset-4" style={{ color: 'var(--text-primary)' }}>
                去注册
              </Link>
            </AppsInsetCard>
          ) : null}
          <div className="mt-4 space-y-3">
            <AppsInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="需求标题" />
            <AppsInput value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} placeholder="学科代码，可留空" />
            <AppsTextarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="描述你希望解决的研究场景、输入输出和现有痛点" />
            <AppsPillButton type="button" onClick={submit}>
              发布许愿
            </AppsPillButton>
          </div>
        </AppsPanel>

        <AppsPanel>
          <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>热门需求</h2>
          <div className="mt-4 space-y-3">
            {wishes.map((wish) => (
              <AppsInsetCard key={wish.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{wish.title}</div>
                    <div className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{wish.content}</div>
                    <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {wish.author.display_name || '匿名需求方'} · {wish.category_key || '未分类'}
                    </div>
                  </div>
                  <AppsPillButton type="button" onClick={() => vote(wish.id)} className="shrink-0 px-3 py-1.5 text-xs">
                    支持 {wish.votes_count}
                  </AppsPillButton>
                </div>
              </AppsInsetCard>
            ))}
          </div>
        </AppsPanel>
      </div>
    </ImmersiveAppShell>
  )
}
