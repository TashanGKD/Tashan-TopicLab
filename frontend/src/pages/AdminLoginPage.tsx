import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi, adminPanelTokenManager } from '../api/admin'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = adminPanelTokenManager.get()
    if (!token) return
    void adminApi.me().then(() => navigate('/admin', { replace: true })).catch(() => {
      adminPanelTokenManager.remove()
    })
  }, [navigate])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const data = await adminApi.login(password)
      adminPanelTokenManager.set(data.token)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '后台登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-8 shadow-2xl shadow-black/30">
            <div className="mb-8 inline-flex items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.28em] text-sky-200">
              Admin Panel
            </div>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight text-white">
              独立后台管理面
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              该后台与站点普通用户体系分离，只接受独立口令。未配置 `ADMIN_PANEL_PASSWORD`
              时，后端会在启动日志中生成并打印一次临时随机口令。
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Users</div>
                <div className="mt-2 text-sm text-slate-200">紧凑列表、编辑、删除</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Topics</div>
                <div className="mt-2 text-sm text-slate-200">正文、分类、状态管理</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Feedback</div>
                <div className="mt-2 text-sm text-slate-200">反馈检索、修正、删除</div>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white p-8 text-slate-900 shadow-2xl shadow-black/20">
            <h2 className="text-2xl font-semibold">后台登录</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              这里不使用站点管理员用户和普通用户 token。
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Admin Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:bg-white"
                  placeholder="输入后台口令"
                  autoComplete="current-password"
                />
              </label>
              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? '登录中...' : '进入后台'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
