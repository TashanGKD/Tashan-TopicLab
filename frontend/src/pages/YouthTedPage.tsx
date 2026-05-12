import { useEffect, useState, type ReactNode } from 'react'
import { youthTedApi, type YouthTedActivity } from '../api/client'

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

type ActivityQuestion = {
  text: string
  icon: ActivityIcon
}

type ActivityIcon = {
  viewBox?: string
  strokeWidth?: number
  paths?: string[]
  circles?: Array<{ cx: number; cy: number; r: number }>
  lines?: Array<{ x1: number; y1: number; x2: number; y2: number }>
  polylines?: string[]
  rects?: Array<{ x: number; y: number; width: number; height: number; rx?: number }>
}

const questionLayoutClasses = [
  'sm:translate-y-1 text-lg sm:text-xl bg-[#f7fbff]/95 border-sky-100/90 text-slate-950 shadow-[0_18px_42px_rgba(15,23,42,0.07)]',
  'sm:-translate-y-1 text-lg bg-[#f8fcf8]/95 border-emerald-100/90 text-slate-900 shadow-[0_16px_34px_rgba(15,23,42,0.05)]',
  'sm:translate-x-3 text-base bg-white/95 border-slate-200 text-slate-700',
  'text-base bg-[#fffaf2]/95 border-amber-100/90 text-slate-700',
  'sm:-translate-x-2 sm:translate-y-2 text-base bg-[#f8f7ff]/95 border-indigo-100/90 text-slate-700',
  'sm:translate-x-6 text-lg bg-[#f6fbfb]/95 border-teal-100/90 text-slate-900 shadow-[0_14px_30px_rgba(15,23,42,0.05)]',
  'sm:-translate-y-1 text-base bg-white/95 border-slate-200 text-slate-700',
  'sm:translate-x-4 text-base bg-[#fbfdf7]/95 border-lime-100/90 text-slate-700',
  'sm:-translate-x-1 text-base bg-[#f8fafc]/95 border-slate-200 text-slate-700',
  'sm:translate-x-5 text-base bg-[#f7fbff]/95 border-sky-100/90 text-slate-700',
]

const questionIconClasses = [
  'border-sky-100 bg-sky-50 text-sky-700 group-hover:border-sky-200 group-hover:bg-sky-100',
  'border-emerald-100 bg-emerald-50 text-emerald-700 group-hover:border-emerald-200 group-hover:bg-emerald-100',
  'border-slate-200 bg-slate-50 text-slate-500 group-hover:border-slate-300 group-hover:bg-slate-100',
  'border-amber-100 bg-amber-50 text-amber-700 group-hover:border-amber-200 group-hover:bg-amber-100',
  'border-indigo-100 bg-indigo-50 text-indigo-600 group-hover:border-indigo-200 group-hover:bg-indigo-100',
  'border-teal-100 bg-teal-50 text-teal-700 group-hover:border-teal-200 group-hover:bg-teal-100',
]

const questionIconTiltClasses = [
  'group-hover:-rotate-6',
  'group-hover:rotate-5',
  'group-hover:-rotate-3',
  'group-hover:rotate-6',
  'group-hover:-rotate-5',
  'group-hover:rotate-3',
]

const defaultQuestionIcon: ActivityIcon = {
  paths: ['M9 9h6', 'M9 13h4', 'M12 20a8 8 0 1 0-7.4-5L4 20l5-1.4Z'],
}

function readStringField(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return null
}

function readIconField(value: unknown): ActivityIcon | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const icon: ActivityIcon = {}
  if (typeof record.viewBox === 'string' && record.viewBox.trim()) icon.viewBox = record.viewBox.trim()
  if (typeof record.strokeWidth === 'number') icon.strokeWidth = record.strokeWidth
  if (Array.isArray(record.paths)) {
    icon.paths = record.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
  }
  if (Array.isArray(record.polylines)) {
    icon.polylines = record.polylines.filter(
      (points): points is string => typeof points === 'string' && points.trim().length > 0,
    )
  }
  if (Array.isArray(record.circles)) {
    icon.circles = record.circles.filter((circle): circle is { cx: number; cy: number; r: number } => {
      if (!circle || typeof circle !== 'object') return false
      const raw = circle as Record<string, unknown>
      return typeof raw.cx === 'number' && typeof raw.cy === 'number' && typeof raw.r === 'number'
    })
  }
  if (Array.isArray(record.lines)) {
    icon.lines = record.lines.filter((line): line is { x1: number; y1: number; x2: number; y2: number } => {
      if (!line || typeof line !== 'object') return false
      const raw = line as Record<string, unknown>
      return (
        typeof raw.x1 === 'number' &&
        typeof raw.y1 === 'number' &&
        typeof raw.x2 === 'number' &&
        typeof raw.y2 === 'number'
      )
    })
  }
  if (Array.isArray(record.rects)) {
    icon.rects = record.rects.filter((rect): rect is { x: number; y: number; width: number; height: number; rx?: number } => {
      if (!rect || typeof rect !== 'object') return false
      const raw = rect as Record<string, unknown>
      return (
        typeof raw.x === 'number' &&
        typeof raw.y === 'number' &&
        typeof raw.width === 'number' &&
        typeof raw.height === 'number' &&
        (raw.rx == null || typeof raw.rx === 'number')
      )
    })
  }
  if (
    icon.paths?.length ||
    icon.polylines?.length ||
    icon.circles?.length ||
    icon.lines?.length ||
    icon.rects?.length
  ) {
    return icon
  }
  return null
}

function getActivityQuestions(item: YouthTedActivity): ActivityQuestion[] {
  const rawTopics = item.content?.topics
  const rawQuestions = item.content?.questions
  const rawTags = item.content?.tags
  const rawKeywords = item.content?.keywords
  const rawIcons = item.content?.icons
  const iconList = Array.isArray(rawIcons)
    ? rawIcons.map((icon) => readIconField(icon) ?? defaultQuestionIcon)
    : []
  const rawTerms = Array.isArray(rawTopics)
    ? rawTopics
    : Array.isArray(rawQuestions)
    ? rawQuestions
    : Array.isArray(rawKeywords)
      ? rawKeywords
      : Array.isArray(rawTags)
        ? rawTags
        : []

  return rawTerms
    .map((term, index) => {
      if (typeof term === 'string') {
        return {
          text: term.trim(),
          icon: iconList[index] || defaultQuestionIcon,
        }
      }
      return {
        text: readStringField(term, ['question', 'label', 'name', 'title', 'value', 'text']) ?? '',
        icon: readIconField((term as Record<string, unknown>).icon) ?? iconList[index] ?? defaultQuestionIcon,
      }
    })
    .filter((term) => term.text)
}

function QuestionIcon({ icon }: { icon: ActivityIcon }) {
  return (
    <svg
      viewBox={icon.viewBox ?? '0 0 24 24'}
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={icon.strokeWidth ?? 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon.rects?.map((rect, index) => (
        <rect key={`rect-${index}`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={rect.rx} />
      ))}
      {icon.circles?.map((circle, index) => (
        <circle key={`circle-${index}`} cx={circle.cx} cy={circle.cy} r={circle.r} />
      ))}
      {icon.lines?.map((line, index) => (
        <line key={`line-${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
      ))}
      {icon.polylines?.map((points, index) => (
        <polyline key={`polyline-${index}`} points={points} />
      ))}
      {icon.paths?.map((path, index) => (
        <path key={`path-${index}`} d={path} />
      ))}
    </svg>
  )
}

function formatSlugDate(slug: string): string | null {
  const match = slug.match(/(?:^|-)20(\d{2})-(\d{2})-(\d{2})(?:$|-)/)
  if (!match) return null
  return `20${match[1]}.${match[2]}.${match[3]}`
}

function getActivityDate(item: YouthTedActivity): string {
  return (
    readStringField(item.content, ['date', 'display_date', 'event_date', 'day']) ??
    formatSlugDate(item.slug) ??
    item.meta
  )
}

function splitActivityDate(date: string): { year: string; day: string } {
  const normalized = date.replace(/-/g, '.')
  const match = normalized.match(/^(20\d{2})\.(\d{2})\.(\d{2})/)
  if (!match) return { year: '', day: normalized }
  return { year: match[1], day: `${match[2]}.${match[3]}` }
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

function ActivityScheduleItem({ item }: { item: YouthTedActivity }) {
  const questions = getActivityQuestions(item).slice(0, 10)
  const activityDate = splitActivityDate(getActivityDate(item))

  return (
    <article className="grid gap-8 border-t border-slate-200 pt-8 md:grid-cols-[minmax(14rem,19rem)_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
      <div className="mx-auto aspect-[2/3] w-1/2 overflow-hidden rounded-[var(--radius-md)] bg-slate-950 shadow-[0_24px_60px_rgba(15,23,42,0.12)] md:mx-0 md:w-full">
        <img
          src={item.poster_url}
          alt={`${item.title}活动海报`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>
      <div className="relative isolate py-2">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(2,132,199,0.06)_0_1px,transparent_1px_34px)] opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_92%)]"
        />
        <div className="flex items-baseline gap-3 border-l border-slate-200 pl-4">
          {activityDate.year ? (
            <span className="text-[0.68rem] font-semibold tracking-[0.2em] text-slate-400">{activityDate.year}</span>
          ) : null}
          <span className="text-3xl font-semibold leading-none text-slate-950 sm:text-[2.55rem]">{activityDate.day}</span>
        </div>
        {questions.length > 0 ? (
          <div className="relative mt-7 max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.22em] text-slate-400">DISCUSSION QUESTIONS</p>
            <div className="mt-5 flex flex-wrap items-start gap-3 sm:gap-4">
              {questions.map((question, index) => (
                <span
                  key={`${item.id}-${question.text}-${index}`}
                  className={`group inline-flex w-fit max-w-full rounded-[1.45rem] border px-4 py-3.5 leading-none backdrop-blur transition duration-200 ease-out hover:-translate-y-1 hover:border-slate-300 hover:bg-white hover:shadow-[0_24px_58px_rgba(15,23,42,0.10)] ${questionLayoutClasses[index % questionLayoutClasses.length]}`}
                >
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition duration-200 group-hover:-translate-y-0.5 group-hover:scale-105 ${questionIconClasses[index % questionIconClasses.length]} ${questionIconTiltClasses[index % questionIconTiltClasses.length]}`}
                    >
                      <QuestionIcon icon={question.icon} />
                    </span>
                    <span>{question.text}</span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-7 max-w-2xl text-base leading-8 text-slate-600">{item.summary}</p>
        )}
      </div>
    </article>
  )
}

export default function YouthTedPage() {
  const [activities, setActivities] = useState<YouthTedActivity[]>([])
  const [activityStatus, setActivityStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

    youthTedApi
      .listActivities()
      .then((response) => {
        if (cancelled) return
        setActivities(response.data.list)
        setActivityStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setActivities([])
        setActivityStatus('error')
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
              <ActivityScheduleItem key={item.id} item={item} />
            ))}
            {activityStatus === 'loading' ? (
              <p className="border-t border-slate-200 pt-8 text-sm text-slate-500">活动加载中</p>
            ) : null}
            {activityStatus === 'error' ? (
              <p className="border-t border-slate-200 pt-8 text-sm text-slate-500">活动接口暂时未连接</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
