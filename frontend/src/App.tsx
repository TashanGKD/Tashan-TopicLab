import { Routes, Route, Navigate } from 'react-router-dom'
import TopNav from './components/TopNav'
import Footer from './components/Footer'
import TopicList from './pages/TopicList'
import CreateTopic from './pages/CreateTopic'
import TopicDetail from './pages/TopicDetail'
import ExpertEdit from './pages/ExpertEdit'
import ProfileHelperPage from './pages/ProfileHelperPage'
import AgentLinkLibraryPage from './pages/AgentLinkLibraryPage'
import AgentLinkChatPage from './pages/AgentLinkChatPage'
import SourceFeedPage from './pages/SourceFeedPage'
import Login from './pages/Login'
import Register from './pages/Register'
import LibraryPage from './pages/LibraryPage'
import MyFavoritesPage from './pages/MyFavoritesPage'
import MyPage from './pages/MyPage'
import AppsPage from './pages/AppsPage'
import AppErrorBoundary from './components/AppErrorBoundary'
import FeedbackBubble from './components/FeedbackBubble'

function App() {
  return (
    <AppErrorBoundary>
      <div className="flex flex-col min-h-screen">
        <TopNav />
        <main className="flex-1 pt-14 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-[env(safe-area-inset-bottom)]">
          <Routes>
            <Route path="/" element={<TopicList />} />
            <Route path="/source-feed" element={<Navigate to="/source-feed/source" replace />} />
            <Route path="/source-feed/:section" element={<SourceFeedPage />} />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/me" element={<MyPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/favorites" element={<MyFavoritesPage />} />
            <Route path="/topics/new" element={<CreateTopic />} />
            <Route path="/topics/:id" element={<TopicDetail />} />
            <Route path="/library" element={<Navigate to="/library/experts" replace />} />
            <Route path="/library/:section" element={<LibraryPage />} />
            <Route path="/experts" element={<Navigate to="/library/experts" replace />} />
            <Route path="/experts/:name/edit" element={<ExpertEdit />} />
            <Route path="/skills" element={<Navigate to="/library/skills" replace />} />
            <Route path="/mcp" element={<Navigate to="/library/mcp" replace />} />
            <Route path="/moderator-modes" element={<Navigate to="/library/moderator-modes" replace />} />
            <Route path="/profile-helper/*" element={<ProfileHelperPage />} />
            <Route path="/agent-links" element={<AgentLinkLibraryPage />} />
            <Route path="/agent-links/:slug" element={<AgentLinkChatPage />} />
          </Routes>
        </main>
        <Footer />
        <FeedbackBubble />
      </div>
    </AppErrorBoundary>
  )
}

export default App
