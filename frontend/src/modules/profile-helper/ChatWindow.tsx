import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageBubble } from './MessageBubble'
import { LoadingDots, RobotAvatar } from './LoadingDots'
import { BlockRenderer } from './blocks/BlockRenderer'
import {
  getOrCreateSession,
  sendMessageBlocks,
  resetSession,
  getProfile,
} from './profileHelperApi'
import type { Block, ChatMessage } from './types'
import { PROFILE_HELPER_MODELS } from '../../api/client'
import { refreshCurrentUserProfile, tokenManager, User } from '../../api/auth'
import { toast } from '../../utils/toast'

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

/** 判断消息是否含有交互型 Block（choice/text_input/rating） */
function hasInteractiveBlock(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === 'choice' || b.type === 'text_input' || b.type === 'rating')
}

/**
 * 输入框锁定状态：
 * - 'initial'：空会话，显示固定文本"建立我的分身"，只读，只能发送
 * - 'locked'：最后一条助手消息含 choice/rating，输入框变浅禁用
 * - 'active'：正常可输入（纯文本回复、text_input 块、copyable 等）
 */
type InputLockState = 'initial' | 'locked' | 'active'

function getInputLockState(messages: ChatMessage[]): InputLockState {
  if (messages.length === 0) return 'initial'

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant') {
      const blocks = m.blocks ?? []
      if (blocks.length === 0) return 'active'
      const hasChoice = blocks.some((b) => b.type === 'choice')
      const hasRating = blocks.some((b) => b.type === 'rating')
      // choice/rating 存在 → 锁定（即使同时有 text_input 也锁定）
      if (hasChoice || hasRating) return 'locked'
      // 只有 text_input / text / copyable / actions → 可输入
      return 'active'
    }
  }
  return 'active'
}

const INIT_MESSAGE = '建立我的分身'

export function ChatWindow() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [, setProfile] = useState('')
  const [, setForumProfile] = useState('')
  const [input, setInput] = useState(INIT_MESSAGE)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>(PROFILE_HELPER_MODELS[0]?.value ?? '')
  const [isComposing, setIsComposing] = useState(false)
  const messagesViewportRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const pendingScrollModeRef = useRef<'bottom' | null>('bottom')
  const bootstrapSessionRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()

  /**
   * requireCurrentUser：
   * - 有登录用户 → 始终通过
   * - 无登录用户但 sessionId 存在 → 匿名模式通过（AUTH_MODE=none 场景）
   * - 无登录 + 无 session → 提示登录
   */
  const requireCurrentUser = useCallback(() => {
    if (currentUser) return true
    if (sessionId) return true      // 匿名 session 已建立，允许交互
    toast.error('请先登录后再与数字分身助手对话')
    return false
  }, [currentUser, sessionId])

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
    const stored = getStoredSessionId()
    bootstrapSessionRef.current = stored
    if (!stored) return

    setSessionId(stored)
    setInitialized(true)
  }, [])

  useEffect(() => {
    async function init() {
      const stored = bootstrapSessionRef.current

      // 认证和 session 初始化并行进行，避免首屏被 /auth/me 阻塞
      const authPromise = (async () => {
        let user: import('../../api/auth').User | null = null
        const token = tokenManager.get()
        if (token) {
          try {
            user = await refreshCurrentUserProfile()
          } catch {
            // auth 服务不可用（如 topiclab-backend 未启动），降级为匿名模式
          }
        }
        return user
      })()

      // ── 1. 后台补齐当前用户（可选）──────────────────────────────
      void authPromise.then((user) => {
        setCurrentUser(user)
      })

      // ── 2. 始终创建/恢复 session（无论是否已登录）────────────────
      // AUTH_MODE=none 时后端接受匿名请求，前端无需登录即可使用 profile helper
      try {
        const id = await getOrCreateSession(stored ?? undefined)
        setSessionId(id)
        setStoredSessionId(id)

        // 本地缓存里的 session 已失效时，避免继续展示旧历史
        if (stored && stored !== id) {
          setMessages([])
          setInput(INIT_MESSAGE)
        }

        // profile 不阻塞首屏
        void fetchProfile(id)
      } catch {
        // 后端不可达，session 创建失败（保持当前 UI 降级态）
      } finally {
        setInitialized(true)
      }
    }
    init()
  }, [fetchProfile])

  /** 从 localStorage 恢复历史消息，有历史则清空初始输入文字 */
  useEffect(() => {
    if (!sessionId) return
    try {
      const raw = localStorage.getItem(`profile_helper_chat_${sessionId}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed)
          setInput('')   // 有历史消息时清空初始固定文字
        }
      } else if (bootstrapSessionRef.current !== sessionId) {
        // session 切换到了一个本地没有缓存的新 id，清空旧会话视觉残留
        setMessages([])
        setInput(INIT_MESSAGE)
      }
    } catch {
      // ignore
    }
  }, [sessionId])

  /** 同步消息到 localStorage */
  useEffect(() => {
    if (!sessionId) return
    try {
      localStorage.setItem(`profile_helper_chat_${sessionId}`, JSON.stringify(messages))
    } catch {
      // ignore
    }
  }, [sessionId, messages])

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const distanceToBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
    shouldAutoScrollRef.current = distanceToBottom <= 48
  }, [])

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const anchor = messagesEndRef.current
    if (!anchor) return
    anchor.scrollIntoView({ block: 'end', behavior })
  }, [])

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return

    const shouldScroll = shouldAutoScrollRef.current || pendingScrollModeRef.current === 'bottom'
    if (!shouldScroll) return

    const behavior: ScrollBehavior = pendingScrollModeRef.current ? 'auto' : 'smooth'
    requestAnimationFrame(() => {
      scrollMessagesToBottom(behavior)
      pendingScrollModeRef.current = null
    })
  }, [messages, loading, scrollMessagesToBottom])

  const handleSubmit = async () => {
    if (!requireCurrentUser()) return
    const text = input.trim()
    if (!text || !sessionId || loading) return

    shouldAutoScrollRef.current = true
    pendingScrollModeRef.current = 'bottom'
    setInput('')
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    // 先加一个空的 assistant 占位
    const placeholderMsg: ChatMessage = { role: 'assistant', blocks: [] }
    setMessages((prev) => [...prev, placeholderMsg])

    const collectedBlocks: Block[] = []

    // 慢响应提示：超过 15 秒仍无 block 时给用户反馈
    const slowTimer = setTimeout(() => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && (!last.blocks || last.blocks.length === 0)) {
          next[next.length - 1] = {
            ...last,
            blocks: [{ type: 'text', content: '⏳ AI 正在思考中，通常需要 20~40 秒，请稍候...' }],
          }
        }
        return next
      })
    }, 15000)

    try {
      await sendMessageBlocks(sessionId, text, (block) => {
        clearTimeout(slowTimer)  // 收到第一个 block，清除慢响应提示
        collectedBlocks.push(block)
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, blocks: [...collectedBlocks] }
          }
          return next
        })
      }, selectedModel || undefined)
      await fetchProfile(sessionId)
    } catch (e) {
      clearTimeout(slowTimer)
      const isNetworkError = e instanceof TypeError && e.message.includes('fetch')
      const errText = isNetworkError
        ? '网络连接中断。AI 仍可能在处理中，请刷新页面查看是否已完成，或重新发送消息重试。'
        : `请求失败: ${e instanceof Error ? e.message : String(e)}`
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = {
            role: 'assistant',
            blocks: [{ type: 'text', content: errText }],
          }
        }
        return next
      })
    } finally {
      clearTimeout(slowTimer)
      setLoading(false)
    }
  }

  /** 当用户点击 Block 中的交互组件时，自动作为新消息发送 */
  const handleBlockRespond = useCallback(
    async (msgIndex: number, responseText: string, blockId?: string) => {
      // Block 级标记：只禁用本次点击的 block，其余 block 保持可用
      setMessages((prev) => {
        const next = [...prev]
        const msg = next[msgIndex]
        if (msg?.role === 'assistant') {
          const respondedBlocks = [...(msg._responded_blocks ?? [])]
          if (blockId && !respondedBlocks.includes(blockId)) {
            respondedBlocks.push(blockId)
          }
          // 检查该消息内所有交互型 block 是否都已响应（向后兼容 _responded）
          const interactiveIds = (msg.blocks ?? [])
            .filter((b) => b.type === 'choice' || b.type === 'rating' || b.type === 'text_input')
            .map((b) => ('id' in b ? (b as { id: string }).id : ''))
            .filter(Boolean)
          const allResponded = interactiveIds.length > 0 && interactiveIds.every((id) => respondedBlocks.includes(id))
          next[msgIndex] = { ...msg, _responded_blocks: respondedBlocks, _responded: allResponded }
        }
        return next
      })
      shouldAutoScrollRef.current = true
      pendingScrollModeRef.current = 'bottom'
      setInput(responseText)
      // 自动发送
      if (!requireCurrentUser() || !sessionId || loading) return
      setLoading(true)

      const userMsg: ChatMessage = { role: 'user', content: responseText }
      setMessages((prev) => [...prev, userMsg])
      const placeholderMsg: ChatMessage = { role: 'assistant', blocks: [] }
      setMessages((prev) => [...prev, placeholderMsg])
      setInput('')

      const collectedBlocks: Block[] = []
      try {
        await sendMessageBlocks(sessionId, responseText, (block) => {
          collectedBlocks.push(block)
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, blocks: [...collectedBlocks] }
            }
            return next
          })
        }, selectedModel || undefined)
        await fetchProfile(sessionId)
      } catch (e) {
        const errText = `请求失败: ${e instanceof Error ? e.message : String(e)}`
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') {
            next[next.length - 1] = {
              role: 'assistant',
              blocks: [{ type: 'text', content: errText }],
            }
          }
          return next
        })
      } finally {
        setLoading(false)
      }
    },
    [sessionId, loading, selectedModel, requireCurrentUser, fetchProfile]
  )

  const handleReset = async () => {
    if (!requireCurrentUser() || !sessionId) return
    try {
      await resetSession(sessionId)
      shouldAutoScrollRef.current = true
      pendingScrollModeRef.current = 'bottom'
      setMessages([])
      setInput(INIT_MESSAGE)   // 重置后恢复固定初始文本
      await fetchProfile(sessionId)
      inputRef.current?.focus()
    } catch (e) {
      alert(`重置失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const showLoadingDots =
    loading &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    (messages[messages.length - 1]?.blocks?.length ?? 0) === 0

  const lockState: InputLockState = loading ? 'locked' : getInputLockState(messages)
  const isInitial = lockState === 'initial'
  const isLocked = lockState === 'locked'
  // initial 状态的显示值固定为 INIT_MESSAGE；locked/active 使用 input state
  const textareaValue = isInitial ? INIT_MESSAGE : input
  const textareaPlaceholder = isLocked ? '请从上方选项中作答' : '输入消息...'

  if (!initialized) {
    return <div className="chat-loading">加载中...</div>
  }

  return (
    <div className="chat-layout">
      <div className="chat-window">
        <div className="chat-conversation-shell">
          <div
            ref={messagesViewportRef}
            className="chat-scroll-viewport"
            onScroll={handleMessagesScroll}
          >
            <div className="messages">
              {messages.length === 0 && (
                <div className="welcome">
                  <p>你好，我是科研数字分身采集助手。</p>
                  <p>可以说「建立我的分身」开始。</p>
                </div>
              )}
              {messages
                .filter((m, i) => {
                  // 过滤掉最后一条空占位 assistant 消息（正在加载时）
                  if (
                    showLoadingDots &&
                    i === messages.length - 1 &&
                    m.role === 'assistant' &&
                    (m.blocks?.length ?? 0) === 0
                  ) return false
                  return true
                })
                .map((m, i) => {
                  if (m.role === 'user') {
                    return <MessageBubble key={i} role="user" content={m.content ?? ''} />
                  }
                  // assistant: blocks 模式
                  if (m.blocks && m.blocks.length > 0) {
                    const isLatest = i === messages.length - 1
                    const isInteractive = hasInteractiveBlock(m.blocks)
                    const respondedBlocks = m._responded_blocks ?? []
                    return (
                      <div key={i} className="message-row assistant-row">
                        <RobotAvatar />
                        <div className="assistant-blocks">
                          {m.blocks.map((block, bi) => {
                            // Block 级响应状态：每个 block 独立判断是否已被回答
                            const blockId = 'id' in block ? (block as { id: string }).id : undefined
                            const isBlockResponded = blockId
                              ? respondedBlocks.includes(blockId)
                              : !!m._responded
                            return (
                              <BlockRenderer
                                key={bi}
                                block={block}
                                onRespond={(text) => handleBlockRespond(i, text, blockId)}
                                disabled={loading || (isInteractive && (!isLatest || isBlockResponded))}
                                responded={isBlockResponded}
                              />
                            )
                          })}
                        </div>
                      </div>
                    )
                  }
                  // 旧式纯文本（backward compat）
                  return <MessageBubble key={i} role="assistant" content={m.content ?? ''} />
                })}
              {showLoadingDots && (
                <div className="loading-message-row">
                  <RobotAvatar />
                  <div className="message-bubble assistant loading-bubble">
                    <LoadingDots />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} className="chat-scroll-anchor" aria-hidden />
            </div>
          </div>
        </div>

        <form
          className="chat-input-container"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="chat-input-inner">
            {!currentUser && !sessionId ? (
              // 既未登录、又无匿名 session（后端不可达）→ 才提示登录
              <div className="chat-login-prompt">
                <p>请先登录后再与数字分身助手对话</p>
                <Link to="/login" state={{ from: '/profile-helper' }} className="chat-login-link">
                  去登录
                </Link>
              </div>
            ) : (
              <>
                <div className="chat-input-row">
                  <div className="chat-input-wrapper">
                    <textarea
                      ref={inputRef}
                      value={textareaValue}
                      readOnly={isInitial || isLocked}
                      onChange={(e) => {
                        if (isInitial || isLocked) return
                        setInput(e.target.value)
                      }}
                      onKeyDown={(e) => {
                        if (isInitial || isLocked) { e.preventDefault(); return }
                        if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                          e.preventDefault()
                          handleSubmit()
                        }
                      }}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={() => setIsComposing(false)}
                      placeholder={textareaPlaceholder}
                      rows={3}
                      className={`chat-textarea${isLocked ? ' chat-textarea--locked' : ''}${isInitial ? ' chat-textarea--initial' : ''}`}
                    />
                  </div>
                  <button
                    type="submit"
                    className="chat-send-btn"
                    disabled={isLocked || (!isInitial && !input.trim())}
                  >
                    {loading ? (
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    )}
                  </button>
                </div>

                <div className="chat-hint-row">
                  <span className="input-hint">
                    {isLocked ? '请点击上方选项作答' : isInitial ? '点击发送开始建立分身' : 'Enter 发送 · Shift+Enter 换行'}
                  </span>
                  <div className="chat-hint-actions">
                    <select
                      className="model-select-single"
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
                      className="chat-action-btn"
                      onClick={() => navigate('/profile-helper/profile')}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      我的分身
                    </button>
                    <button
                      type="button"
                      className="chat-action-btn"
                      onClick={handleReset}
                      disabled={loading}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      重置会话
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
