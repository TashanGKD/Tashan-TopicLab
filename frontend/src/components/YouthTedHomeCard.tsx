import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

const YOUTH_TED_POINTS = [
  '青年同频',
  '问题讨论',
  '项目发现',
  'AI 前沿',
]

export default function YouthTedHomeCard() {
  const theme = getHomeCardTheme('deepAzure')

  return (
    <HomeFeatureCardShell
      themeName="deepAzure"
      eyebrow="YOUTH TED"
      title="他山青年 TED"
      description="他山青年 TED 是面向 AI 时代青年行动者的公益交流与共创计划。"
    >
      <div className="flex flex-col gap-5 sm:gap-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/youth-ted"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-4 sm:py-2.5 sm:text-[13px]"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            打开青年 TED
            <span aria-hidden="true" className="text-lg leading-none">›</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] leading-5 sm:text-[12px] sm:leading-6" style={{ color: theme.bodyColor }}>
          {YOUTH_TED_POINTS.map((item, index) => (
            <span key={item} className="whitespace-nowrap">
              {item}
              {index < YOUTH_TED_POINTS.length - 1 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
