import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpHubApi } from '../../api/client'
import MCPHubProfilePage from '../MCPHubProfilePage'

vi.mock('../../api/client', () => ({
  mcpHubApi: {
    getProfile: vi.fn(),
    listTasks: vi.fn(),
    createCollection: vi.fn(),
  },
}))

const mockedGetProfile = vi.mocked(mcpHubApi.getProfile)
const mockedListTasks = vi.mocked(mcpHubApi.listTasks)
const mockedCreateCollection = vi.mocked(mcpHubApi.createCollection)

afterEach(cleanup)

describe('MCPHubProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetProfile.mockResolvedValue({
      data: {
        user_id: 7,
        favorites: [{ mcp_id: 'protein-mcp', created_at: '2026-08-05T00:00:00Z' }],
        reviews: [{ id: 1, mcp_id: 'protein-mcp', rating: 5, content: '证据清晰。', pros: [], cons: [], dimensions: {}, helpful_count: 0, author: {}, created_at: '2026-08-05T00:00:00Z' }],
        wishes: [{ id: 2, title: '结构生物学工具', content: '希望补齐蛋白结构动作。', status: 'open', votes_count: 0, author: {}, created_at: '2026-08-05T00:00:00Z' }],
        submissions: [{ id: 3, name: '候选 MCP', summary: '候选摘要', canonical_url: 'https://example.com', status: 'needs_review' }],
        collections: [],
        stats: { favorites: 1, reviews: 1, wishes: 1, submissions: 1, collections: 0 },
      },
    } as any)
    mockedListTasks.mockResolvedValue({ data: { tasks: [] } } as any)
    mockedCreateCollection.mockResolvedValue({
      data: { id: 9, slug: 'protein-tools', title: '蛋白工具', description: '结构研究工具', visibility: 'private', items: [], created_at: '', updated_at: '' },
    } as any)
  })

  it('renders community records and creates a collection without changing catalog data', async () => {
    render(<MemoryRouter><MCPHubProfilePage /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('我的集合')).toBeInTheDocument())
    expect(screen.getByText('我的评议')).toBeInTheDocument()
    expect(screen.getByText('证据清晰。')).toBeInTheDocument()
    expect(screen.getByText('结构生物学工具')).toBeInTheDocument()
    expect(screen.getByText('候选 MCP')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('集合名称'), { target: { value: '蛋白工具' } })
    fireEvent.change(screen.getByLabelText('集合说明'), { target: { value: '结构研究工具' } })
    fireEvent.click(screen.getByRole('button', { name: '新建集合' }))

    await waitFor(() => expect(screen.getAllByText('蛋白工具').length).toBeGreaterThan(0))
    expect(mockedCreateCollection).toHaveBeenCalledWith({ title: '蛋白工具', description: '结构研究工具' })
    expect(screen.getByText('集合已创建。')).toBeInTheDocument()
  })
})
