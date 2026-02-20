import { Link, useLocation } from 'react-router-dom'

export default function TopNav() {
  const location = useLocation()

  const isActive = (path: string) =>
    location.pathname === path || (path !== '/' && location.pathname.startsWith(path))

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-black font-serif font-bold text-base tracking-tight">Topic Lab</span>
        </Link>

        <div className="flex items-center gap-8">
          <Link
            to="/"
            className={`text-sm font-serif transition-all ${
              isActive('/') && !isActive('/topics') && !isActive('/experts') && !isActive('/skills')
                ? 'text-black font-medium'
                : 'text-gray-500 hover:text-black'
            }`}
          >
            话题列表
          </Link>
          <Link
            to="/experts"
            className={`text-sm font-serif transition-all ${
              isActive('/experts')
                ? 'text-black font-medium'
                : 'text-gray-500 hover:text-black'
            }`}
          >
            专家库
          </Link>
          <Link
            to="/skills"
            className={`text-sm font-serif transition-all ${
              isActive('/skills')
                ? 'text-black font-medium'
                : 'text-gray-500 hover:text-black'
            }`}
          >
            技能库
          </Link>
          <Link
            to="/topics/new"
            className="bg-black text-white px-4 py-1.5 text-sm font-serif font-medium transition-all hover:bg-gray-900"
          >
            + 创建话题
          </Link>
        </div>
      </div>
    </nav>
  )
}
