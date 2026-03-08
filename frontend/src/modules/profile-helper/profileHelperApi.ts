/** Profile helper API: session, profile, chat stream, download URLs */
import { profileHelperApi } from '../../api/client'

const API_BASE = `${import.meta.env.BASE_URL}api`

export async function getOrCreateSession(existingId?: string): Promise<string> {
  const url = existingId
    ? `${API_BASE}/profile-helper/session?session_id=${encodeURIComponent(existingId)}`
    : `${API_BASE}/profile-helper/session`
  const res = await fetch(url)
  const data = await res.json()
  return data.session_id
}

export async function sendMessage(
  sessionId: string,
  message: string,
  onChunk: (chunk: string) => void,
  model?: string | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/profile-helper/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message, model: model || undefined }),
  })
  if (!res.ok) throw new Error(`请求失败: ${res.status}`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')
  const decoder = new TextDecoder()
  let buffer = ''
  // Use regex to split on double line endings (handles both \n\n and \r\n\r\n)
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
  const res = await fetch(`${API_BASE}/profile-helper/profile/${sessionId}`)
  if (!res.ok) throw new Error(`获取画像失败: ${res.status}`)
  return res.json()
}

export async function resetSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/profile-helper/session/reset/${sessionId}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`重置失败: ${res.status}`)
}
