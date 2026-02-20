import { useState } from 'react'
import { moderatorModesApi, AssignableModeratorMode } from '../api/client'
import ModeratorModeGrid from '../components/ModeratorModeGrid'
import ModeratorModeDetailModal from '../components/ModeratorModeDetailModal'
import LibraryPageLayout from '../components/LibraryPageLayout'

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
    <LibraryPageLayout title="讨论方式库">
      <ModeratorModeGrid
        mode="view"
        layout="page"
        onModeClick={openModeDetail}
      />
      {detailMode && (
        <ModeratorModeDetailModal
          mode={detailMode}
          content={detailContent}
          loading={detailLoading}
          onClose={closeModeDetail}
        />
      )}
    </LibraryPageLayout>
  )
}
