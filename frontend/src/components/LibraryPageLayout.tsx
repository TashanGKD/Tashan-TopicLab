import { ReactNode } from 'react'

interface LibraryPageLayoutProps {
  title: string
  description?: ReactNode
  children: ReactNode
  actions?: ReactNode
}

export default function LibraryPageLayout({ title, description, children, actions }: LibraryPageLayoutProps) {
  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-serif font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h1>
            {description ? (
              <div className="max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                {description}
              </div>
            ) : null}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  )
}
