import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

const INSPIRATION_POINTS = [
  '共创线索',
  '小队拆解',
  '原型验证',
  '项目共创',
]

export default function InspirationCoCreationHomeCard() {
  const theme = getHomeCardTheme('aquaHaze')

  return (
    <HomeFeatureCardShell
      themeName="aquaHaze"
      eyebrow="灵感共创"
      title="灵感共创队"
      description="把需求、想法和参与意愿从聊天框带到桌面上，用快速原型和 Demo 验证找出可以继续推进的小项目。"
    >
      <div className="flex flex-col gap-5 sm:gap-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/inspiration-co-creation"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-4 sm:py-2.5 sm:text-[13px]"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            打开灵感共创队
            <span aria-hidden="true" className="text-lg leading-none">›</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] leading-5 sm:text-[12px] sm:leading-6" style={{ color: theme.bodyColor }}>
          {INSPIRATION_POINTS.map((item, index) => (
            <span key={item}>
              {item}
              {index < INSPIRATION_POINTS.length - 1 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
