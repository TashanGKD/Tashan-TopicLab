import { useState } from 'react'
import { expertsApi } from '../api/client'
import ExpertGrid from './ExpertGrid'
import ExpertDetailModal from './ExpertDetailModal'
import type { ExpertInfo } from '../api/client'

export interface ExpertSelectorProps {
  value: string[]
  selectedExperts: { name: string; label: string }[]
  onChange: (names: string[]) => void
  onAdd: (name: string) => Promise<void>
  onRemove: (name: string) => Promise<void>
  onEdit?: (name: string) => void
  onShare?: (name: string) => void
  placeholder?: string
  fillHeight?: boolean
}

export default function ExpertSelector({
  value,
  selectedExperts,
  onChange,
  onAdd,
  onRemove,
  onEdit,
  onShare,
  placeholder = '搜索角色名称、描述、领域...',
  fillHeight = false,
}: ExpertSelectorProps) {
  const [detailExpert, setDetailExpert] = useState<ExpertInfo | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openExpertDetail = async (expert: ExpertInfo) => {
    setDetailExpert(expert)
    setDetailContent(null)
    setDetailLoading(true)
    try {
      const res = await expertsApi.get(expert.name)
      setDetailContent(res.data.skill_content || '')
    } catch {
      setDetailContent('（加载失败）')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleChange = async (newNames: string[]) => {
    const toAdd = newNames.filter((n) => !value.includes(n))
    const toRemove = value.filter((n) => !newNames.includes(n))
    for (const name of toAdd) {
      await onAdd(name)
    }
    for (const name of toRemove) {
      await onRemove(name)
    }
    onChange(newNames)
  }

  return (
    <>
      <ExpertGrid
        mode="select"
        layout="embed"
        value={value}
        onChange={handleChange}
        selectedExperts={selectedExperts}
        onExpertClick={openExpertDetail}
        onEdit={onEdit}
        onShare={onShare}
        placeholder={placeholder}
        fillHeight={fillHeight}
      />
      {detailExpert && (
        <ExpertDetailModal
          expert={detailExpert}
          content={detailContent}
          loading={detailLoading}
          onClose={() => setDetailExpert(null)}
        />
      )}
    </>
  )
}
