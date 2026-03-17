import ReactMarkdown from 'react-markdown'
import type { StructuredProfile } from '../../types'

interface InterpretationSectionProps {
  data: StructuredProfile['interpretation']
}

export function InterpretationSection({ data }: InterpretationSectionProps) {
  const { core_driver, risks, path } = data
  const isEmpty = !core_driver && !risks && !path

  if (isEmpty) {
    return (
      <section className="pv-section">
        <h3 className="pv-section-title">综合解读</h3>
        <p className="pv-empty">尚未生成。完成画像采集后将自动生成。</p>
      </section>
    )
  }

  return (
    <section className="pv-section">
      <h3 className="pv-section-title">综合解读</h3>
      {core_driver && (
        <div className="pv-interp-card">
          <h4>核心驱动模式</h4>
          <div className="pv-interp-body"><ReactMarkdown>{core_driver}</ReactMarkdown></div>
        </div>
      )}
      {risks && (
        <div className="pv-interp-card">
          <h4>潜在风险与发展建议</h4>
          <div className="pv-interp-body"><ReactMarkdown>{risks}</ReactMarkdown></div>
        </div>
      )}
      {path && (
        <div className="pv-interp-card pv-interp-highlight">
          <h4>适合的发展路径</h4>
          <div className="pv-interp-body"><ReactMarkdown>{path}</ReactMarkdown></div>
        </div>
      )}
    </section>
  )
}
