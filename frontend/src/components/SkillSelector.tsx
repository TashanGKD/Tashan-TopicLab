import { useCallback } from 'react'
import { skillsApi, AssignableSkill } from '../api/client'
import { useResourceDetail } from '../hooks/useResourceDetail'
import SkillGrid from './SkillGrid'
import SkillDetailModal from './SkillDetailModal'

export interface SkillSelectorProps {
  value: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  maxHeight?: string
  fillHeight?: boolean
}

export default function SkillSelector({
  value,
  onChange,
  placeholder = '搜索技能名称、描述、分类...',
  maxHeight = '400px',
  fillHeight = false,
}: SkillSelectorProps) {
  const fetchContent = useCallback(async (s: AssignableSkill) => {
    const res = await skillsApi.getContent(s.id)
    return res.data.content
  }, [])
  const { detailItem: detailSkill, detailContent, detailLoading, openDetail: openSkillDetail, closeDetail: closeSkillDetail } =
    useResourceDetail(fetchContent)

  return (
    <>
      <SkillGrid
        mode="select"
        layout="embed"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxHeight={fillHeight ? undefined : maxHeight}
        fillHeight={fillHeight}
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
