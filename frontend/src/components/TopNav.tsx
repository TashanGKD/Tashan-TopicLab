import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'

const navLinks = [
  { to: '/', label: '话题列表', match: (path: string) => path === '/' && !path.startsWith('/topics') && !path.startsWith('/source-feed') && !path.startsWith('/library') && !path.startsWith('/profile-helper') && !path.startsWith('/agent-links') },
  { to: '/source-feed', label: '信源', match: (path: string) => path.startsWith('/source-feed') },
  { to: '/apps', label: '应用', match: (path: string) => path.startsWith('/apps') },
  { to: '/library', label: '库', match: (path: string) => path.startsWith('/library') || path.startsWith('/experts') || path.startsWith('/skills') || path.startsWith('/mcp') || path.startsWith('/moderator-modes') },
] as const

const mobileTabs = [
  {
    to: '/',
    label: '话题',
    match: (path: string) => path === '/' || path.startsWith('/topics'),
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 8h10M7 12h10M7 16h6" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5.5 4.75h13A1.75 1.75 0 0120.25 6.5v11A1.75 1.75 0 0118.5 19.25h-13A1.75 1.75 0 013.75 17.5v-11A1.75 1.75 0 015.5 4.75z" />
      </svg>
    ),
  },
  {
    to: '/source-feed',
    label: '信源',
    match: (path: string) => path.startsWith('/source-feed'),
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5.75 6.5A1.75 1.75 0 017.5 4.75h8.25A1.75 1.75 0 0117.5 6.5v11.25A1.5 1.5 0 0019 19.25h-10.5A2.75 2.75 0 015.75 16.5v-10z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.5 8.25h6M8.5 11.5h6M8.5 14.75h3.25" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 19.25a1.5 1.5 0 001.5-1.5V9.5h-3" />
      </svg>
    ),
  },
  {
    to: '/me',
    label: '我的',
    match: (path: string) =>
      path.startsWith('/me') ||
      path.startsWith('/apps') ||
      path.startsWith('/profile-helper') ||
      path.startsWith('/favorites') ||
      path.startsWith('/library') ||
      path.startsWith('/experts') ||
      path.startsWith('/skills') ||
      path.startsWith('/mcp') ||
      path.startsWith('/moderator-modes'),
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 12a3.25 3.25 0 100-6.5 3.25 3.25 0 000 6.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 19.25a7 7 0 0114 0" />
      </svg>
    ),
  },
] as const

export default function TopNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [adminMode, setAdminMode] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [userMenuPosition, setUserMenuPosition] = useState({ top: 0, left: 0 })
  const [scrolled, setScrolled] = useState(false)
  const userMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  // 滚动监听 - 实现磨砂效果
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const loadUser = useCallback(async () => {
    const token = tokenManager.get()
    if (token) {
      const latestUser = await refreshCurrentUserProfile()
      if (latestUser) {
        setUser(latestUser)
        setAdminMode(Boolean(latestUser.is_admin))
        return
      }
    }
    const savedUser = tokenManager.getUser()
    if (savedUser && token) {
      setUser(savedUser)
      setAdminMode(Boolean(savedUser.is_admin))
    } else {
      setUser(null)
      setAdminMode(false)
    }
  }, [])

  useEffect(() => {
    void loadUser()
  }, [location.pathname, loadUser])

  useEffect(() => {
    const handleStorageChange = () => { void loadUser() }
    const handleAuthChange = () => { void loadUser() }
    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('auth-change', handleAuthChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('auth-change', handleAuthChange)
    }
  }, [loadUser])

  const updateUserMenuPosition = useCallback(() => {
    const trigger = userMenuTriggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setUserMenuPosition({
      top: rect.bottom + 8,
      left: rect.right,
    })
  }, [])

  useEffect(() => {
    setUserMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!userMenuOpen) return
    updateUserMenuPosition()

    const handleWindowChange = () => updateUserMenuPosition()
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        userMenuRef.current?.contains(target) ||
        userMenuTriggerRef.current?.contains(target)
      ) {
        return
      }
      setUserMenuOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false)
      }
    }

    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [userMenuOpen, updateUserMenuPosition])

  const handleLogout = () => {
    tokenManager.remove()
    tokenManager.clearUser()
    setUser(null)
    setUserMenuOpen(false)
    window.dispatchEvent(new CustomEvent('auth-change'))
    navigate('/')
  }

  const hideNav = location.pathname === '/login' || location.pathname === '/register'
  const activeMobileTabIndex = Math.max(0, mobileTabs.findIndex((tab) => tab.match(location.pathname)))

  if (hideNav) {
    return null
  }

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 w-full safe-area-inset-top overflow-x-hidden transition-all duration-300 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-xl shadow-[0_2px_8px_rgba(15,46,79,0.08)] border-b border-[var(--color-gray-light)]'
            : 'bg-white border-b border-[var(--color-gray-light)]'
        }`}
      >
        {adminMode && location.pathname === '/' ? (
          <div className="w-full bg-red-600 px-4 py-2 text-center text-xs font-medium tracking-[0.18em] text-white">
            ADMIN MODE
          </div>
        ) : null}
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 min-w-0">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink overflow-hidden">
            <img
              src="/media/logo_complete.svg"
              alt="他山"
              className="h-8 sm:h-9 w-auto shrink-0"
            />
            <span
              className="font-sans font-semibold text-base sm:text-lg tracking-[0.2em] sm:tracking-[0.3em]"
              style={{ color: 'var(--color-dark)' }}
            >
              · 世 界
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6 lg:gap-8">
            {navLinks.map(({ to, label, match }) => (
              <Link
                key={to}
                to={to}
                className="relative text-sm font-serif transition-all py-2 group"
                style={{
                  color: match(location.pathname) ? 'var(--color-dark)' : 'var(--color-gray)',
                }}
              >
                <span className={match(location.pathname) ? 'font-medium' : ''}>{label}</span>
                <span
                  className={`absolute bottom-0 left-0 h-0.5 transition-all duration-300 ${
                    match(location.pathname) ? 'w-full' : 'w-0 group-hover:w-full'
                  }`}
                  style={{
                    background: 'var(--color-dark)',
                  }}
                />
              </Link>
            ))}
            <Link
              to="/profile-helper"
              className="relative text-sm font-serif font-medium transition-all whitespace-nowrap py-2 group"
              style={{
                color: location.pathname.startsWith('/profile-helper') ? 'var(--color-dark)' : 'var(--color-gray)',
              }}
            >
              科研数字分身
              <span
                className={`absolute bottom-0 left-0 h-0.5 transition-all duration-300 ${
                  location.pathname.startsWith('/profile-helper') ? 'w-full' : 'w-0 group-hover:w-full'
                }`}
                style={{
                  background: 'var(--color-dark)',
                }}
              />
            </Link>
            <Link
              to="/topics/new"
              className="text-white px-4 py-1.5 rounded-[var(--radius-lg)] text-sm font-serif font-medium transition-all hover:-translate-y-0.5 whitespace-nowrap shrink-0"
              style={{
                background: 'var(--color-dark)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              + 创建话题
            </Link>

            {user ? (
              <div>
                <button
                  ref={userMenuTriggerRef}
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(v => {
                      const next = !v
                      if (next) {
                        requestAnimationFrame(updateUserMenuPosition)
                      }
                      return next
                    })
                  }}
                  className="flex items-center gap-2 text-sm font-serif transition-all hover:opacity-80"
                  style={{ color: 'var(--color-gray)' }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                    style={{ background: 'var(--color-dark)' }}
                  >
                    {(user.username || user.phone).charAt(0)}
                  </div>
                  <span className="max-w-[100px] truncate">{user.username || user.phone}</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="text-sm font-serif transition-all hover:opacity-80"
                  style={{ color: 'var(--color-gray)' }}
                >
                  登录
                </Link>
                <Link
                  to="/register"
                  className="px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-serif font-medium transition-all hover:opacity-90 whitespace-nowrap"
                  style={{
                    background: 'var(--color-gray-light)',
                    color: 'var(--color-dark)',
                  }}
                >
                  注册
                </Link>
              </div>
            )}
          </div>

          <div className="md:hidden w-10 shrink-0" aria-hidden />
        </div>
      </nav>
      {userMenuOpen &&
        createPortal(
          <div
            ref={userMenuRef}
            className="fixed bg-white rounded-[var(--radius-md)] py-1 min-w-[120px] z-[9999]"
            style={{
              top: `${userMenuPosition.top}px`,
              left: `${userMenuPosition.left}px`,
              transform: 'translateX(-100%)',
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--color-gray-light)',
            }}
          >
            <Link
              to="/favorites"
              className="block px-4 py-2 text-sm font-serif transition-all hover:bg-gray-50"
              style={{ color: 'var(--color-gray-dark)' }}
              onClick={() => setUserMenuOpen(false)}
            >
              我的收藏
            </Link>
            <Link
              to="/profile-helper"
              className="block px-4 py-2 text-sm font-serif transition-all hover:bg-gray-50"
              style={{ color: 'var(--color-gray-dark)' }}
              onClick={() => setUserMenuOpen(false)}
            >
              数字分身
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="block w-full text-left px-4 py-2 text-sm font-serif transition-all hover:bg-gray-50"
              style={{ color: 'var(--color-gray-dark)' }}
            >
              退出登录
            </button>
          </div>,
          document.body,
        )}
      <div
        className="fixed inset-x-0 z-50 px-3 md:hidden"
        style={{
          bottom: 'calc(0.85rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="mx-auto max-w-md">
          <div
            className="relative grid h-[4.25rem] grid-cols-3 items-stretch rounded-[1.7rem] border p-1"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(248,250,252,0.84) 100%)',
              borderColor: 'rgba(255, 255, 255, 0.34)',
              boxShadow: '0 18px 40px rgba(15, 23, 42, 0.12), 0 6px 18px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
              backdropFilter: 'blur(24px) saturate(1.25)',
            }}
          >
            <div
              className="absolute inset-y-1 rounded-[1.35rem] transition-all duration-300 ease-out"
              style={{
                left: `calc(0.25rem + ${activeMobileTabIndex} * ((100% - 0.5rem) / 3))`,
                width: 'calc((100% - 0.5rem) / 3)',
                background: 'linear-gradient(180deg, rgba(241,245,249,0.98) 0%, rgba(226,232,240,0.92) 100%)',
                boxShadow: '0 10px 18px rgba(148, 163, 184, 0.14), inset 0 1px 0 rgba(255,255,255,0.76)',
              }}
              aria-hidden
            />
          {mobileTabs.map((tab) => {
            const active = tab.match(location.pathname)
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className="relative z-10 grid min-w-0 place-items-center rounded-[1.25rem] px-2 text-xs font-medium transition-all duration-300 ease-out"
                style={{
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  transform: active ? 'translateY(-1px)' : 'translateY(0)',
                }}
                aria-current={active ? 'page' : undefined}
              >
                <span className="grid min-h-[2.5rem] place-items-center">
                  <span
                    className="flex h-6 items-center justify-center transition-all duration-300 ease-out"
                    style={{
                      transform: active ? 'scale(1.06)' : 'scale(1)',
                      opacity: active ? 1 : 0.76,
                    }}
                  >
                    {tab.icon}
                  </span>
                  <span
                    className="mt-1 block leading-none transition-all duration-300 ease-out"
                    style={{
                      transform: active ? 'translateY(0)' : 'translateY(1px)',
                      fontWeight: active ? 600 : 500,
                      letterSpacing: active ? '0.01em' : '0',
                    }}
                  >
                    {tab.label}
                  </span>
                </span>
              </Link>
            )
          })}
          </div>
        </div>
      </div>
      <Link
        to="/topics/new"
        className="fixed z-[34] flex h-12 w-12 items-center justify-center rounded-full border text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 active:scale-95 md:hidden"
        style={{
          right: 'max(1rem, env(safe-area-inset-right))',
          bottom: 'calc(5.9rem + env(safe-area-inset-bottom))',
          background: 'linear-gradient(180deg, rgba(51,65,85,0.68) 0%, rgba(30,41,59,0.54) 100%)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(16px) saturate(1.15)',
        }}
        aria-label="创建话题"
      >
        <span
          className="pointer-events-none absolute inset-[3px] rounded-full"
          aria-hidden
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.01) 100%)' }}
        />
        <svg className="relative h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </>
  )
}
