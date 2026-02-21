import { ReactNode } from 'react'

interface LibraryPageLayoutProps {
  title: string
  children: ReactNode
  actions?: ReactNode
}

export default function LibraryPageLayout({ title, children, actions }: LibraryPageLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </div>
  )
}
