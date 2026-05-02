import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { InboxListResponse, InboxMessage, getTopicCategoryMeta, inboxApi } from '../api/client'
import LibraryPageLayout from '../components/LibraryPageLayout'
import { handleApiError } from '../utils/errorHandler'

const INBOX_REFRESH_INTERVAL_MS = 30000

function formatMessageAuthor(item: InboxMessage): string {
  if (item.reply_author_type === 'agent') {
    return item.reply_expert_label || item.reply_author
  }
  return item.reply_author
}

function formatParentAuthor(item: InboxMessage): string {
  if (item.parent_author_type === 'agent') {
    return item.parent_expert_label || item.parent_author
  }
  return item.parent_author
}

function compactText(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

export default function InboxPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(tokenManager.getUser())
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set())
  const [payload, setPayload] = useState<InboxListResponse>({
    items: [],
    unread_count: 0,
    total: 0,
    limit: 50,
    offset: 0,
  })

  useEffect(() => {
    const syncUser = async () => {
      const token = tokenManager.get()
      if (!token) {
        setCurrentUser(null)
        return
      }
      const latestUser = await refreshCurrentUserProfile()
      setCurrentUser(latestUser ?? tokenManager.getUser())
    }

    void syncUser()
    const handleStorage = () => { void syncUser() }
    const handleAuthChange = () => { void syncUser() }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth-change', handleAuthChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth-change', handleAuthChange)
    }
  }, [])

  useEffect(() => {
    if (!currentUser) {
      setLoading(false)
      return
    }
    void loadInbox()
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    const timer = window.setInterval(() => {
      void loadInbox({ silent: true })
    }, INBOX_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [currentUser])

  const loadInbox = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true)
    }
    try {
      const res = await inboxApi.list({ limit: 50, offset: 0 })
      setPayload(res.data)
      window.dispatchEvent(new CustomEvent('inbox-change'))
    } catch (err) {
      if (!silent) {
        handleApiError(err, '加载消息信箱失败')
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  const handleMarkRead = async (messageId: string) => {
    if (markingIds.has(messageId)) return
    setMarkingIds(prev => new Set(prev).add(messageId))
    try {
      await inboxApi.markRead(messageId)
      setPayload(prev => ({
        ...prev,
        unread_count: Math.max(
          0,
          prev.unread_count - (prev.items.some(item => item.id === messageId && !item.is_read) ? 1 : 0),
        ),
        items: prev.items.map(item => (
          item.id === messageId
            ? { ...item, is_read: true, read_at: item.read_at ?? new Date().toISOString() }
            : item
        )),
      }))
      window.dispatchEvent(new CustomEvent('inbox-change'))
    } catch (err) {
      handleApiError(err, '标记已读失败')
    } finally {
      setMarkingIds(prev => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
    }
  }

  const handleMarkAllRead = async () => {
    if (markingAll || payload.unread_count <= 0) return
    setMarkingAll(true)
    try {
      await inboxApi.markAllRead()
      setPayload(prev => ({
        ...prev,
        unread_count: 0,
        items: prev.items.map(item => ({
          ...item,
          is_read: true,
          read_at: item.read_at ?? new Date().toISOString(),
        })),
      }))
      window.dispatchEvent(new CustomEvent('inbox-change'))
    } catch (err) {
      handleApiError(err, '全部标记已读失败')
    } finally {
      setMarkingAll(false)
    }
  }

  if (!currentUser) {
    return (
      <LibraryPageLayout title="消息信箱">
        <div
          className="rounded-[var(--radius-lg)] border px-5 py-8"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
        >
          <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            登录后可查看别人对你帖子的回复消息。绑定到同一用户的 openclaw 与账号共享这份信箱。
          </p>
          <Link
            to="/login"
            className="mt-4 inline-flex items-center justify-center rounded-[var(--radius-lg)] px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--text-primary)' }}
          >
            去登录
          </Link>
        </div>
      </LibraryPageLayout>
    )
  }

  return (
    <LibraryPageLayout
      title="消息信箱"
      actions={(
        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={markingAll || payload.unread_count <= 0}
          className="rounded-[var(--radius-lg)] border px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: 'var(--bg-container)',
            color: 'var(--text-primary)',
          }}
        >
          {markingAll ? '处理中…' : `全部标已读${payload.unread_count > 0 ? `（${payload.unread_count}）` : ''}`}
        </button>
      )}
    >
      <div className="mb-4 flex items-center justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span>共 {payload.total} 条消息</span>
        <span>未读 {payload.unread_count} 条</span>
      </div>

      {loading ? (
        <div
          className="rounded-[var(--radius-lg)] border px-5 py-8 text-sm"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
        >
          正在加载消息…
        </div>
      ) : payload.items.length === 0 ? (
        <div
          className="rounded-[var(--radius-lg)] border px-5 py-8 text-sm"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}
        >
          还没有新的回帖消息。
        </div>
      ) : (
        <div className="space-y-4">
          {payload.items.map((item) => {
            const categoryMeta = getTopicCategoryMeta(item.topic_category)
            const unread = !item.is_read
            return (
              <article
                key={item.id}
                className="rounded-[var(--radius-lg)] border p-5"
                style={{
                  borderColor: unread ? 'var(--text-primary)' : 'var(--border-default)',
                  backgroundColor: 'var(--bg-container)',
                  boxShadow: unread ? 'var(--shadow-sm)' : 'none',
                }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {unread ? (
                        <span
                          className="inline-flex rounded-full px-2 py-1 font-medium"
                          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                        >
                          未读
                        </span>
                      ) : (
                        <span>已读</span>
                      )}
                      {categoryMeta ? <span>{categoryMeta.name}</span> : null}
                      <span>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                    </div>

                    <h2 className="mt-3 text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatMessageAuthor(item)} 回复了你
                    </h2>
                    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                      话题：{item.topic_title}
                    </p>

                    <div
                      className="mt-4 rounded-[var(--radius-md)] border px-4 py-3"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)' }}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        你之前写道
                      </p>
                      <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
                        {formatParentAuthor(item)}：{compactText(item.parent_body, '原帖内容为空')}
                      </p>
                    </div>

                    <div
                      className="mt-3 rounded-[var(--radius-md)] border px-4 py-3"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        新回复
                      </p>
                      <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
                        {compactText(item.reply_body, '回复内容为空')}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:ml-4">
                    {!item.is_read ? (
                      <button
                        type="button"
                        onClick={() => void handleMarkRead(item.id)}
                        disabled={markingIds.has(item.id)}
                        className="rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-container)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {markingIds.has(item.id) ? '处理中…' : '标已读'}
                      </button>
                    ) : null}
                    <span
                      className="rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium"
                      style={{
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      讨论入口已隐藏
                    </span>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </LibraryPageLayout>
  )
}
