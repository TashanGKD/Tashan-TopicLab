import { Link, Route, Routes, useLocation } from 'react-router-dom'
import LibraryPageLayout from '../components/LibraryPageLayout'
import { ChatPage } from '../modules/profile-helper/pages/ChatPage'
import { ProfilePage } from '../modules/profile-helper/pages/ProfilePage'
import { ScalesPage } from '../modules/profile-helper/pages/ScalesPage'
import { ScaleTestPage } from '../modules/profile-helper/pages/ScaleTestPage'
import '../modules/profile-helper/profile-helper.css'

const profileHelperSections = [
  {
    id: 'chat',
    label: '对话采集',
    description: '通过对话采集科研认知与偏好信息，帮助建立您的数字分身。',
    render: () => <ChatPage />,
  },
  {
    id: 'profile',
    label: '我的分身',
    description: '查看、发布与管理您的数字分身记录。',
    render: () => <ProfilePage />,
  },
  {
    id: 'scales',
    label: '量表测试',
    description: '通过标准化量表评估科研认知风格与学术动机，可用于校对数字分身推断结果。',
    render: () => <ScalesPage />,
  },
] as const

function getActiveSection(pathname: string): (typeof profileHelperSections)[number] {
  const base = '/profile-helper'
  if (pathname === base || pathname === `${base}/`) {
    return profileHelperSections[0]
  }
  if (pathname.startsWith(`${base}/profile`)) {
    return profileHelperSections[1]
  }
  if (pathname.startsWith(`${base}/scales`)) {
    return profileHelperSections[2]
  }
  return profileHelperSections[0]
}

export default function ProfileHelperPage() {
  const location = useLocation()
  const activeSection = getActiveSection(location.pathname)
  const isChat = activeSection.id === 'chat'

  return (
    <LibraryPageLayout title="他山数字分身助手">
      <div className={`profile-helper-layout ${isChat ? 'profile-helper-layout-chat' : ''}`}>
        <div className={`flex flex-col md:flex-row md:items-start md:gap-8 ${isChat ? 'profile-helper-shell-chat' : ''}`}>
          <div className="relative md:w-[172px] md:flex-shrink-0">
            <div
              className="flex items-center gap-2 overflow-x-auto border-b px-4 py-3 md:flex-col md:items-stretch md:gap-0.5 md:border-b-0 md:px-0 md:py-0 md:sticky md:top-20 scrollbar-hide"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'transparent',
              }}
            >
              {profileHelperSections.map((item) => {
                const base = '/profile-helper'
                const to = item.id === 'chat' ? base : `${base}/${item.id}`
                const active = item.id === activeSection.id
                return (
                  <Link
                    key={item.id}
                    to={to}
                    className={`block rounded-lg px-3 py-1.5 text-sm font-serif whitespace-nowrap transition-colors md:w-full ${
                      active ? 'font-semibold' : ''
                    }`}
                    style={{
                      backgroundColor: active ? 'var(--bg-secondary)' : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
                        e.currentTarget.style.color = 'var(--text-primary)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.backgroundColor = 'transparent'
                        e.currentTarget.style.color = 'var(--text-secondary)'
                      }
                    }}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
            <div
              className="md:hidden absolute right-0 top-0 bottom-0 w-6 pointer-events-none"
              style={{ background: 'linear-gradient(to left, var(--bg-container), transparent)' }}
              aria-hidden
            />
          </div>

          <div className={`flex-1 min-w-0 pt-5 md:pt-0 ${isChat ? 'profile-helper-content-chat' : ''}`}>
            <p className={`text-sm mb-6 ${isChat ? 'profile-helper-chat-description' : ''}`} style={{ color: 'var(--text-secondary)' }}>
              {activeSection.description}
            </p>
            {isChat ? (
              <div className="profile-helper-chat-wrapper">
                <ChatPage />
              </div>
            ) : (
              <Routes>
                <Route index element={<ChatPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="scales" element={<ScalesPage />} />
                <Route path="scales/:scaleId" element={<ScaleTestPage />} />
              </Routes>
            )}
          </div>
        </div>
      </div>
    </LibraryPageLayout>
  )
}
