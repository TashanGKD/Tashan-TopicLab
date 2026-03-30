import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { SkillHubCategoriesResponse, SkillHubLeaderboard, SkillHubSkillSummary } from '../api/client'
import { skillHubApi } from '../api/client'
import { FloatingActionButton } from '../components/FloatingActions'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { CategoryStrip, SkillCard } from './skillHubShared'

const SORT_OPTIONS = [
  { key: 'hot', label: '热门' },
  { key: 'top', label: '高分' },
  { key: 'new', label: '最新' },
] as const

export default function AppsSkillLibraryPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
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
          skillHubApi.listSkills({ category, q: query || undefined, sort, limit: 12 }),
          skillHubApi.listCategories(),
          skillHubApi.listLeaderboard(),
        ])
        if (!alive) return
        setSkills(skillsRes.data.list)
        setCategories(categoriesRes.data)
        setLeaderboard(leaderboardRes.data)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'SkillHub 加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
    return () => {
      alive = false
    }
  }, [category, sort, query])

  const hotUsers = useMemo(() => leaderboard?.users.slice(0, 5) ?? [], [leaderboard])

  const primaryFabStyle = {
    background: 'linear-gradient(180deg, rgba(51,65,85,0.68) 0%, rgba(30,41,59,0.54) 100%)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(16px) saturate(1.15)',
  } as const

  return (
    <ImmersiveAppShell title="科研 Skill 专区">
      <section className="mt-4">
        <h2 className="text-[2.2rem] font-serif font-semibold leading-tight sm:text-[2.8rem]" style={{ color: 'var(--text-primary)' }}>
          科研 Skill 专区
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 sm:text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          面向科研场景的可安装技能目录：按学科筛选，支持搜索与热门 / 高分 / 最新排序；可查看详情与作者排行，并参与评测、许愿、发布与个人管理。
        </p>
      </section>

      <section className="mt-6">
        <CategoryStrip disciplines={categories?.disciplines ?? []} activeKey={category} onChange={setCategory} />
      </section>

      <section className="mt-6 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSort(option.key)}
              className="rounded-full border px-4 py-2 text-sm font-medium"
              style={{
                borderColor: sort === option.key ? 'var(--text-primary)' : 'var(--border-default)',
                backgroundColor: sort === option.key ? 'var(--text-primary)' : 'var(--bg-container)',
                color: sort === option.key ? '#fff' : 'var(--text-primary)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            navigate(`/apps/skills/search?q=${encodeURIComponent(query)}`)
          }}
          className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:items-center"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能或关键词"
            className="h-10 min-w-0 w-full flex-1 rounded-full border px-4 text-sm leading-10 outline-none"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            className="h-10 shrink-0 rounded-full border px-5 text-sm font-medium leading-none whitespace-nowrap sm:w-auto sm:self-center"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          >
            搜索
          </button>
        </form>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_18rem]">
        <div>
          <h3 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
            技能列表
          </h3>
          {error ? (
            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-default)', color: 'var(--accent-error)' }}>
              {error}
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                actions={(
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/apps/skills/${skill.slug}`)}
                      className="rounded-full border px-3 py-1.5 text-xs font-medium"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    >
                      打开详情
                    </button>
                  </div>
                )}
              />
            ))}
            {!loading && skills.length === 0 ? (
              <div className="rounded-2xl border px-4 py-5 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
                暂无可展示的 Skill。
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[22px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
              排行榜
            </h3>
            <div className="mt-4 space-y-3">
              {hotUsers.map((user, index) => (
                <div key={user.id} className="flex items-center justify-between rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>#{index + 1}</div>
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{user.display_name}</div>
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{user.balance} pts</div>
                </div>
              ))}
            </div>
            <Link to="/apps/skills/leaderboard" className="mt-4 inline-block text-sm underline underline-offset-4" style={{ color: 'var(--text-secondary)' }}>
              查看全部排名
            </Link>
          </section>
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
