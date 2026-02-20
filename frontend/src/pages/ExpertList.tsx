import { useState } from 'react'
import type { ExpertInfo } from '../api/client'
import ExpertGrid from '../components/ExpertGrid'
import ExpertDetailModal from '../components/ExpertDetailModal'
import LibraryPageLayout from '../components/LibraryPageLayout'

export default function ExpertList() {
  const [detailExpert, setDetailExpert] = useState<ExpertInfo | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openExpertDetail = (expert: ExpertInfo) => {
    setDetailExpert(expert)
    setDetailContent(expert.skill_content || null)
    setDetailLoading(false)
  }

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
