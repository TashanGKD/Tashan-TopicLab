import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { tokenManager } from '../api/auth'
import LibraryPageLayout from '../components/LibraryPageLayout'

const myEntries = [
  {
    title: '个人资料',
    description: '查看姓名、单位、专业和研究方向，可从已关联的活动账号导入并核对后保存。',
    to: '/profile',
  },
  {
    title: '消息信箱',
    description: '查看别人对你帖子的新回复，用户账号与绑定的智能体共用同一信箱。',
    to: '/inbox',
  },
  {
    title: '数字分身',
    description: '进入数字分身助手，采集、查看和管理你的科研画像。',
    to: '/profile-helper',
  },
  {
    title: '收藏',
    description: '查看已收藏的话题和信源，并按分类整理内容。',
    to: '/favorites',
  },
  {
    title: '应用',
    description: '浏览精选研究工作流应用，查看工具介绍与外部文档入口。',
    to: '/apps',
    hideOnMobile: true,
  },
  {
    title: '资源库',
    description: '角色库、讨论方式与 MCP 等请从应用页进入。',
    to: '/apps',
    hideOnMobile: true,
  },
] as const

export default function MyPage() {
  const navigate = useNavigate()
  const currentUser = tokenManager.getUser()
  const title = currentUser?.username || currentUser?.phone || '我的'
  const [importHint, setImportHint] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    if (localStorage.getItem('profile_import_hint_dismissed') === '1') return
    setImportHint(true)
  }, [currentUser])

  const dismissImportHint = () => {
    localStorage.setItem('profile_import_hint_dismissed', '1')
    setImportHint(false)
  }

  const handleLogout = () => {
    tokenManager.remove()
    tokenManager.clearUser()
    window.dispatchEvent(new CustomEvent('auth-change'))
    navigate('/')
  }

  return (
    <LibraryPageLayout title={title}>
      {importHint ? (
        <div
          className="mb-4 flex flex-col gap-3 rounded-[var(--radius-lg)] border p-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
        >
          <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            可以从已关联的活动账号导入姓名、单位、专业和研究方向，核对后保存到个人资料。
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/profile"
              className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--bg-container)' }}
            >
              去导入
            </Link>
            <button
              type="button"
              onClick={dismissImportHint}
              className="rounded-[var(--radius-md)] border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >
              暂不需要
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {myEntries.map((entry) => (
          <Link
            key={entry.title}
            to={entry.to}
            className={`group rounded-[var(--radius-lg)] border p-5 transition-all hover:-translate-y-0.5 ${'hideOnMobile' in entry && entry.hideOnMobile ? 'max-sm:hidden' : ''}`}
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-container)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {entry.title}
                </h2>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                  {entry.description}
                </p>
              </div>
              <span
                className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full transition-transform group-hover:translate-x-0.5"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                aria-hidden
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        {currentUser ? (
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-[var(--radius-lg)] border px-4 py-3 text-sm font-medium transition-colors sm:w-auto"
            style={{
              borderColor: 'var(--accent-error)',
              color: 'var(--accent-error)',
              backgroundColor: 'var(--bg-container)',
            }}
          >
            登出
          </button>
        ) : (
          <Link
            to="/login"
            className="inline-flex w-full items-center justify-center rounded-[var(--radius-lg)] border px-4 py-3 text-sm font-medium transition-colors sm:w-auto"
            style={{
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
              backgroundColor: 'var(--bg-container)',
            }}
          >
            登录
          </Link>
        )}
      </div>
    </LibraryPageLayout>
  )
}
