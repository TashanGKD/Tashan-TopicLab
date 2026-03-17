import type { StructuredProfile } from '../../types'

interface NeedsSectionProps {
  needs: StructuredProfile['needs']
}

export function NeedsSection({ needs }: NeedsSectionProps) {
  const { time_occupation, pain_points, want_to_change } = needs
  const isEmpty = time_occupation.length === 0 && pain_points.length === 0 && !want_to_change

  if (isEmpty) {
    return (
      <section className="pv-section">
        <h3 className="pv-section-title">当前需求</h3>
        <p className="pv-empty">尚未填写。建议补充以获得更有针对性的发展建议。</p>
      </section>
    )
  }

  return (
    <section className="pv-section">
      <h3 className="pv-section-title">当前需求</h3>
      <div className="pv-needs-grid">
        <div className="pv-need-card">
          <h4>主要时间占用</h4>
          {time_occupation.length > 0 ? (
            <ul>{time_occupation.map((t, i) => <li key={i}>{t.item || t.desc}{t.feeling ? ` — ${t.feeling}` : ''}</li>)}</ul>
          ) : <p className="pv-empty">未填写</p>}
        </div>
        <div className="pv-need-card">
          <h4>核心难点</h4>
          {pain_points.length > 0 ? (
            <ul>{pain_points.map((p, i) => <li key={i}>{p.issue || p.detail}</li>)}</ul>
          ) : <p className="pv-empty">未填写</p>}
        </div>
        <div className="pv-need-card">
          <h4>最想改变的一件事</h4>
          {want_to_change ? <p>{want_to_change}</p> : <p className="pv-empty">未填写</p>}
        </div>
      </div>
    </section>
  )
}
