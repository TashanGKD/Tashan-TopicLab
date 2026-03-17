import { useEffect, useState } from 'react'
import { getFamousMatches, getFieldRecommendations } from '../profileHelperApi'
import type { FamousMatchResult, FieldRecommendation } from '../types'
import { ScientistCard } from './ScientistCard'
import { ScientistScatter } from './ScientistScatter'

interface ScientistMatchSectionProps {
  sessionId: string
}

export function ScientistMatchSection({ sessionId }: ScientistMatchSectionProps) {
  const [famous, setFamous] = useState<FamousMatchResult | null>(null)
  const [famousLoading, setFamousLoading] = useState(true)
  const [fieldRecs, setFieldRecs] = useState<FieldRecommendation[] | null>(null)
  const [fieldLoading, setFieldLoading] = useState(true)

  useEffect(() => {
    getFamousMatches(sessionId)
      .then(setFamous)
      .catch(() => {})
      .finally(() => setFamousLoading(false))

    getFieldRecommendations(sessionId)
      .then(setFieldRecs)
      .catch(() => setFieldRecs([]))
      .finally(() => setFieldLoading(false))
  }, [sessionId])

  return (
    <section className="pv-section sci-section">
      <h3 className="pv-section-title">你的科研灵魂伴侣</h3>

      {famousLoading ? (
        <div className="sci-loading">
          <div className="sci-loading-animation">
            <div className="sci-loading-dot" />
            <div className="sci-loading-dot" />
            <div className="sci-loading-dot" />
          </div>
          <p>正在从 30 位知名科学家中寻找你的灵魂伴侣...</p>
        </div>
      ) : famous ? (
        <>
          <div className="sci-top3">
            {famous.top3.map((s, i) => (
              <ScientistCard key={s.name} scientist={s} rank={i + 1} />
            ))}
          </div>

          <h4 className="sci-sub-title">你在科学家图谱中的位置</h4>
          <ScientistScatter
            scatterData={famous.scatter_data}
            userPoint={famous.user_point}
            top3Names={famous.top3.map((s) => s.name)}
          />
        </>
      ) : null}

      <h4 className="sci-sub-title">值得关注的同领域学者</h4>
      {fieldLoading ? (
        <div className="sci-field-loading">
          <span className="sci-field-spinner" />
          <span>正在根据你的研究方向寻找相关学者...</span>
        </div>
      ) : fieldRecs && fieldRecs.length > 0 ? (
        <>
          <p className="sci-field-hint">基于你的研究方向推荐，可以关注他们的最新工作</p>
          <div className="sci-field-list">
            {fieldRecs.map((r, i) => (
              <div key={i} className="sci-field-item">
                <div className="sci-field-name">
                  <strong>{r.name}</strong>
                  {r.name_en && <span className="sci-field-name-en">{r.name_en}</span>}
                </div>
                <p className="sci-field-info">{r.institution} · {r.field}</p>
                <p className="sci-field-reason">{r.reason}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="pv-empty">暂无领域推荐（需要完善研究领域信息）</p>
      )}
    </section>
  )
}
