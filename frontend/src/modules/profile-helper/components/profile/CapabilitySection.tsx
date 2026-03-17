import type { StructuredProfile } from '../../types'

const PROCESS_LABELS: Record<string, string> = {
  problem_definition: '问题定义',
  literature: '文献整合',
  design: '方案设计',
  execution: '实验执行',
  writing: '论文写作',
  management: '项目管理',
}

const PROCESS_ORDER = ['problem_definition', 'literature', 'design', 'execution', 'writing', 'management']

interface CapabilitySectionProps {
  capability: StructuredProfile['capability']
}

export function CapabilitySection({ capability }: CapabilitySectionProps) {
  const { process, tech_stack, outputs } = capability
  const dims = PROCESS_ORDER.filter((k) => process[k])
  const labels = dims.map((k) => PROCESS_LABELS[k])
  const values = dims.map((k) => process[k]?.score ?? 0)
  const hasRadar = dims.length >= 3

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
      <h3 className="pv-section-title">科研能力</h3>
      <div className="pv-capability-grid">
        {hasRadar && (
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
                const pts = values.map((v, i) => getPoint(i, radius * Math.min(v / 5, 1)))
                const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
                return <path d={d} fill="rgba(0,0,0,0.08)" stroke="#000" strokeWidth="2" />
              })()}
              {values.map((v, i) => {
                const p = getPoint(i, radius * Math.min(v / 5, 1))
                return <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#000" />
              })}
              {labels.map((label, i) => {
                const p = getPoint(i, radius + 20)
                return (
                  <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#374151">
                    {label}
                  </text>
                )
              })}
            </svg>
          </div>
        )}
        <div className="pv-score-bars">
          {PROCESS_ORDER.map((key) => {
            const item = process[key]
            if (!item) return null
            const score = item.score ?? 0
            return (
              <div key={key} className="pv-score-row">
                <span className="pv-score-label">{PROCESS_LABELS[key]}</span>
                <div className="pv-score-track">
                  <div className="pv-score-fill" style={{ width: `${(score / 5) * 100}%` }} />
                </div>
                <span className="pv-score-num">{score}</span>
              </div>
            )
          })}
        </div>
      </div>
      {tech_stack.length > 0 && (
        <div className="pv-tech-stack">
          <h4>技术栈</h4>
          <div className="pv-tech-tags">
            {tech_stack.map((t, i) => (
              <span key={i} className="pv-tech-tag">{t.tech}{t.level ? ` · ${t.level}` : ''}</span>
            ))}
          </div>
        </div>
      )}
      {outputs && <p className="pv-outputs"><strong>代表性产出：</strong>{outputs}</p>}
    </section>
  )
}
