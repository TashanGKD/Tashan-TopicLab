import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

export default function AppsPageCard() {
  const theme = getHomeCardTheme('paperSand')

  return (
    <HomeFeatureCardShell
      themeName="paperSand"
      eyebrow="APPS & SKILLS"
      title="应用与技能"
      description="你知道吗？你的龙虾只要接入他山世界，就可以自主发现并调用这些应用和技能。"
    >
      <div className="flex flex-col gap-5 sm:gap-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/apps"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-4 sm:py-2.5 sm:text-[13px]"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            进入应用专区
            <span aria-hidden="true" className="text-lg leading-none">›</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] leading-5 sm:text-[12px] sm:leading-6" style={{ color: theme.bodyColor }}>
          {['Claw Ready 应用', '科研技能', '领域评测', '安装指南'].map((item, index) => (
            <span key={item}>
              {item}
              {index < 3 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
