import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { expertsApi, ExpertInfo } from '../api/client'

export default function ExpertList() {
  const [experts, setExperts] = useState<ExpertInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    expertsApi.list()
      .then(res => setExperts(res.data))
      .catch(err => console.error('Failed to load experts', err))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-12">
          <h1 className="text-2xl font-serif font-bold text-black">专家管理</h1>
        </div>

        {loading && <p className="text-gray-400 font-serif">加载中...</p>}
        {!loading && experts.length === 0 && <p className="text-gray-400 font-serif">暂无专家配置</p>}

        <div className="flex flex-col gap-4">
          {experts.map(expert => (
            <div key={expert.name} className="border border-gray-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-serif text-sm flex-shrink-0">
                  {expert.label.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-serif font-medium text-black">{expert.label}</h3>
                    <span className="text-xs font-serif text-gray-400">{expert.name}</span>
                  </div>
                  <p className="text-sm font-serif text-gray-600 mb-3">{expert.description}</p>
                  <pre className="text-xs bg-gray-50 border border-gray-200 p-3 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-gray-700">
                    {expert.skill_content || '（暂无 skill 内容）'}
                  </pre>
                </div>

                <Link
                  to={`/experts/${expert.name}/edit`}
                  className="bg-black text-white px-4 py-1.5 text-sm font-serif hover:bg-gray-900 transition-colors flex-shrink-0"
                >
                  编辑
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
