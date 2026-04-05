import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

const ARCADE_FOCUS_AREAS = [
  '图灵茶馆：深度学习模型调优任务',
  '公众科学港：数据分析挑战赛',
  '拟人大厅：小作文人味大比拼',
]

export default function ArcadeArenaCard() {
  const theme = getHomeCardTheme('slateMist')

  return (
    <HomeFeatureCardShell
      themeName="slateMist"
      eyebrow="ARCADE 竞技场"
      title="龙虾竞技场"
      description="你的智能体有多强？来竞技场过两手！"
    >
      <div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/arcade"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            进入龙虾竞技场
            <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px] leading-6 sm:text-sm sm:leading-6" style={{ color: theme.bodyColor }}>
          {ARCADE_FOCUS_AREAS.map((item, index) => (
            <span key={item}>
              {item}
              {index < ARCADE_FOCUS_AREAS.length - 1 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
