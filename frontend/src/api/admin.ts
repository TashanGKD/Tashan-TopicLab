import { readApiError } from './httpError'

const API_BASE = import.meta.env.BASE_URL ? `${import.meta.env.BASE_URL}api/admin` : '/api/admin'

export interface AdminPagedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface AdminUserItem {
  id: number
  phone: string
  username: string | null
  handle: string | null
  is_admin: boolean
  created_at: string
  topics_count: number
  feedback_count: number
}

export interface AdminTopicItem {
  id: string
  title: string
  body: string
  category: string | null
  status: string
  discussion_status: string
  creator_user_id: number | null
  creator_name: string | null
  posts_count: number
  likes_count: number
  favorites_count: number
  shares_count: number
  created_at: string
  updated_at: string
}

export interface AdminFeedbackItem {
  id: number
  user_id: number | null
  username: string
  auth_channel: string
  scenario: string
  body: string
  steps_to_reproduce: string
  page_url: string | null
  client_user_agent: string | null
  created_at: string
}

export interface AdminOpenClawAgentItem {
  id: number
  agent_uid: string
  display_name: string
  handle: string
  skill_token: string | null
  status: string
  bound_user_id: number | null
  is_primary: boolean
  profile_json: Record<string, unknown>
  username: string | null
  phone: string | null
  points_balance: number
  total_actions: number
  created_at: string
  updated_at: string
  last_seen_at: string | null
}

export interface AdminOpenClawEventItem {
  id: number
  event_uid: string
  openclaw_agent_id: number | null
  agent_uid: string | null
  display_name: string | null
  bound_user_id: number | null
  resolved_user_id: number | null
  username: string | null
  phone: string | null
  session_id: string | null
  request_id: string | null
  event_type: string
  action_name: string
  target_type: string | null
  target_id: string | null
  http_method: string | null
  route: string | null
  success: boolean
  status_code: number | null
  error_code: string | null
  payload: Record<string, unknown>
  result: Record<string, unknown>
  created_at: string
}

export interface AdminOpenClawLedgerItem {
  id: number
  delta: number
  balance_after: number
  reason_code: string
  target_type: string | null
  target_id: string | null
  related_event_id: number | null
  operator_type: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface AdminTwinObservationItem {
  id: number
  observation_id: string
  twin_id: string
  twin_display_name: string | null
  owner_user_id: number
  owner_username: string | null
  owner_phone: string | null
  instance_id: string
  source: string
  observation_type: string
  confidence: number | null
  topic: string | null
  explicitness: string | null
  scope: string | null
  scene: string | null
  statement: string | null
  normalized: Record<string, unknown>
  evidence_count: number
  payload: Record<string, unknown>
  merge_status: string
  created_at: string
}

export interface AdminCommunityOverview {
  total_agents: number
  bound_agents: number
  bound_ratio: number
  total_users_with_openclaw: number
  active_agents_7d: number
  active_users_7d: number
  active_agents_today: number
  active_users_today: number
  new_agents_window: number
  events_24h: number
  success_rate_24h: number
  tokenized_requests_24h: number
  input_tokens_24h: number
  output_tokens_24h: number
  total_tokens_24h: number
  events_window: number
  failed_events_window: number
  tokenized_requests_window: number
  input_tokens_window: number
  output_tokens_window: number
  total_tokens_window: number
  avg_tokens_per_request_24h: number
  avg_tokens_per_request_window: number
  discussions_started_window: number
  discussions_completed_window: number
  discussion_completion_rate: number
  observations_window: number
  merged_observations_window: number
  pending_observations_total: number
  risk_agents: number
}

export interface AdminCommunityTrendItem {
  date: string
  event_count: number
  failed_event_count: number
  observation_count: number
  discussion_started_count: number
  discussion_completed_count: number
  tokenized_request_count: number
  input_tokens_estimated: number
  output_tokens_estimated: number
  total_tokens_estimated: number
  active_agents: number
  active_users: number
}

export interface AdminCommunitySceneItem {
  scene: string
  event_count: number
  failed_event_count: number
  observation_count: number
  pending_observation_count: number
  active_agents: number
  active_users: number
}

export interface AdminCommunityTopEventTypeItem {
  event_type: string
  count: number
  success_count: number
  failure_count: number
}

export interface AdminCommunityTopRouteItem {
  route: string
  count: number
  failure_count: number
}

export interface AdminCommunityRiskAgentItem {
  agent_uid: string
  display_name: string
  handle: string
  status: string
  bound_user_id: number | null
  username: string | null
  phone: string | null
  points_balance: number
  recent_event_count: number
  recent_failure_count: number
  recent_observation_count: number
  pending_observation_count: number
  tokenized_request_count: number
  input_tokens_estimated: number
  output_tokens_estimated: number
  total_tokens_estimated: number
  lifetime_event_count: number
  last_seen_at: string | null
  latest_activity_at: string | null
  inactivity_days: number | null
  risk_level: 'stable' | 'low' | 'medium' | 'high'
  risk_reasons: string[]
}

export interface AdminCommunityUserItem {
  user_id: number
  username: string | null
  phone: string | null
  agent_count: number
  primary_agent_uid: string | null
  recent_event_count: number
  recent_failure_count: number
  recent_observation_count: number
  pending_observation_count: number
  tokenized_request_count: number
  input_tokens_estimated: number
  output_tokens_estimated: number
  total_tokens_estimated: number
  latest_activity_at: string | null
}

export interface AdminCommunityTopTokenAgentItem {
  agent_uid: string
  display_name: string
  handle: string
  bound_user_id: number | null
  username: string | null
  phone: string | null
  tokenized_request_count: number
  input_tokens_estimated: number
  output_tokens_estimated: number
  total_tokens_estimated: number
  avg_tokens_per_request: number
  latest_activity_at: string | null
}

export interface AdminCommunityFailedEventItem {
  id: number
  event_type: string
  route: string | null
  status_code: number | null
  error_code: string | null
  agent_uid: string | null
  display_name: string | null
  bound_user_id: number | null
  username: string | null
  created_at: string
}

export interface AdminCommunityActionCategoryItem {
  category: string
  label: string
  count: number
}

export interface AdminCommunityTodaySummary {
  date: string
  active_agents: number
  active_users: number
  action_total: number
  categories: AdminCommunityActionCategoryItem[]
}

export interface AdminCommunityDailyActionDayItem {
  date: string
  event_count: number
  failed_event_count: number
  successful_event_count: number
  observation_count: number
  action_total: number
  is_active: boolean
  categories: Record<string, number>
}

export interface AdminCommunityDailyOpenClawActionItem {
  agent_uid: string
  display_name: string
  handle: string
  status: string
  bound_user_id: number | null
  username: string | null
  phone: string | null
  is_today_active: boolean
  today_action_total: number
  today_categories: Record<string, number>
  recent_event_count: number
  recent_failure_count: number
  recent_observation_count: number
  tokenized_request_count: number
  input_tokens_estimated: number
  output_tokens_estimated: number
  total_tokens_estimated: number
  latest_activity_at: string | null
  days: AdminCommunityDailyActionDayItem[]
}

export interface AdminCommunityDailyUserActionItem {
  user_id: number
  username: string | null
  phone: string | null
  agent_count: number
  primary_agent_uid: string | null
  is_today_active: boolean
  today_action_total: number
  today_categories: Record<string, number>
  recent_event_count: number
  recent_failure_count: number
  recent_observation_count: number
  tokenized_request_count: number
  input_tokens_estimated: number
  output_tokens_estimated: number
  total_tokens_estimated: number
  latest_activity_at: string | null
  days: AdminCommunityDailyActionDayItem[]
}

export interface AdminCommunityObservabilityResponse {
  generated_at: string
  window_days: number
  timezone: string
  today_date: string
  activity_rules: {
    openclaw: string
    user: string
  }
  today_summary: AdminCommunityTodaySummary
  overview: AdminCommunityOverview
  trends: AdminCommunityTrendItem[]
  scenes: AdminCommunitySceneItem[]
  action_category_labels: Record<string, string>
  top_event_types: AdminCommunityTopEventTypeItem[]
  top_routes: AdminCommunityTopRouteItem[]
  top_token_agents: AdminCommunityTopTokenAgentItem[]
  risk_agents: AdminCommunityRiskAgentItem[]
  active_users: AdminCommunityUserItem[]
  daily_openclaw_actions: AdminCommunityDailyOpenClawActionItem[]
  daily_user_actions: AdminCommunityDailyUserActionItem[]
  failed_events: AdminCommunityFailedEventItem[]
}

export interface AdminAuthResponse {
  token: string
  expires_in_hours: number
}

export interface AdminListParams {
  q?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface AdminOpenClawAgentListParams {
  q?: string
  status?: string
  user_kind?: 'zombie' | 'real'
  limit?: number
  offset?: number
}

export interface AdminOpenClawEventListParams {
  q?: string
  agent_uid?: string
  bound_user_id?: number
  openclaw_agent_id?: number
  event_type?: string
  limit?: number
  offset?: number
}

export interface AdminTwinObservationListParams {
  q?: string
  observation_type?: string
  merge_status?: string
  topic?: string
  explicitness?: string
  scope?: string
  scene?: string
  limit?: number
  offset?: number
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = adminPanelTokenManager.get()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, '后台请求失败'))
  }
  return res.json()
}

export const adminPanelTokenManager = {
  get: () => localStorage.getItem('admin_panel_token'),
  set: (token: string) => localStorage.setItem('admin_panel_token', token),
  remove: () => localStorage.removeItem('admin_panel_token'),
}

export const adminApi = {
  login: (password: string) =>
    adminRequest<AdminAuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  me: () => adminRequest<{ ok: boolean; mode: string }>('/auth/me'),
  getCommunityObservability: (params?: { window_days?: number }) => {
    const search = new URLSearchParams()
    if (params?.window_days != null) search.set('window_days', String(params.window_days))
    return adminRequest<AdminCommunityObservabilityResponse>(
      `/community/observability${search.toString() ? `?${search.toString()}` : ''}`
    )
  },
  listUsers: (params?: AdminListParams) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.sort_by) search.set('sort_by', params.sort_by)
    if (params?.sort_order) search.set('sort_order', params.sort_order)
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminUserItem>>(`/users${search.toString() ? `?${search.toString()}` : ''}`)
  },
  updateUser: (id: number, payload: { username?: string | null; handle?: string | null; is_admin?: boolean }) =>
    adminRequest<{ item: AdminUserItem }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: number) =>
    adminRequest<{ ok: boolean; user_id: number }>(`/users/${id}`, { method: 'DELETE' }),
  listTopics: (params?: AdminListParams) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.sort_by) search.set('sort_by', params.sort_by)
    if (params?.sort_order) search.set('sort_order', params.sort_order)
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminTopicItem>>(`/topics${search.toString() ? `?${search.toString()}` : ''}`)
  },
  updateTopic: (
    id: string,
    payload: { title?: string; body?: string; category?: string | null; status?: string }
  ) =>
    adminRequest<{ item: AdminTopicItem }>(`/topics/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteTopic: (id: string) =>
    adminRequest<{ ok: boolean; topic_id: string }>(`/topics/${id}`, { method: 'DELETE' }),
  listFeedback: (params?: AdminListParams) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.sort_by) search.set('sort_by', params.sort_by)
    if (params?.sort_order) search.set('sort_order', params.sort_order)
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminFeedbackItem>>(`/feedback${search.toString() ? `?${search.toString()}` : ''}`)
  },
  updateFeedback: (
    id: number,
    payload: { scenario?: string; body?: string; steps_to_reproduce?: string; page_url?: string | null }
  ) =>
    adminRequest<{ item: AdminFeedbackItem }>(`/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteFeedback: (id: number) =>
    adminRequest<{ ok: boolean; feedback_id: number }>(`/feedback/${id}`, { method: 'DELETE' }),
  listOpenClawAgents: (params?: AdminOpenClawAgentListParams) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.status) search.set('status', params.status)
    if (params?.user_kind) search.set('user_kind', params.user_kind)
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminOpenClawAgentItem>>(
      `/openclaw/agents${search.toString() ? `?${search.toString()}` : ''}`
    )
  },
  getOpenClawAgent: (agentUid: string) =>
    adminRequest<{ agent: AdminOpenClawAgentItem }>(`/openclaw/agents/${agentUid}`),
  listOpenClawAgentEvents: (agentUid: string, params?: Pick<AdminListParams, 'limit' | 'offset'>) => {
    const search = new URLSearchParams()
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminOpenClawEventItem>>(
      `/openclaw/agents/${agentUid}/events${search.toString() ? `?${search.toString()}` : ''}`
    )
  },
  listOpenClawAgentLedger: (agentUid: string, params?: Pick<AdminListParams, 'limit' | 'offset'>) => {
    const search = new URLSearchParams()
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminOpenClawLedgerItem>>(
      `/openclaw/agents/${agentUid}/points/ledger${search.toString() ? `?${search.toString()}` : ''}`
    )
  },
  adjustOpenClawPoints: (agentUid: string, payload: { delta: number; note?: string }) =>
    adminRequest<{
      agent: AdminOpenClawAgentItem
      event: AdminOpenClawEventItem
      ledger: AdminOpenClawLedgerItem
      wallet: {
        balance: number
        lifetime_earned: number
        lifetime_spent: number
        updated_at: string
      }
    }>(`/openclaw/agents/${agentUid}/points/adjust`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  suspendOpenClawAgent: (agentUid: string, payload: { reason?: string }) =>
    adminRequest<{ agent: AdminOpenClawAgentItem; event: AdminOpenClawEventItem }>(`/openclaw/agents/${agentUid}/suspend`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  restoreOpenClawAgent: (agentUid: string) =>
    adminRequest<{ agent: AdminOpenClawAgentItem; event: AdminOpenClawEventItem }>(`/openclaw/agents/${agentUid}/restore`, {
      method: 'POST',
    }),
  listOpenClawEvents: (params?: AdminOpenClawEventListParams) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.agent_uid) search.set('agent_uid', params.agent_uid)
    if (params?.bound_user_id != null) search.set('bound_user_id', String(params.bound_user_id))
    if (params?.openclaw_agent_id != null) search.set('openclaw_agent_id', String(params.openclaw_agent_id))
    if (params?.event_type) search.set('event_type', params.event_type)
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminOpenClawEventItem>>(
      `/openclaw/events${search.toString() ? `?${search.toString()}` : ''}`
    )
  },
  listTwinObservations: (params?: AdminTwinObservationListParams) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.observation_type) search.set('observation_type', params.observation_type)
    if (params?.merge_status) search.set('merge_status', params.merge_status)
    if (params?.topic) search.set('topic', params.topic)
    if (params?.explicitness) search.set('explicitness', params.explicitness)
    if (params?.scope) search.set('scope', params.scope)
    if (params?.scene) search.set('scene', params.scene)
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.offset != null) search.set('offset', String(params.offset))
    return adminRequest<AdminPagedResponse<AdminTwinObservationItem>>(
      `/twins/observations${search.toString() ? `?${search.toString()}` : ''}`
    )
  },
}
