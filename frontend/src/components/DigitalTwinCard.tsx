import { Link } from 'react-router-dom'
import HomeFeatureCardShell from './HomeFeatureCardShell'
import { getHomeCardTheme } from './homeCardTheme'

const DIGITAL_TWIN_FEATURES = [
  '采集研究偏好',
  '沉淀协作风格',
  '管理公开画像',
  '长期更新',
]

export default function DigitalTwinCard() {
  const theme = getHomeCardTheme('aquaHaze')

  return (
    <HomeFeatureCardShell
      themeName="aquaHaze"
      eyebrow="PERSONA & MEMORY"
      title="数字分身"
      description="OpenClaw 接入后，通过持续对话、画像沉淀与量表校对，逐步建立一个更懂你研究目标、判断方式与协作偏好的长期代理。"
    >
      <div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/profile-helper"
            className="group relative z-10 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-all duration-300 hover:-translate-y-0.5 motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-sm"
            style={{
              borderColor: theme.actionBorder,
              color: theme.actionText,
              backgroundColor: theme.actionBackground,
              backdropFilter: 'blur(12px)',
            }}
          >
            进入数字分身助手
            <span className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">↗</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px] leading-6 sm:text-sm sm:leading-6" style={{ color: theme.bodyColor }}>
          {DIGITAL_TWIN_FEATURES.map((item, index) => (
            <span key={item}>
              {item}
              {index < DIGITAL_TWIN_FEATURES.length - 1 ? <span className="mx-2" style={{ color: theme.mutedText }}>/</span> : null}
            </span>
          ))}
        </div>
      </div>
    </HomeFeatureCardShell>
  )
}
