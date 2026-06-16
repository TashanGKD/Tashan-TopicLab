import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App'

vi.mock('../components/TopNav', () => ({ default: () => <div data-testid="top-nav" /> }))
vi.mock('../components/Footer', () => ({ default: () => <div data-testid="footer" /> }))
vi.mock('../components/FloatingActions', () => ({ default: () => <div data-testid="floating-actions" /> }))
vi.mock('../pages/HomePage', () => ({ default: () => <div>Home Route</div> }))
vi.mock('../pages/TopicDetail', () => ({ default: () => <div>Topic Detail Route</div> }))
vi.mock('../pages/TopicLinkPage', () => ({ default: () => <div>TopicLink Route</div> }))
vi.mock('../pages/TopicLinkDetailPage', () => ({ default: () => <div>TopicLink Detail Route</div> }))
vi.mock('../pages/ArcadePage', () => ({ default: () => <div>Arcade Route</div> }))
vi.mock('../pages/ActivitiesPage', () => ({ default: () => <div>Activities Route</div> }))
vi.mock('../pages/YouthTedPage', () => ({ default: () => <div>Youth TED Route</div> }))
vi.mock('../pages/ChallengeCupTopicPage', () => ({ default: () => <div>Challenge Cup Topic Route</div> }))
vi.mock('../pages/InspirationCoCreationPage', () => ({ default: () => <div>Inspiration Co Creation Route</div> }))
vi.mock('../pages/ExpertEdit', () => ({ default: () => <div /> }))
vi.mock('../pages/ProfileHelperPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AgentLinkLibraryPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AgentLinkChatPage', () => ({ default: () => <div /> }))
vi.mock('../pages/SourceFeedPage', () => ({ default: () => <div /> }))
vi.mock('../pages/Login', () => ({ default: () => <div /> }))
vi.mock('../pages/Register', () => ({ default: () => <div /> }))
vi.mock('../pages/ForgotPassword', () => ({ default: () => <div /> }))
vi.mock('../pages/WatchaAuthCallback', () => ({ default: () => <div /> }))
vi.mock('../pages/LibraryPage', () => ({ default: () => <div /> }))
vi.mock('../pages/MyFavoritesPage', () => ({ default: () => <div /> }))
vi.mock('../pages/MyPage', () => ({ default: () => <div /> }))
vi.mock('../pages/InboxPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillLibraryPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillDetailPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillLeaderboardPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillProfilePage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillPublishPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillSearchPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillSharePage', () => ({ default: () => <div /> }))
vi.mock('../pages/AppsSkillWishesPage', () => ({ default: () => <div /> }))
vi.mock('../pages/ThinkingPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AdminLoginPage', () => ({ default: () => <div /> }))
vi.mock('../pages/AdminDashboardPage', () => ({ default: () => <div /> }))

describe('App arcade topic route', () => {
  afterEach(() => {
    cleanup()
  })

  it('allows arcade-only topic detail routes', () => {
    render(
      <MemoryRouter initialEntries={['/arcade/topics/arcade-topic-1']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Topic Detail Route')).toBeInTheDocument()
  })

  it('keeps the general topics route hidden', () => {
    render(
      <MemoryRouter initialEntries={['/topics/arcade-topic-1']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Home Route')).toBeInTheDocument()
    expect(screen.queryByText('Topic Detail Route')).not.toBeInTheDocument()
  })

  it('exposes TopicLink as a separate route', () => {
    render(
      <MemoryRouter initialEntries={['/topiclink']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('TopicLink Route')).toBeInTheDocument()
    expect(screen.queryByText('Home Route')).not.toBeInTheDocument()
  })

  it('routes TopicLink detail without enabling the hidden topics detail route', () => {
    render(
      <MemoryRouter initialEntries={['/topiclink/topic-1']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('TopicLink Detail Route')).toBeInTheDocument()
    expect(screen.queryByText('Topic Detail Route')).not.toBeInTheDocument()
  })

  it('routes the youth TED page', () => {
    render(
      <MemoryRouter initialEntries={['/youth-ted']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Youth TED Route')).toBeInTheDocument()
  })

  it('routes the activities page', () => {
    render(
      <MemoryRouter initialEntries={['/activities']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Activities Route')).toBeInTheDocument()
  })

  it('routes the Challenge Cup topic page with global chrome', () => {
    render(
      <MemoryRouter initialEntries={['/challenge-cup-topic']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Challenge Cup Topic Route')).toBeInTheDocument()
    expect(screen.getByTestId('top-nav')).toBeInTheDocument()
    expect(screen.getByTestId('footer')).toBeInTheDocument()
    expect(screen.getByTestId('floating-actions')).toBeInTheDocument()
  })

  it('routes the inspiration co-creation page', () => {
    render(
      <MemoryRouter initialEntries={['/inspiration-co-creation']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Inspiration Co Creation Route')).toBeInTheDocument()
  })
})
