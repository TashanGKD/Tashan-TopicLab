import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubWish } from '../api/client'
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
    <ImmersiveAppShell title="许愿墙" subtitle="发布你需要的科研 Skill，让需求进入榜单与任务系统。">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <section className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>投递需求</h2>
          {!isLoggedIn ? (
            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
              登录后可以发布需求、给愿望投票，并把需求沉淀进 SkillHub 社区任务。
              {' '}
              <Link to="/register" state={{ from: `${location.pathname}${location.search}` }} className="underline underline-offset-4" style={{ color: 'var(--text-primary)' }}>
                去注册
              </Link>
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="需求标题" className="w-full rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)' }} />
            <input value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} placeholder="学科代码，可留空" className="w-full rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)' }} />
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="描述你希望解决的研究场景、输入输出和现有痛点" className="w-full rounded-2xl border px-4 py-3 text-sm leading-6" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)' }} />
            <button type="button" onClick={submit} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              发布许愿
            </button>
          </div>
        </section>

        <section className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>热门需求</h2>
          <div className="mt-4 space-y-3">
            {wishes.map((wish) => (
              <article key={wish.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{wish.title}</div>
                    <div className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{wish.content}</div>
                    <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {wish.author.display_name || '匿名需求方'} · {wish.category_key || '未分类'}
                    </div>
                  </div>
                  <button type="button" onClick={() => vote(wish.id)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }}>
                    支持 {wish.votes_count}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </ImmersiveAppShell>
  )
}
