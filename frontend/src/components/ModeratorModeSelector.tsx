import { useState } from 'react'
import { moderatorModesApi, AssignableModeratorMode } from '../api/client'
import ModeratorModeGrid from './ModeratorModeGrid'
import ModeratorModeDetailModal from './ModeratorModeDetailModal'

export interface ModeratorModeSelectorProps {
  value: string
  onChange: (modeId: string) => void
  placeholder?: string
  maxHeight?: string
  fillHeight?: boolean
  hideSelectedChips?: boolean
}

const CUSTOM_MODE = { id: 'custom', name: '自定义模式' }

export default function ModeratorModeSelector({
  value,
  onChange,
  placeholder = '搜索讨论方式名称、描述、分类...',
  maxHeight = '320px',
  fillHeight = false,
  hideSelectedChips = false,
}: ModeratorModeSelectorProps) {
  const [detailMode, setDetailMode] = useState<AssignableModeratorMode | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const valueAsArray = value && value !== 'custom' ? [value] : []
  const handleChange = (ids: string[]) => {
    onChange(ids[0] || 'standard')
  }

  const openModeDetail = async (m: AssignableModeratorMode) => {
    setDetailMode(m)
    setDetailContent(null)
    setDetailLoading(true)
    try {
      const res = await moderatorModesApi.getContent(m.id)
      setDetailContent(res.data.content)
    } catch {
      setDetailContent('（加载失败）')
    } finally {
      setDetailLoading(false)
    }
  }

  const closeModeDetail = () => {
    setDetailMode(null)
    setDetailContent(null)
  }

  return (
    <>
      {!hideSelectedChips && value === 'custom' && (
        <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100 mb-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide w-full mb-1">
            已选讨论方式
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
            <span className="text-sm font-serif font-medium text-black">{CUSTOM_MODE.name}</span>
            <button
              type="button"
              onClick={() => onChange('standard')}
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium text-gray-400 hover:text-black hover:bg-gray-200 transition-colors"
              aria-label="取消选择"
            >
              ×
            </button>
          </span>
        </div>
      )}

      <ModeratorModeGrid
        mode="select"
        layout="embed"
        value={valueAsArray}
        onChange={handleChange}
        placeholder={placeholder}
        maxHeight={fillHeight ? undefined : maxHeight}
        fillHeight={fillHeight}
        onModeClick={openModeDetail}
        hideSelectedChips={hideSelectedChips}
      />

      {detailMode && (
        <ModeratorModeDetailModal
          mode={detailMode}
          content={detailContent}
          loading={detailLoading}
          onClose={closeModeDetail}
        />
      )}
    </>
  )
}
