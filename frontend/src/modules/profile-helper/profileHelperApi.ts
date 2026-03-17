/** Profile helper API: session, profile, chat stream, blocks, download, scales, scientist match */
import { profileHelperApi } from '../../api/client'
import type { Block, FamousMatchResult, FieldRecommendation, StructuredProfile } from './types'

const API_BASE = `${import.meta.env.BASE_URL}api`

function getAuthFetchHeaders(contentType: boolean = false): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  const headers: Record<string, string> = {}
  if (contentType) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function getOrCreateSession(existingId?: string): Promise<string> {
  const url = existingId
    ? `${API_BASE}/profile-helper/session?session_id=${encodeURIComponent(existingId)}`
    : `${API_BASE}/profile-helper/session`
  const res = await fetch(url, { headers: getAuthFetchHeaders() })
  const data = await res.json()
  return data.session_id
}

/** 旧式流式文本接口（保留兼容） */
export async function sendMessage(
  sessionId: string,
  message: string,
  onChunk: (chunk: string) => void,
  model?: string | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/profile-helper/chat`, {
    method: 'POST',
    headers: getAuthFetchHeaders(true),
    body: JSON.stringify({ session_id: sessionId, message, model: model || undefined }),
  })
  if (!res.ok) throw new Error(`请求失败: ${res.status}`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')
  const decoder = new TextDecoder()
  let buffer = ''
  const SSE_REGEX = /\r?\n\r?\n/
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(SSE_REGEX)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6)
        if (payload === '[DONE]') continue
        try {
          const obj = JSON.parse(payload)
          if (obj.content) onChunk(obj.content)
          if (obj.error) onChunk(`错误: ${obj.error}`)
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

/**
 * Block 协议接口：每个 SSE 事件是一个 Block JSON。
 * onBlock 回调在收到每个 Block 时触发。
 */
export async function sendMessageBlocks(
  sessionId: string,
  message: string,
  onBlock: (block: Block) => void,
  model?: string | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/profile-helper/chat/blocks`, {
    method: 'POST',
    headers: getAuthFetchHeaders(true),
    body: JSON.stringify({ session_id: sessionId, message, model: model || undefined }),
  })
  if (!res.ok) throw new Error(`请求失败: ${res.status}`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6)
        if (payload === '[DONE]') continue
        try {
          const block = JSON.parse(payload) as Block
          onBlock(block)
        } catch {
          // ignore
        }
      }
    }
  }
}

export function getDownloadUrl(sessionId: string): string {
  return profileHelperApi.getDownloadUrl(sessionId)
}

export function getForumDownloadUrl(sessionId: string): string {
  return profileHelperApi.getForumDownloadUrl(sessionId)
}

export async function getProfile(sessionId: string): Promise<{
  profile: string
  forum_profile: string
}> {
  const res = await fetch(`${API_BASE}/profile-helper/profile/${sessionId}`, {
    headers: getAuthFetchHeaders(),
  })
  if (!res.ok) throw new Error(`获取画像失败: ${res.status}`)
  return res.json()
}

export async function getStructuredProfile(sessionId: string): Promise<StructuredProfile> {
  const res = await fetch(`${API_BASE}/profile-helper/profile/${sessionId}/structured`, {
    headers: getAuthFetchHeaders(),
  })
  if (!res.ok) throw new Error(`获取结构化画像失败: ${res.status}`)
  return res.json()
}

export async function resetSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/profile-helper/session/reset/${sessionId}`, {
    method: 'POST',
    headers: getAuthFetchHeaders(),
  })
  if (!res.ok) throw new Error(`重置失败: ${res.status}`)
}

export async function submitScale(
  sessionId: string,
  scaleName: string,
  answers: Record<string, number>,
  scores: Record<string, number>,
  resultSummary?: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${API_BASE}/profile-helper/scales/submit`, {
    method: 'POST',
    headers: getAuthFetchHeaders(true),
    body: JSON.stringify({
      session_id: sessionId,
      scale_name: scaleName,
      answers,
      scores,
      result_summary: resultSummary,
    }),
  })
  if (!res.ok) throw new Error(`提交失败: ${res.status}`)
}

// ── 科学家匹配 API ──────────────────────────────────────────────

export async function getFamousMatches(sessionId: string): Promise<FamousMatchResult> {
  const res = await fetch(
    `${API_BASE}/profile-helper/profile/${sessionId}/scientists/famous`,
    { headers: getAuthFetchHeaders() }
  )
  if (!res.ok) throw new Error(`获取匹配失败: ${res.status}`)
  return res.json()
}

export async function getFieldRecommendations(sessionId: string): Promise<FieldRecommendation[]> {
  const res = await fetch(
    `${API_BASE}/profile-helper/profile/${sessionId}/scientists/field`,
    { headers: getAuthFetchHeaders() }
  )
  if (!res.ok) throw new Error(`获取推荐失败: ${res.status}`)
  const data = await res.json()
  return data.recommendations
}

// ── 发布分身 ────────────────────────────────────────────────────

export interface PublishTwinPayload {
  session_id: string
  visibility: 'private' | 'public'
  exposure: 'brief' | 'full'
  display_name?: string
}

export interface PublishTwinResult {
  ok: boolean
  agent_name: string
  display_name: string
  visibility: string
  exposure: string
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function getChatHistory(sessionId: string): Promise<{
  messages: ChatHistoryMessage[]
  count: number
}> {
  const res = await fetch(`${API_BASE}/profile-helper/chat-history/${encodeURIComponent(sessionId)}`, {
    headers: getAuthFetchHeaders(),
  })
  if (!res.ok) throw new Error(`获取对话历史失败: ${res.status}`)
  return res.json()
}

export async function publishTwin(payload: PublishTwinPayload): Promise<PublishTwinResult> {
  const res = await fetch(`${API_BASE}/profile-helper/publish-to-library`, {
    method: 'POST',
    headers: getAuthFetchHeaders(true),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let detail = `发布失败: ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return res.json()
}
