import type { StructuredProfile, PersonalityDim } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'
import { InfoTooltip } from './InfoTooltip'

const DIM_TIPS: Record<string, string> = {
  extraversion:      `外向性（E）\n倾向于从社交互动中获取能量，喜欢热闹、主动、表达欲强。\n高分：外向、活跃、健谈；低分：内向、独处偏好、安静。`,
  agreeableness:     `宜人性（A）\n对他人的友善、合作、信任程度。\n高分：善解人意、乐于助人、容易妥协；低分：竞争性强、直接、较少考虑他人感受。`,
  conscientiousness: `尽责性（C）\n自律、计划性、做事认真的程度。\n高分：有条理、守时、目标感强；低分：灵活但可能较随性。`,
  neuroticism:       `神经质（N）\n情绪敏感和不稳定的倾向。\n高分：容易焦虑、情绪起伏较大；低分：情绪平稳、抗压性强。\n注意：神经质是中性描述词，不是负面评价。`,
  openness:          `开放性（O）\n对新经验、想法和创造力的接受程度。\n高分：好奇、有创造力、思维发散；低分：务实、偏好惯例、细节执行力强。`,
}

const TIP_OCEAN = `大五人格（Mini-IPIP）是心理学中应用最广泛的人格模型之一，包含 5 个维度（OCEAN）：\n· 开放性 O：对新事物的好奇与创造力\n· 尽责性 C：自律与计划性\n· 外向性 E：社交能量与活跃度\n· 宜人性 A：合作与友善\n· 神经质 N：情绪稳定性（反向）\n每个维度 1-5 分，3 分为中等水平。`

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
        <h3 className="pv-section-title">
          <InfoTooltip term="人格特征 (Mini-IPIP)" content={TIP_OCEAN} />
        </h3>
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
              <span className="pv-per-label">
                <InfoTooltip term={d.label} content={DIM_TIPS[d.key] || d.label} />
              </span>
              <span className="pv-per-score">{d.score.toFixed(1)}</span>
              <span className="pv-per-level">{d.level}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
