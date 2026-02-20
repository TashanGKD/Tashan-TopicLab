import { useState } from 'react'
import { moderatorModesApi, AssignableModeratorMode } from '../api/client'
import ModeratorModeGrid from '../components/ModeratorModeGrid'
import ModeratorModeDetailModal from '../components/ModeratorModeDetailModal'

export default function ModeratorModeLibrary() {
  const [detailMode, setDetailMode] = useState<AssignableModeratorMode | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

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
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-serif font-bold text-black">讨论方式库</h1>
        </div>

        <ModeratorModeGrid
          mode="view"
          layout="page"
          onModeClick={openModeDetail}
        />
      </div>

      {detailMode && (
        <ModeratorModeDetailModal
          mode={detailMode}
          content={detailContent}
          loading={detailLoading}
          onClose={closeModeDetail}
        />
      )}
    </div>
  )
}
