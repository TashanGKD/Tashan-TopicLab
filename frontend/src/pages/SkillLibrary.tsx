import { useCallback, useState } from 'react'
import { skillsApi, libsApi, AssignableSkill } from '../api/client'
import SkillGrid from '../components/SkillGrid'
import SkillDetailModal from '../components/SkillDetailModal'
import LibraryPageLayout from '../components/LibraryPageLayout'

export default function SkillLibrary() {
  const [detailSkill, setDetailSkill] = useState<AssignableSkill | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(async () => {
    try {
      await libsApi.invalidateCache()
      setRefreshKey((k) => k + 1)
    } catch {
      // ignore
    }
  }, [])

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
    <LibraryPageLayout
      title="技能库"
      actions={
        <button
          type="button"
          onClick={handleRefresh}
          className="text-sm font-serif text-gray-600 hover:text-black border border-gray-200 hover:border-black px-3 py-1.5 rounded-lg transition-colors"
          aria-label="刷新技能库"
        >
          刷新库
        </button>
      }
    >
      <SkillGrid
        key={refreshKey}
        mode="view"
        layout="page"
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
    </LibraryPageLayout>
  )
}
