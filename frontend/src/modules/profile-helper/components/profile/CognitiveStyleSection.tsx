import type { StructuredProfile } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'
import { InfoTooltip } from './InfoTooltip'

const TIP = {
  rcss: `科研认知风格量表（RCSS）测量你在科研中的思维偏好：\n· 横向整合型：擅长跨学科连接，喜欢把不同领域的方法和理论整合起来，享受"拼图式"创新。\n· 垂直深度型：专注于单一领域的极致深耕，追求细节精通，享受"打井式"钻研。\n大多数人介于两者之间，用 CSI 指数衡量（-24 到 +24）。`,
  integration: `横向整合分（I）= 4道题之和，满分 28。\n得分越高，说明你越倾向于跨学科整合、系统架构和宏观框架。`,
  depth: `垂直深度分（D）= 4道题之和，满分 28。\n得分越高，说明你越倾向于垂直深耕、细节精通和专业领域极致化。`,
  csi: `认知风格指数（CSI）= I − D，范围 -24 到 +24。\n正值偏整合型，负值偏深度型，接近 0 为平衡型。`,
}

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
        <h3 className="pv-section-title">
          <InfoTooltip term="认知风格 (RCSS)" content={TIP.rcss} />
        </h3>
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
            <div className="pv-csi-value">
              <InfoTooltip term={`CSI = ${csi > 0 ? '+' : ''}${csi}`} content={TIP.csi} />
            </div>
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
          {integration !== null && (
            <span><InfoTooltip term="横向整合 (I)" content={TIP.integration} /> = <strong>{integration}</strong></span>
          )}
          {depth !== null && (
            <span><InfoTooltip term="垂直深度 (D)" content={TIP.depth} /> = <strong>{depth}</strong></span>
          )}
        </div>
        {typeName && <p className="pv-csi-type">{typeName}</p>}
      </div>
    </section>
  )
}
