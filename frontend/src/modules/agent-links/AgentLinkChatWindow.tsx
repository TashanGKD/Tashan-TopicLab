import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AGENT_LINK_MODELS,
  AgentLinkInfo,
  AgentStreamEvent,
  chatWithAgentLink,
  getAgentLink,
  MAX_WORKSPACE_FILE_SIZE_BYTES,
  startAgentLinkSession,
  uploadAgentLinkWorkspaceFile,
} from './agentLinksApi'

interface AgentLinkChatWindowProps {
  slug: string
}

type FeedItem =
  | { id: string; kind: 'user'; content: string }
  | { id: string; kind: 'assistant'; content: string }
  | { id: string; kind: 'plan'; items: Array<{ content?: string; status?: string; activeForm?: string }> }
  | { id: string; kind: 'error'; content: string }

interface UploadedFileItem {
  path: string
  size: number
}

function getStorageKey(slug: string): string {
  return `tashan_agent_link_session_${slug}`
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CodeBlockWithCopy({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const code = preRef.current?.querySelector('code')
    const text = code?.textContent ?? ''
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="agent-code-wrap">
      <button type="button" className="agent-code-copy" onClick={handleCopy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre ref={preRef} {...props}>
        {children}
      </pre>
    </div>
  )
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="agent-markdown markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlockWithCopy }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function AgentLinkChatWindow({ slug }: AgentLinkChatWindowProps) {
  const [searchParams] = useSearchParams()
  const [agentLink, setAgentLink] = useState<AgentLinkInfo | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const defaultModel = useMemo(
    () => AGENT_LINK_MODELS.find((m) => m.value === 'qwen3.5-plus')?.value ?? AGENT_LINK_MODELS[0]?.value ?? '',
    [],
  )
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel)

  const streamAssistantIdRef = useRef<string | null>(null)
  const autoHelloSentRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const storageKey = useMemo(() => getStorageKey(slug), [slug])

  const persistSessionId = useCallback((id: string) => {
    setSessionId(id)
    localStorage.setItem(storageKey, id)
  }, [storageKey])

  const initialize = useCallback(async () => {
    setInitializing(true)
    setError(null)
    try {
      const link = await getAgentLink(slug)
      setAgentLink(link)

      const sidFromUrl = searchParams.get('sid')
      const sidStored = localStorage.getItem(storageKey)
      const sidCandidate = sidFromUrl || sidStored || undefined

      const session = await startAgentLinkSession(slug, sidCandidate)
      persistSessionId(session.session_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInitializing(false)
    }
  }, [persistSessionId, searchParams, slug, storageKey])

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed])

  const appendFeed = useCallback((item: FeedItem) => {
    setFeed((prev) => [...prev, item])
  }, [])

  const handleStreamEvent = useCallback((event: AgentStreamEvent) => {
    if (event.error) {
      appendFeed({ id: makeId('err'), kind: 'error', content: String(event.error) })
      return
    }
    const type = String(event.type || '')
    if (type === 'assistant_delta') {
      const text = String(event.content ?? '')
      if (!text) return
      const aid = streamAssistantIdRef.current
      // Always append to the current assistant message
      if (aid) {
        setFeed((prev) => prev.map((item) => (item.id === aid && item.kind === 'assistant'
          ? { ...item, content: item.content + text }
          : item)))
      } else {
        // Fallback: create new message if ref is null (should not happen)
        const newId = makeId('assistant')
        streamAssistantIdRef.current = newId
        appendFeed({ id: newId, kind: 'assistant', content: text })
      }
      return
    }
    if (type === 'plan') {
      appendFeed({
        id: makeId('plan'),
        kind: 'plan',
        items: Array.isArray(event.items) ? event.items : [],
      })
      return
    }
    // Hide all non-dialog events in this page (except plan).
    if (type === 'thinking' || type === 'tool_call' || type === 'tool_result') return
    if (type === 'system') return
    if (type === 'result') {
      if (event.is_error && event.result) {
        appendFeed({ id: makeId('err'), kind: 'error', content: String(event.result) })
      }
      return
    }
    if (event.content) {
      const aid = streamAssistantIdRef.current
      const text = String(event.content)
      if (aid) {
        setFeed((prev) => prev.map((item) => (item.id === aid && item.kind === 'assistant'
          ? { ...item, content: item.content + text }
          : item)))
      } else {
        const newId = makeId('assistant')
        streamAssistantIdRef.current = newId
        appendFeed({ id: newId, kind: 'assistant', content: text })
      }
    }
  }, [appendFeed])

  const sendMessage = useCallback(async (text: string, opts?: { silentUser?: boolean }) => {
    const msg = text.trim()
    if (!msg || !sessionId || loading) return
    const silentUser = Boolean(opts?.silentUser)

    const assistantId = makeId('assistant')
    if (!silentUser) {
      appendFeed({ id: makeId('user'), kind: 'user', content: msg })
    }
    appendFeed({ id: assistantId, kind: 'assistant', content: '' })
    streamAssistantIdRef.current = assistantId
    if (!silentUser) setInput('')
    setLoading(true)

    try {
      await chatWithAgentLink(
        slug,
        msg,
        handleStreamEvent,
        {
          sessionId,
          model: selectedModel || undefined,
          onSessionId: (id) => persistSessionId(id),
        },
      )
    } catch (e) {
      appendFeed({
        id: makeId('err'),
        kind: 'error',
        content: `Request failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      streamAssistantIdRef.current = null
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [appendFeed, handleStreamEvent, loading, persistSessionId, selectedModel, sessionId, slug])

  const handleSubmit = async () => {
    await sendMessage(input)
  }

  useEffect(() => {
    if (initializing || loading || !sessionId || autoHelloSentRef.current) return
    autoHelloSentRef.current = true
    void sendMessage('你好', { silentUser: true })
  }, [initializing, loading, sendMessage, sessionId])

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !sessionId || uploading) return
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_WORKSPACE_FILE_SIZE_BYTES) {
          throw new Error(`File too large: ${file.name}`)
        }
        const uploaded = await uploadAgentLinkWorkspaceFile(slug, file, {
          sessionId,
          targetPath: 'uploads',
        })
        persistSessionId(uploaded.session_id)
        setUploadedFiles((prev) => {
          const next = [...prev]
          const i = next.findIndex((x) => x.path === uploaded.path)
          if (i >= 0) {
            next[i] = { path: uploaded.path, size: uploaded.size }
          } else {
            next.push({ path: uploaded.path, size: uploaded.size })
          }
          return next
        })
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const userHistory = useMemo(
    () => feed
      .filter((item): item is Extract<FeedItem, { kind: 'user' }> => item.kind === 'user')
      .map((item, idx) => ({
        id: item.id,
        index: idx + 1,
        title: item.content.slice(0, 24).replace(/\s+/g, ' ') || `Message ${idx + 1}`,
      })),
    [feed],
  )

  const jumpToUser = (id: string) => {
    const el = document.getElementById(`feed-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (initializing) {
    return <div className="chat-loading">Loading...</div>
  }

  if (error) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-6">
        <p className="text-red-600 text-sm">Load failed: {error}</p>
        <button
          type="button"
          onClick={() => initialize()}
          className="mt-3 px-3 py-2 bg-black text-white text-sm rounded"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="agent-link-shell">
      <header className="agent-link-header">
        <div>
          <h1>{agentLink?.name || slug}</h1>
          {agentLink?.description ? <p>{agentLink.description}</p> : null}
        </div>
      </header>

      <section className="agent-link-main">
        <div className="agent-link-feed">
          {feed.length === 0 ? (
            <div className="agent-link-welcome">
              <p>{agentLink?.welcome_message || 'Hello, I am your research digital twin assistant.'}</p>
            </div>
          ) : null}

          {feed.map((item) => {
            if (item.kind === 'user') {
              return (
                <article id={`feed-${item.id}`} key={item.id} className="agent-row agent-row-user">
                  <div className="agent-row-label">You</div>
                  <div className="agent-row-content">{item.content}</div>
                </article>
              )
            }
            if (item.kind === 'assistant') {
              return (
                <article key={item.id} className="agent-row">
                  <div className="agent-row-label">Assistant</div>
                  <div className="agent-row-content">
                    {item.content ? <MarkdownBlock content={item.content} /> : (loading ? <span>...</span> : null)}
                  </div>
                </article>
              )
            }
            if (item.kind === 'plan') {
              return (
                <article key={item.id} className="agent-row agent-row-meta">
                  <details open>
                    <summary>Plan Mode</summary>
                    <ul className="agent-plan-list">
                      {item.items.length === 0 ? <li>(no plan items)</li> : null}
                      {item.items.map((planItem, idx) => (
                        <li key={`${item.id}_${idx}`}>
                          <span className={`agent-plan-status status-${planItem.status || 'pending'}`}>{planItem.status || 'pending'}</span>
                          <span>{planItem.content || '(empty)'}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              )
            }
            return (
              <article key={item.id} className="agent-row agent-row-error">
                <div className="agent-row-label">Error</div>
                <div className="agent-row-content">{item.content}</div>
              </article>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        <aside className="agent-link-history">
          <div className="agent-link-history-title">History</div>
          {userHistory.length === 0 ? (
            <p className="agent-link-history-empty">No user messages</p>
          ) : (
            <div className="agent-link-history-list">
              {userHistory.map((item) => (
                <button key={item.id} type="button" onClick={() => jumpToUser(item.id)} className="agent-link-history-item">
                  <span className="idx">{item.index}</span>
                  <span className="txt">{item.title}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </section>

      <form
        className="agent-input-shell"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <div className="agent-input-box">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // IME composing Enter should confirm candidate, not send.
              const ne = e.nativeEvent as KeyboardEvent & { isComposing?: boolean }
              if (ne.isComposing || ne.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Message agent. Enter to send, Shift+Enter for newline."
            rows={3}
          />
          <div className="agent-input-toolbar">
            <div className="agent-input-left">
              <button
                type="button"
                className="agent-icon-btn"
                title="Upload files"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploading}
              >
                +
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => handleUploadFiles(e.target.files)}
                disabled={loading || uploading}
              />
              <select
                className="agent-input-model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                title="Model"
                disabled={loading}
              >
                {AGENT_LINK_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="agent-send-btn" disabled={loading || !input.trim() || !sessionId}>
              ↑
            </button>
          </div>
        </div>
        {uploadError ? <p className="agent-upload-error inline">{uploadError}</p> : null}
        {uploadedFiles.length > 0 ? (
          <div className="agent-upload-inline">
            {uploadedFiles.slice(-4).map((f) => (
              <span key={f.path} className="agent-upload-chip">
                {f.path} ({humanBytes(f.size)})
              </span>
            ))}
          </div>
        ) : null}
      </form>
    </div>
  )
}
