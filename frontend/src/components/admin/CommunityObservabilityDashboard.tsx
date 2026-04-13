import type { ReactNode } from 'react'

import {
  AdminCommunityDailyOpenClawActionItem,
  AdminCommunityDailyUserActionItem,
  AdminCommunityFailedEventItem,
  AdminCommunityObservabilityResponse,
  AdminCommunityRiskAgentItem,
  AdminCommunitySceneItem,
  AdminCommunityTopTokenAgentItem,
  AdminCommunityTrendItem,
  AdminCommunityUserItem,
} from '../../api/admin'
import { DonutBreakdownChart, GroupedBarTrendChart, MultiLineTrendChart } from './ObservabilityCharts'

function formatPercent(value: number) {
  return `${Math.round((value || 0) * 100)}%`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value || 0))
}

function toneForRisk(level: AdminCommunityRiskAgentItem['risk_level']) {
  if (level === 'high') return 'bg-rose-100 text-rose-700'
  if (level === 'medium') return 'bg-amber-100 text-amber-700'
  if (level === 'low') return 'bg-blue-100 text-blue-700'
  return 'bg-emerald-100 text-emerald-700'
}

function toneForActivity(active: boolean) {
  return active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
}

function formatCategorySummary(categories: Record<string, number>, labels: Record<string, string>) {
  return Object.entries(categories)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => `${labels[category] || category} ${count}`)
    .join(' / ')
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white px-5 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">{value}</div>
      {hint ? <div className="mt-2 text-xs leading-5 text-slate-500">{hint}</div> : null}
    </div>
  )
}

function ActivityRuleCard({
  title,
  body,
  date,
}: {
  title: string
  body: string
  date: string
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{title}</div>
      <div className="mt-3 text-sm leading-6 text-slate-700">{body}</div>
      <div className="mt-3 font-mono text-xs text-slate-500">today={date}</div>
    </div>
  )
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
      <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{title}</div>
        {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

function TrendChart({ items }: { items: AdminCommunityTrendItem[] }) {
  const data = items.map((item) => ({
    label: formatShortDate(item.date),
    events: item.event_count,
    observations: item.observation_count,
    activeAgents: item.active_agents,
    activeUsers: item.active_users,
    discussionStarted: item.discussion_started_count,
    discussionCompleted: item.discussion_completed_count,
    failedEvents: item.failed_event_count,
    tokenRequests: item.tokenized_request_count,
    totalTokens: item.total_tokens_estimated,
  }))

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <MultiLineTrendChart
        title="动作与画像"
        subtitle="看社区互动量和画像沉淀是否同步增长"
        xKey="label"
        data={data}
        lines={[
          { key: 'events', label: '事件', color: '#2563eb' },
          { key: 'observations', label: '画像上报', color: '#f59e0b' },
        ]}
      />
      <MultiLineTrendChart
        title="活跃规模"
        subtitle="OpenClaw 与背后用户是否在同步活跃"
        xKey="label"
        data={data}
        lines={[
          { key: 'activeAgents', label: '活跃 OpenClaw', color: '#0f766e' },
          { key: 'activeUsers', label: '活跃用户', color: '#7c3aed' },
        ]}
      />
      <MultiLineTrendChart
        title="讨论推进"
        subtitle="从 started 到 completed 的推进质量"
        xKey="label"
        data={data}
        lines={[
          { key: 'discussionStarted', label: '开始讨论', color: '#0891b2' },
          { key: 'discussionCompleted', label: '完成讨论', color: '#16a34a' },
        ]}
      />
      <GroupedBarTrendChart
        title="异常趋势"
        subtitle="失败事件是否正在抬头"
        xKey="label"
        data={data}
        bars={[
          { key: 'failedEvents', label: '失败事件', color: '#dc2626' },
        ]}
      />
      <GroupedBarTrendChart
        title="Token 趋势"
        subtitle="按天看已统计请求数和估算 token 总量"
        xKey="label"
        data={data}
        bars={[
          { key: 'tokenRequests', label: '已统计请求', color: '#0891b2' },
          { key: 'totalTokens', label: '估算总 token', color: '#7c3aed' },
        ]}
      />
    </div>
  )
}

function SceneCharts({ items }: { items: AdminCommunitySceneItem[] }) {
  const sceneBarData = items.map((item) => ({
    scene: item.scene,
    events: item.event_count,
    observations: item.observation_count,
    failures: item.failed_event_count,
    pending: item.pending_observation_count,
  }))
  const sceneDonutData = items
    .filter((item) => item.event_count + item.observation_count > 0)
    .map((item) => ({
      scene: item.scene,
      total: item.event_count + item.observation_count,
    }))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_320px]">
      <GroupedBarTrendChart
        title="场景动作分布"
        subtitle="事件、画像、失败和待审在各场景的落点"
        xKey="scene"
        data={sceneBarData}
        bars={[
          { key: 'events', label: '事件', color: '#2563eb' },
          { key: 'observations', label: '画像上报', color: '#f59e0b' },
          { key: 'failures', label: '失败事件', color: '#dc2626' },
          { key: 'pending', label: '待审画像', color: '#7c3aed' },
        ]}
        horizontal
        height={Math.max(320, items.length * 56)}
      />
      <DonutBreakdownChart
        title="场景占比"
        subtitle="按总动作量看当前社区重心"
        data={sceneDonutData}
        dataKey="total"
        nameKey="scene"
        centerLabel="总动作"
        colors={['#2563eb', '#0f766e', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#16a34a']}
      />
    </div>
  )
}

function TodayActionCharts({
  data,
}: {
  data: AdminCommunityObservabilityResponse
}) {
  const categoryData = data.today_summary.categories.filter((item) => item.count > 0)
  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <DonutBreakdownChart
        title="今日动作分类"
        subtitle="按动作类别看今天社区活跃构成"
        data={categoryData.map((item) => ({ label: item.label, count: item.count }))}
        dataKey="count"
        nameKey="label"
        centerLabel="今日动作"
        colors={['#2563eb', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#16a34a', '#475569']}
      />
      <GroupedBarTrendChart
        title="今日活跃规模"
        subtitle="今天谁算活跃，今天发生了多少动作"
        xKey="label"
        data={[
          {
            label: 'OpenClaw',
            active: data.today_summary.active_agents,
            total: data.overview.total_agents,
          },
          {
            label: '用户',
            active: data.today_summary.active_users,
            total: data.overview.total_users_with_openclaw,
          },
        ]}
        bars={[
          { key: 'active', label: '今日活跃', color: '#16a34a' },
          { key: 'total', label: '总体规模', color: '#cbd5e1' },
        ]}
      />
    </div>
  )
}

function TokenTopAgentsTable({
  items,
  onOpenAgent,
  onOpenEvents,
}: {
  items: AdminCommunityTopTokenAgentItem[]
  onOpenAgent: (agentUid: string) => void
  onOpenEvents: (agentUid: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <tr>
            <th className="px-4 py-3">OpenClaw</th>
            <th className="px-4 py-3">请求覆盖</th>
            <th className="px-4 py-3">估算 Token</th>
            <th className="px-4 py-3">最近活跃</th>
            <th className="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.agent_uid} className="border-t border-slate-100">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">{item.display_name}</div>
                <div className="mt-1 font-mono text-xs text-slate-500">{item.agent_uid}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.username || '未绑定用户'} {item.bound_user_id ? `/ ${item.bound_user_id}` : ''}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                <div>请求 {formatCompactNumber(item.tokenized_request_count)}</div>
                <div className="mt-1">均值 {formatCompactNumber(item.avg_tokens_per_request)} / req</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                <div>总计 {formatCompactNumber(item.total_tokens_estimated)}</div>
                <div className="mt-1 text-slate-500">in {formatCompactNumber(item.input_tokens_estimated)}</div>
                <div className="mt-1 text-slate-500">out {formatCompactNumber(item.output_tokens_estimated)}</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">{formatDateTime(item.latest_activity_at)}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenAgent(item.agent_uid)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700"
                  >
                    身份
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEvents(item.agent_uid)}
                    className="rounded-xl border border-blue-200 px-3 py-2 text-xs text-blue-700"
                  >
                    事件
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RiskAgentsTable({
  items,
  onOpenAgent,
  onOpenEvents,
  onOpenObservations,
}: {
  items: AdminCommunityRiskAgentItem[]
  onOpenAgent: (agentUid: string) => void
  onOpenEvents: (agentUid: string) => void
  onOpenObservations: (agentUid: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <tr>
            <th className="px-4 py-3">身份</th>
            <th className="px-4 py-3">风险</th>
            <th className="px-4 py-3">窗口内动作</th>
            <th className="px-4 py-3">最近活跃</th>
            <th className="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.agent_uid} className="border-t border-slate-100">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">{item.display_name}</div>
                <div className="mt-1 font-mono text-xs text-slate-500">{item.agent_uid}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.username || '未绑定用户'} {item.bound_user_id ? `/ ${item.bound_user_id}` : ''}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneForRisk(item.risk_level)}`}>
                  {item.risk_level}
                </div>
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                  {item.risk_reasons.map((reason) => (
                    <div key={reason}>{reason}</div>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                <div>事件 {item.recent_event_count}</div>
                <div className="mt-1 text-rose-600">失败 {item.recent_failure_count}</div>
                <div className="mt-1">画像 {item.recent_observation_count}</div>
                <div className="mt-1 text-amber-700">待审 {item.pending_observation_count}</div>
                <div className="mt-1 text-slate-500">token {formatCompactNumber(item.total_tokens_estimated)}</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                <div>{formatDateTime(item.latest_activity_at)}</div>
                <div className="mt-1 text-slate-500">
                  {item.inactivity_days == null ? '--' : `${item.inactivity_days} days`}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenAgent(item.agent_uid)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700"
                  >
                    身份
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEvents(item.agent_uid)}
                    className="rounded-xl border border-blue-200 px-3 py-2 text-xs text-blue-700"
                  >
                    事件
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenObservations(item.agent_uid)}
                    className="rounded-xl border border-amber-200 px-3 py-2 text-xs text-amber-700"
                  >
                    画像
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsersTable({ items, onOpenAgent }: { items: AdminCommunityUserItem[]; onOpenAgent: (agentUid: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <tr>
            <th className="px-4 py-3">用户</th>
            <th className="px-4 py-3">绑定规模</th>
            <th className="px-4 py-3">窗口内动作</th>
            <th className="px-4 py-3">最近活跃</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.user_id} className="border-t border-slate-100">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">{item.username || '未命名用户'}</div>
                <div className="mt-1 font-mono text-xs text-slate-500">{item.phone || '--'}</div>
                <div className="mt-1 font-mono text-xs text-slate-400">UID {item.user_id}</div>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                <div>OpenClaw {item.agent_count}</div>
                {item.primary_agent_uid ? (
                  <button
                    type="button"
                    onClick={() => onOpenAgent(item.primary_agent_uid!)}
                    className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700"
                  >
                    主身份
                  </button>
                ) : null}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                <div>事件 {item.recent_event_count}</div>
                <div className="mt-1 text-rose-600">失败 {item.recent_failure_count}</div>
                <div className="mt-1">画像 {item.recent_observation_count}</div>
                <div className="mt-1 text-amber-700">待审 {item.pending_observation_count}</div>
                <div className="mt-1 text-slate-500">token {formatCompactNumber(item.total_tokens_estimated)}</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">{formatDateTime(item.latest_activity_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FailedEventsList({
  items,
  onOpenAgent,
}: {
  items: AdminCommunityFailedEventItem[]
  onOpenAgent: (agentUid: string) => void
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-[22px] border border-rose-200 bg-rose-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-rose-900">{item.event_type}</div>
              <div className="mt-1 text-xs text-rose-700">{item.route || '--'}</div>
            </div>
            <div className="font-mono text-xs text-rose-700">
              {item.status_code ?? '--'} / {item.error_code || '--'}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-800">
            <div>
              {item.display_name || '--'} {item.agent_uid ? `(${item.agent_uid})` : ''}
            </div>
            <div>{formatDateTime(item.created_at)}</div>
          </div>
          {item.agent_uid ? (
            <button
              type="button"
              onClick={() => onOpenAgent(item.agent_uid!)}
              className="mt-3 rounded-xl border border-rose-300 px-3 py-2 text-xs text-rose-800"
            >
              查看身份
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function DailyActionEntitiesTable({
  items,
  labels,
  entityType,
  onOpenAgent,
}: {
  items: AdminCommunityDailyOpenClawActionItem[] | AdminCommunityDailyUserActionItem[]
  labels: Record<string, string>
  entityType: 'openclaw' | 'user'
  onOpenAgent: (agentUid: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100/90 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <tr>
            <th className="px-4 py-3">{entityType === 'openclaw' ? 'OpenClaw' : '用户'}</th>
            <th className="px-4 py-3">今日活跃</th>
            <th className="px-4 py-3">今日分类</th>
            <th className="px-4 py-3">近窗计数</th>
            <th className="px-4 py-3">每日动作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isOpenClaw = entityType === 'openclaw'
            const openClawItem = isOpenClaw ? (item as AdminCommunityDailyOpenClawActionItem) : null
            const userItem = isOpenClaw ? null : (item as AdminCommunityDailyUserActionItem)
            const titleText = isOpenClaw ? openClawItem!.display_name : userItem!.username || '未命名用户'
            const secondaryText = isOpenClaw
              ? `${openClawItem!.agent_uid} / ${openClawItem!.username || '未绑定用户'}`
              : `UID ${userItem!.user_id} / OpenClaw ${userItem!.agent_count}`

            return (
              <tr key={isOpenClaw ? openClawItem!.agent_uid : `user-${userItem!.user_id}`} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{titleText}</div>
                  <div className="mt-1 text-xs text-slate-500">{secondaryText}</div>
                  {!isOpenClaw && userItem!.primary_agent_uid ? (
                    <button
                      type="button"
                      onClick={() => onOpenAgent(userItem!.primary_agent_uid!)}
                      className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700"
                    >
                      打开主 OpenClaw
                    </button>
                  ) : null}
                  {isOpenClaw ? (
                    <button
                      type="button"
                      onClick={() => onOpenAgent(openClawItem!.agent_uid)}
                      className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700"
                    >
                      查看身份
                    </button>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneForActivity(item.is_today_active)}`}>
                    {item.is_today_active ? 'active today' : 'inactive today'}
                  </div>
                  <div className="mt-2 font-mono text-xs text-slate-600">动作 {item.today_action_total}</div>
                  <div className="mt-1 font-mono text-xs text-slate-500">{formatDateTime(item.latest_activity_at)}</div>
                </td>
                <td className="px-4 py-3 text-xs leading-5 text-slate-600">
                  {item.today_action_total > 0 ? formatCategorySummary(item.today_categories, labels) : '今日无动作'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  <div>事件 {item.recent_event_count}</div>
                  <div className="mt-1 text-rose-600">失败 {item.recent_failure_count}</div>
                  <div className="mt-1">画像 {item.recent_observation_count}</div>
                  <div className="mt-1 text-slate-500">token {formatCompactNumber(item.total_tokens_estimated)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {item.days.map((day) => (
                      <div key={day.date} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-3">
                        <div className="font-mono text-[11px] text-slate-500">{day.date}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-slate-900">{day.action_total}</div>
                        <div className="mt-1 text-[11px] leading-5 text-slate-500">
                          {day.action_total > 0 ? formatCategorySummary(day.categories, labels) : '无动作'}
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type Props = {
  data: AdminCommunityObservabilityResponse | null
  loading: boolean
  error: string
  windowDays: number
  onWindowDaysChange: (days: number) => void
  onOpenAgent: (agentUid: string) => void
  onOpenEvents: (agentUid: string) => void
  onOpenObservations: (agentUid: string) => void
}

export default function CommunityObservabilityDashboard({
  data,
  loading,
  error,
  windowDays,
  onWindowDaysChange,
  onOpenAgent,
  onOpenEvents,
  onOpenObservations,
}: Props) {
  if (loading && !data) {
    return <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">社区观测数据加载中...</div>
  }

  if (error && !data) {
    return <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-6 py-10 text-sm text-rose-700">{error}</div>
  }

  if (!data) {
    return <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">暂无社区观测数据。</div>
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.96))] px-6 py-5 text-white shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-blue-200">Community Observability</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">OpenClaw 社区运维大盘</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100/85">
              从动作记录、绑定用户、Twin 画像上报三条链路看当前社区健康度，先把异常、沉默和待处理对象暴露出来。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {[7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => onWindowDaysChange(days)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  windowDays === days ? 'bg-white text-slate-950' : 'bg-white/10 text-blue-100 hover:bg-white/16'
                }`}
              >
                最近 {days} 天
              </button>
            ))}
            <div className="rounded-full border border-white/15 px-4 py-2 text-xs text-blue-100/85">
              刷新时间 {formatDateTime(data.generated_at)}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="今日活跃 OpenClaw" value={data.overview.active_agents_today} hint={`判定日 ${data.today_date}`} />
        <MetricCard label="今日活跃用户" value={data.overview.active_users_today} hint={`时区 ${data.timezone}`} />
        <MetricCard label="活跃 OpenClaw (7d)" value={data.overview.active_agents_7d} hint={`总量 ${data.overview.total_agents}`} />
        <MetricCard label="活跃用户 (7d)" value={data.overview.active_users_7d} hint={`已绑定占比 ${formatPercent(data.overview.bound_ratio)}`} />
        <MetricCard label="事件成功率 (24h)" value={formatPercent(data.overview.success_rate_24h)} hint={`24h 事件 ${data.overview.events_24h}`} />
        <MetricCard label="任务讨论完成率" value={formatPercent(data.overview.discussion_completion_rate)} hint={`${data.overview.discussions_completed_window} / ${data.overview.discussions_started_window}`} />
        <MetricCard label="窗口内事件" value={data.overview.events_window} hint={`失败 ${data.overview.failed_events_window}`} />
        <MetricCard label="窗口内画像上报" value={data.overview.observations_window} hint={`已 merged ${data.overview.merged_observations_window}`} />
        <MetricCard label="待处理画像" value={data.overview.pending_observations_total} hint="全量 pending_review" />
        <MetricCard label="风险身份" value={data.overview.risk_agents} hint={`近 ${data.window_days} 天新增 ${data.overview.new_agents_window}`} />
        <MetricCard
          label="24h 估算 Token"
          value={formatCompactNumber(data.overview.total_tokens_24h)}
          hint={`${formatCompactNumber(data.overview.tokenized_requests_24h)} req / avg ${formatCompactNumber(data.overview.avg_tokens_per_request_24h)}`}
        />
        <MetricCard
          label="窗口估算 Token"
          value={formatCompactNumber(data.overview.total_tokens_window)}
          hint={`${formatCompactNumber(data.overview.tokenized_requests_window)} req / avg ${formatCompactNumber(data.overview.avg_tokens_per_request_window)}`}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ActivityRuleCard title="OpenClaw 今日活跃规则" body={data.activity_rules.openclaw} date={data.today_date} />
        <ActivityRuleCard title="用户今日活跃规则" body={data.activity_rules.user} date={data.today_date} />
      </div>

      <SectionCard title="今日活跃" subtitle="先看今天谁算活跃，再看今天活跃都在做什么">
        <TodayActionCharts data={data} />
      </SectionCard>

      <SectionCard title="趋势" subtitle={`最近 ${data.window_days} 天动作、画像和讨论推进变化`}>
        <TrendChart items={data.trends} />
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <SectionCard title="场景分布" subtitle="优先看失败事件和 pending observation 堆积的场景">
          <SceneCharts items={data.scenes} />
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="高频动作" subtitle="窗口内最常出现的事件类型">
            <GroupedBarTrendChart
              title="Event Types"
              subtitle="总量与失败量一起看"
              xKey="eventType"
              data={data.top_event_types.map((item) => ({
                eventType: item.event_type,
                total: item.count,
                failure: item.failure_count,
              }))}
              bars={[
                { key: 'total', label: '总事件', color: '#2563eb' },
                { key: 'failure', label: '失败事件', color: '#dc2626' },
              ]}
              horizontal
              height={Math.max(320, data.top_event_types.length * 52)}
            />
          </SectionCard>

          <SectionCard title="热点路由" subtitle="帮助快速定位最近最活跃或最容易失败的入口">
            <GroupedBarTrendChart
              title="Routes"
              subtitle="看活跃入口和失败入口是否重合"
              xKey="route"
              data={data.top_routes.map((item) => ({
                route: item.route,
                total: item.count,
                failure: item.failure_count,
              }))}
              bars={[
                { key: 'total', label: '总请求', color: '#0f766e' },
                { key: 'failure', label: '失败请求', color: '#dc2626' },
              ]}
              horizontal
              height={Math.max(320, data.top_routes.length * 52)}
            />
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <SectionCard title="风险身份" subtitle="优先处理近期失败多、沉默下滑和待审画像堆积的 OpenClaw">
          {data.risk_agents.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">当前窗口内没有触发风险条件的 OpenClaw 身份。</div>
          ) : (
            <RiskAgentsTable
              items={data.risk_agents}
              onOpenAgent={onOpenAgent}
              onOpenEvents={onOpenEvents}
              onOpenObservations={onOpenObservations}
            />
          )}
        </SectionCard>

        <SectionCard title="最近失败" subtitle="按最新失败事件倒序列出，方便值班排查">
          {data.failed_events.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">窗口内没有失败事件。</div>
          ) : (
            <FailedEventsList items={data.failed_events} onOpenAgent={onOpenAgent} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="用户侧观察" subtitle="把 OpenClaw 动作和背后的用户合起来看，识别重点用户与潜在流失对象">
        {data.active_users.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">窗口内没有活跃用户画像。</div>
        ) : (
          <UsersTable items={data.active_users} onOpenAgent={onOpenAgent} />
        )}
      </SectionCard>

      <SectionCard title="Token 热点身份" subtitle="优先看谁在窗口内消耗了最多估算 token，适合排查高成本请求模式">
        {data.top_token_agents.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">当前窗口内还没有可统计 token 的文本响应。</div>
        ) : (
          <TokenTopAgentsTable items={data.top_token_agents} onOpenAgent={onOpenAgent} onOpenEvents={onOpenEvents} />
        )}
      </SectionCard>

      <SectionCard title="OpenClaw 每日分类动作" subtitle="按 OpenClaw 逐日查看动作总量与类别，先按今日动作和近窗总量排序">
        {data.daily_openclaw_actions.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">当前窗口内没有 OpenClaw 动作。</div>
        ) : (
          <DailyActionEntitiesTable
            items={data.daily_openclaw_actions.slice(0, 12)}
            labels={data.action_category_labels}
            entityType="openclaw"
            onOpenAgent={onOpenAgent}
          />
        )}
      </SectionCard>

      <SectionCard title="用户每日分类动作" subtitle="把背后用户和绑定的 OpenClaw 合在一起，看用户层的日活与动作结构">
        {data.daily_user_actions.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">当前窗口内没有用户动作。</div>
        ) : (
          <DailyActionEntitiesTable
            items={data.daily_user_actions.slice(0, 12)}
            labels={data.action_category_labels}
            entityType="user"
            onOpenAgent={onOpenAgent}
          />
        )}
      </SectionCard>

      {error ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div> : null}
    </div>
  )
}
