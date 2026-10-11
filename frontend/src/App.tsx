import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import TopNav from './components/TopNav'
import Footer from './components/Footer'
import AppErrorBoundary from './components/AppErrorBoundary'
import FloatingActions from './components/FloatingActions'
import { shouldHideGlobalChrome } from './utils/layoutChrome'

const HomePage = lazy(() => import('./pages/HomePage'))
const ExpertEdit = lazy(() => import('./pages/ExpertEdit'))
const ProfileHelperPage = lazy(() => import('./pages/ProfileHelperPage'))
const AgentLinkLibraryPage = lazy(() => import('./pages/AgentLinkLibraryPage'))
const AgentLinkChatPage = lazy(() => import('./pages/AgentLinkChatPage'))
const SourceFeedPage = lazy(() => import('./pages/SourceFeedPage'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const WatchaAuthCallback = lazy(() => import('./pages/WatchaAuthCallback'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const MyFavoritesPage = lazy(() => import('./pages/MyFavoritesPage'))
const MyPage = lazy(() => import('./pages/MyPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const AppsPage = lazy(() => import('./pages/AppsPage'))
const AppsSkillLibraryPage = lazy(() => import('./pages/AppsSkillLibraryPage'))
const AppsSkillDetailPage = lazy(() => import('./pages/AppsSkillDetailPage'))
const AppsSkillLeaderboardPage = lazy(() => import('./pages/AppsSkillLeaderboardPage'))
const AppsSkillProfilePage = lazy(() => import('./pages/AppsSkillProfilePage'))
const AppsSkillPublishPage = lazy(() => import('./pages/AppsSkillPublishPage'))
const AppsSkillSearchPage = lazy(() => import('./pages/AppsSkillSearchPage'))
const AppsSkillSharePage = lazy(() => import('./pages/AppsSkillSharePage'))
const AppsSkillWishesPage = lazy(() => import('./pages/AppsSkillWishesPage'))
const MCPHubPage = lazy(() => import('./pages/MCPHubPage'))
const MCPHubDetailPage = lazy(() => import('./pages/MCPHubDetailPage'))
const MCPHubLeaderboardPage = lazy(() => import('./pages/MCPHubLeaderboardPage'))
const MCPHubWishesPage = lazy(() => import('./pages/MCPHubWishesPage'))
const MCPHubProfilePage = lazy(() => import('./pages/MCPHubProfilePage'))
const MCPHubPublishPage = lazy(() => import('./pages/MCPHubPublishPage'))
const MCPHubSharePage = lazy(() => import('./pages/MCPHubSharePage'))
const ArcadePage = lazy(() => import('./pages/ArcadePage'))
const TopicDetail = lazy(() => import('./pages/TopicDetail'))
const TopicLinkPage = lazy(() => import('./pages/TopicLinkPage'))
const TopicLinkDetailPage = lazy(() => import('./pages/TopicLinkDetailPage'))
const ThinkingPage = lazy(() => import('./pages/ThinkingPage'))
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage'))
const YouthTedPage = lazy(() => import('./pages/YouthTedPage'))
const ChallengeCupTopicPage = lazy(() => import('./pages/ChallengeCupTopicPage'))
const InspirationCoCreationPage = lazy(() => import('./pages/InspirationCoCreationPage'))
const InspirationAdminNeedsPage = lazy(() => import('./pages/InspirationAdminNeedsPage'))
const InspirationSubmitPage = lazy(() => import('./pages/InspirationSubmitPage'))
const InspirationNeedDetailPage = lazy(() => import('./pages/InspirationNeedDetailPage'))
const WechatGroupQrPage = lazy(() => import('./pages/WechatGroupQrPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))

const routeFallback = (
  <div className="mx-auto w-full max-w-6xl px-4 py-10" role="status">
    <p className="text-sm text-slate-500">正在打开页面…</p>
  </div>
)

function App() {
  const location = useLocation()
  const isAdminRoute = location.pathname.startsWith('/admin')
  const hideGlobalChrome = !isAdminRoute && shouldHideGlobalChrome(location.pathname)
  const isHomeRoute = location.pathname === '/'
  const isTopicLinkRoute = location.pathname === '/topiclink' || location.pathname.startsWith('/topiclink/')

  return (
    <AppErrorBoundary>
      <div className="flex flex-col min-h-screen">
        {isAdminRoute || hideGlobalChrome ? null : <TopNav />}
        <main
          className={`flex-1 ${
            isAdminRoute || hideGlobalChrome
              ? ''
              : isHomeRoute
                ? 'pt-14 pb-[env(safe-area-inset-bottom)] md:pb-[env(safe-area-inset-bottom)]'
                : 'pt-14 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-[env(safe-area-inset-bottom)]'
          }`}
        >
          <Suspense fallback={routeFallback}>
            <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin/qr" element={<WechatGroupQrPage adminMode />} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/info" element={<Navigate to="/info/source" replace />} />
            <Route path="/info/:section" element={<SourceFeedPage />} />
            <Route path="/source-feed" element={<Navigate to="/info/source" replace />} />
            <Route path="/source-feed/:section" element={<SourceFeedPage />} />
            <Route path="/activities" element={<ActivitiesPage />} />
            <Route path="/youth-ted" element={<YouthTedPage />} />
            <Route path="/challenge-cup-topic" element={<ChallengeCupTopicPage />} />
            <Route path="/inspiration-co-creation" element={<InspirationCoCreationPage />} />
            <Route path="/inspiration-co-creation/admin/needs" element={<InspirationAdminNeedsPage />} />
            <Route path="/inspiration-co-creation/submit" element={<InspirationSubmitPage />} />
            <Route path="/inspiration-co-creation/needs/:slug" element={<InspirationNeedDetailPage />} />
            <Route path="/wechat-group-qr" element={<Navigate to="/qr/lggc-wechat-group" replace />} />
            <Route path="/qr/:slug" element={<WechatGroupQrPage />} />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/auth/watcha/callback" element={<WatchaAuthCallback />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/me" element={<MyPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/arcade" element={<ArcadePage />} />
            <Route path="/arcade/topics/:id" element={<TopicDetail />} />
            <Route path="/topiclink" element={<TopicLinkPage />} />
            <Route path="/topiclink/:id" element={<TopicLinkDetailPage />} />
            <Route path="/skillhub" element={<AppsSkillLibraryPage />} />
            <Route path="/mcphub" element={<MCPHubPage />} />
            <Route path="/mcphub/leaderboard" element={<MCPHubLeaderboardPage />} />
            <Route path="/mcphub/wishes" element={<MCPHubWishesPage />} />
            <Route path="/mcphub/profile" element={<MCPHubProfilePage />} />
            <Route path="/mcphub/publish" element={<MCPHubPublishPage />} />
            <Route path="/mcphub/share" element={<MCPHubSharePage />} />
            <Route path="/mcphub/:mcpId" element={<MCPHubDetailPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/apps/skills" element={<Navigate to="/skillhub" replace />} />
            <Route path="/apps/skills/search" element={<AppsSkillSearchPage />} />
            <Route path="/apps/skills/leaderboard" element={<AppsSkillLeaderboardPage />} />
            <Route path="/apps/skills/share" element={<AppsSkillSharePage />} />
            <Route path="/apps/skills/wishes" element={<AppsSkillWishesPage />} />
            <Route path="/apps/skills/profile" element={<AppsSkillProfilePage />} />
            <Route path="/apps/skills/publish" element={<AppsSkillPublishPage />} />
            <Route path="/apps/skills/:slug" element={<AppsSkillDetailPage />} />
            <Route path="/thinking" element={<ThinkingPage />} />
            <Route path="/favorites" element={<MyFavoritesPage />} />
            <Route path="/topics/*" element={<Navigate to="/" replace />} />
            <Route path="/library" element={<Navigate to="/library/experts" replace />} />
            <Route path="/library/:section" element={<LibraryPage />} />
            <Route path="/experts" element={<Navigate to="/library/experts" replace />} />
            <Route path="/experts/:name/edit" element={<ExpertEdit />} />
            <Route path="/skills" element={<Navigate to="/skillhub" replace />} />
            <Route path="/mcp" element={<Navigate to="/library/mcp" replace />} />
            <Route path="/moderator-modes" element={<Navigate to="/library/moderator-modes" replace />} />
            <Route path="/profile-helper/*" element={<ProfileHelperPage />} />
            <Route path="/agent-links" element={<AgentLinkLibraryPage />} />
            <Route path="/agent-links/:slug" element={<AgentLinkChatPage />} />
            </Routes>
          </Suspense>
        </main>
        {isAdminRoute || hideGlobalChrome || isTopicLinkRoute ? null : <Footer />}
        {isAdminRoute || hideGlobalChrome ? null : <FloatingActions />}
      </div>
    </AppErrorBoundary>
  )
}

export default App
