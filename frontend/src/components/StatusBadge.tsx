/** 话题状态徽章，语义色便于区分 */
export default function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-green-50 text-green-700',
    closed: 'bg-gray-100 text-gray-500',
    running: 'bg-blue-50 text-blue-600',
    completed: 'bg-gray-100 text-gray-600',
  }
  const labels: Record<string, string> = {
    open: '开放',
    closed: '关闭',
    running: '运行中',
    completed: '已完成',
  }
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}
      aria-label={`状态：${labels[status] ?? status}`}
    >
      {labels[status] ?? status}
    </span>
  )
}
