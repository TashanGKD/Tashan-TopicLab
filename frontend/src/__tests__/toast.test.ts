import { describe, expect, it } from 'vitest'
import { showToast } from '../utils/toast'

function latestToastSpans(): HTMLSpanElement[] {
  const toasts = document.querySelectorAll('span')
  return Array.from(toasts).slice(-2) as HTMLSpanElement[]
}

describe('showToast', () => {
  it('renders the message as text, not HTML', () => {
    const malicious = '<img src=x onerror="window.__xss=1">'
    showToast({ message: malicious, type: 'error' })

    expect(document.querySelector('img')).toBeNull()
    const [, messageSpan] = latestToastSpans()
    expect(messageSpan.textContent).toBe(malicious)
  })

  it('shows the type icon alongside the message', () => {
    showToast({ message: 'hello', type: 'success' })

    const [iconSpan, messageSpan] = latestToastSpans()
    expect(iconSpan.textContent).toBe('✓')
    expect(messageSpan.textContent).toBe('hello')
  })
})
