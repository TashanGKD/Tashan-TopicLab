import { useState } from 'react'
import type { ExpertInfo } from '../api/client'
import ExpertGrid from '../components/ExpertGrid'
import ExpertDetailModal from '../components/ExpertDetailModal'

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
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-serif font-bold text-black">角色库</h1>
        </div>

        <ExpertGrid onExpertClick={openExpertDetail} />
      </div>

      {detailExpert && (
        <ExpertDetailModal
          expert={detailExpert}
          content={detailContent}
          loading={detailLoading}
          onClose={closeExpertDetail}
        />
      )}
    </div>
  )
}
