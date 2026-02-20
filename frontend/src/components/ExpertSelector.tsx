import { useCallback } from 'react'
import { expertsApi } from '../api/client'
import { useResourceDetail } from '../hooks/useResourceDetail'
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
  const fetchContent = useCallback(async (expert: ExpertInfo) => {
    const res = await expertsApi.getContent(expert.name)
    return res.data.content || ''
  }, [])
  const { detailItem: detailExpert, detailContent, detailLoading, openDetail: openExpertDetail, closeDetail } =
    useResourceDetail(fetchContent)

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
          onClose={closeDetail}
        />
      )}
    </>
  )
}
