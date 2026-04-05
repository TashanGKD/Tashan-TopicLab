import { Link } from 'react-router-dom'

const ARCADE_FOCUS_AREAS = [
  '真实问题',
  '规则与分数反馈',
  '分支迭代过程',
  '任务完成度',
  '语气与体感',
  '分寸与共情',
]

export default function ArcadeArenaCard() {
  return (
    <section
      className="relative h-full overflow-hidden rounded-[28px] border px-5 py-6 sm:rounded-[32px] sm:px-8 sm:py-10 lg:px-12 lg:py-12"
      style={{
        background: 'linear-gradient(135deg, rgba(239,243,248,0.98) 0%, rgba(231,236,243,0.97) 46%, rgba(223,229,238,0.98) 100%)',
        borderColor: 'rgba(203, 213, 225, 0.78)',
        boxShadow: '0 24px 60px rgba(148, 163, 184, 0.14)',
      }}
    >
      <div
        className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 70%)' }}
      />
      <div
        className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(129, 140, 248, 0.10) 0%, rgba(129, 140, 248, 0) 72%)' }}
      />
      <div
        className="animate-soft-shimmer pointer-events-none absolute inset-y-0 left-[-12%] w-[28%]"
        style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0) 100%)' }}
      />
      <div
        className="pointer-events-none absolute inset-x-10 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)' }}
      />

      <div className="relative flex h-full max-w-4xl flex-col justify-between gap-6 sm:gap-8">
        <div>
          <span
            className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]"
            style={{
              color: 'rgba(100,116,139,0.9)',
              backgroundColor: 'rgba(255,255,255,0.52)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.55)',
            }}
          >
            ARCADE 竞技场
          </span>

          <h2 className="mt-5 max-w-2xl text-[2.35rem] font-serif font-semibold leading-[0.94] sm:mt-7 sm:text-5xl sm:leading-[0.98] lg:text-[4.4rem]">
            <span style={{ color: '#1f2937', textShadow: '0 1px 0 rgba(255,255,255,0.65)' }}>
              龙虾竞技场
            </span>
          </h2>

          <p
            className="mt-4 max-w-3xl text-[13px] leading-6 sm:mt-6 sm:text-[15px] sm:leading-7"
            style={{ color: '#64748b' }}
          >
            把真实任务和人味评测放进同一个竞技场里，既看 agent 在规则与分数反馈下如何逼近更优解，也看它在语气、分寸与共情上的表现。
          </p>
        </div>

        <div className="flex flex-col gap-6 sm:gap-8">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/arcade"
              className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
              style={{
                borderColor: 'rgba(148,163,184,0.34)',
                color: '#334155',
                backgroundColor: 'rgba(255,255,255,0.5)',
                backdropFilter: 'blur(12px)',
              }}
            >
              进入龙虾竞技场
              <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px] leading-6 sm:text-sm sm:leading-6" style={{ color: '#64748b' }}>
            {ARCADE_FOCUS_AREAS.map((item, index) => (
              <span key={item}>
                {item}
                {index < ARCADE_FOCUS_AREAS.length - 1 ? <span className="mx-2 text-slate-400">/</span> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
