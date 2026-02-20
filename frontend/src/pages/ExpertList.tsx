import { useCallback, useState } from 'react'
import { expertsApi, type ExpertInfo } from '../api/client'
import ExpertGrid from '../components/ExpertGrid'
import ExpertDetailModal from '../components/ExpertDetailModal'
import LibraryPageLayout from '../components/LibraryPageLayout'

export default function ExpertList() {
  const [detailExpert, setDetailExpert] = useState<ExpertInfo | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openExpertDetail = useCallback(async (expert: ExpertInfo) => {
    setDetailExpert(expert)
    setDetailContent(null)
    setDetailLoading(true)
    try {
      const res = await expertsApi.getContent(expert.name)
      setDetailContent(res.data.content ?? '')
    } catch {
      setDetailContent('（加载失败）')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeExpertDetail = () => {
    setDetailExpert(null)
    setDetailContent(null)
  }

  return (
    <LibraryPageLayout title="角色库">
      <ExpertGrid mode="view" onExpertClick={openExpertDetail} />
      {detailExpert && (
        <ExpertDetailModal
          expert={detailExpert}
          content={detailContent}
          loading={detailLoading}
          onClose={closeExpertDetail}
        />
      )}
    </LibraryPageLayout>
  )
}
