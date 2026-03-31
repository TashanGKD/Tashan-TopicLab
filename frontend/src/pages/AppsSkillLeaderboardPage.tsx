import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { skillHubApi, type SkillHubLeaderboard } from '../api/client'
import { AppsInsetCard, AppsPanel } from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'

export default function AppsSkillLeaderboardPage() {
  const [data, setData] = useState<SkillHubLeaderboard | null>(null)

  useEffect(() => {
    let alive = true
    skillHubApi.listLeaderboard()
      .then((res) => { if (alive) setData(res.data) })
      .catch((err) => { if (alive) handleApiError(err, '加载排行榜失败') })
    return () => { alive = false }
  }, [])

  return (
    <ImmersiveAppShell title="Skill 榜单" subtitle="查看作者榜、总榜和本周热榜。">
      {!data ? (
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在加载榜单…</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-3 xl:gap-6">
          <LeaderboardSection
            title="作者榜"
            items={data.users.map((item, index) => ({
              key: item.id,
              title: item.display_name,
              subtitle: `${item.total_skills} skills · ${item.total_reviews} reviews`,
              meta: `${item.balance} pts`,
              rank: index + 1,
            }))}
          />
          <LeaderboardSection
            title="技能总榜"
            items={data.skills.map((item, index) => ({
              key: item.id,
              title: item.name,
              subtitle: `${item.cluster_name} · ${item.avg_rating.toFixed(1)} 分`,
              meta: `${item.total_downloads} 下载`,
              rank: index + 1,
              href: `/apps/skills/${item.slug}`,
            }))}
          />
          <LeaderboardSection
            title="本周热榜"
            items={data.weekly.map((item, index) => ({
              key: item.id,
              title: item.name,
              subtitle: item.summary,
              meta: `${item.weekly_downloads} 周下载`,
              rank: index + 1,
              href: `/apps/skills/${item.slug}`,
            }))}
          />
        </div>
      )}
    </ImmersiveAppShell>
  )
}

function LeaderboardSection({
  title,
  items,
}: {
  title: string
  items: Array<{ key: number; title: string; subtitle: string; meta: string; rank: number; href?: string }>
}) {
  return (
    <AppsPanel className="p-4 sm:p-5">
      <h2 className="text-xl font-serif font-semibold sm:text-2xl" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <div className="mt-3 space-y-2">
        {items.map((item) => {
          const content = (
            <AppsInsetCard className="flex items-start justify-between gap-2 rounded-xl px-3 py-2 sm:gap-2.5 sm:px-3.5 sm:py-2.5">
              <div className="min-w-0">
                <div className="text-[11px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>#{item.rank}</div>
                <div className="mt-0.5 font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{item.subtitle}</div>
              </div>
              <div className="shrink-0 self-start text-xs tabular-nums sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{item.meta}</div>
            </AppsInsetCard>
          )
          return item.href ? (
            <Link key={item.key} to={item.href} className="block rounded-xl transition-opacity hover:opacity-90">
              {content}
            </Link>
          ) : (
            <div key={item.key}>{content}</div>
          )
        })}
      </div>
    </AppsPanel>
  )
}
