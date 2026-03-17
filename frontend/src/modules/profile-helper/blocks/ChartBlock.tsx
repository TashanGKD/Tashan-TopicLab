interface ChartBlockProps {
  chartType: 'radar' | 'bar'
  title: string
  dimensions: string[]
  values: number[]
  maxValue?: number
}

type InternalChartProps = Omit<ChartBlockProps, 'chartType'>

export function ChartBlock({ chartType, title, dimensions, values, maxValue = 5 }: ChartBlockProps) {
  if (chartType === 'radar') {
    return <RadarChart title={title} dimensions={dimensions} values={values} maxValue={maxValue} />
  }
  return <BarChart title={title} dimensions={dimensions} values={values} maxValue={maxValue} />
}

function RadarChart({ title, dimensions, values, maxValue }: InternalChartProps) {
  const size = 280
  const center = size / 2
  const radius = 110
  const n = dimensions.length
  if (n < 3) return <BarChart title={title} dimensions={dimensions} values={values} maxValue={maxValue!} />

  const angleStep = (2 * Math.PI) / n
  const startAngle = -Math.PI / 2

  const getPoint = (i: number, r: number) => ({
    x: center + r * Math.cos(startAngle + i * angleStep),
    y: center + r * Math.sin(startAngle + i * angleStep),
  })

  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0]

  const dataPoints = values.map((v, i) => {
    const ratio = Math.min(v / maxValue!, 1)
    return getPoint(i, radius * ratio)
  })
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'

  return (
    <div className="block-chart">
      <h4 className="chart-title">{title}</h4>
      <svg viewBox={`0 0 ${size} ${size}`} className="radar-svg">
        {gridLevels.map((level) => {
          const points = Array.from({ length: n }, (_, i) => getPoint(i, radius * level))
          const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
          return <path key={level} d={path} fill="none" stroke="#e5e7eb" strokeWidth="1" />
        })}
        {Array.from({ length: n }, (_, i) => {
          const p = getPoint(i, radius)
          return <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="1" />
        })}
        <path d={dataPath} fill="rgba(0,0,0,0.08)" stroke="#000" strokeWidth="2" />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#000" />
        ))}
        {dimensions.map((dim, i) => {
          const p = getPoint(i, radius + 24)
          return (
            <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#374151">
              {dim}
            </text>
          )
        })}
        {values.map((v, i) => {
          const p = getPoint(i, radius * Math.min(v / maxValue!, 1) + 14)
          return (
            <text key={`v${i}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#000" fontWeight="600">
              {v.toFixed(1)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function BarChart({ title, dimensions, values, maxValue }: InternalChartProps) {
  return (
    <div className="block-chart">
      <h4 className="chart-title">{title}</h4>
      <div className="bar-chart">
        {dimensions.map((dim, i) => {
          const ratio = Math.min((values[i] || 0) / (maxValue || 5), 1)
          return (
            <div key={i} className="bar-row">
              <span className="bar-label">{dim}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${ratio * 100}%` }} />
              </div>
              <span className="bar-value">{(values[i] || 0).toFixed(1)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
