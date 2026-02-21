import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { topicsApi, Topic } from '../api/client'
import { handleApiError } from '../utils/errorHandler'

function StatusBadge({ status }: { status: string }) {
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
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}

export default function TopicList() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTopics()
    const interval = setInterval(loadTopics, 3000)
    return () => clearInterval(interval)
  }, [])

  const loadTopics = async () => {
    try {
      const res = await topicsApi.list()
      setTopics(res.data)
    } catch (err) {
      if (loading) {
        handleApiError(err, '加载话题列表失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-8 sm:mb-12">
          <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">话题列表</h1>
        </div>

        {loading && (
          <p className="text-gray-500 font-serif">加载中...</p>
        )}

        {!loading && topics.length === 0 && (
          <p className="text-gray-500 font-serif">暂无话题，点击右上角创建一个</p>
        )}

        <div className="flex flex-col gap-4">
          {topics.map((topic) => (
            <Link key={topic.id} to={`/topics/${topic.id}`}>
              <div className="border border-gray-200 rounded-lg p-4 sm:p-6 hover:border-black transition-colors active:bg-gray-50">
                <div className="flex flex-row items-start justify-between gap-2 mb-3">
                  <h3 className="text-base font-serif font-semibold text-black flex-1 min-w-0">{topic.title}</h3>
                  <StatusBadge status={topic.status} />
                </div>
                {topic.body?.trim() && (
                  <p className="text-sm font-serif text-gray-600 mb-4 line-clamp-2">
                    {topic.body.slice(0, 150)}{topic.body.length > 150 ? '...' : ''}
                  </p>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs font-serif text-gray-400">
                  <span>创建于 {new Date(topic.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span>
                    话题讨论方式: {topic.discussion_status === 'pending'
                      ? '未发起讨论'
                      : topic.moderator_mode_name ?? topic.moderator_mode_id ?? '—'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
