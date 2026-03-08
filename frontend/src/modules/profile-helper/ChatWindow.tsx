import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { LoadingDots, RobotAvatar } from './LoadingDots'
import { ProfilePanel } from './ProfilePanel'
import {
  getOrCreateSession,
  sendMessage,
  resetSession,
  getProfile,
} from './profileHelperApi'
import { PROFILE_HELPER_MODELS } from '../../api/client'
import api from '../../api/client'

const SESSION_KEYS = ['tashan_session_id', 'tashan_profile_session_id'] as const

function getStoredSessionId(): string | null {
  for (const key of SESSION_KEYS) {
    const value = localStorage.getItem(key)
    if (value) return value
  }
  return null
}

function setStoredSessionId(id: string) {
  for (const key of SESSION_KEYS) {
    localStorage.setItem(key, id)
  }
}

export function ChatWindow() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [profile, setProfile] = useState('')
  const [forumProfile, setForumProfile] = useState('')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [view, setView] = useState<'chat' | 'profile'>('chat')
  const [selectedModel, setSelectedModel] = useState<string>(PROFILE_HELPER_MODELS[0]?.value ?? '')
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const fetchProfile = useCallback(async (sid: string) => {
    try {
      const data = await getProfile(sid)
      setProfile(data.profile)
      setForumProfile(data.forum_profile)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    async function init() {
      const stored = getStoredSessionId()
      const id = await getOrCreateSession(stored ?? undefined)
      setSessionId(id)
      setStoredSessionId(id)
      await fetchProfile(id)
      setInitialized(true)
    }
    init()
  }, [fetchProfile])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async () => {
    const text = input.trim()
    if (!text || !sessionId || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)

    const assistantContent: string[] = []
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      await sendMessage(sessionId, text, (chunk) => {
        assistantContent.push(chunk)
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            next[next.length - 1] = {
              ...last,
              content: assistantContent.join(''),
            }
          }
          return next
        })
      }, selectedModel || undefined)
      await fetchProfile(sessionId)
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && last.content === '') {
          next[next.length - 1] = {
            ...last,
            content: `请求失败: ${e instanceof Error ? e.message : String(e)}`,
          }
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    if (!sessionId) return
    try {
      await resetSession(sessionId)
      setMessages([])
      setImportResult(null)
      await fetchProfile(sessionId)
      inputRef.current?.focus()
    } catch (e) {
      alert(`重置失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleImportToTopicLab = async () => {
    if (!forumProfile || !sessionId) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const res = await api.post<{ message: string; expert_name: string }>(
        '/experts/import-profile',
        {
          forum_profile: forumProfile,
          session_id: sessionId,
        }
      )
      setImportResult(`已导入角色「${res.data.expert_name}」到 Topic-Lab 角色库`)
    } catch (e) {
      setImportResult(`导入失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImportLoading(false)
    }
  }

  const showLoadingDots =
    loading &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content === ''

  if (!initialized) {
    return <div className="chat-loading">加载中...</div>
  }

  if (view === 'profile') {
    return (
      <div className="profile-page">
        <header className="profile-page-header">
          <h1>科研数字分身</h1>
          <button type="button" className="back-btn" onClick={() => setView('chat')}>
            返回对话
          </button>
        </header>
        <ProfilePanel
          sessionId={sessionId}
          profile={profile}
          forumProfile={forumProfile}
          onImportToTopicLab={handleImportToTopicLab}
          importLoading={importLoading}
          importResult={importResult}
        />
      </div>
    )
  }

  return (
    <div className="chat-layout">
      <div className="chat-window">
        <header className="chat-header">
          <h1>他山数字分身助手</h1>
          <div className="header-actions">
            <select
              className="profile-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              title="选择模型"
            >
              {PROFILE_HELPER_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="view-profile-btn"
              onClick={() => setView('profile')}
            >
              查看数字分身
            </button>
            <button
              type="button"
              className="reset-btn"
              onClick={handleReset}
              disabled={loading}
            >
              重置会话
            </button>
          </div>
        </header>

        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <p>你好，我是科研数字分身采集助手。</p>
              <p>可以说「帮我建立分身」开始。</p>
            </div>
          )}
          {messages
            .filter(
              (m, i) =>
                !(
                  showLoadingDots &&
                  i === messages.length - 1 &&
                  m.role === 'assistant' &&
                  m.content === ''
                )
            )
            .map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} />
            ))}
          {showLoadingDots && (
            <div className="loading-message-row">
              <RobotAvatar />
              <div className="message-bubble assistant loading-bubble">
                <LoadingDots />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form
          className="input-area"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={2}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? '发送中...' : '发送'}
          </button>
        </form>
      </div>
    </div>
  )
}
