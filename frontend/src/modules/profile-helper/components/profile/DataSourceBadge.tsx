interface DataSourceBadgeProps {
  source: string
}

export function DataSourceBadge({ source }: DataSourceBadgeProps) {
  if (!source) return null
  const isInferred = source.includes('推断')
  const isScale = source.includes('实测')
  return (
    <span className={`data-badge ${isInferred ? 'badge-inferred' : isScale ? 'badge-scale' : 'badge-mixed'}`}>
      {source}
    </span>
  )
}
