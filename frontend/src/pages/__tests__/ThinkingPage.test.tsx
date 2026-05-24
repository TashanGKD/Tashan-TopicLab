import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import ThinkingPage from '../ThinkingPage'

describe('ThinkingPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('explains the Tashan World 2.0 thinking page', () => {
    render(
      <MemoryRouter>
        <ThinkingPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '他山世界 2.0' })).toBeInTheDocument()
    expect(screen.queryByText('打破学科壁垒，扩展认知边界')).not.toBeInTheDocument()
    expect(screen.getByText('让科研成为所有有好奇心的人共同拥有的权利。')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '他山世界' })).toHaveAttribute('src', '/media/logo_horizontal.webp')
    expect(screen.queryByText('信息：世界脉络系统')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: '世界脉络系统' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('heading', { name: 'skills + 迭代沉淀' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('heading', { name: '增强数字分身' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /灵感共创/ })).toHaveAttribute('href', '/inspiration-co-creation')
    expect(screen.getByRole('link', { name: /他山青年 TED/ })).toHaveAttribute('href', '/youth-ted')
    expect(screen.getByRole('link', { name: /世界脉络/ })).toHaveAttribute('href', '/info/source')
    expect(screen.getByRole('link', { name: /TopicLink/ })).toHaveAttribute('href', '/topiclink')
    expect(screen.getByRole('link', { name: /Arcade/ })).toHaveAttribute('href', '/arcade')
    expect(screen.getByRole('link', { name: /数字分身/ })).toHaveAttribute('href', '/profile-helper')
    expect(screen.getByRole('heading', { name: 'backend / Resonnet' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'worldweave' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ClawArcade' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
  })
})
