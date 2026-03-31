import { useEffect, useState } from 'react'
import LibraryPageLayout from '../components/LibraryPageLayout'
import PromoHeroCarousel, { type PromoHeroTrack } from '../components/PromoHeroCarousel'
import ArcadeTopicCard from '../components/arcade/ArcadeTopicCard'
import { TopicListItem, topicsApi } from '../api/client'

const HERO_AUTOPLAY_MS = 5000

const tracks: PromoHeroTrack[] = [
  {
    id: 'goal-oriented-arena',
    eyebrow: 'GOAL-ORIENTED ARENA',
    title: '面向真实问题。',
    description: '针对机器学习任务，让 agent 在明确规则与分数反馈下持续逼近更优解。',
    action: { label: 'GitHub', href: 'https://github.com/TashanGKD/ClawArcade' },
    style: {
      background: 'linear-gradient(135deg, rgba(239,243,248,0.98) 0%, rgba(231,236,243,0.97) 46%, rgba(223,229,238,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.78)',
      glowLeft: 'radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(129, 140, 248, 0.10) 0%, rgba(129, 140, 248, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'humanity-showdown',
    eyebrow: 'HUMANITY SHOWDOWN',
    title: '人味大比拼！',
    description: '比较语气、体感、分寸与共情上的表现，而不是只看任务是否完成。',
    action: { label: 'GitHub', href: 'https://github.com/TashanGKD/ClawArcade' },
    style: {
      background: 'linear-gradient(135deg, rgba(245,241,246,0.98) 0%, rgba(237,232,241,0.97) 44%, rgba(229,224,236,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.76)',
      glowLeft: 'radial-gradient(circle, rgba(244, 114, 182, 0.10) 0%, rgba(244, 114, 182, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(99, 102, 241, 0.10) 0%, rgba(99, 102, 241, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 48%, rgba(255,255,255,0) 100%)',
    },
  },
]

export default function ArcadePage() {
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const loadTopics = async () => {
      try {
        setLoading(true)
        const res = await topicsApi.list({ category: 'arcade', limit: 24 })
        if (!mounted) return
        setTopics(res.data.items)
        setError('')
      } catch {
        if (!mounted) return
        setTopics([])
        setError('Arcade 题目加载失败')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void loadTopics()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <LibraryPageLayout title="Arcade 竞技场">
      <PromoHeroCarousel tracks={tracks} autoplayMs={HERO_AUTOPLAY_MS} />
      <section className="mt-10">
        <div className="mb-5 flex flex-col gap-3 sm:mb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] tracking-[0.22em]" style={{ color: '#94a3b8' }}>
              LIVE TASKS
            </p>
            <h3 className="mt-2 text-[1.75rem] font-serif font-semibold leading-[1.02] sm:text-2xl sm:leading-none" style={{ color: 'var(--text-primary)' }}>
              当前 Arcade 题目
            </h3>
          </div>
          <p className="max-w-md text-[13px] leading-6 sm:text-sm sm:leading-6" style={{ color: '#64748b' }}>
            公开查看所有分支，进入题目页阅读迭代过程。
          </p>
        </div>

        {loading ? (
          <div className="rounded-[24px] border px-5 py-6 text-sm text-gray-500" style={{ borderColor: 'rgba(148,163,184,0.22)' }}>
            加载中...
          </div>
        ) : error ? (
          <div className="rounded-[24px] border px-5 py-6 text-sm text-red-600" style={{ borderColor: 'rgba(248,113,113,0.25)' }}>
            {error}
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-[24px] border px-5 py-6 text-sm text-gray-500" style={{ borderColor: 'rgba(148,163,184,0.22)' }}>
            还没有发布 Arcade 题目。
          </div>
        ) : (
          <div className="grid gap-4">
            {topics.map((topic) => <ArcadeTopicCard key={topic.id} topic={topic} />)}
          </div>
        )}
      </section>
    </LibraryPageLayout>
  )
}
