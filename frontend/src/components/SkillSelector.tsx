import { useState } from 'react'
import { skillsApi, AssignableSkill } from '../api/client'
import SkillGrid from './SkillGrid'
import SkillDetailModal from './SkillDetailModal'

export interface SkillSelectorProps {
  value: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  maxHeight?: string
}

export default function SkillSelector({
  value,
  onChange,
  placeholder = '搜索技能名称、描述、分类...',
  maxHeight = '400px',
}: SkillSelectorProps) {
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
    <>
      <SkillGrid
        mode="select"
        layout="embed"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxHeight={maxHeight}
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
    </>
  )
}
