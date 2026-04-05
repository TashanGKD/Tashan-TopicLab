import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ResearchSkillZoneCard from '../ResearchSkillZoneCard'

function renderWithRouter(component: React.ReactElement) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('ResearchSkillZoneCard', () => {
  it('renders the card title', () => {
    renderWithRouter(<ResearchSkillZoneCard />)
    const title = screen.getByRole('heading', { name: /科研技能专区/ })
    expect(title).toBeInTheDocument()
  })

  it('renders the card label', () => {
    renderWithRouter(<ResearchSkillZoneCard />)
    const labels = screen.getAllByText('科研应用与技能')
    expect(labels.length).toBeGreaterThan(0)
  })

  it('renders the description', () => {
    renderWithRouter(<ResearchSkillZoneCard />)
    const descriptions = screen.getAllByText(/收录科研场景下的可安装应用与技能/)
    expect(descriptions.length).toBeGreaterThan(0)
  })

  it('renders the primary action link', () => {
    renderWithRouter(<ResearchSkillZoneCard />)
    const links = screen.getAllByText('进入科研技能专区')
    expect(links.length).toBeGreaterThan(0)
  })

  it('renders all research cluster badges', () => {
    renderWithRouter(<ResearchSkillZoneCard />)
    const clusters = [
      '生物与生命科学',
      '药物研发',
      '医学与临床',
      '实验室自动化',
      '视觉与 XR',
      'AI 与大模型',
      '数据科学',
      '文献检索',
    ]
    clusters.forEach((cluster) => {
      const badges = screen.getAllByText(cluster)
      expect(badges.length).toBeGreaterThan(0)
    })
  })
})
