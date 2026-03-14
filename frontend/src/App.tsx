import { Routes, Route, Navigate } from 'react-router-dom'
import TopNav from './components/TopNav'
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

function App() {
  return (
    <>
      <TopNav />
      <main className="pt-14 pb-[env(safe-area-inset-bottom)] min-h-screen">
        <Routes>
          <Route path="/" element={<TopicList />} />
          <Route path="/source-feed" element={<SourceFeedPage />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
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
    </>
  )
}

export default App
