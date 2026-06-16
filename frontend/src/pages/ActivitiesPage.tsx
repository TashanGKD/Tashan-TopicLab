import { Link } from 'react-router-dom'

import challengeCupOfficialBannerUrl from '../assets/challenge-cup-official-banner.webp'
import youthTedPosterUrl from '../assets/tashan-youth-ted-poster.webp'

const activities = [
  {
    title: '他山青年 TED',
    subtitle: '周三前沿分享',
    body: '青年行动者围绕 AI 前沿、Agent 工具和真实项目展开分享与讨论。',
    href: '/youth-ted',
    image: youthTedPosterUrl,
    imageAlt: '他山青年 TED 活动海报',
    tone: 'bg-sky-50 text-sky-700 ring-sky-100',
  },
  {
    title: '灵感共创队',
    subtitle: '周五难题攻关',
    body: '把真实问题、需求和代码带到桌面上，用小样本和原型推进下一步。',
    href: '/inspiration-co-creation',
    image: '/media/inspiration-co-creation/poster.webp',
    imageAlt: '灵感共创队活动海报',
    tone: 'bg-teal-50 text-teal-700 ring-teal-100',
  },
  {
    title: '挑战杯专题',
    subtitle: '公众科学题单',
    body: '围绕 Science 125 个前沿问题和挑战杯真实任务，整理问题、材料与验证过程。',
    href: '/challenge-cup-topic',
    image: challengeCupOfficialBannerUrl,
    imageAlt: '挑战杯官方横幅',
    tone: 'bg-slate-100 text-slate-700 ring-slate-200',
  },
] as const

export default function ActivitiesPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <section className="px-5 pb-8 pt-10 sm:px-8 lg:px-10 lg:pb-12 lg:pt-16">
        <div className="mx-auto w-full max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Activities</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">活动</h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
            每周分享、共创线索和公众科学题单都放在这里，方便顺着真实问题继续参与。
          </p>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-10 lg:pb-24">
        <div className="mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-3">
          {activities.map((activity) => (
            <Link
              key={activity.href}
              to={activity.href}
              className="group overflow-hidden rounded-[var(--radius-lg)] border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-sky-200 hover:shadow-[0_24px_64px_rgba(15,23,42,0.10)]"
            >
              <div className="aspect-[16/10] overflow-hidden bg-slate-100">
                <img
                  src={activity.image}
                  alt={activity.imageAlt}
                  className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.02]"
                />
              </div>
              <div className="p-5 sm:p-6">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${activity.tone}`}>
                  {activity.subtitle}
                </span>
                <h2 className="mt-4 text-2xl font-semibold leading-tight">{activity.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{activity.body}</p>
                <span className="mt-5 inline-flex items-center text-sm font-semibold text-slate-950">
                  进入
                  <span aria-hidden="true" className="ml-1 transition group-hover:translate-x-1">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
