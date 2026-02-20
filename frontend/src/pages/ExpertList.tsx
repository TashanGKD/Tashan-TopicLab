import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { expertsApi, ExpertInfo } from '../api/client'
import ResizableToc from '../components/ResizableToc'

export default function ExpertList() {
  const [experts, setExperts] = useState<ExpertInfo[]>([])
  const [loading, setLoading] = useState(true)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    expertsApi.list()
      .then(res => setExperts(res.data))
      .catch(err => console.error('Failed to load experts', err))
      .finally(() => setLoading(false))
  }, [])

  const scrollToExpert = (name: string) => {
    const el = sectionRefs.current[`expert-${name}`]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-8 flex gap-8">
        {/* Left toc - hidden on mobile */}
        {!loading && experts.length > 0 && (
          <ResizableToc defaultWidth={160} className="sticky top-20 self-start hidden md:flex">
            <nav className="text-sm">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">目录</div>
              <ul className="space-y-0.5">
                {experts.map((expert) => (
                  <li key={expert.name}>
                    <button
                      type="button"
                      onClick={() => scrollToExpert(expert.name)}
                      className="block w-full text-left px-2 py-1.5 rounded text-gray-600 hover:text-black hover:bg-gray-100 transition-colors text-xs truncate"
                    >
                      {expert.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </ResizableToc>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-12">
            <h1 className="text-2xl font-serif font-bold text-black">专家库</h1>
          </div>

          {loading && <p className="text-gray-400 font-serif">加载中...</p>}
          {!loading && experts.length === 0 && <p className="text-gray-400 font-serif">暂无专家配置</p>}

          <div className="flex flex-col gap-4">
            {experts.map(expert => (
              <div
                key={expert.name}
                id={`expert-${expert.name}`}
                ref={(el) => { sectionRefs.current[`expert-${expert.name}`] = el }}
                className="border border-gray-200 p-6 scroll-mt-6"
              >
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
    </div>
  )
}
