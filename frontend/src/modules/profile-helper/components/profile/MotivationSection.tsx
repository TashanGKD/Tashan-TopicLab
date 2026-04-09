import type { StructuredProfile } from '../../types'
import { DataSourceBadge } from './DataSourceBadge'
import { InfoTooltip } from './InfoTooltip'

const DIM_TIPS: Record<string, string> = {
  know:           `内在动机·求知\n为了学习和理解新事物本身的乐趣而做科研。\n例："我做这个是因为我真的很想弄明白这个现象。"`,
  accomplishment: `内在动机·成就\n为了攻克挑战、创造成果的满足感而做科研。\n例："彻底搞定一个难题会让我很有成就感。"`,
  stimulation:    `内在动机·体验刺激\n为了探索过程本身的兴奋感和智识刺激。\n例："做实验或推导时会进入心流状态。"`,
  identified:     `外在动机·认同调节\n认同科研活动的价值，虽目标来自外部，但个人认同并接受。\n例："这对我的职业发展和社会贡献很重要。"`,
  introjected:    `外在动机·内摄调节\n由内化的外部压力驱动：自尊与成果绑定、避免内疚感。\n例："不发文章会觉得对不起自己。"`,
  external:       `外在动机·外部调节\n由外部奖惩直接驱动：导师要求、奖学金、就业压力。\n例："这个方向好发文章，以后好找工作。"`,
  amotivation:    `无动机\n对科研活动失去目的感和动力，看不到行为与结果之间的联系。\n若此维度偏高，建议关注职业意义的重新建立。`,
}

const DIM_ORDER = [
  { key: 'know',           label: '求知',     group: 'intrinsic'   },
  { key: 'accomplishment', label: '成就',     group: 'intrinsic'   },
  { key: 'stimulation',    label: '体验刺激', group: 'intrinsic'   },
  { key: 'identified',     label: '认同调节', group: 'autonomous'  },
  { key: 'introjected',    label: '内摄调节', group: 'controlled'  },
  { key: 'external',       label: '外部调节', group: 'controlled'  },
  { key: 'amotivation',    label: '无动机',   group: 'amotivation' },
]

const TIP_AMS = `学术动机量表（AMS）源自自我决定理论（SDT），测量你做科研的动力来源。\n动机从"自主"到"受控"分为7个维度：\n· 内在动机（求知/成就/体验）：最自主，持续力最强\n· 外在认同调节：认可价值，也较自主\n· 外在内摄/外部调节：受外部压力驱动\n· 无动机：缺乏目的感`
const TIP_RAI = `相对自主指数（RAI）综合反映动机的自主程度。\n公式：3×(求知+成就+体验) + 2×认同 − 内摄 − 2×外部 − 3×无动机\n正值越大 = 越自主；负值 = 受控或无动机为主。`

interface MotivationSectionProps {
  data: StructuredProfile['motivation']
}

export function MotivationSection({ data }: MotivationSectionProps) {
  const { dimensions, intrinsic_total, extrinsic_total, rai } = data
  const hasDims = Object.keys(dimensions).length > 0

  if (!hasDims) {
    return (
      <section className="pv-section">
        <h3 className="pv-section-title">学术动机 (AMS)</h3>
        <p className="pv-empty">尚未评估。</p>
      </section>
    )
  }

  return (
    <section className="pv-section">
      <div className="pv-section-header">
        <h3 className="pv-section-title">
          <InfoTooltip term="学术动机 (AMS)" content={TIP_AMS} />
        </h3>
        <DataSourceBadge source={data.source} />
      </div>
      <div className="pv-motivation-chart">
        {DIM_ORDER.map(({ key, label, group }) => {
          const val = dimensions[key] ?? 0
          return (
            <div key={key} className="pv-mot-row">
              <span className="pv-mot-label">
                <InfoTooltip term={label} content={DIM_TIPS[key] || label} />
              </span>
              <div className={`pv-mot-track group-${group}`}>
                <div className="pv-mot-fill" style={{ width: `${(val / 7) * 100}%` }} />
              </div>
              <span className="pv-mot-val">{val.toFixed(1)}</span>
            </div>
          )
        })}
      </div>
      <div className="pv-mot-summary">
        {intrinsic_total != null && <span>内在动机总分 <strong>{intrinsic_total.toFixed(1)}</strong></span>}
        {extrinsic_total != null && <span>外在动机总分 <strong>{extrinsic_total.toFixed(1)}</strong></span>}
        {rai != null && (
          <span>
            <InfoTooltip term="RAI" content={TIP_RAI} /> <strong>{rai > 0 ? '+' : ''}{rai.toFixed(1)}</strong>
          </span>
        )}
      </div>
    </section>
  )
}
