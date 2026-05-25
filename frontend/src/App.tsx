import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import TopNav from './components/TopNav'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import ExpertEdit from './pages/ExpertEdit'
import ProfileHelperPage from './pages/ProfileHelperPage'
import AgentLinkLibraryPage from './pages/AgentLinkLibraryPage'
import AgentLinkChatPage from './pages/AgentLinkChatPage'
import SourceFeedPage from './pages/SourceFeedPage'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import WatchaAuthCallback from './pages/WatchaAuthCallback'
import LibraryPage from './pages/LibraryPage'
import MyFavoritesPage from './pages/MyFavoritesPage'
import MyPage from './pages/MyPage'
import InboxPage from './pages/InboxPage'
import AppsPage from './pages/AppsPage'
import AppsSkillLibraryPage from './pages/AppsSkillLibraryPage'
import AppsSkillDetailPage from './pages/AppsSkillDetailPage'
import AppsSkillLeaderboardPage from './pages/AppsSkillLeaderboardPage'
import AppsSkillProfilePage from './pages/AppsSkillProfilePage'
import AppsSkillPublishPage from './pages/AppsSkillPublishPage'
import AppsSkillSearchPage from './pages/AppsSkillSearchPage'
import AppsSkillSharePage from './pages/AppsSkillSharePage'
import AppsSkillWishesPage from './pages/AppsSkillWishesPage'
import ArcadePage from './pages/ArcadePage'
import TopicDetail from './pages/TopicDetail'
import TopicLinkPage from './pages/TopicLinkPage'
import TopicLinkDetailPage from './pages/TopicLinkDetailPage'
import ThinkingPage from './pages/ThinkingPage'
import YouthTedPage from './pages/YouthTedPage'
import InspirationCoCreationPage from './pages/InspirationCoCreationPage'
import InspirationAdminNeedsPage from './pages/InspirationAdminNeedsPage'
import InspirationSubmitPage from './pages/InspirationSubmitPage'
import InspirationNeedDetailPage from './pages/InspirationNeedDetailPage'
import WechatGroupQrPage from './pages/WechatGroupQrPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import AppErrorBoundary from './components/AppErrorBoundary'
import FloatingActions from './components/FloatingActions'
import { shouldHideGlobalChrome } from './utils/layoutChrome'

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
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/info" element={<Navigate to="/info/source" replace />} />
            <Route path="/info/:section" element={<SourceFeedPage />} />
            <Route path="/source-feed" element={<Navigate to="/info/source" replace />} />
            <Route path="/source-feed/:section" element={<SourceFeedPage />} />
            <Route path="/youth-ted" element={<YouthTedPage />} />
            <Route path="/inspiration-co-creation" element={<InspirationCoCreationPage />} />
            <Route path="/inspiration-co-creation/admin/needs" element={<InspirationAdminNeedsPage />} />
            <Route path="/inspiration-co-creation/submit" element={<InspirationSubmitPage />} />
            <Route path="/inspiration-co-creation/needs/:slug" element={<InspirationNeedDetailPage />} />
            <Route path="/wechat-group-qr" element={<Navigate to="/qr/lggc-wechat-group" replace />} />
            <Route
              path="/qr/world-wechat-group"
              element={<WechatGroupQrPage assetKey="wechat-group-qr" title="他山世界交流群二维码" />}
            />
            <Route
              path="/qr/lggc-wechat-group"
              element={<WechatGroupQrPage assetKey="lggc-wechat-group" title="灵感共创队群聊二维码" />}
            />
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
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/apps/skills" element={<AppsSkillLibraryPage />} />
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
            <Route path="/skills" element={<Navigate to="/apps/skills" replace />} />
            <Route path="/mcp" element={<Navigate to="/library/mcp" replace />} />
            <Route path="/moderator-modes" element={<Navigate to="/library/moderator-modes" replace />} />
            <Route path="/profile-helper/*" element={<ProfileHelperPage />} />
            <Route path="/agent-links" element={<AgentLinkLibraryPage />} />
            <Route path="/agent-links/:slug" element={<AgentLinkChatPage />} />
          </Routes>
        </main>
        {isAdminRoute || hideGlobalChrome || isTopicLinkRoute ? null : <Footer />}
        {isAdminRoute || hideGlobalChrome ? null : <FloatingActions />}
      </div>
    </AppErrorBoundary>
  )
}

export default App
