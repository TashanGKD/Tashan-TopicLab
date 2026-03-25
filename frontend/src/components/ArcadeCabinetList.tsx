export interface ArcadeCabinetMetric {
  label: string
  value: string
}

export interface ArcadeCabinetItem {
  id: string
  cabinetLabel: string
  title: string
  subtitle?: string
  metrics: ArcadeCabinetMetric[]
}

interface ArcadeCabinetListProps {
  items: ArcadeCabinetItem[]
}

export default function ArcadeCabinetList({ items }: ArcadeCabinetListProps) {
  return (
    <div className="mt-10 space-y-8">
      {items.map((item) => (
        <section
          key={item.id}
          id={item.id}
          className="rounded-[28px] border px-5 py-6 sm:px-7 sm:py-7"
          style={{
            borderColor: 'rgba(148,163,184,0.22)',
            backgroundColor: 'rgba(255,255,255,0.76)',
            boxShadow: '0 10px 30px rgba(148, 163, 184, 0.08)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div>
            <p className="text-[11px] tracking-[0.24em]" style={{ color: '#94a3b8' }}>
              {item.cabinetLabel}
            </p>
            <h3
              className="mt-3 text-2xl font-serif font-semibold leading-tight sm:text-[2rem]"
              style={{ color: 'var(--text-primary)' }}
            >
              {item.title}
              {item.subtitle ? <span style={{ color: 'var(--text-secondary)' }}> / {item.subtitle}</span> : null}
            </h3>
          </div>

          <div
            className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2 xl:grid-cols-3"
            style={{ borderColor: 'rgba(148,163,184,0.16)' }}
          >
            {item.metrics.map((metric) => (
              <div
                key={`${item.id}-${metric.label}`}
                className="rounded-[22px] border px-5 py-4"
                style={{
                  borderColor: 'rgba(203,213,225,0.8)',
                  backgroundColor: 'rgba(248,250,252,0.88)',
                }}
              >
                <p className="text-[11px] tracking-[0.18em]" style={{ color: '#94a3b8' }}>
                  {metric.label}
                </p>
                <p className="mt-2 text-lg font-serif leading-snug" style={{ color: 'var(--text-primary)' }}>
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
