import type { StructuredProfile } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'

interface CognitiveStyleSectionProps {
  data: StructuredProfile['cognitive_style']
}

export function CognitiveStyleSection({ data }: CognitiveStyleSectionProps) {
  const csi = data.csi ?? null
  const integration = data.integration ?? null
  const depth = data.depth ?? null
  const typeName = data.type || ''

  if (csi === null) {
    return (
      <section className="pv-section">
        <h3 className="pv-section-title">认知风格 (RCSS)</h3>
        <p className="pv-empty">尚未评估。</p>
      </section>
    )
  }

  // -24~+24 映射到 0~100%
  const pct = ((csi - (-24)) / 48) * 100

  return (
    <section className="pv-section">
      <div className="pv-section-header">
        <h3 className="pv-section-title">认知风格 (RCSS)</h3>
        <DataSourceBadge source={data.source || ''} />
      </div>
      <div className="pv-csi-spectrum">
        <div className="pv-csi-labels">
          <span>强深度型</span>
          <span>平衡型</span>
          <span>强整合型</span>
        </div>
        <div className="pv-csi-track">
          <div className="pv-csi-marker" style={{ left: `${pct}%` }}>
            <div className="pv-csi-dot" />
            <div className="pv-csi-value">CSI = {csi > 0 ? '+' : ''}{csi}</div>
          </div>
        </div>
        <div className="pv-csi-labels pv-csi-numbers">
          <span>-24</span>
          <span>0</span>
          <span>+24</span>
        </div>
      </div>
      <div className="pv-csi-summary">
        <div className="pv-csi-scores">
          {integration !== null && <span>横向整合 (I) = <strong>{integration}</strong></span>}
          {depth !== null && <span>垂直深度 (D) = <strong>{depth}</strong></span>}
        </div>
        {typeName && <p className="pv-csi-type">{typeName}</p>}
      </div>
    </section>
  )
}
