import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  adminApi,
  adminPanelTokenManager,
  AdminFeedbackItem,
  AdminTopicItem,
  AdminUserItem,
} from '../api/admin'

type AdminTab = 'users' | 'topics' | 'feedback'
type SortOrder = 'asc' | 'desc'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const SORT_OPTIONS: Record<AdminTab, Array<{ value: string; label: string }>> = {
  users: [
    { value: 'created_at', label: '创建时间' },
    { value: 'phone', label: '手机号' },
    { value: 'username', label: '用户名' },
    { value: 'handle', label: '标识' },
    { value: 'topics_count', label: '话题数' },
    { value: 'feedback_count', label: '反馈数' },
  ],
  topics: [
    { value: 'updated_at', label: '更新时间' },
    { value: 'created_at', label: '创建时间' },
    { value: 'title', label: '标题' },
    { value: 'category', label: '分类' },
    { value: 'status', label: '状态' },
    { value: 'creator_name', label: '发起人' },
    { value: 'posts_count', label: '帖子数' },
  ],
  feedback: [
    { value: 'created_at', label: '提交时间' },
    { value: 'id', label: '反馈 ID' },
    { value: 'user_id', label: '用户 ID' },
    { value: 'username', label: '用户名' },
    { value: 'auth_channel', label: '登录来源' },
  ],
}

const DEFAULT_SORT: Record<AdminTab, { sortBy: string; sortOrder: SortOrder }> = {
  users: { sortBy: 'created_at', sortOrder: 'desc' },
  topics: { sortBy: 'updated_at', sortOrder: 'desc' },
  feedback: { sortBy: 'created_at', sortOrder: 'desc' },
}

function formatDate(value: string) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function StatCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: string | number
  tone?: 'slate' | 'blue' | 'amber'
}) {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-200 bg-blue-50 text-blue-900'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-900'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
    </div>
  )
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<AdminTab>('users')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState(DEFAULT_SORT.users.sortBy)
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT.users.sortOrder)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userDraft, setUserDraft] = useState<{ username: string; handle: string; is_admin: boolean }>({
    username: '',
    handle: '',
    is_admin: false,
  })

  const [topics, setTopics] = useState<AdminTopicItem[]>([])
  const [topicsTotal, setTopicsTotal] = useState(0)
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [topicDraft, setTopicDraft] = useState<{ title: string; body: string; category: string; status: string }>({
    title: '',
    body: '',
    category: '',
    status: '',
  })

  const [feedbackItems, setFeedbackItems] = useState<AdminFeedbackItem[]>([])
  const [feedbackTotal, setFeedbackTotal] = useState(0)
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null)
  const [feedbackDraft, setFeedbackDraft] = useState<{ scenario: string; body: string; steps_to_reproduce: string; page_url: string }>({
    scenario: '',
    body: '',
    steps_to_reproduce: '',
    page_url: '',
  })

  const logout = () => {
    adminPanelTokenManager.remove()
    navigate('/admin/login', { replace: true })
  }

  useEffect(() => {
    const token = adminPanelTokenManager.get()
    if (!token) {
      navigate('/admin/login', { replace: true })
      return
    }
    void adminApi.me().catch(() => {
      adminPanelTokenManager.remove()
      navigate('/admin/login', { replace: true })
    })
  }, [navigate])

  useEffect(() => {
    setOffset(0)
  }, [tab, query, pageSize, sortBy, sortOrder])

  useEffect(() => {
    setSearch('')
    setQuery('')
    setSortBy(DEFAULT_SORT[tab].sortBy)
    setSortOrder(DEFAULT_SORT[tab].sortOrder)
  }, [tab])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const run = async () => {
      try {
        if (tab === 'users') {
          const data = await adminApi.listUsers({ q: query, sort_by: sortBy, sort_order: sortOrder, limit: pageSize, offset })
          if (cancelled) return
          setUsers(data.items)
          setUsersTotal(data.total)
          const nextSelected = data.items.find((item) => item.id === selectedUserId) ?? data.items[0] ?? null
          setSelectedUserId(nextSelected?.id ?? null)
          setUserDraft({
            username: nextSelected?.username ?? '',
            handle: nextSelected?.handle ?? '',
            is_admin: nextSelected?.is_admin ?? false,
          })
        } else if (tab === 'topics') {
          const data = await adminApi.listTopics({ q: query, sort_by: sortBy, sort_order: sortOrder, limit: pageSize, offset })
          if (cancelled) return
          setTopics(data.items)
          setTopicsTotal(data.total)
          const nextSelected = data.items.find((item) => item.id === selectedTopicId) ?? data.items[0] ?? null
          setSelectedTopicId(nextSelected?.id ?? null)
          setTopicDraft({
            title: nextSelected?.title ?? '',
            body: nextSelected?.body ?? '',
            category: nextSelected?.category ?? '',
            status: nextSelected?.status ?? '',
          })
        } else {
          const data = await adminApi.listFeedback({ q: query, sort_by: sortBy, sort_order: sortOrder, limit: pageSize, offset })
          if (cancelled) return
          setFeedbackItems(data.items)
          setFeedbackTotal(data.total)
          const nextSelected = data.items.find((item) => item.id === selectedFeedbackId) ?? data.items[0] ?? null
          setSelectedFeedbackId(nextSelected?.id ?? null)
          setFeedbackDraft({
            scenario: nextSelected?.scenario ?? '',
            body: nextSelected?.body ?? '',
            steps_to_reproduce: nextSelected?.steps_to_reproduce ?? '',
            page_url: nextSelected?.page_url ?? '',
          })
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载失败')
        if (err instanceof Error && err.message.includes('后台登录')) {
          logout()
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [tab, query, pageSize, sortBy, sortOrder, offset, selectedUserId, selectedTopicId, selectedFeedbackId, reloadKey])

  const selectedUser = users.find((item) => item.id === selectedUserId) ?? null
  const selectedTopic = topics.find((item) => item.id === selectedTopicId) ?? null
  const selectedFeedback = feedbackItems.find((item) => item.id === selectedFeedbackId) ?? null
  const total = tab === 'users' ? usersTotal : tab === 'topics' ? topicsTotal : feedbackTotal
  const currentPage = Math.floor(offset / pageSize) + 1
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = offset > 0
  const canNext = offset + pageSize < total

  const pageNumbers = (() => {
    const pages: number[] = []
    const start = Math.max(1, currentPage - 2)
    const end = Math.min(totalPages, currentPage + 2)
    for (let page = start; page <= end; page += 1) {
      pages.push(page)
    }
    return pages
  })()

  const reloadCurrentTab = async () => {
    setReloadKey((value) => value + 1)
  }

  const summaryLabel = tab === 'users' ? '用户记录' : tab === 'topics' ? '话题记录' : '反馈记录'
  const selectedLabel = tab === 'users'
    ? (selectedUser?.username || selectedUser?.phone || '--')
    : tab === 'topics'
      ? (selectedTopic?.title || '--')
      : (selectedFeedback ? `#${selectedFeedback.id}` : '--')

  const saveCurrent = async () => {
    setSaving(true)
    setError('')
    try {
      if (tab === 'users' && selectedUser) {
        await adminApi.updateUser(selectedUser.id, {
          username: userDraft.username.trim() || null,
          handle: userDraft.handle.trim() || null,
          is_admin: userDraft.is_admin,
        })
      } else if (tab === 'topics' && selectedTopic) {
        await adminApi.updateTopic(selectedTopic.id, {
          title: topicDraft.title.trim(),
          body: topicDraft.body,
          category: topicDraft.category.trim() || null,
          status: topicDraft.status.trim(),
        })
      } else if (tab === 'feedback' && selectedFeedback) {
        await adminApi.updateFeedback(selectedFeedback.id, {
          scenario: feedbackDraft.scenario,
          body: feedbackDraft.body,
          steps_to_reproduce: feedbackDraft.steps_to_reproduce,
          page_url: feedbackDraft.page_url.trim() || null,
        })
      }
      await reloadCurrentTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteCurrent = async () => {
    if (tab === 'users' && selectedUser && !window.confirm(`确认删除用户 ${selectedUser.phone}？`)) return
    if (tab === 'topics' && selectedTopic && !window.confirm(`确认删除话题《${selectedTopic.title}》？`)) return
    if (tab === 'feedback' && selectedFeedback && !window.confirm(`确认删除反馈 #${selectedFeedback.id}？`)) return

    setSaving(true)
    setError('')
    try {
      if (tab === 'users' && selectedUser) {
        await adminApi.deleteUser(selectedUser.id)
        setSelectedUserId(null)
      } else if (tab === 'topics' && selectedTopic) {
        await adminApi.deleteTopic(selectedTopic.id)
        setSelectedTopicId(null)
      } else if (tab === 'feedback' && selectedFeedback) {
        await adminApi.deleteFeedback(selectedFeedback.id)
        setSelectedFeedbackId(null)
      }
      await reloadCurrentTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_28%),linear-gradient(180deg,#eef4fb_0%,#f8fbff_46%,#f2f6fb_100%)] text-slate-900"
      style={{ fontFamily: '"Fira Sans", "Noto Sans SC", sans-serif' }}
    >
      <div className="mx-auto max-w-[1680px] px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-4 overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,64,175,0.94))] px-6 py-5 text-white shadow-[0_24px_60px_rgba(30,64,175,0.18)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.32em] text-blue-200">Isolated Admin Surface</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">数据库管理后台</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100/85">
                面向高密度数据操作的控制台，优先强调筛选、排序、紧凑阅读和低误操作成本。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setTab('users')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  tab === 'users' ? 'bg-white text-slate-950 shadow-sm' : 'bg-white/10 text-blue-100 hover:bg-white/16'
                }`}
              >
                用户
              </button>
              <button
                type="button"
                onClick={() => setTab('topics')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  tab === 'topics' ? 'bg-white text-slate-950 shadow-sm' : 'bg-white/10 text-blue-100 hover:bg-white/16'
                }`}
              >
                话题
              </button>
              <button
                type="button"
                onClick={() => setTab('feedback')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  tab === 'feedback' ? 'bg-white text-slate-950 shadow-sm' : 'bg-white/10 text-blue-100 hover:bg-white/16'
                }`}
              >
                用户反馈
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/88 transition hover:bg-white/10"
              >
                退出后台
              </button>
            </div>
          </div>
        </header>

        <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="当前模块" value={summaryLabel} tone="blue" />
          <StatCard label="记录总数" value={total} />
          <StatCard label="当前页码" value={`${currentPage} / ${totalPages}`} />
          <StatCard label="当前选中" value={selectedLabel} tone="amber" />
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Dataset</div>
                  <div className="mt-1 text-base font-semibold text-slate-950">
                    {tab === 'users' ? '用户列表' : tab === 'topics' ? '话题列表' : '反馈列表'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">总计 {total} 条，当前第 {currentPage} / {totalPages} 页</div>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,260px)_150px_120px_120px]">
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white px-3">
                    <svg className="mr-2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
                    </svg>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          setQuery(search.trim())
                        }
                      }}
                      className="w-full bg-transparent py-2.5 text-sm outline-none"
                      placeholder={tab === 'users' ? '搜索用户名 / 手机 / handle' : tab === 'topics' ? '搜索标题 / 正文 / 发起人' : '搜索反馈正文 / 场景 / 页面'}
                    />
                  </div>
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                  >
                    {SORT_OPTIONS[tab].map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="desc">降序</option>
                    <option value="asc">升序</option>
                  </select>
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        每页 {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuery(search.trim())}
                  className="rounded-xl bg-slate-950 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  应用筛选
                </button>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  排序字段：<span className="font-medium text-slate-700">{SORT_OPTIONS[tab].find((item) => item.value === sortBy)?.label}</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  实际区间：<span className="font-medium text-slate-700">{total === 0 ? '0' : `${offset + 1}-${Math.min(offset + pageSize, total)}`}</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {tab === 'users' ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">序号</th>
                      <th className="px-4 py-3">用户</th>
                      <th className="px-4 py-3">标识</th>
                      <th className="px-4 py-3">计数</th>
                      <th className="px-4 py-3">创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedUserId(item.id)
                          setUserDraft({
                            username: item.username ?? '',
                            handle: item.handle ?? '',
                            is_admin: item.is_admin,
                          })
                        }}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${selectedUserId === item.id ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{offset + index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{item.username || '未命名用户'}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{item.phone}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div className="font-mono">ID {item.id}</div>
                          <div className="mt-1 font-mono">{item.handle || '--'}</div>
                          <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 ${item.is_admin ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                            {item.is_admin ? '管理员' : '普通用户'}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          <div>话题 {item.topics_count}</div>
                          <div className="mt-1">反馈 {item.feedback_count}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{formatDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === 'topics' ? (
                <table className="min-w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col />
                    <col className="w-[168px]" />
                    <col className="w-[170px]" />
                    <col className="w-[172px]" />
                  </colgroup>
                  <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">序号</th>
                      <th className="px-4 py-3">话题</th>
                      <th className="px-4 py-3 whitespace-nowrap">状态</th>
                      <th className="px-4 py-3 whitespace-nowrap">互动</th>
                      <th className="px-4 py-3 whitespace-nowrap">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topics.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedTopicId(item.id)
                          setTopicDraft({
                            title: item.title,
                            body: item.body,
                            category: item.category ?? '',
                            status: item.status,
                          })
                        }}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${selectedTopicId === item.id ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{offset + index + 1}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="line-clamp-1 font-medium text-slate-900">{item.title}</div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div className="whitespace-nowrap font-medium">{item.status}</div>
                          <div className="mt-1 whitespace-nowrap font-mono">{item.discussion_status}</div>
                          <div className="mt-1 whitespace-nowrap">{item.category || '未分类'}</div>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-600">
                          <div className="whitespace-nowrap">帖子 {item.posts_count}</div>
                          <div className="mt-1 whitespace-nowrap">赞 {item.likes_count} / 收藏 {item.favorites_count}</div>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-600">
                          <div className="whitespace-nowrap">{formatDate(item.updated_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === 'feedback' ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">序号</th>
                      <th className="px-4 py-3">反馈</th>
                      <th className="px-4 py-3">来源</th>
                      <th className="px-4 py-3">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbackItems.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedFeedbackId(item.id)
                          setFeedbackDraft({
                            scenario: item.scenario,
                            body: item.body,
                            steps_to_reproduce: item.steps_to_reproduce,
                            page_url: item.page_url ?? '',
                          })
                        }}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${selectedFeedbackId === item.id ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{offset + index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{item.username}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.scenario || '未填场景'}</div>
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div className="font-mono">用户 ID {item.user_id}</div>
                          <div className="mt-1">{item.auth_channel}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{formatDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 text-sm md:flex-row md:items-center md:justify-between">
              <div className="text-slate-500">
                {loading ? '加载中...' : total === 0 ? '暂无数据' : `当前 ${offset + 1}-${Math.min(offset + pageSize, total)} / ${total}`}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => setOffset((value) => Math.max(0, value - pageSize))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  上一页
                </button>
                {currentPage > 3 ? (
                  <button
                    type="button"
                    onClick={() => setOffset(0)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600"
                  >
                    1
                  </button>
                ) : null}
                {currentPage > 4 ? <span className="px-1 text-slate-400">...</span> : null}
                {pageNumbers.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setOffset((page - 1) * pageSize)}
                  className={`rounded-xl border px-3 py-2 ${
                      page === currentPage ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                {currentPage < totalPages - 3 ? <span className="px-1 text-slate-400">...</span> : null}
                {currentPage < totalPages - 2 ? (
                  <button
                    type="button"
                    onClick={() => setOffset((totalPages - 1) * pageSize)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600"
                  >
                    {totalPages}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setOffset((value) => value + pageSize)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          </section>

          <aside className="rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur xl:sticky xl:top-4 xl:h-fit">
            <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Inspector</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">编辑面板</div>
              <div className="mt-1 text-xs text-slate-500">
                {tab === 'users' ? '修改用户名、handle、管理员标记' : tab === 'topics' ? '修改标题、正文、分类、状态' : '修改反馈内容'}
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              {tab === 'users' ? (
                selectedUser ? (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                      <div>ID {selectedUser.id}</div>
                      <div>{selectedUser.phone}</div>
                      <div>创建于 {formatDate(selectedUser.created_at)}</div>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Username</span>
                      <input
                        value={userDraft.username}
                        onChange={(event) => setUserDraft((draft) => ({ ...draft, username: event.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Handle</span>
                      <input
                        value={userDraft.handle}
                        onChange={(event) => setUserDraft((draft) => ({ ...draft, handle: event.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={userDraft.is_admin}
                        onChange={(event) => setUserDraft((draft) => ({ ...draft, is_admin: event.target.checked }))}
                      />
                      站点管理员标记
                    </label>
                  </>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">左侧选择一个用户后可编辑。</div>
                )
              ) : null}

              {tab === 'topics' ? (
                selectedTopic ? (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                      <div>话题 ID {selectedTopic.id}</div>
                      <div>发起人 {selectedTopic.creator_name || '未知'}</div>
                      <div>更新时间 {formatDate(selectedTopic.updated_at)}</div>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Title</span>
                      <input
                        value={topicDraft.title}
                        onChange={(event) => setTopicDraft((draft) => ({ ...draft, title: event.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Category</span>
                        <input
                          value={topicDraft.category}
                          onChange={(event) => setTopicDraft((draft) => ({ ...draft, category: event.target.value }))}
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Status</span>
                        <input
                          value={topicDraft.status}
                          onChange={(event) => setTopicDraft((draft) => ({ ...draft, status: event.target.value }))}
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Body</span>
                      <textarea
                        value={topicDraft.body}
                        onChange={(event) => setTopicDraft((draft) => ({ ...draft, body: event.target.value }))}
                        rows={14}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                  </>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">左侧选择一个话题后可编辑。</div>
                )
              ) : null}

              {tab === 'feedback' ? (
                selectedFeedback ? (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                      <div>反馈 ID {selectedFeedback.id}</div>
                      <div>用户 {selectedFeedback.username} / {selectedFeedback.user_id}</div>
                      <div>提交时间 {formatDate(selectedFeedback.created_at)}</div>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Scenario</span>
                      <input
                        value={feedbackDraft.scenario}
                        onChange={(event) => setFeedbackDraft((draft) => ({ ...draft, scenario: event.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Page URL</span>
                      <input
                        value={feedbackDraft.page_url}
                        onChange={(event) => setFeedbackDraft((draft) => ({ ...draft, page_url: event.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Body</span>
                      <textarea
                        value={feedbackDraft.body}
                        onChange={(event) => setFeedbackDraft((draft) => ({ ...draft, body: event.target.value }))}
                        rows={8}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Steps</span>
                      <textarea
                        value={feedbackDraft.steps_to_reproduce}
                        onChange={(event) => setFeedbackDraft((draft) => ({ ...draft, steps_to_reproduce: event.target.value }))}
                        rows={6}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none focus:border-sky-500 focus:bg-white"
                      />
                    </label>
                  </>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">左侧选择一条反馈后可编辑。</div>
                )
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={saving || loading || (!selectedUser && !selectedTopic && !selectedFeedback)}
                  onClick={() => { void saveCurrent() }}
                  className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? '处理中...' : '保存修改'}
                </button>
                <button
                  type="button"
                  disabled={saving || loading || (!selectedUser && !selectedTopic && !selectedFeedback)}
                  onClick={() => { void deleteCurrent() }}
                  className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
