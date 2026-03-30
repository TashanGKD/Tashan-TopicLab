import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { skillHubApi, type SkillHubSkillSummary } from '../api/client'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { SkillCard } from './skillHubShared'

export default function AppsSkillSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const [input, setInput] = useState(q)
  const [skills, setSkills] = useState<SkillHubSkillSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setSkills([])
      return
    }
    let alive = true
    setLoading(true)
    skillHubApi.search({ q, sort: 'hot', limit: 24 })
      .then((res) => { if (alive) setSkills(res.data.list) })
      .catch((err) => { if (alive) handleApiError(err, '搜索 Skill 失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [q])

  return (
    <ImmersiveAppShell title="Skill 搜索" subtitle="搜索科研 Skill、研究方向和工作流关键词。">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSearchParams(input.trim() ? { q: input.trim() } : {})
        }}
        className="mb-6 flex max-w-xl items-center gap-2"
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} className="w-full rounded-full border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }} placeholder="搜索 Skill、cluster 或关键词" />
        <button type="submit" className="rounded-full border px-4 py-2.5 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          搜索
        </button>
      </form>
      {loading ? <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>搜索中…</div> : null}
      {!loading && skills.length === 0 ? <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{q ? '没有匹配结果' : '输入关键词开始搜索'}</div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {skills.map((skill) => <SkillCard key={skill.id} skill={skill} />)}
      </div>
    </ImmersiveAppShell>
  )
}
