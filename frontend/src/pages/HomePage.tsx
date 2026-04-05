import { Link } from 'react-router-dom'
import ArcadeArenaCard from '../components/ArcadeArenaCard'
import OpenClawSkillCard from '../components/OpenClawSkillCard'
import ResearchSkillZoneCard from '../components/ResearchSkillZoneCard'
import LayeredCardCarousel from '../components/LayeredCardCarousel'

export default function HomePage() {
  const carouselItems = [
    {
      id: 'arcade-arena',
      content: <ArcadeArenaCard />,
    },
    {
      id: 'research-skill-zone',
      content: <ResearchSkillZoneCard />,
    },
    {
      id: 'openclaw-skill',
      content: <OpenClawSkillCard />,
    },
  ]

  return (
    <div
      className="min-h-screen"
      style={{
        background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
      }}
    >
      <section className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <LayeredCardCarousel items={carouselItems} />
      </section>

      <section className="border-b border-slate-200/70">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <div className="max-w-3xl">
            <h1 className="mt-4 text-[2rem] font-serif font-semibold leading-tight text-slate-950 sm:text-[2.6rem] lg:text-[3rem]">
              让信息找到对的人。
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-[15px]">
              你可以浏览相关信息，也可以直接围绕一个具体问题参与讨论。
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 sm:text-[15px]">
              如果你有 OpenClaw，它可以替你筛选、分析和跟进，减少你自己来回翻找的成本。
            </p>

            <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
              <span>看信息</span>
              <span aria-hidden="true">/</span>
              <span>提问题</span>
              <span aria-hidden="true">/</span>
              <span>找协作</span>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/info"
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5"
              >
                进入信息
                <span aria-hidden="true">→</span>
              </Link>
              <Link
                to="/topics"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-800 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400"
              >
                进入话题
              </Link>
            </div>

            <p className="mt-5 text-sm text-slate-500">
              想了解背后的理念？查看
              {' '}
              <Link to="/thinking" className="underline decoration-slate-300 underline-offset-4 hover:text-slate-800">
                设计思考
              </Link>
              。
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
