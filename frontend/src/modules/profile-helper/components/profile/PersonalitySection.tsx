import type { StructuredProfile, PersonalityDim } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'

const DIM_ORDER = [
  { key: 'extraversion',      label: '外向性' },
  { key: 'agreeableness',     label: '宜人性' },
  { key: 'conscientiousness', label: '尽责性' },
  { key: 'neuroticism',       label: '神经质' },
  { key: 'openness',          label: '开放性' },
]

function getLevel(score: number): string {
  if (score >= 4.5) return '极高'
  if (score >= 3.5) return '偏高'
  if (score >= 2.5) return '中等'
  if (score >= 1.5) return '偏低'
  return '极低'
}

interface PersonalitySectionProps {
  data: StructuredProfile['personality']
}

export function PersonalitySection({ data }: PersonalitySectionProps) {
  const source = (data.source as string) || ''
  const dims = DIM_ORDER.map(({ key, label }) => {
    const val = data[key] as PersonalityDim | undefined
    return {
      key,
      label,
      score: val?.score ?? 0,
      level: val?.level || getLevel(val?.score ?? 0),
    }
  })
  const hasData = dims.some((d) => d.score > 0)

  if (!hasData) {
    return (
      <section className="pv-section">
        <h3 className="pv-section-title">人格特征 (Mini-IPIP)</h3>
        <p className="pv-empty">尚未评估。</p>
      </section>
    )
  }

  const size = 240, center = size / 2, radius = 90, n = dims.length
  const angleStep = (2 * Math.PI) / n
  const startAngle = -Math.PI / 2
  const getPoint = (i: number, r: number) => ({
    x: center + r * Math.cos(startAngle + i * angleStep),
    y: center + r * Math.sin(startAngle + i * angleStep),
  })
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0]

  return (
    <section className="pv-section">
      <div className="pv-section-header">
        <h3 className="pv-section-title">人格特征 (Mini-IPIP)</h3>
        <DataSourceBadge source={source} />
      </div>
      <div className="pv-personality-grid">
        <div className="pv-radar-wrap">
          <svg viewBox={`0 0 ${size} ${size}`} className="pv-radar-svg">
            {gridLevels.map((level) => {
              const pts = Array.from({ length: n }, (_, i) => getPoint(i, radius * level))
              const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
              return <path key={level} d={path} fill="none" stroke="#e5e7eb" strokeWidth="1" />
            })}
            {Array.from({ length: n }, (_, i) => {
              const p = getPoint(i, radius)
              return <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="1" />
            })}
            {(() => {
              const pts = dims.map((d, i) => getPoint(i, radius * Math.min(d.score / 5, 1)))
              const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
              return <path d={path} fill="rgba(0,0,0,0.08)" stroke="#000" strokeWidth="2" />
            })()}
            {dims.map((d, i) => {
              const p = getPoint(i, radius * Math.min(d.score / 5, 1))
              return <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#000" />
            })}
            {dims.map((d, i) => {
              const p = getPoint(i, radius + 20)
              return (
                <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#374151">
                  {d.label}
                </text>
              )
            })}
          </svg>
        </div>
        <div className="pv-per-list">
          {dims.map((d) => (
            <div key={d.key} className="pv-per-row">
              <span className="pv-per-label">{d.label}</span>
              <span className="pv-per-score">{d.score.toFixed(1)}</span>
              <span className="pv-per-level">{d.level}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
