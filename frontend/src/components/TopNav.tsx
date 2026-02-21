import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const navLinks = [
  { to: '/', label: '话题列表', match: (path: string) => path === '/' && !path.startsWith('/topics') && !path.startsWith('/experts') && !path.startsWith('/skills') && !path.startsWith('/mcp') && !path.startsWith('/moderator-modes') },
  { to: '/moderator-modes', label: '讨论方式库', match: (path: string) => path.startsWith('/moderator-modes') },
  { to: '/experts', label: '角色库', match: (path: string) => path.startsWith('/experts') },
  { to: '/skills', label: '技能库', match: (path: string) => path.startsWith('/skills') },
  { to: '/mcp', label: 'MCP 库', match: (path: string) => path.startsWith('/mcp') },
] as const

export default function TopNav() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const linkClass = (isActive: boolean) =>
    `text-sm font-serif transition-all block py-2 ${
      isActive ? 'text-black font-medium' : 'text-gray-500 hover:text-black'
    }`

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 safe-area-inset-top">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
          <span className="text-black font-serif font-bold text-base tracking-tight">Topic Lab</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 lg:gap-8">
          {navLinks.map(({ to, label, match }) => (
            <Link
              key={to}
              to={to}
              className={linkClass(match(location.pathname)).replace(' block py-2', '')}
            >
              {label}
            </Link>
          ))}
          <Link
            to="/topics/new"
            className="bg-black text-white px-4 py-1.5 rounded-lg text-sm font-serif font-medium transition-all hover:bg-gray-900 whitespace-nowrap"
          >
            + 创建话题
          </Link>
        </div>

        {/* Mobile: hamburger + create button */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            to="/topics/new"
            className="bg-black text-white px-3 py-1.5 rounded-lg text-sm font-serif font-medium"
            onClick={() => setMobileMenuOpen(false)}
          >
            + 创建
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(v => !v)}
            className="p-2 -mr-2 rounded-lg text-gray-600 hover:text-black hover:bg-gray-100 touch-manipulation"
            aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileMenuOpen}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white">
          <div className="px-4 py-3 space-y-0">
            {navLinks.map(({ to, label, match }) => (
              <Link
                key={to}
                to={to}
                className={linkClass(match(location.pathname))}
                onClick={() => setMobileMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
