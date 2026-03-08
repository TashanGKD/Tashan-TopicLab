import api, { PROFILE_HELPER_MODELS } from '../../api/client'

const API_BASE = `${import.meta.env.BASE_URL}api`
export const MAX_IMPORT_ZIP_SIZE_BYTES = 5 * 1024 * 1024

export interface AgentLinkInfo {
  slug: string
  name: string
  description: string
  module: string
  entry_skill: string
  blueprint_root: string
  agent_workdir: string
  rule_file_path: string
  skills_path: string
  docs_path: string
  template_path: string
  welcome_message: string
  default_model: string
}

export interface StartLinkSessionResponse {
  session_id: string
  agent_link: AgentLinkInfo
  welcome_message: string
  agent_workdir: string
}

export const AGENT_LINK_MODELS = PROFILE_HELPER_MODELS
export const MAX_WORKSPACE_FILE_SIZE_BYTES = 30 * 1024 * 1024

export interface AgentStreamEvent {
  type?: string
  content?: string
  error?: string
  tool_name?: string
  tool_use_id?: string
  input?: unknown
  is_error?: boolean
  data?: Record<string, unknown>
  items?: Array<{ content?: string; status?: string; activeForm?: string }>
  result?: string
  [key: string]: unknown
}

export interface ImportAgentLinkParams {
  file: File
  slug?: string
  name: string
  description?: string
  ruleFilePath: string
  welcomeMessage: string
  defaultModel?: string
  overwrite?: boolean
}

export interface ZipPreview {
  files: string[]
  total: number
}

export interface UploadWorkspaceFileResponse {
  session_id: string
  path: string
  size: number
}

export async function listAgentLinks(): Promise<AgentLinkInfo[]> {
  const res = await api.get<AgentLinkInfo[]>('/agent-links')
  return res.data
}

export async function getAgentLink(slug: string): Promise<AgentLinkInfo> {
  const res = await api.get<AgentLinkInfo>(`/agent-links/${encodeURIComponent(slug)}`)
  return res.data
}

export async function importAgentLink(params: ImportAgentLinkParams): Promise<AgentLinkInfo> {
  if (params.file.size > MAX_IMPORT_ZIP_SIZE_BYTES) {
    throw new Error('导入失败：压缩包超过 5MB 限制，请压缩后重试。')
  }
  const form = new FormData()
  form.append('file', params.file)
  if (params.slug?.trim()) form.append('slug', params.slug.trim())
  form.append('name', params.name.trim())
  if (params.description?.trim()) form.append('description', params.description.trim())
  form.append('rule_file_path', params.ruleFilePath.trim())
  form.append('welcome_message', params.welcomeMessage.trim())
  if (params.defaultModel?.trim()) form.append('default_model', params.defaultModel.trim())
  form.append('overwrite', params.overwrite ? 'true' : 'false')

  const res = await fetch(`${API_BASE}/agent-links/import`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let message = `导入失败：${res.status}`
    if (res.status === 413) {
      message = '导入失败：压缩包超过 5MB 限制，请压缩后重试。'
    }
    try {
      const data = await res.json()
      if (data?.detail) message = `导入失败：${data.detail}`
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json()
}

export async function previewAgentLinkZip(file: File): Promise<ZipPreview> {
  if (file.size > MAX_IMPORT_ZIP_SIZE_BYTES) {
    throw new Error('预览失败：压缩包超过 5MB 限制，请压缩后重试。')
  }
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/agent-links/import/preview`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let message = `预览失败：${res.status}`
    if (res.status === 413) {
      message = '预览失败：压缩包超过 5MB 限制，请压缩后重试。'
    }
    try {
      const data = await res.json()
      if (data?.detail) message = `预览失败：${data.detail}`
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json()
}

export async function startAgentLinkSession(
  slug: string,
  sessionId?: string | null,
): Promise<StartLinkSessionResponse> {
  const res = await fetch(`${API_BASE}/agent-links/${encodeURIComponent(slug)}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId || undefined }),
  })
  if (!res.ok) throw new Error(`创建会话失败：${res.status}`)
  return res.json()
}

export async function chatWithAgentLink(
  slug: string,
  message: string,
  onEvent: (event: AgentStreamEvent) => void,
  opts?: { sessionId?: string | null; model?: string | null; onSessionId?: (id: string) => void },
): Promise<void> {
  const chatReq = {
    session_id: opts?.sessionId || undefined,
    message,
    model: opts?.model || undefined,
  }
  console.log('[AgentLink Chat] Request:', { slug, ...chatReq })

  const res = await fetch(`${API_BASE}/agent-links/${encodeURIComponent(slug)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chatReq),
  })

  console.log('[AgentLink Chat] Response status:', res.status)
  console.log('[AgentLink Chat] Response headers:', {
    'X-Session-Id': res.headers.get('X-Session-Id'),
    'X-Agent-Link': res.headers.get('X-Agent-Link'),
    'X-Agent-Workdir': res.headers.get('X-Agent-Workdir'),
  })

  if (!res.ok) throw new Error(`请求失败：${res.status}`)

  const sid = res.headers.get('X-Session-Id')
  if (sid && opts?.onSessionId) opts.onSessionId(sid)

  const reader = res.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')

  const decoder = new TextDecoder()
  let buffer = ''
  let eventCount = 0
  const SSE_REGEX = /\r?\n\r?\n/

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('[AgentLink Chat] Stream complete, total events:', eventCount)
        break
      }

      const chunk = decoder.decode(value, { stream: true })
      console.log('[AgentLink Chat] Raw chunk:', JSON.stringify(chunk.substring(0, 200) + (chunk.length > 200 ? '...' : '')))

      buffer += chunk
      const lines = buffer.split(SSE_REGEX)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          console.log('[AgentLink Chat] Skipping non-data line:', line)
          continue
        }
        const payload = line.slice(6)
        if (payload === '[DONE]') {
          console.log('[AgentLink Chat] Received [DONE]')
          continue
        }
        try {
          const obj = JSON.parse(payload) as AgentStreamEvent
          eventCount++
          console.log(`[AgentLink Chat] Event #${eventCount}:`, obj.type, obj)
          onEvent(obj)
        } catch (e) {
          console.error('[AgentLink Chat] Failed to parse event:', line, e)
        }
      }
    }
  } catch (e) {
    console.error('[AgentLink Chat] Stream error:', e)
    throw e
  }
}

export async function uploadAgentLinkWorkspaceFile(
  slug: string,
  file: File,
  opts?: { sessionId?: string | null; targetPath?: string | null },
): Promise<UploadWorkspaceFileResponse> {
  if (file.size > MAX_WORKSPACE_FILE_SIZE_BYTES) {
    throw new Error('上传失败：文件超过 30MB 限制，请压缩或分拆后重试。')
  }
  const form = new FormData()
  form.append('file', file)
  if (opts?.sessionId) form.append('session_id', opts.sessionId)
  if (opts?.targetPath) form.append('target_path', opts.targetPath)

  const res = await fetch(`${API_BASE}/agent-links/${encodeURIComponent(slug)}/files/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let message = `上传失败：${res.status}`
    if (res.status === 413) {
      message = '上传失败：文件超过 30MB 限制，请压缩或分拆后重试。'
    }
    try {
      const data = await res.json()
      if (data?.detail) message = `上传失败：${data.detail}`
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json()
}
