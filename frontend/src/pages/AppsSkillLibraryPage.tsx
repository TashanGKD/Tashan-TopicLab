import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { SkillHubCategoriesResponse, SkillHubLeaderboard, SkillHubSkillSummary } from '../api/client'
import { skillHubApi } from '../api/client'
import { FloatingActionButton } from '../components/FloatingActions'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import {
  AppsInput,
  AppsPillButton,
  AppsPanel,
  AppsInsetCard,
  AppsSkillCard,
  AppsStatusCard,
  CategoryStrip,
  ClusterStrip,
} from '../components/apps/appsShared'

const SORT_OPTIONS = [
  { key: 'hot', label: '热门' },
  { key: 'top', label: '高分' },
  { key: 'new', label: '最新' },
] as const

export default function AppsSkillLibraryPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [cluster, setCluster] = useState('')
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]['key']>('hot')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillHubSkillSummary[]>([])
  const [leaderboard, setLeaderboard] = useState<SkillHubLeaderboard | null>(null)
  const [categories, setCategories] = useState<SkillHubCategoriesResponse | null>(null)

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const [skillsRes, categoriesRes, leaderboardRes] = await Promise.all([
          skillHubApi.listSkills({
            category,
            cluster: cluster || undefined,
            q: query || undefined,
            sort,
            limit: 12,
          }),
          skillHubApi.listCategories(),
          skillHubApi.listLeaderboard(),
        ])
        if (!alive) return
        setSkills(skillsRes.data.list)
        setCategories(categoriesRes.data)
        setLeaderboard(leaderboardRes.data)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : '科研技能专区加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
    return () => {
      alive = false
    }
  }, [category, cluster, sort, query])

  const hotUsers = useMemo(() => leaderboard?.users.slice(0, 5) ?? [], [leaderboard])

  const primaryFabStyle = {
    background: 'linear-gradient(180deg, rgba(51,65,85,0.68) 0%, rgba(30,41,59,0.54) 100%)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(16px) saturate(1.15)',
  } as const

  return (
    <ImmersiveAppShell title="科研技能专区">
      <section className="mt-4">
        <h2 className="text-[2.2rem] font-serif font-semibold leading-tight sm:text-[2.8rem]" style={{ color: 'var(--text-primary)' }}>
          科研技能专区
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          这里收录科研场景下的可安装应用；其中很多底层能力形态是 skill，但前台统一按应用展示。你可以按一级学科与研究领域（Cluster）筛选，查看详情、作者排行，并参与评测、许愿、发布与个人管理。
        </p>
      </section>

      <section className="mt-6 space-y-2">
        <p className="text-xs font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
          一级学科
        </p>
        <CategoryStrip disciplines={categories?.disciplines ?? []} activeKey={category} onChange={setCategory} />
      </section>

      <section className="mt-5 space-y-2">
        <p className="text-xs font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
          研究领域（Cluster）
        </p>
        <ClusterStrip clusters={categories?.clusters ?? []} activeKey={cluster} onChange={setCluster} />
      </section>

      <section className="mt-6 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <AppsPillButton
              key={option.key}
              onClick={() => setSort(option.key)}
              variant={sort === option.key ? 'primary' : 'secondary'}
              style={sort === option.key
                ? { borderColor: 'var(--text-primary)', backgroundColor: 'var(--text-primary)', color: '#fff' }
                : undefined}
            >
              {option.label}
            </AppsPillButton>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            navigate(`/apps/skills/search?q=${encodeURIComponent(query)}`)
          }}
          className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:items-center"
        >
          <AppsInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能或关键词"
            className="h-10 min-w-0 flex-1 rounded-full py-0 leading-10 outline-none"
          />
          <AppsPillButton type="submit" className="h-10 shrink-0 px-5 leading-none whitespace-nowrap sm:w-auto sm:self-center">
            搜索
          </AppsPillButton>
        </form>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_18rem]">
        <div>
          {error ? (
            <AppsStatusCard tone="error">
              {error}
            </AppsStatusCard>
          ) : null}
          <div className={`space-y-3${error ? ' mt-4' : ''}`}>
            {skills.map((skill) => (
              <AppsSkillCard
                key={skill.id}
                skill={skill}
                actions={(
                  <div className="flex flex-col items-end gap-2">
                    <AppsPillButton
                      onClick={() => navigate(`/apps/skills/${skill.slug}`)}
                      className="px-3 py-1.5 text-xs"
                    >
                      打开详情
                    </AppsPillButton>
                  </div>
                )}
              />
            ))}
            {!loading && skills.length === 0 ? (
              <AppsStatusCard className="py-5">
                暂无可展示的科研应用。
              </AppsStatusCard>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4">
          <AppsPanel className="rounded-[22px]">
            <h3 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
              排行榜
            </h3>
            <div className="mt-4 space-y-3">
              {hotUsers.map((user, index) => (
                <AppsInsetCard key={user.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>#{index + 1}</div>
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{user.display_name}</div>
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{user.balance} pts</div>
                </AppsInsetCard>
              ))}
            </div>
            <Link to="/apps/skills/leaderboard" className="mt-4 inline-block text-sm underline underline-offset-4" style={{ color: 'var(--text-secondary)' }}>
              查看全部排名
            </Link>
          </AppsPanel>
        </aside>
      </section>

      <div
        className="fixed right-[max(1rem,env(safe-area-inset-right))] z-[35] flex flex-col items-center gap-3"
        style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <FloatingActionButton
          ariaLabel="许愿墙"
          to="/apps/skills/wishes"
          iconColorClassName="text-white hover:text-white"
          style={primaryFabStyle}
        >
          <svg className="relative h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 2.25v4M12 17.75v4M2.25 12h4M17.75 12h4M5.4 5.4l2.9 2.9M15.7 15.7l2.9 2.9M18.6 5.4l-2.9 2.9M8.3 15.7l-2.9 2.9"
            />
          </svg>
        </FloatingActionButton>
        <FloatingActionButton
          ariaLabel="上传技能"
          to="/apps/skills/publish"
          iconColorClassName="text-white hover:text-white"
          style={primaryFabStyle}
        >
          <svg className="relative h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.65}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v9"
            />
          </svg>
        </FloatingActionButton>
      </div>
    </ImmersiveAppShell>
  )
}
