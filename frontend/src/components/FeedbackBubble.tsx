import { ReactNode, useCallback, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { feedbackApi } from '../api/client'

type FeedbackDraftEventDetail = {
  scenario?: string
  steps?: string
  body?: string
}

type FeedbackBubbleProps = {
  renderTrigger?: (open: () => void) => ReactNode
}

function formatAxiosDetail(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { detail?: unknown } } }).response
    const d = res?.data?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) {
      return d
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: string }).msg) : String(item)))
        .join('; ')
    }
  }
  if (err instanceof Error) return err.message
  return '提交失败，请稍后重试'
}

/**
 * 固定在视口右下偏上区域，避免与常见底部输入栏、话题回复浮层（约 z-40）重叠。
 */
export default function FeedbackBubble({ renderTrigger }: FeedbackBubbleProps) {
  const location = useLocation()
  const panelTitleId = useId()
  const [open, setOpen] = useState(false)
  const [scenario, setScenario] = useState('')
  const [steps, setSteps] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    const handleDraft = (event: Event) => {
      const detail = (event as CustomEvent<FeedbackDraftEventDetail>).detail
      setScenario(detail?.scenario ?? '')
      setSteps(detail?.steps ?? '')
      setBody(detail?.body ?? '')
      setMessage(null)
      setOpen(true)
    }

    window.addEventListener('open-feedback-draft', handleDraft as EventListener)
    return () => {
      window.removeEventListener('open-feedback-draft', handleDraft as EventListener)
    }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setMessage(null)
  }, [])

  const submit = useCallback(async () => {
    const trimmed = body.trim()
    if (!trimmed) {
      setMessage('请填写反馈正文')
      return
    }
    setSending(true)
    setMessage(null)
    try {
      const pageUrl =
        typeof window !== 'undefined' ? `${window.location.origin}${location.pathname}${location.search}` : null
      await feedbackApi.submit({
        body: trimmed,
        scenario: scenario.trim(),
        steps_to_reproduce: steps.trim(),
        page_url: pageUrl,
      })
      setScenario('')
      setSteps('')
      setBody('')
      setMessage('已提交，感谢反馈。')
      setTimeout(() => close(), 1200)
    } catch (e) {
      setMessage(formatAxiosDetail(e))
    } finally {
      setSending(false)
    }
  }, [body, close, location.pathname, location.search, scenario, steps])

  const fab = (
    renderTrigger?.(() => {
      setOpen(true)
      setMessage(null)
    }) ?? null
  )

  const modal =
    open &&
    createPortal(
      <div
        className="fixed inset-0 z-[50] flex items-end justify-center sm:items-center sm:p-4"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close()
        }}
      >
        <div
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={panelTitleId}
          className="relative z-[51] flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <div>
              <h2 id={panelTitleId} className="text-base font-semibold text-slate-900">
                反馈意见
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">登录后会自动关联账号，未登录也可以匿名提交。</p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="关闭"
              onClick={close}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3">
              <label className="block text-xs font-medium text-slate-600">
                场景（可选）
                <textarea
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="例如：在话题详情页点击收藏时…"
                  className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                复现步骤（可选）
                <textarea
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="1. …&#10;2. …"
                  className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                详细说明 <span className="text-red-600">*</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  maxLength={8000}
                  placeholder="期望行为、实际现象、报错信息等"
                  className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                />
              </label>
            </div>
            {message ? (
              <p
                className={`mt-3 text-sm ${message.startsWith('已提交') ? 'text-emerald-700' : 'text-red-600'}`}
              >
                {message}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={close}
              disabled={sending}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              onClick={() => void submit()}
              disabled={sending}
            >
              {sending ? '提交中…' : '提交'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      {fab}
      {modal}
    </>
  )
}
