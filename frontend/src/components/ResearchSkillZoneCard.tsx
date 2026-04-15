import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

const RESEARCH_CLUSTERS = [
  '生物与生命科学',
  '药物研发',
  '医学与临床',
  '实验室自动化',
  '视觉与 XR',
  'AI 与大模型',
  '数据科学',
  '文献检索',
]

export default function ResearchSkillZoneCard() {
  const theme = getHomeCardTheme('sageFog')

  return (
    <HomeFeatureCardShell
      themeName="sageFog"
      eyebrow="科研应用与技能"
      title="科研技能专区"
      description="赋能科研智能体生态，集获取、分享、评测、许愿于一体的技能专区。覆盖生物、医药、医学、实验室自动化、视觉、AI、数据科学与文献检索等领域。"
    >
      <div className="flex flex-col gap-5 sm:gap-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/apps/skills"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-4 sm:py-2.5 sm:text-[13px]"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            进入科研技能专区
            <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] leading-5 sm:text-[12px] sm:leading-6" style={{ color: theme.bodyColor }}>
          {RESEARCH_CLUSTERS.map((cluster, index) => (
            <span key={cluster}>
              {cluster}
              {index < RESEARCH_CLUSTERS.length - 1 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
