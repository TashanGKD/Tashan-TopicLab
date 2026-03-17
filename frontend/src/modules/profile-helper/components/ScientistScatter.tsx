import type { ScatterPoint } from '../types'

interface ScientistScatterProps {
  scatterData: ScatterPoint[]
  userPoint: { csi: number; rai: number }
  top3Names: string[]
}

export function ScientistScatter({ scatterData, userPoint, top3Names }: ScientistScatterProps) {
  const W = 500
  const H = 400
  const PAD = 50

  const csiMin = -24, csiMax = 24
  const raiMin = -10, raiMax = 62

  const toX = (csi: number) => PAD + ((csi - csiMin) / (csiMax - csiMin)) * (W - 2 * PAD)
  const toY = (rai: number) => H - PAD - ((rai - raiMin) / (raiMax - raiMin)) * (H - 2 * PAD)

  const cx = toX(0)
  const cy = toY(raiMin + (raiMax - raiMin) / 2)

  const ux = toX(userPoint.csi)
  const uy = toY(userPoint.rai)

  return (
    <div className="sci-scatter-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="sci-scatter-svg">
        {/* 背景 */}
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="#fafafa" stroke="#e5e7eb" />

        {/* 十字轴 */}
        <line x1={cx} y1={PAD} x2={cx} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" strokeDasharray="4,3" />
        <line x1={PAD} y1={cy} x2={W - PAD} y2={cy} stroke="#d1d5db" strokeWidth="1" strokeDasharray="4,3" />

        {/* 象限标签 */}
        <text x={PAD + 8} y={PAD + 16} fontSize="9" fill="#9ca3af">自主专精型</text>
        <text x={W - PAD - 8} y={PAD + 16} fontSize="9" fill="#9ca3af" textAnchor="end">自主整合型</text>
        <text x={PAD + 8} y={H - PAD - 8} fontSize="9" fill="#9ca3af">策略专精型</text>
        <text x={W - PAD - 8} y={H - PAD - 8} fontSize="9" fill="#9ca3af" textAnchor="end">策略整合型</text>

        {/* 轴标注 */}
        <text x={W / 2} y={H - 8} fontSize="10" fill="#6b7280" textAnchor="middle">认知风格 (CSI: 深度← →整合)</text>
        <text x={12} y={H / 2} fontSize="10" fill="#6b7280" textAnchor="middle" transform={`rotate(-90, 12, ${H / 2})`}>动机自主性 (RAI)</text>

        {/* Top3 连线 */}
        {scatterData.filter((p) => top3Names.includes(p.name)).map((p, i) => (
          <line key={`line-${i}`} x1={ux} y1={uy} x2={toX(p.csi)} y2={toY(p.rai)} stroke="#000" strokeWidth="1" strokeDasharray="3,3" opacity="0.3" />
        ))}

        {/* 科学家点 */}
        {scatterData.map((p, i) => {
          const px = toX(p.csi)
          const py = toY(p.rai)
          const isTop3 = p.is_top3
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={isTop3 ? 5 : 3.5} fill={isTop3 ? '#000' : 'none'} stroke="#000" strokeWidth={isTop3 ? 0 : 1.5} />
              <text x={px} y={py - 8} fontSize="8" fill="#374151" textAnchor="middle">
                {p.name.length > 4 ? p.name.slice(0, 4) + '..' : p.name}
              </text>
            </g>
          )
        })}

        {/* 用户点 */}
        <circle cx={ux} cy={uy} r="8" fill="#000" stroke="#fff" strokeWidth="2" />
        <text x={ux} y={uy - 14} fontSize="12" fill="#000" textAnchor="middle" fontWeight="700">我</text>
      </svg>
    </div>
  )
}
