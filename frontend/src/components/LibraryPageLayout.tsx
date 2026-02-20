import { ReactNode } from 'react'

interface LibraryPageLayoutProps {
  title: string
  children: ReactNode
  actions?: ReactNode
}

export default function LibraryPageLayout({ title, children, actions }: LibraryPageLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-serif font-bold text-black">{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </div>
  )
}
