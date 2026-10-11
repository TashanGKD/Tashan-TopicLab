import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ImmersiveAppShellProps {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  backTo?: string
  backLabel?: string
}

/** 无全站顶栏/底栏时的子页外壳：顶栏返回应用 + 标题 */
export default function ImmersiveAppShell({ title, subtitle, children, backTo = '/apps', backLabel = '应用' }: ImmersiveAppShellProps) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-page)' }}>
      <header
        className="sticky top-0 z-20 border-b"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          backgroundColor: 'var(--bg-container)',
          borderColor: 'var(--border-default)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="mx-auto flex min-h-12 max-w-6xl items-center gap-3 px-4 py-2.5 sm:min-h-14 sm:px-6 sm:py-3">
          <Link
            to={backTo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none sm:text-sm cursor-pointer"
            style={{
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <span aria-hidden>←</span>
            {backLabel}
          </Link>
          <h1 className="min-w-0 truncate text-sm font-serif font-semibold sm:text-base" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        {subtitle ? (
          <div className="mb-5 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            {subtitle}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}
