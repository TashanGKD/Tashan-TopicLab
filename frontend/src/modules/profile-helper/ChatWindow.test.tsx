import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatWindow } from './ChatWindow'
import {
  getOrCreateSession,
  getProfile,
  resetSession,
  sendMessageBlocks,
} from './profileHelperApi'
import { refreshCurrentUserProfile, tokenManager } from '../../api/auth'
import { toast } from '../../utils/toast'

vi.mock('./profileHelperApi', async () => {
  const actual = await vi.importActual<typeof import('./profileHelperApi')>('./profileHelperApi')
  return {
    ...actual,
    getOrCreateSession: vi.fn(),
    getProfile: vi.fn(),
    sendMessageBlocks: vi.fn(),
    resetSession: vi.fn(),
  }
})

vi.mock('../../api/client', () => ({
  PROFILE_HELPER_MODELS: [
    { value: 'qwen3', label: 'Qwen 3' },
  ],
}))

vi.mock('../../api/auth', () => ({
  tokenManager: {
    get: vi.fn(),
  },
  refreshCurrentUserProfile: vi.fn(),
}))

vi.mock('../../utils/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const mockedGetOrCreateSession = vi.mocked(getOrCreateSession)
const mockedGetProfile = vi.mocked(getProfile)
const mockedSendMessageBlocks = vi.mocked(sendMessageBlocks)
const mockedResetSession = vi.mocked(resetSession)
const mockedRefreshCurrentUserProfile = vi.mocked(refreshCurrentUserProfile)
const mockedTokenGet = vi.mocked(tokenManager.get)
const mockedToastError = vi.mocked(toast.error)

function renderChatWindow() {
  return render(
    <MemoryRouter>
      <ChatWindow />
    </MemoryRouter>,
  )
}

describe('ChatWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockedGetOrCreateSession.mockResolvedValue('session-1')
    mockedGetProfile.mockResolvedValue({ profile: '# dev', forum_profile: '# forum' })
    mockedSendMessageBlocks.mockResolvedValue(undefined)
    mockedResetSession.mockResolvedValue(undefined)
    mockedTokenGet.mockReturnValue(null)
    mockedRefreshCurrentUserProfile.mockResolvedValue(null)
    mockedToastError.mockImplementation(() => undefined)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('creates anonymous session on init and does not show login prompt', async () => {
    const { container } = renderChatWindow()

    await waitFor(() => {
      expect(mockedGetOrCreateSession).toHaveBeenCalledWith(undefined)
    })

    expect(screen.queryByText('请先登录后再与数字分身助手对话')).not.toBeInTheDocument()

    const textarea = container.querySelector('.chat-textarea') as HTMLTextAreaElement
    const sendButton = container.querySelector('.chat-send-btn') as HTMLButtonElement
    expect(textarea.value).toBe('建立我的分身')
    expect(textarea.readOnly).toBe(true)
    expect(sendButton.disabled).toBe(false)
    expect(localStorage.getItem('tashan_session_id')).toBe('session-1')
    expect(localStorage.getItem('tashan_profile_session_id')).toBe('session-1')
  })

  it('restores cached history from localStorage and clears initial input text', async () => {
    localStorage.setItem('tashan_session_id', 'session-restore')
    localStorage.setItem(
      'profile_helper_chat_session-restore',
      JSON.stringify([{ role: 'user', content: '已有历史消息' }]),
    )
    mockedGetOrCreateSession.mockResolvedValue('session-restore')

    const { container } = renderChatWindow()

    await screen.findByText('已有历史消息')

    const textarea = container.querySelector('.chat-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
    expect(textarea.readOnly).toBe(false)
    expect(screen.queryByText('你好，我是科研数字分身采集助手。')).not.toBeInTheDocument()
  })

  it('locks textarea after receiving a choice block from assistant', async () => {
    mockedSendMessageBlocks.mockImplementation(async (_sid, _message, onBlock) => {
      onBlock({ type: 'text', content: '先回答一个问题。' })
      onBlock({
        type: 'choice',
        id: 'next-step',
        question: '下一步？',
        options: [{ id: 'continue', label: '继续' }],
      })
    })

    const { container } = renderChatWindow()

    await waitFor(() => {
      expect(mockedGetOrCreateSession).toHaveBeenCalled()
      expect(localStorage.getItem('tashan_session_id')).toBe('session-1')
    })

    fireEvent.click(container.querySelector('.chat-send-btn') as HTMLButtonElement)

    await screen.findByText('下一步？')
    expect(mockedSendMessageBlocks).toHaveBeenCalledWith(
      'session-1',
      '建立我的分身',
      expect.any(Function),
      'qwen3',
    )

    const textarea = container.querySelector('.chat-textarea') as HTMLTextAreaElement
    const sendButton = container.querySelector('.chat-send-btn') as HTMLButtonElement
    expect(textarea.readOnly).toBe(true)
    expect(textarea.placeholder).toBe('请从上方选项中作答')
    expect(sendButton.disabled).toBe(true)
    expect(screen.getByText('请点击上方选项作答')).toBeInTheDocument()
  })

  it('auto-submits selected choice response and unlocks input after non-interactive reply', async () => {
    mockedSendMessageBlocks.mockImplementation(async (_sid, message, onBlock) => {
      if (message === '建立我的分身') {
        onBlock({ type: 'text', content: '请选择方向。' })
        onBlock({
          type: 'choice',
          id: 'next-step',
          question: '下一步？',
          options: [{ id: 'continue', label: '继续' }],
        })
        return
      }

      if (message === '继续') {
        onBlock({ type: 'text', content: '收到继续' })
      }
    })

    const { container } = renderChatWindow()

    await waitFor(() => {
      expect(mockedGetOrCreateSession).toHaveBeenCalled()
    })

    fireEvent.click(container.querySelector('.chat-send-btn') as HTMLButtonElement)
    await screen.findByRole('button', { name: '继续' })

    fireEvent.click(screen.getByRole('button', { name: '继续' }))

    await waitFor(() => {
      expect(mockedSendMessageBlocks).toHaveBeenNthCalledWith(
        2,
        'session-1',
        '继续',
        expect.any(Function),
        'qwen3',
      )
    })

    await screen.findByText('收到继续')

    const textarea = container.querySelector('.chat-textarea') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(false)
    expect(textarea.placeholder).toBe('输入消息...')
    expect(screen.getByText('Enter 发送 · Shift+Enter 换行')).toBeInTheDocument()

    const cached = localStorage.getItem('profile_helper_chat_session-1')
    expect(cached).toContain('继续')
    expect(cached).toContain('收到继续')
  })
})
