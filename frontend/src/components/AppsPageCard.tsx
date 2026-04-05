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
      <div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/apps"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
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

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px] leading-6 sm:text-sm sm:leading-6" style={{ color: theme.bodyColor }}>
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
