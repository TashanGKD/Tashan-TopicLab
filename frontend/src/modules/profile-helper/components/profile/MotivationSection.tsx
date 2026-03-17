import type { StructuredProfile } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'

const DIM_ORDER = [
  { key: 'know',           label: '求知',     group: 'intrinsic'   },
  { key: 'accomplishment', label: '成就',     group: 'intrinsic'   },
  { key: 'stimulation',    label: '体验刺激', group: 'intrinsic'   },
  { key: 'identified',     label: '认同调节', group: 'autonomous'  },
  { key: 'introjected',    label: '内摄调节', group: 'controlled'  },
  { key: 'external',       label: '外部调节', group: 'controlled'  },
  { key: 'amotivation',    label: '无动机',   group: 'amotivation' },
]

interface MotivationSectionProps {
  data: StructuredProfile['motivation']
}

export function MotivationSection({ data }: MotivationSectionProps) {
  const { dimensions, intrinsic_total, extrinsic_total, rai } = data
  const hasDims = Object.keys(dimensions).length > 0

  if (!hasDims) {
    return (
      <section className="pv-section">
        <h3 className="pv-section-title">学术动机 (AMS)</h3>
        <p className="pv-empty">尚未评估。</p>
      </section>
    )
  }

  return (
    <section className="pv-section">
      <div className="pv-section-header">
        <h3 className="pv-section-title">学术动机 (AMS)</h3>
        <DataSourceBadge source={data.source} />
      </div>
      <div className="pv-motivation-chart">
        {DIM_ORDER.map(({ key, label, group }) => {
          const val = dimensions[key] ?? 0
          return (
            <div key={key} className="pv-mot-row">
              <span className="pv-mot-label">{label}</span>
              <div className={`pv-mot-track group-${group}`}>
                <div className="pv-mot-fill" style={{ width: `${(val / 7) * 100}%` }} />
              </div>
              <span className="pv-mot-val">{val.toFixed(1)}</span>
            </div>
          )
        })}
      </div>
      <div className="pv-mot-summary">
        {intrinsic_total != null && <span>内在动机总分 <strong>{intrinsic_total.toFixed(1)}</strong></span>}
        {extrinsic_total != null && <span>外在动机总分 <strong>{extrinsic_total.toFixed(1)}</strong></span>}
        {rai != null && <span>RAI <strong>{rai > 0 ? '+' : ''}{rai.toFixed(1)}</strong></span>}
      </div>
    </section>
  )
}
