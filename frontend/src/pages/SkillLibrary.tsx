import { useState } from 'react'
import { skillsApi, AssignableSkill } from '../api/client'
import SkillGrid from '../components/SkillGrid'
import SkillDetailModal from '../components/SkillDetailModal'
import LibraryPageLayout from '../components/LibraryPageLayout'

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
    <LibraryPageLayout title="技能库">
      <SkillGrid
        mode="view"
        layout="page"
        onSkillClick={openSkillDetail}
      />
      {detailSkill && (
        <SkillDetailModal
          skill={detailSkill}
          content={detailContent}
          loading={detailLoading}
          onClose={closeSkillDetail}
        />
      )}
    </LibraryPageLayout>
  )
}
