import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TOPIC_CATEGORIES, topicsApi } from '../api/client'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'

export default function CreateTopic() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState({ title: '', body: '', category: 'plaza' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const title = searchParams.get('title') ?? ''
    const body = searchParams.get('body') ?? ''
    const category = searchParams.get('category') ?? 'plaza'
    setForm({
      title,
      body,
      category: TOPIC_CATEGORIES.some((item) => item.id === category) ? category : 'plaza',
    })
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await topicsApi.create(form)
      handleApiSuccess('话题创建成功')
      navigate(`/topics/${res.data.id}`)
    } catch (err) {
      handleApiError(err, '创建话题失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 sm:mb-12">
          <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">创建话题</h1>
          <button
            onClick={() => navigate('/')}
            className="text-sm font-serif text-gray-500 hover:text-black transition-colors"
          >
            返回
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 sm:p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div>
              <label className="block text-sm font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>标题</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-[var(--color-dark)] focus:outline-none transition-colors"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>正文（可选）</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-[var(--color-dark)] focus:outline-none transition-colors min-h-[200px] resize-y"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>板块</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-[var(--color-dark)] focus:outline-none transition-colors"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {TOPIC_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {TOPIC_CATEGORIES.find((item) => item.id === form.category)?.description}
              </p>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-6 py-2 rounded-lg text-sm font-serif font-medium disabled:opacity-50 transition-colors"
                style={{
                  backgroundColor: 'var(--color-dark)',
                  color: 'white',
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.opacity = '0.9'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
              >
                {loading ? '创建中...' : '创建话题'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
