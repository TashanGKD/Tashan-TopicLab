import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { inspirationApi, type InspirationDemand } from '../api/client'
import { refreshCurrentUserProfile, tokenManager, type User } from '../api/auth'

const ADMIN_DEMAND_LIMIT = 50

function formatPrivateValue(value: unknown) {
  if (value == null || value === '') return '未填写'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function getPrivateText(privateData: InspirationDemand['private'], key: string) {
  if (!privateData) return '未填写'
  return formatPrivateValue(privateData[key])
}

function demandStatusLabel(demand: InspirationDemand) {
  if (demand.status === 'published' && demand.allow_public !== false) return '公开'
  if (demand.status === 'private' || demand.allow_public === false) return '不公开'
  return demand.status || '未知'
}

function getClueNumber(demand: InspirationDemand, index: number) {
  if (typeof demand.clue_number === 'number' && Number.isFinite(demand.clue_number)) {
    return demand.clue_number
  }
  return index + 1
}

function AdminDemandCard({ demand, index }: { demand: InspirationDemand; index: number }) {
  const clueNumber = getClueNumber(demand, index)
  const owner = getPrivateText(demand.private, 'submitter_name')
  const contact = getPrivateText(demand.private, 'contact')
  const problem = getPrivateText(demand.private, 'problem')
  const blockers = getPrivateText(demand.private, 'current_blockers')

  return (
    <article className="rounded-[var(--radius-md)] border border-slate-200 bg-white p-5 shadow-[0_16px_38px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-700">线索 {String(clueNumber).padStart(2, '0')}</p>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-slate-950">{demand.title}</h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {demandStatusLabel(demand)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{demand.summary}</p>
      <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-slate-400">提出者</dt>
          <dd className="mt-1 break-words text-slate-800">{owner}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-400">联系方式</dt>
          <dd className="mt-1 break-words text-slate-800">{contact}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-xs font-semibold text-slate-400">原始问题</dt>
          <dd className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-slate-800">{problem}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-xs font-semibold text-slate-400">当前卡点</dt>
          <dd className="mt-1 break-words text-slate-800">{blockers}</dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to={`/inspiration-co-creation/needs/${demand.slug}`}
          className="inline-flex min-h-10 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          查看详情
        </Link>
        <span className="text-xs text-slate-400">更新于 {demand.latest_update_at || demand.updated_at}</span>
      </div>
    </article>
  )
}

export default function InspirationAdminNeedsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authStatus, setAuthStatus] = useState<'checking' | 'admin' | 'forbidden'>('checking')
  const [demands, setDemands] = useState<InspirationDemand[]>([])
  const [pagination, setPagination] = useState<{ total: number; hasMore: boolean; nextOffset: number | null }>({
    total: 0,
    hasMore: false,
    nextOffset: null,
  })
  const [listStatus, setListStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const sortedDemands = useMemo(() => demands, [demands])

  useEffect(() => {
    let cancelled = false
    async function checkAdmin() {
      const token = tokenManager.get()
      if (!token) {
        navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true })
        return
      }
      const user = await refreshCurrentUserProfile()
      if (cancelled) return
      setCurrentUser(user)
      setAuthStatus(user?.is_admin ? 'admin' : 'forbidden')
    }
    void checkAdmin()
    return () => {
      cancelled = true
    }
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    if (authStatus !== 'admin') return
    let cancelled = false
    const controller = new AbortController()
    setListStatus('loading')
    inspirationApi.listAdminDemands({
      includePrivate: true,
      limit: ADMIN_DEMAND_LIMIT,
      offset: 0,
    }, { signal: controller.signal })
      .then((response) => {
        if (cancelled) return
        setDemands(response.data.list)
        setPagination({
          total: response.data.total,
          hasMore: response.data.has_more,
          nextOffset: response.data.next_offset ?? null,
        })
        setListStatus('idle')
      })
      .catch(() => {
        if (cancelled) return
        setListStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [authStatus])

  function loadMore() {
    if (!pagination.hasMore || pagination.nextOffset == null || listStatus === 'loading') return
    setListStatus('loading')
    inspirationApi.listAdminDemands({
      includePrivate: true,
      limit: ADMIN_DEMAND_LIMIT,
      offset: pagination.nextOffset,
    })
      .then((response) => {
        setDemands((current) => [...current, ...response.data.list])
        setPagination({
          total: response.data.total,
          hasMore: response.data.has_more,
          nextOffset: response.data.next_offset ?? null,
        })
        setListStatus('idle')
      })
      .catch(() => setListStatus('error'))
  }

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-[#f6f9f8] px-5 py-20 text-slate-950">
        <div className="mx-auto max-w-5xl text-sm text-slate-500">正在校验管理员权限...</div>
      </div>
    )
  }

  if (authStatus === 'forbidden') {
    return (
      <div className="min-h-screen bg-[#f6f9f8] px-5 py-20 text-slate-950">
        <div className="mx-auto max-w-3xl rounded-[var(--radius-md)] border border-slate-200 bg-white p-8">
          <p className="text-sm font-semibold text-red-600">没有权限查看这个入口</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">灵感共创队线索入口</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            当前账号{currentUser?.username ? `（${currentUser.username}）` : ''}不是管理员，不能查看未公开线索和完整表单信息。
          </p>
          <Link to="/inspiration-co-creation" className="mt-6 inline-flex text-sm font-semibold text-teal-700">
            返回灵感共创队
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f6f9f8] px-5 py-14 text-slate-950 sm:px-8 lg:py-20">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-semibold text-teal-700">管理员入口</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">灵感共创队线索入口</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              查看公开与不公开的共创线索，以及提交表单中的完整问题、联系人和当前卡点。
            </p>
          </div>
          <Link to="/inspiration-co-creation" className="inline-flex text-sm font-semibold text-teal-700">
            返回公开页
          </Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-3xl font-semibold text-slate-950">{pagination.total}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">全部线索</p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-slate-950">{demands.filter((demand) => demand.allow_public !== false && demand.status === 'published').length}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">当前页公开线索</p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-slate-950">{demands.filter((demand) => demand.allow_public === false || demand.status === 'private').length}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">当前页不公开线索</p>
          </div>
        </div>

        {listStatus === 'error' && demands.length === 0 ? (
          <div className="mt-8 rounded-[var(--radius-md)] border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            线索入口加载失败，请稍后再试。
          </div>
        ) : null}

        <div className="mt-8 grid gap-5">
          {sortedDemands.map((demand, index) => (
            <AdminDemandCard key={demand.slug} demand={demand} index={index} />
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          {pagination.hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={listStatus === 'loading'}
              className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {listStatus === 'loading' ? '加载中...' : '加载更多'}
            </button>
          ) : listStatus === 'loading' ? (
            <p className="text-sm text-slate-400">加载中...</p>
          ) : (
            <p className="text-sm text-slate-400">已显示全部 {pagination.total} 条线索。</p>
          )}
        </div>
      </div>
    </div>
  )
}
