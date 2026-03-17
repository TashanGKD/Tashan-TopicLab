import type { FamousMatch } from '../types'

interface ScientistCardProps {
  scientist: FamousMatch
  rank: number
}

export function ScientistCard({ scientist, rank }: ScientistCardProps) {
  return (
    <div className="sci-card">
      <div className="sci-card-rank">#{rank}</div>
      <div className="sci-card-body">
        <div className="sci-card-header">
          <div>
            <h4 className="sci-card-name">{scientist.name}</h4>
            <p className="sci-card-name-en">{scientist.name_en}</p>
          </div>
          <span className="sci-card-similarity">{scientist.similarity}%</span>
        </div>
        <p className="sci-card-meta">{scientist.field} · {scientist.era}</p>
        <p className="sci-card-signature">{scientist.signature}</p>
        <p className="sci-card-reason">{scientist.reason}</p>
      </div>
    </div>
  )
}
