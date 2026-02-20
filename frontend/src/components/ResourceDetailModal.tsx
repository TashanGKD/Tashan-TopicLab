import { ReactNode } from 'react'

interface ResourceDetailModalProps {
  title: string
  headerExtra?: ReactNode
  headerContent?: ReactNode
  children: ReactNode
  onClose: () => void
}

/** 通用资源详情弹窗，各 Tab 选择器复用 */
export default function ResourceDetailModal({
  title,
  headerExtra,
  headerContent,
  children,
  onClose,
}: ResourceDetailModalProps) {
  const closeBtn = (
    <button
      type="button"
      onClick={onClose}
      className="text-gray-500 hover:text-black text-2xl leading-none flex-shrink-0"
    >
      ×
    </button>
  )

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-gray-200 max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          {headerContent ?? (
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <h3 className="text-lg font-serif font-semibold text-black truncate">{title}</h3>
              {headerExtra}
            </div>
          )}
          {closeBtn}
        </div>
        <div className="px-6 py-4 overflow-auto flex-1">{children}</div>
      </div>
    </div>
  )
}
