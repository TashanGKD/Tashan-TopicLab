import type { ReactNode } from 'react'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type LineSeries = {
  key: string
  label: string
  color: string
}

type BarSeries = {
  key: string
  label: string
  color: string
}

type ChartDatum = Record<string, string | number>

function ChartShell({
  title,
  subtitle,
  children,
  height = 280,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  height?: number
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      {title ? <div className="text-sm font-semibold text-slate-900">{title}</div> : null}
      {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
      <div className="mt-4" style={{ height }}>
        {children}
      </div>
    </div>
  )
}

function BaseTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: string | number; color?: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
      {label ? <div className="text-xs font-semibold text-slate-900">{label}</div> : null}
      <div className="mt-2 space-y-1">
        {payload.map((item) => (
          <div key={`${item.name}-${item.value}`} className="flex items-center justify-between gap-4 text-xs text-slate-600">
            <div className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color || '#64748b' }} />
              <span>{item.name}</span>
            </div>
            <span className="font-mono text-slate-900">{item.value ?? '--'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MultiLineTrendChart({
  title,
  subtitle,
  data,
  lines,
  xKey,
}: {
  title?: string
  subtitle?: string
  data: ChartDatum[]
  lines: LineSeries[]
  xKey: string
}) {
  return (
    <ChartShell title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<BaseTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

export function GroupedBarTrendChart({
  title,
  subtitle,
  data,
  bars,
  xKey,
  horizontal = false,
  height,
}: {
  title?: string
  subtitle?: string
  data: ChartDatum[]
  bars: BarSeries[]
  xKey: string
  horizontal?: boolean
  height?: number
}) {
  const layout = horizontal ? 'vertical' : 'horizontal'
  return (
    <ChartShell title={title} subtitle={subtitle} height={height ?? (horizontal ? 360 : 280)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={layout}
          margin={horizontal ? { top: 8, right: 24, left: 24, bottom: 0 } : { top: 8, right: 12, left: -18, bottom: 0 }}
          barGap={6}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis
                dataKey={xKey}
                type="category"
                width={140}
                tick={{ fill: '#475569', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            </>
          )}
          <Tooltip content={<BaseTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {bars.map((bar) => (
            <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={bar.color} radius={[8, 8, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

export function DonutBreakdownChart({
  title,
  subtitle,
  data,
  dataKey,
  nameKey,
  colors,
  centerLabel,
}: {
  title?: string
  subtitle?: string
  data: ChartDatum[]
  dataKey: string
  nameKey: string
  colors: string[]
  centerLabel?: string
}) {
  const total = data.reduce((sum, item) => sum + Number(item[dataKey] || 0), 0)

  return (
    <ChartShell title={title} subtitle={subtitle} height={300}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<BaseTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius={72} outerRadius={104} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={`${String(entry[nameKey])}-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          {centerLabel ? (
            <>
              <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="fill-slate-500 text-[12px]">
                {centerLabel}
              </text>
              <text x="50%" y="56%" textAnchor="middle" dominantBaseline="central" className="fill-slate-900 text-[24px] font-semibold">
                {total}
              </text>
            </>
          ) : null}
        </PieChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}
