import { useEffect, useState, type ReactNode } from 'react'
import { youthTedApi, type YouthTedActivity } from '../api/client'
import fallbackPosterUrl from '../assets/tashan-youth-ted-poster.webp'

const DETAILS_URL = 'https://mp.weixin.qq.com/s/KcXyglqEuaJ5PKMDLN1n1A'
const PAST_ACTIVITIES_URL = 'https://tashan.ac.cn/homepage/activities'

const builderTypes = [
  '青年科研者',
  '人工智能开发者',
  '早期创业者',
  '科创团队',
  '内容创作者',
  '跨学科实践者',
]

const fallbackActivity: YouthTedActivity = {
  id: 'frontier-ai-discussion-2026-05',
  slug: 'frontier-ai-discussion-2026-05',
  status: 'published',
  sort_order: 10,
  label: '本期活动',
  title: '前沿 AI 进展专场讨论',
  meta: '周三晚 20:00',
  summary: '围绕 Agent 与 Codex 生态、Skill 系统、AI 内容工程与开源工具，快速同步最近值得追踪的变化。',
  content: {},
  poster_url: fallbackPosterUrl,
}

function SectionHeading({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">{eyebrow}</p>
      <div className="mt-3 flex items-end gap-3">
        <h2 className="text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">{title}</h2>
        {action}
      </div>
      {children == null ? null : <p className="mt-5 text-base leading-8 text-slate-600">{children}</p>}
    </div>
  )
}

export default function YouthTedPage() {
  const [activities, setActivities] = useState<YouthTedActivity[]>([])
  const [activityStatus, setActivityStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    let cancelled = false

    youthTedApi
      .listActivities()
      .then((response) => {
        if (cancelled) return
        setActivities(response.data.list.slice(0, 1))
        setActivityStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setActivities(import.meta.env.DEV ? [fallbackActivity] : [])
        setActivityStatus('ready')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="bg-[#f6f8fb] text-slate-950">
      <section
        id="concept"
        className="relative isolate overflow-hidden border-b border-slate-200/70 bg-[#f8fbff] px-5 py-16 sm:px-8 lg:px-10 lg:py-20"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(247,251,255,0.92)_55%,rgba(241,247,252,0.96)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[66%] bg-[repeating-linear-gradient(150deg,rgba(2,132,199,0.12)_0_1px,transparent_1px_26px)] opacity-60 [mask-image:linear-gradient(to_left,black_0%,rgba(0,0,0,0.72)_42%,transparent_88%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 right-0 -z-10 h-40 bg-[linear-gradient(160deg,transparent_0_18%,rgba(2,132,199,0.10)_18.4%,transparent_19.2%_42%,rgba(15,118,110,0.08)_42.4%,transparent_43.2%_100%)] opacity-80"
        />
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <h1 className="text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
                他山青年 TED
              </h1>
              <a
                href={DETAILS_URL}
                target="_blank"
                rel="noreferrer"
                className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-800"
              >
                详情介绍
                <span aria-hidden="true" className="text-base leading-none">›</span>
              </a>
            </div>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">
              面向人工智能原生青年建设者的持续交流、早期项目发现与共创机制。
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {builderTypes.map((type) => (
              <div key={type} className="border-l-2 border-sky-500 pl-4">
                <p className="text-base font-semibold text-slate-950">{type}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">围绕 AI 前沿、真实问题和项目实践持续交流。</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-20 sm:px-8 lg:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <SectionHeading
            eyebrow="ACTIVITIES"
            title="活动日程"
            action={
              <a
                href={PAST_ACTIVITIES_URL}
                target="_blank"
                rel="noreferrer"
                className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-slate-800"
              >
                更多他山活动
                <span aria-hidden="true" className="text-base leading-none">›</span>
              </a>
            }
          >
            {null}
          </SectionHeading>
          <div className="mt-10 space-y-8">
            {activities.map((item) => (
              <article key={item.id} className="grid gap-8 border-t border-slate-200 pt-8 md:grid-cols-[minmax(14rem,20rem)_1fr]">
                <div className="aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] bg-slate-950">
                  <img
                    src={item.poster_url}
                    alt={`${item.title}活动海报`}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm font-semibold text-sky-600">{item.label}</p>
                    <p className="text-sm text-slate-500">{item.meta}</p>
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold leading-tight text-slate-950">{item.title}</h3>
                  <p className="mt-4 text-base leading-8 text-slate-600">{item.summary}</p>
                </div>
              </article>
            ))}
            {activityStatus === 'loading' ? (
              <p className="border-t border-slate-200 pt-8 text-sm text-slate-500">活动加载中</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
