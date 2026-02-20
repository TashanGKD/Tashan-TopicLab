import { useState } from 'react'
import { skillsApi, AssignableSkill } from '../api/client'
import SkillGrid from '../components/SkillGrid'
import SkillDetailModal from '../components/SkillDetailModal'

export default function SkillLibrary() {
  const [detailSkill, setDetailSkill] = useState<AssignableSkill | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openSkillDetail = async (s: AssignableSkill) => {
    setDetailSkill(s)
    setDetailContent(null)
    setDetailLoading(true)
    try {
      const res = await skillsApi.getContent(s.id)
      setDetailContent(res.data.content)
    } catch {
      setDetailContent('（加载失败）')
    } finally {
      setDetailLoading(false)
    }
  }

  const closeSkillDetail = () => {
    setDetailSkill(null)
    setDetailContent(null)
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-serif font-bold text-black">技能库</h1>
        </div>

        <SkillGrid
          mode="view"
          layout="page"
          onSkillClick={openSkillDetail}
        />
      </div>

      {detailSkill && (
        <SkillDetailModal
          skill={detailSkill}
          content={detailContent}
          loading={detailLoading}
          onClose={closeSkillDetail}
        />
      )}
    </div>
  )
}
