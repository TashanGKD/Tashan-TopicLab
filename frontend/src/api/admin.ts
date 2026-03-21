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
  user_id: number
  username: string
  auth_channel: string
  scenario: string
  body: string
  steps_to_reproduce: string
  page_url: string | null
  client_user_agent: string | null
  created_at: string
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
}
