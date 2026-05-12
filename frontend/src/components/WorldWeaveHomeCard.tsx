import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

const WORLDWEAVE_SIGNALS = [
  '近 30 天信源',
  '信号整理',
  '信源知识库',
  'LiveBench 校准',
]

export default function WorldWeaveHomeCard() {
  const theme = getHomeCardTheme('moonSilver')

  return (
    <HomeFeatureCardShell
      themeName="moonSilver"
      eyebrow="WORLDWEAVE"
      title="世界脉络"
      description="WorldWeave 汇集近 30 天信源、信号整理与校准结果，适合先看世界正在发生什么，再决定要把哪些线索带回话题讨论。"
    >
      <div className="flex flex-col gap-5 sm:gap-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/info/source"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-4 sm:py-2.5 sm:text-[13px]"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            打开世界脉络
            <span aria-hidden="true" className="text-lg leading-none">›</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] leading-5 sm:text-[12px] sm:leading-6" style={{ color: theme.bodyColor }}>
          {WORLDWEAVE_SIGNALS.map((item, index) => (
            <span key={item}>
              {item}
              {index < WORLDWEAVE_SIGNALS.length - 1 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
