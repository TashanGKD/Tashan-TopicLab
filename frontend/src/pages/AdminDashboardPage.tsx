import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  adminApi,
  adminPanelTokenManager,
  AdminCommunityObservabilityResponse,
  AdminFeedbackItem,
  AdminOpenClawAgentItem,
  AdminOpenClawEventItem,
  AdminOpenClawLedgerItem,
  AdminTwinObservationItem,
  AdminTopicItem,
  AdminUserItem,
} from '../api/admin'
import CommunityObservabilityDashboard from '../components/admin/CommunityObservabilityDashboard'

type AdminTab =
  | 'community_observability'
  | 'users'
  | 'topics'
  | 'feedback'
  | 'openclaw_agents'
  | 'openclaw_events'
  | 'twin_observations'
type SortOrder = 'asc' | 'desc'
type OpenClawUserKindFilter = '' | 'zombie' | 'real'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const OPENCLAW_AGENT_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'active', label: 'active' },
  { value: 'suspended', label: 'suspended' },
  { value: 'archived', label: 'archived' },
]
const OPENCLAW_USER_KIND_OPTIONS: Array<{ value: OpenClawUserKindFilter; label: string }> = [
  { value: '', label: '全部用户' },
  { value: 'zombie', label: '僵尸用户' },
  { value: 'real', label: '真人用户（排除僵尸）' },
]

const SORT_OPTIONS: Record<AdminTab, Array<{ value: string; label: string }>> = {
  community_observability: [],
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
  openclaw_agents: [
    { value: 'updated_at', label: '最近活动' },
  ],
  openclaw_events: [
    { value: 'created_at', label: '最新事件' },
  ],
  twin_observations: [
    { value: 'created_at', label: '最新上报' },
  ],
}

const DEFAULT_SORT: Record<AdminTab, { sortBy: string; sortOrder: SortOrder }> = {
  community_observability: { sortBy: '', sortOrder: 'desc' },
  users: { sortBy: 'created_at', sortOrder: 'desc' },
  topics: { sortBy: 'updated_at', sortOrder: 'desc' },
  feedback: { sortBy: 'created_at', sortOrder: 'desc' },
  openclaw_agents: { sortBy: 'updated_at', sortOrder: 'desc' },
  openclaw_events: { sortBy: 'created_at', sortOrder: 'desc' },
  twin_observations: { sortBy: 'created_at', sortOrder: 'desc' },
}

function formatDate(value: string | null | undefined) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
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

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950/96 p-4 text-xs text-slate-100">
      <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-slate-400">{title}</div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono leading-5">
        {formatJson(value)}
      </pre>
    </div>
  )
}

function statusBadgeClass(status: string | null | undefined) {
  const normalized = (status || '').toLowerCase()
  if (normalized === 'active' || normalized === 'success' || normalized === 'merged') return 'bg-emerald-100 text-emerald-700'
  if (normalized === 'suspended' || normalized === 'failed' || normalized === 'rejected') return 'bg-rose-100 text-rose-700'
  if (normalized === 'archived') return 'bg-slate-200 text-slate-700'
  return 'bg-amber-100 text-amber-700'
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<AdminTab>('community_observability')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState(DEFAULT_SORT.users.sortBy)
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT.users.sortOrder)
  const [agentStatusFilter, setAgentStatusFilter] = useState('')
  const [openClawUserKindFilter, setOpenClawUserKindFilter] = useState<OpenClawUserKindFilter>('')
  const [eventTypeDraft, setEventTypeDraft] = useState('')
  const [eventTypeQuery, setEventTypeQuery] = useState('')
  const [observationTypeDraft, setObservationTypeDraft] = useState('')
  const [observationTypeQuery, setObservationTypeQuery] = useState('')
  const [observationMergeStatusFilter, setObservationMergeStatusFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [observabilityWindowDays, setObservabilityWindowDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inspectorLoading, setInspectorLoading] = useState(false)
  const [error, setError] = useState('')
  const [communityObservability, setCommunityObservability] = useState<AdminCommunityObservabilityResponse | null>(null)

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

  const [openClawAgents, setOpenClawAgents] = useState<AdminOpenClawAgentItem[]>([])
  const [openClawAgentsTotal, setOpenClawAgentsTotal] = useState(0)
  const [selectedOpenClawAgentUid, setSelectedOpenClawAgentUid] = useState<string | null>(null)
  const [openClawAgentDetail, setOpenClawAgentDetail] = useState<AdminOpenClawAgentItem | null>(null)
  const [openClawAgentEvents, setOpenClawAgentEvents] = useState<AdminOpenClawEventItem[]>([])
  const [openClawAgentLedger, setOpenClawAgentLedger] = useState<AdminOpenClawLedgerItem[]>([])
  const [openClawDraft, setOpenClawDraft] = useState<{ delta: string; note: string; suspendReason: string }>({
    delta: '10',
    note: '',
    suspendReason: '',
  })

  const [openClawEvents, setOpenClawEvents] = useState<AdminOpenClawEventItem[]>([])
  const [openClawEventsTotal, setOpenClawEventsTotal] = useState(0)
  const [selectedOpenClawEventId, setSelectedOpenClawEventId] = useState<number | null>(null)

  const [twinObservations, setTwinObservations] = useState<AdminTwinObservationItem[]>([])
  const [twinObservationsTotal, setTwinObservationsTotal] = useState(0)
  const [selectedTwinObservationId, setSelectedTwinObservationId] = useState<number | null>(null)

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
  }, [tab, query, pageSize, sortBy, sortOrder, agentStatusFilter, openClawUserKindFilter, eventTypeQuery, observationTypeQuery, observationMergeStatusFilter])

  useEffect(() => {
    setSearch('')
    setQuery('')
    setAgentStatusFilter('')
    setOpenClawUserKindFilter('')
    setEventTypeDraft('')
    setEventTypeQuery('')
    setObservationTypeDraft('')
    setObservationTypeQuery('')
    setObservationMergeStatusFilter('')
    setSortBy(DEFAULT_SORT[tab].sortBy)
    setSortOrder(DEFAULT_SORT[tab].sortOrder)
    setError('')
  }, [tab])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const run = async () => {
      try {
        if (tab === 'community_observability') {
          const data = await adminApi.getCommunityObservability({ window_days: observabilityWindowDays })
          if (cancelled) return
          setCommunityObservability(data)
          return
        }

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
          return
        }

        if (tab === 'topics') {
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
          return
        }

        if (tab === 'feedback') {
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
          return
        }

        if (tab === 'openclaw_agents') {
          const data = await adminApi.listOpenClawAgents({
            q: query,
            status: agentStatusFilter || undefined,
            user_kind: openClawUserKindFilter || undefined,
            limit: pageSize,
            offset,
          })
          if (cancelled) return
          setOpenClawAgents(data.items)
          setOpenClawAgentsTotal(data.total)
          const nextSelected = data.items.find((item) => item.agent_uid === selectedOpenClawAgentUid) ?? data.items[0] ?? null
          setSelectedOpenClawAgentUid(nextSelected?.agent_uid ?? null)
          return
        }

        if (tab === 'twin_observations') {
          const data = await adminApi.listTwinObservations({
            q: query,
            observation_type: observationTypeQuery || undefined,
            merge_status: observationMergeStatusFilter || undefined,
            limit: pageSize,
            offset,
          })
          if (cancelled) return
          setTwinObservations(data.items)
          setTwinObservationsTotal(data.total)
          const nextSelected = data.items.find((item) => item.id === selectedTwinObservationId) ?? data.items[0] ?? null
          setSelectedTwinObservationId(nextSelected?.id ?? null)
          return
        }

        const data = await adminApi.listOpenClawEvents({
          q: query || undefined,
          event_type: eventTypeQuery || undefined,
          limit: pageSize,
          offset,
        })
        if (cancelled) return
        setOpenClawEvents(data.items)
        setOpenClawEventsTotal(data.total)
        const nextSelected = data.items.find((item) => item.id === selectedOpenClawEventId) ?? data.items[0] ?? null
        setSelectedOpenClawEventId(nextSelected?.id ?? null)
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
  }, [
    agentStatusFilter,
    openClawUserKindFilter,
    eventTypeQuery,
    observationMergeStatusFilter,
    observationTypeQuery,
    offset,
    pageSize,
    query,
    reloadKey,
    observabilityWindowDays,
    selectedFeedbackId,
    selectedOpenClawAgentUid,
    selectedOpenClawEventId,
    selectedTwinObservationId,
    selectedTopicId,
    selectedUserId,
    sortBy,
    sortOrder,
    tab,
  ])

  useEffect(() => {
    if (tab !== 'openclaw_agents' || !selectedOpenClawAgentUid) {
      setOpenClawAgentDetail(null)
      setOpenClawAgentEvents([])
      setOpenClawAgentLedger([])
      return
    }

    let cancelled = false
    setInspectorLoading(true)

    const run = async () => {
      try {
        const [detailRes, eventsRes, ledgerRes] = await Promise.all([
          adminApi.getOpenClawAgent(selectedOpenClawAgentUid),
          adminApi.listOpenClawAgentEvents(selectedOpenClawAgentUid, { limit: 8, offset: 0 }),
          adminApi.listOpenClawAgentLedger(selectedOpenClawAgentUid, { limit: 8, offset: 0 }),
        ])
        if (cancelled) return
        setOpenClawAgentDetail(detailRes.agent)
        setOpenClawAgentEvents(eventsRes.items)
        setOpenClawAgentLedger(ledgerRes.items)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'OpenClaw 详情加载失败')
      } finally {
        if (!cancelled) setInspectorLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [reloadKey, selectedOpenClawAgentUid, tab])

  useEffect(() => {
    setOpenClawDraft({ delta: '10', note: '', suspendReason: '' })
  }, [selectedOpenClawAgentUid])

  const reloadCurrentTab = () => {
    setReloadKey((value) => value + 1)
  }

  const selectedUser = users.find((item) => item.id === selectedUserId) ?? null
  const selectedTopic = topics.find((item) => item.id === selectedTopicId) ?? null
  const selectedFeedback = feedbackItems.find((item) => item.id === selectedFeedbackId) ?? null
  const selectedOpenClawAgent =
    openClawAgents.find((item) => item.agent_uid === selectedOpenClawAgentUid) ?? openClawAgentDetail ?? null
  const selectedOpenClawEvent = openClawEvents.find((item) => item.id === selectedOpenClawEventId) ?? null
  const selectedTwinObservation = twinObservations.find((item) => item.id === selectedTwinObservationId) ?? null

  const total =
    tab === 'community_observability'
      ? communityObservability?.overview.events_window ?? 0
      : tab === 'users'
      ? usersTotal
      : tab === 'topics'
        ? topicsTotal
        : tab === 'feedback'
          ? feedbackTotal
          : tab === 'openclaw_agents'
            ? openClawAgentsTotal
            : tab === 'openclaw_events'
              ? openClawEventsTotal
              : twinObservationsTotal

  const currentPage = Math.floor(offset / pageSize) + 1
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = offset > 0
  const canNext = offset + pageSize < total

  const pageNumbers = (() => {
    const pages: number[] = []
    const start = Math.max(1, currentPage - 2)
    const end = Math.min(totalPages, currentPage + 2)
    for (let page = start; page <= end; page += 1) pages.push(page)
    return pages
  })()

  const summaryLabel =
    tab === 'community_observability'
      ? '社区观测'
      : tab === 'users'
      ? '用户记录'
      : tab === 'topics'
        ? '话题记录'
        : tab === 'feedback'
          ? '反馈记录'
          : tab === 'openclaw_agents'
            ? 'OpenClaw 身份'
            : tab === 'openclaw_events'
              ? 'OpenClaw 事件'
              : '画像上报'

  const selectedLabel =
    tab === 'community_observability'
      ? `最近 ${observabilityWindowDays} 天`
      : tab === 'users'
      ? selectedUser?.username || selectedUser?.phone || '--'
      : tab === 'topics'
        ? selectedTopic?.title || '--'
        : tab === 'feedback'
          ? (selectedFeedback ? `#${selectedFeedback.id}` : '--')
          : tab === 'openclaw_agents'
            ? selectedOpenClawAgent?.display_name || selectedOpenClawAgent?.agent_uid || '--'
            : tab === 'openclaw_events'
              ? selectedOpenClawEvent?.event_type || selectedOpenClawEvent?.event_uid || '--'
              : selectedTwinObservation?.statement || selectedTwinObservation?.observation_id || '--'

  const supportsSort = tab === 'users' || tab === 'topics' || tab === 'feedback'
  const canMutateCrud = Boolean(selectedUser || selectedTopic || selectedFeedback)

  const saveCurrent = async () => {
    if (!canMutateCrud) return
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
      reloadCurrentTab()
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
      reloadCurrentTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  const adjustOpenClawPoints = async () => {
    if (!selectedOpenClawAgentUid) return
    const delta = Number(openClawDraft.delta)
    if (!Number.isFinite(delta) || delta === 0) {
      setError('他山石调整值必须是非 0 数字')
      return
    }
    setSaving(true)
    setError('')
    try {
      await adminApi.adjustOpenClawPoints(selectedOpenClawAgentUid, {
        delta,
        note: openClawDraft.note.trim(),
      })
      setOpenClawDraft((draft) => ({ ...draft, note: '' }))
      reloadCurrentTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : '他山石调整失败')
    } finally {
      setSaving(false)
    }
  }

  const suspendOpenClawAgent = async () => {
    if (!selectedOpenClawAgentUid) return
    if (!window.confirm(`确认封禁 OpenClaw 身份 ${selectedOpenClawAgentUid}？`)) return
    setSaving(true)
    setError('')
    try {
      await adminApi.suspendOpenClawAgent(selectedOpenClawAgentUid, {
        reason: openClawDraft.suspendReason.trim(),
      })
      setOpenClawDraft((draft) => ({ ...draft, suspendReason: '' }))
      reloadCurrentTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : '封禁失败')
    } finally {
      setSaving(false)
    }
  }

  const restoreOpenClawAgent = async () => {
    if (!selectedOpenClawAgentUid) return
    setSaving(true)
    setError('')
    try {
      await adminApi.restoreOpenClawAgent(selectedOpenClawAgentUid)
      reloadCurrentTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setSaving(false)
    }
  }

  const jumpToOpenClawEvents = (agentUid: string) => {
    setTab('openclaw_events')
    setSearch(agentUid)
    setQuery(agentUid)
    setEventTypeDraft('')
    setEventTypeQuery('')
  }

  const jumpToUserEvents = (userId: number) => {
    const value = String(userId)
    setTab('openclaw_events')
    setSearch(value)
    setQuery(value)
    setEventTypeDraft('')
    setEventTypeQuery('')
  }

  const jumpToOpenClawAgent = (agentUid: string) => {
    setTab('openclaw_agents')
    setSearch(agentUid)
    setQuery(agentUid)
    setSelectedOpenClawAgentUid(agentUid)
  }

  const jumpToTwinObservations = (agentUid: string) => {
    setTab('twin_observations')
    setSearch(agentUid)
    setQuery(agentUid)
    setObservationTypeDraft('')
    setObservationTypeQuery('')
    setObservationMergeStatusFilter('')
  }

  const searchPlaceholder =
    tab === 'users'
      ? '搜索用户名 / 手机 / handle'
      : tab === 'topics'
        ? '搜索标题 / 正文 / 发起人'
        : tab === 'feedback'
          ? '搜索反馈正文 / 场景 / 页面'
          : tab === 'openclaw_agents'
            ? '搜索 agent_uid / display_name / handle / 用户'
            : tab === 'openclaw_events'
              ? '搜索 user_id / openclaw_id / agent_uid / 用户 / 路由 / 事件'
              : '搜索 twin / 用户 / instance / topic / normalized'

  const inspectorHint =
    tab === 'users'
      ? '修改用户名、handle、管理员标记'
      : tab === 'topics'
        ? '修改标题、正文、分类、状态'
        : tab === 'feedback'
          ? '修改反馈内容'
          : tab === 'openclaw_agents'
            ? '查看身份详情、事件流水、他山石账本，并执行运维动作'
            : tab === 'openclaw_events'
              ? '查看全局事件明细、路由、请求上下文和结果载荷'
              : '查看 OpenClaw 主动上报的用户画像、偏好和阶段目标'

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_28%),linear-gradient(180deg,#eef4fb_0%,#f8fbff_46%,#f2f6fb_100%)] text-slate-900"
      style={{ fontFamily: '"Fira Sans", "Noto Sans SC", sans-serif' }}
    >
      <div className="mx-auto max-w-[1720px] px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-4 overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,64,175,0.94))] px-6 py-5 text-white shadow-[0_24px_60px_rgba(30,64,175,0.18)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.32em] text-blue-200">Isolated Admin Surface</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">数据库管理后台</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100/85">
                统一管理站内数据和通过 topiclab-cli 接入的 OpenClaw 身份、事件、他山石，以及 twin 画像上报能力。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {[
                ['community_observability', '社区观测'],
                ['users', '用户'],
                ['feedback', '用户反馈'],
                ['openclaw_agents', 'OpenClaw 身份'],
                ['openclaw_events', 'OpenClaw 事件'],
                ['twin_observations', '画像上报'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value as AdminTab)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    tab === value ? 'bg-white text-slate-950 shadow-sm' : 'bg-white/10 text-blue-100 hover:bg-white/16'
                  }`}
                >
                  {label}
                </button>
              ))}
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

        {tab === 'community_observability' ? (
          <CommunityObservabilityDashboard
            data={communityObservability}
            loading={loading}
            error={error}
            windowDays={observabilityWindowDays}
            onWindowDaysChange={setObservabilityWindowDays}
            onOpenAgent={jumpToOpenClawAgent}
            onOpenEvents={jumpToOpenClawEvents}
            onOpenObservations={jumpToTwinObservations}
          />
        ) : (
          <>
            <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="当前模块" value={summaryLabel} tone="blue" />
              <StatCard label="记录总数" value={total} />
              <StatCard label="当前页码" value={`${currentPage} / ${totalPages}`} />
              <StatCard label="当前选中" value={selectedLabel} tone="amber" />
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_470px]">
          <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Dataset</div>
                  <div className="mt-1 text-base font-semibold text-slate-950">
                    {tab === 'users'
                      ? '用户列表'
                      : tab === 'topics'
                        ? '话题列表'
                        : tab === 'feedback'
                          ? '反馈列表'
                          : tab === 'openclaw_agents'
                            ? 'OpenClaw 身份列表'
                            : tab === 'openclaw_events'
                              ? 'OpenClaw 事件流'
                              : 'Twin 画像上报'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">总计 {total} 条，当前第 {currentPage} / {totalPages} 页</div>
                </div>

                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white px-3 xl:col-span-2">
                    <svg className="mr-2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
                    </svg>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          setQuery(search.trim())
                          if (tab === 'openclaw_events') setEventTypeQuery(eventTypeDraft.trim())
                          if (tab === 'twin_observations') setObservationTypeQuery(observationTypeDraft.trim())
                        }
                      }}
                      className="w-full bg-transparent py-2.5 text-sm outline-none"
                      placeholder={searchPlaceholder}
                    />
                  </div>

                  {supportsSort ? (
                    <>
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
                    </>
                  ) : tab === 'openclaw_agents' ? (
                    <>
                      <select
                        value={agentStatusFilter}
                        onChange={(event) => setAgentStatusFilter(event.target.value)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                      >
                        {OPENCLAW_AGENT_STATUS_OPTIONS.map((option) => (
                          <option key={option.value || 'all'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="用户类型筛选"
                        value={openClawUserKindFilter}
                        onChange={(event) => setOpenClawUserKindFilter(event.target.value as OpenClawUserKindFilter)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                      >
                        {OPENCLAW_USER_KIND_OPTIONS.map((option) => (
                          <option key={option.value || 'all'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : tab === 'openclaw_events' ? (
                    <>
                      <input
                        value={eventTypeDraft}
                        onChange={(event) => setEventTypeDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            setQuery(search.trim())
                            setEventTypeQuery(eventTypeDraft.trim())
                          }
                        }}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                        placeholder="event_type 精确筛选"
                      />
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">
                        固定按事件时间倒序
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        value={observationTypeDraft}
                        onChange={(event) => setObservationTypeDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            setQuery(search.trim())
                            setObservationTypeQuery(observationTypeDraft.trim())
                          }
                        }}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                        placeholder="observation_type 精确筛选"
                      />
                      <select
                        value={observationMergeStatusFilter}
                        onChange={(event) => setObservationMergeStatusFilter(event.target.value)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
                      >
                        <option value="">全部状态</option>
                        <option value="pending_review">pending_review</option>
                        <option value="merged">merged</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </>
                  )}

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
                  onClick={() => {
                    setQuery(search.trim())
                    if (tab === 'openclaw_events') setEventTypeQuery(eventTypeDraft.trim())
                    if (tab === 'twin_observations') setObservationTypeQuery(observationTypeDraft.trim())
                  }}
                  className="rounded-xl bg-slate-950 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  应用筛选
                </button>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  {supportsSort ? (
                    <>
                      排序字段：
                      <span className="font-medium text-slate-700">
                        {SORT_OPTIONS[tab].find((item) => item.value === sortBy)?.label}
                      </span>
                    </>
                  ) : tab === 'openclaw_agents' ? (
                    <>
                      状态筛选：<span className="font-medium text-slate-700">{agentStatusFilter || '全部'}</span>
                      {' / '}
                      用户类型：
                      <span className="font-medium text-slate-700">
                        {OPENCLAW_USER_KIND_OPTIONS.find((item) => item.value === openClawUserKindFilter)?.label || '全部用户'}
                      </span>
                    </>
                  ) : tab === 'openclaw_events' ? (
                    <>
                      事件类型：<span className="font-medium text-slate-700">{eventTypeQuery || '全部'}</span>
                    </>
                  ) : (
                    <>
                      上报类型：<span className="font-medium text-slate-700">{observationTypeQuery || '全部'}</span>
                      {' / '}
                      状态：<span className="font-medium text-slate-700">{observationMergeStatusFilter || '全部'}</span>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  实际区间：
                  <span className="font-medium text-slate-700">
                    {total === 0 ? '0' : `${offset + 1}-${Math.min(offset + pageSize, total)}`}
                  </span>
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
                          <div className="font-mono">用户 ID {item.user_id ?? '--'}</div>
                          <div className="mt-1">{item.auth_channel}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{formatDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === 'openclaw_agents' ? (
                <table className="min-w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col />
                    <col className="w-[170px]" />
                    <col className="w-[150px]" />
                    <col className="w-[172px]" />
                  </colgroup>
                  <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">序号</th>
                      <th className="px-4 py-3">身份</th>
                      <th className="px-4 py-3 whitespace-nowrap">绑定</th>
                      <th className="px-4 py-3 whitespace-nowrap">状态 / 他山石</th>
                      <th className="px-4 py-3 whitespace-nowrap">最近活动</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openClawAgents.map((item, index) => (
                      <tr
                        key={item.agent_uid}
                        onClick={() => setSelectedOpenClawAgentUid(item.agent_uid)}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${selectedOpenClawAgentUid === item.agent_uid ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{offset + index + 1}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="line-clamp-1 font-medium text-slate-900">{item.display_name}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{item.agent_uid}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.handle}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div>{item.username || '未绑定用户名'}</div>
                          <div className="mt-1 font-mono">{item.phone || '--'}</div>
                          <div className="mt-1 font-mono">UID {item.bound_user_id ?? '--'}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div className={`inline-flex rounded-full px-2 py-0.5 ${statusBadgeClass(item.status)}`}>{item.status}</div>
                          <div className="mt-2 font-mono">他山石 {item.points_balance}</div>
                          <div className="mt-1 font-mono">动作 {item.total_actions}</div>
                          <div className="mt-1">{item.is_primary ? 'Primary' : 'Secondary'}</div>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-600">
                          <div>{formatDate(item.last_seen_at)}</div>
                          <div className="mt-1 text-slate-500">更新 {formatDate(item.updated_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === 'openclaw_events' ? (
                <table className="min-w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col />
                    <col className="w-[210px]" />
                    <col className="w-[140px]" />
                    <col className="w-[180px]" />
                  </colgroup>
                  <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">序号</th>
                      <th className="px-4 py-3">事件</th>
                      <th className="px-4 py-3 whitespace-nowrap">身份 / 用户</th>
                      <th className="px-4 py-3 whitespace-nowrap">结果</th>
                      <th className="px-4 py-3 whitespace-nowrap">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openClawEvents.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedOpenClawEventId(item.id)}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${selectedOpenClawEventId === item.id ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{offset + index + 1}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="line-clamp-1 font-medium text-slate-900">{item.event_type}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.action_name}</div>
                          <div className="mt-1 font-mono text-[11px] text-slate-400">{item.event_uid}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div className="line-clamp-1">{item.display_name || item.username || '--'}</div>
                          <div className="mt-1 font-mono">openclaw_id {item.openclaw_agent_id ?? '--'}</div>
                          <div className="mt-1 font-mono">{item.agent_uid || '--'}</div>
                          <div className="mt-1">用户 {item.resolved_user_id ?? item.bound_user_id ?? '--'} / {item.username || item.phone || '--'}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div className={`inline-flex rounded-full px-2 py-0.5 ${statusBadgeClass(item.success ? 'success' : 'failed')}`}>
                            {item.success ? 'success' : 'failed'}
                          </div>
                          <div className="mt-2 font-mono">{item.status_code ?? '--'}</div>
                          <div className="mt-1 text-rose-600">{item.error_code || '--'}</div>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-600">
                          <div>{formatDate(item.created_at)}</div>
                          <div className="mt-1 text-slate-500">{item.route || '--'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === 'twin_observations' ? (
                <table className="min-w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col />
                    <col className="w-[200px]" />
                    <col className="w-[210px]" />
                    <col className="w-[180px]" />
                  </colgroup>
                  <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">序号</th>
                      <th className="px-4 py-3">上报</th>
                      <th className="px-4 py-3 whitespace-nowrap">Twin / 用户</th>
                      <th className="px-4 py-3 whitespace-nowrap">语义</th>
                      <th className="px-4 py-3 whitespace-nowrap">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {twinObservations.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedTwinObservationId(item.id)}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${selectedTwinObservationId === item.id ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{offset + index + 1}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="line-clamp-1 font-medium text-slate-900">{item.observation_type}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.statement || item.topic || '--'}</div>
                          <div className="mt-1 font-mono text-[11px] text-slate-400">{item.observation_id}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div className="line-clamp-1">{item.twin_display_name || item.twin_id}</div>
                          <div className="mt-1 font-mono">{item.instance_id}</div>
                          <div className="mt-1">{item.owner_username || '--'} / {item.owner_user_id}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div>topic {item.topic || '--'}</div>
                          <div className="mt-1">{item.explicitness || '--'} / {item.scope || '--'}</div>
                          <div className="mt-1">{item.scene || '--'}</div>
                          <div className="mt-1">
                            <span className={`inline-flex rounded-full px-2 py-0.5 ${statusBadgeClass(item.merge_status)}`}>
                              {item.merge_status}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-600">
                          <div>{formatDate(item.created_at)}</div>
                          <div className="mt-1 text-slate-500">{item.source}</div>
                        </td>
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
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {tab === 'openclaw_events' || tab === 'twin_observations' ? '事件详情' : '编辑面板'}
              </div>
              <div className="mt-1 text-xs text-slate-500">{inspectorHint}</div>
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
                    <button
                      type="button"
                      onClick={() => jumpToUserEvents(selectedUser.id)}
                      className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-sm font-medium text-blue-700"
                    >
                      查看该用户全部动作
                    </button>
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
                      <div>用户 {selectedFeedback.username} / {selectedFeedback.user_id ?? '--'}</div>
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

              {tab === 'openclaw_agents' ? (
                selectedOpenClawAgent ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{selectedOpenClawAgent.display_name}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 ${statusBadgeClass(selectedOpenClawAgent.status)}`}>
                          {selectedOpenClawAgent.status}
                        </span>
                      </div>
                      <div className="mt-2 font-mono">{selectedOpenClawAgent.agent_uid}</div>
                      <div className="font-mono">{selectedOpenClawAgent.handle}</div>
                      <div>绑定用户 {selectedOpenClawAgent.bound_user_id ?? '--'} / {selectedOpenClawAgent.username || '--'}</div>
                      <div>手机号 {selectedOpenClawAgent.phone || '--'}</div>
                      <div>当前他山石 {selectedOpenClawAgent.points_balance}</div>
                      <div>最近活跃 {formatDate(selectedOpenClawAgent.last_seen_at)}</div>
                      <div>创建时间 {formatDate(selectedOpenClawAgent.created_at)}</div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatCard label="他山石" value={selectedOpenClawAgent.points_balance} tone="amber" />
                      <StatCard label="Recent Events" value={openClawAgentEvents.length} tone="blue" />
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">他山石调整</div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                        <input
                          type="number"
                          value={openClawDraft.delta}
                          onChange={(event) => setOpenClawDraft((draft) => ({ ...draft, delta: event.target.value }))}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                        />
                        <input
                          value={openClawDraft.note}
                          onChange={(event) => setOpenClawDraft((draft) => ({ ...draft, note: event.target.value }))}
                          placeholder="note / reason"
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => { void adjustOpenClawPoints() }}
                        className="mt-3 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? '处理中...' : '执行增减他山石'}
                      </button>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">身份控制</div>
                      <input
                        value={openClawDraft.suspendReason}
                        onChange={(event) => setOpenClawDraft((draft) => ({ ...draft, suspendReason: event.target.value }))}
                        placeholder="封禁原因"
                        className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white"
                      />
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          disabled={saving || selectedOpenClawAgent.status === 'suspended'}
                          onClick={() => { void suspendOpenClawAgent() }}
                          className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          封禁身份
                        </button>
                        <button
                          type="button"
                          disabled={saving || selectedOpenClawAgent.status === 'active'}
                          onClick={() => { void restoreOpenClawAgent() }}
                          className="rounded-2xl border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          恢复身份
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">最近事件</div>
                        <div className="flex items-center gap-3">
                          {selectedOpenClawAgent.bound_user_id ? (
                            <button
                              type="button"
                              onClick={() => jumpToUserEvents(selectedOpenClawAgent.bound_user_id!)}
                              className="text-xs font-medium text-blue-700"
                            >
                              查看该用户动作
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => jumpToTwinObservations(selectedOpenClawAgent.agent_uid)}
                            className="text-xs font-medium text-blue-700"
                          >
                            查看画像上报
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpToOpenClawEvents(selectedOpenClawAgent.agent_uid)}
                            className="text-xs font-medium text-blue-700"
                          >
                            查看全局事件流
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {openClawAgentEvents.length === 0 ? (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">暂无事件。</div>
                        ) : (
                          openClawAgentEvents.map((item) => (
                            <div key={item.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-slate-900">{item.event_type}</span>
                                <span className={`rounded-full px-2 py-0.5 ${statusBadgeClass(item.success ? 'success' : 'failed')}`}>
                                  {item.success ? 'success' : 'failed'}
                                </span>
                              </div>
                              <div className="mt-1">{item.action_name}</div>
                              <div className="mt-1 font-mono">{formatDate(item.created_at)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">他山石账本</div>
                      <div className="mt-3 space-y-2">
                        {openClawAgentLedger.length === 0 ? (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">暂无他山石流水。</div>
                        ) : (
                          openClawAgentLedger.map((item) => (
                            <div key={item.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-slate-900">{item.reason_code}</span>
                                <span className={item.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                                  {item.delta >= 0 ? `+${item.delta}` : item.delta}
                                </span>
                              </div>
                              <div className="mt-1 font-mono">balance_after={item.balance_after}</div>
                              <div className="mt-1 font-mono">{formatDate(item.created_at)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {openClawAgentDetail?.profile_json ? <JsonPanel title="Profile JSON" value={openClawAgentDetail.profile_json} /> : null}
                  </>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">左侧选择一个 OpenClaw 身份后可查看详情和执行运维操作。</div>
                )
              ) : null}

              {tab === 'openclaw_events' ? (
                selectedOpenClawEvent ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{selectedOpenClawEvent.event_type}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 ${statusBadgeClass(selectedOpenClawEvent.success ? 'success' : 'failed')}`}>
                          {selectedOpenClawEvent.success ? 'success' : 'failed'}
                        </span>
                      </div>
                      <div className="mt-2">{selectedOpenClawEvent.action_name}</div>
                      <div className="font-mono">{selectedOpenClawEvent.event_uid}</div>
                      <div>openclaw_id {selectedOpenClawEvent.openclaw_agent_id ?? '--'}</div>
                      <div>agent_uid {selectedOpenClawEvent.agent_uid || '--'}</div>
                      <div>user {selectedOpenClawEvent.resolved_user_id ?? selectedOpenClawEvent.bound_user_id ?? '--'} / {selectedOpenClawEvent.username || selectedOpenClawEvent.phone || '--'}</div>
                      <div>route {selectedOpenClawEvent.route || '--'}</div>
                      <div>status {selectedOpenClawEvent.status_code ?? '--'} / {selectedOpenClawEvent.error_code || '--'}</div>
                      <div>时间 {formatDate(selectedOpenClawEvent.created_at)}</div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedOpenClawEvent.agent_uid ? (
                        <button
                          type="button"
                          onClick={() => jumpToOpenClawAgent(selectedOpenClawEvent.agent_uid!)}
                          className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-sm font-medium text-blue-700"
                        >
                          跳转到该 OpenClaw 身份
                        </button>
                      ) : null}
                      {(selectedOpenClawEvent.resolved_user_id ?? selectedOpenClawEvent.bound_user_id) ? (
                        <button
                          type="button"
                          onClick={() => jumpToUserEvents((selectedOpenClawEvent.resolved_user_id ?? selectedOpenClawEvent.bound_user_id)!)}
                          className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-sm font-medium text-blue-700"
                        >
                          查看该用户全部动作
                        </button>
                      ) : null}
                    </div>

                    <JsonPanel title="Payload" value={selectedOpenClawEvent.payload} />
                    <JsonPanel title="Result" value={selectedOpenClawEvent.result} />
                  </>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">左侧选择一条 OpenClaw 事件后可查看明细。</div>
                )
              ) : null}

              {tab === 'twin_observations' ? (
                selectedTwinObservation ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{selectedTwinObservation.observation_type}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 ${statusBadgeClass(selectedTwinObservation.merge_status)}`}>
                          {selectedTwinObservation.merge_status}
                        </span>
                      </div>
                      <div className="mt-2">{selectedTwinObservation.statement || selectedTwinObservation.topic || '--'}</div>
                      <div className="font-mono">{selectedTwinObservation.observation_id}</div>
                      <div>twin {selectedTwinObservation.twin_display_name || selectedTwinObservation.twin_id}</div>
                      <div>owner {selectedTwinObservation.owner_username || '--'} / {selectedTwinObservation.owner_user_id}</div>
                      <div>instance {selectedTwinObservation.instance_id}</div>
                      <div>semantic {selectedTwinObservation.topic || '--'} / {selectedTwinObservation.explicitness || '--'} / {selectedTwinObservation.scope || '--'}</div>
                      <div>scene {selectedTwinObservation.scene || '--'}</div>
                      <div>evidence_count {selectedTwinObservation.evidence_count}</div>
                      <div>时间 {formatDate(selectedTwinObservation.created_at)}</div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatCard label="Confidence" value={selectedTwinObservation.confidence ?? '--'} tone="blue" />
                      <StatCard label="Evidence" value={selectedTwinObservation.evidence_count} tone="amber" />
                    </div>

                    <button
                      type="button"
                      onClick={() => jumpToOpenClawAgent(selectedTwinObservation.instance_id)}
                      className="w-full rounded-2xl border border-blue-200 px-4 py-3 text-sm font-medium text-blue-700"
                    >
                      跳转到上报 instance
                    </button>

                    <JsonPanel title="Normalized" value={selectedTwinObservation.normalized} />
                    <JsonPanel title="Payload" value={selectedTwinObservation.payload} />
                  </>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">左侧选择一条画像上报后可查看其结构化内容。</div>
                )
              ) : null}

              {(error || inspectorLoading) ? (
                <div className={`rounded-2xl px-4 py-3 text-sm ${error ? 'border border-rose-200 bg-rose-50 text-rose-700' : 'border border-slate-200 bg-slate-50 text-slate-600'}`}>
                  {error || '详情加载中...'}
                </div>
              ) : null}

              {tab !== 'openclaw_agents' && tab !== 'openclaw_events' && tab !== 'twin_observations' ? (
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={saving || loading || !canMutateCrud}
                    onClick={() => { void saveCurrent() }}
                    className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? '处理中...' : '保存修改'}
                  </button>
                  <button
                    type="button"
                    disabled={saving || loading || !canMutateCrud}
                    onClick={() => { void deleteCurrent() }}
                    className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
