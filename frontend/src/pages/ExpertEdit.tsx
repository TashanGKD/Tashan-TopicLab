import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { expertsApi, ExpertInfo } from '../api/client'

const inputClass = 'w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

export default function ExpertEdit() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [expert, setExpert] = useState<ExpertInfo | null>(null)
  const [skillContent, setSkillContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (name) {
      expertsApi.get(name)
        .then(res => {
          setExpert(res.data)
          setSkillContent(res.data.skill_content)
        })
        .catch(err => console.error('Failed to load expert', err))
        .finally(() => setLoading(false))
    }
  }, [name])

  const handleSave = async () => {
    if (!name) return
    setSaving(true)
    try {
      const res = await expertsApi.update(name, { skill_content: skillContent })
      setExpert(res.data)
      alert('保存成功')
    } catch (err) {
      console.error('Failed to save expert', err)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="bg-white min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">加载中...</p>
      </div>
    </div>
  )
  if (!expert) return (
    <div className="bg-white min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">专家不存在</p>
      </div>
    </div>
  )

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Link
            to="/experts"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← 返回专家列表
          </Link>
        </div>

        <div className="rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">{expert.label}</h2>
          <p className="text-sm text-gray-500 mb-1">{expert.description}</p>
          <p className="text-xs text-gray-400 mb-6">文件: {expert.skill_file}</p>

          <div className="mb-4">
            <label className={labelClass}>Skill 画像内容</label>
            <textarea
              className={`${inputClass} min-h-[400px] font-mono text-sm resize-vertical`}
              value={skillContent}
              onChange={e => setSkillContent(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => navigate('/experts')}
              className="border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded text-sm transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
