/** Authorized import of activity-site profile fields into the unified profile. */
import api from './client'

export interface ImportField {
  field: string
  label: string
  current: string | null
  source_value: string | null
  source_updated_at: string | null
  note: string | null
}

export interface ImportSource {
  source: string
  label: string
  activity: string
  available: boolean
}

export interface PreviewResponse {
  bound: boolean
  message?: string
  source?: string
  label?: string
  activity?: string
  preview_id?: string
  preview_token?: string
  expires_at?: number
  base_version?: number
  fields?: ImportField[]
  consent_version?: string
}

export interface ProfileFieldView {
  field: string
  label: string
  value: string | null
  source: string | null
  source_updated_at: string | null
  adopted_at: number | null
}

export interface HistoryItem {
  authorization_id: string
  source: string
  label: string
  status: string
  consent_version: string
  field_scope: string[]
  granted_at: number
  expires_at: number
  cancelled_at: number | null
  completed_at: number | null
  adopted_fields: { field: string; source: string; source_updated_at: string | null }[]
}

const get = async <T>(url: string): Promise<T> => (await api.get<T>(url)).data
const post = async <T>(url: string, body: unknown): Promise<T> => (await api.post<T>(url, body)).data

export const profileImportApi = {
  sources: () =>
    get<{ sources: ImportSource[]; consent: { version: string; text: string }; fields: { field: string; label: string }[] }>(
      '/v1/profile-import/sources',
    ),
  profile: () => get<{ profile: Record<string, unknown>; fields: ProfileFieldView[] }>('/v1/profile-import/profile'),
  authorize: (source: string) =>
    post<{ authorization_id: string; expires_at: number; consent_version: string; field_scope: string[] }>(
      '/v1/profile-import/authorizations',
      { source },
    ),
  cancel: (authorizationId: string) =>
    post<{ authorization_id: string; status: string }>(
      `/v1/profile-import/authorizations/${encodeURIComponent(authorizationId)}/cancel`,
      {},
    ),
  preview: (authorizationId: string) =>
    post<PreviewResponse>('/v1/profile-import/previews', { authorization_id: authorizationId }),
  commit: (payload: {
    preview_id: string
    preview_token: string
    expected_version: number
    idempotency_key: string
    selections: Record<string, string>
    origin: Record<string, string>
  }) => post<{ profile: Record<string, unknown>; applied_version: number; imported: unknown[] }>(
    '/v1/profile-import/commits',
    payload,
  ),
  history: () => get<{ items: HistoryItem[]; sources: ImportSource[] }>('/v1/profile-import/history'),
}

export function readImportError(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length && typeof (detail[0] as { msg?: string })?.msg === 'string')
    return (detail[0] as { msg: string }).msg
  return '操作未完成，请稍后重试'
}
