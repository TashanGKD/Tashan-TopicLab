import type { StructuredProfile } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'

interface ProfileHeaderProps {
  profile: StructuredProfile
}

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  const { name, meta, identity, completion } = profile
  const filled = Object.values(completion).filter(Boolean).length
  const total = Object.keys(completion).length
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0

  return (
    <section className="pv-header">
      <div className="pv-header-top">
        <div>
          <h2 className="pv-name">{name || '未命名'}</h2>
          <div className="pv-tags">
            {identity.research_stage && <span className="pv-tag">{identity.research_stage}</span>}
            {identity.primary_field && <span className="pv-tag">{identity.primary_field}</span>}
            {identity.secondary_field && <span className="pv-tag">{identity.secondary_field}</span>}
            {identity.method && <span className="pv-tag">{identity.method}</span>}
          </div>
          {identity.institution && <p className="pv-institution">{identity.institution}</p>}
        </div>
        <DataSourceBadge source={meta.source} />
      </div>
      <div className="pv-progress">
        <div className="pv-progress-info">
          <span>画像完成度</span>
          <span>{filled}/{total} 维度 · {pct}%</span>
        </div>
        <div className="pv-progress-bar">
          <div className="pv-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </section>
  )
}
