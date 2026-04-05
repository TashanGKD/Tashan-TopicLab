import type { ReactNode } from 'react'

export interface AgentSkillCardModule {
  /** 模块唯一标识 */
  id: string
  /** 模块类型 */
  type: 'header' | 'title' | 'description' | 'actions' | 'metrics' | 'custom' | 'tags' | 'alert' | 'code'
  /** 模块内容（根据类型不同而不同） */
  content?: ReactNode | string | MetricItem[] | ActionButton[] | TagItem[]
  /** 模块样式覆盖 */
  className?: string
  /** 是否隐藏 */
  hidden?: boolean
  /** 额外 props */
  [key: string]: any
}

export interface MetricItem {
  label: string
  value: number | string
}

export interface ActionButton {
  label: string
  href?: string
  onClick?: () => void
  variant?: 'primary' | 'secondary'
  icon?: ReactNode
}

export interface TagItem {
  label: string
  color?: string
}

export interface AgentSkillCardProps {
  /** 卡片标题 */
  title?: string
  /** 卡片标签（右上角小标签） */
  badge?: string
  /** 主描述文本 */
  description?: string
  /** 副描述文本（可选） */
  subDescription?: string
  /** 标题右侧的自定义内容（如按钮） */
  titleAction?: ReactNode
  /** 自定义模块列表 */
  modules?: AgentSkillCardModule[]
  /** 背景渐变色 */
  backgroundGradient?: string
  /** 装饰色（光晕颜色） */
  accentColor?: string
  /** 底部间距 */
  marginBottom?: 'mb-0' | 'mb-4' | 'mb-6' | 'mb-8' | 'mb-10' | 'mb-12'
  /** 自定义类名 */
  className?: string
}

export function AgentSkillCard({
  title,
  badge,
  description,
  subDescription,
  titleAction,
  modules,
  backgroundGradient = 'linear-gradient(135deg, rgba(239,243,248,0.98) 0%, rgba(231,236,243,0.97) 46%, rgba(223,229,238,0.98) 100%)',
  accentColor = 'rgba(56, 189, 248, 0.12)',
  marginBottom = 'mb-4',
  className,
}: AgentSkillCardProps) {
  return (
    <section
      className={`relative h-full ${marginBottom} overflow-hidden rounded-[28px] border px-5 py-6 sm:rounded-[32px] sm:px-7 sm:py-7 ${className || ''}`}
      style={{
        borderColor: 'rgba(203, 213, 225, 0.78)',
        background: backgroundGradient,
        boxShadow: '0 24px 60px rgba(148, 163, 184, 0.14)',
      }}
    >
      {/* 装饰性背景元素 */}
      <div
        className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${accentColor} 0%, rgba(56, 189, 248, 0) 70%)` }}
      />
      <div
        className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, rgba(129, 140, 248, 0.1) 0%, rgba(129, 140, 248, 0) 72%)` }}
      />
      <div
        className="animate-soft-shimmer pointer-events-none absolute inset-y-0 left-[-12%] w-[28%]"
        style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0) 100%)' }}
      />
      <div
        className="pointer-events-none absolute inset-x-10 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.78) 50%, rgba(255,255,255,0) 100%)' }}
      />

      <div className="relative flex h-full flex-col gap-4">
        {/* 默认头部区域 */}
        {(badge || title || description) && (
          <div className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8">
            <div className="animate-stage-enter-left min-w-0 max-w-3xl lg:max-w-none">
              {badge && (
                <p
                  className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]"
                  style={{
                    color: 'rgba(100,116,139,0.9)',
                    backgroundColor: 'rgba(255,255,255,0.52)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255,255,255,0.55)',
                  }}
                >
                  {badge}
                </p>
              )}

              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                {title && (
                  <h2
                    className={`mt-5 max-w-2xl text-[2.15rem] font-serif font-semibold leading-[0.96] sm:mt-6 sm:text-5xl sm:leading-[0.98] ${badge ? '' : 'mt-0'}`}
                    style={{
                      color: '#1f2937',
                      textShadow: '0 1px 0 rgba(255,255,255,0.65)',
                    }}
                  >
                    {title}
                  </h2>
                )}
                {titleAction && (
                  <div className="mt-4 lg:mt-0 lg:shrink-0">
                    {titleAction}
                  </div>
                )}
              </div>

              {description && (
                <p
                  className="mt-4 max-w-xl text-[13px] leading-6 sm:text-[15px] sm:leading-7"
                  style={{ color: '#64748b' }}
                >
                  {description}
                </p>
              )}

              {subDescription && (
                <p
                  className="mt-3 max-w-2xl text-xs leading-6 sm:text-[13px]"
                  style={{ color: 'rgba(100, 116, 139, 0.9)' }}
                >
                  {subDescription}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 自定义模块渲染 */}
        {modules?.map((module) => {
          if (module.hidden) return null

          switch (module.type) {
            case 'header':
              return <div key={module.id} className={module.className}>{module.content as ReactNode}</div>

            case 'title':
              return (
                <h2
                  key={module.id}
                  className={`text-[2.15rem] font-serif font-semibold sm:text-5xl ${module.className || ''}`}
                  style={{ color: '#1f2937', textShadow: '0 1px 0 rgba(255,255,255,0.65)' }}
                >
                  {module.content as ReactNode}
                </h2>
              )

            case 'description':
              return (
                <p
                  key={module.id}
                  className={`text-[13px] leading-6 sm:text-[15px] sm:leading-7 ${module.className || ''}`}
                  style={{ color: (module as any).style?.color || '#64748b' }}
                >
                  {module.content as ReactNode}
                </p>
              )

            case 'actions': {
              const actions = module.content as ActionButton[] || []
              return (
                <div key={module.id} className={`mt-5 flex flex-wrap gap-2 ${module.className || ''}`}>
                  {actions.map((action, idx) => (
                    <a
                      key={idx}
                      href={action.href}
                      onClick={action.onClick}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 ${
                        action.variant === 'primary'
                          ? 'bg-slate-950 text-white'
                          : 'border border-slate-300 bg-white text-slate-800 hover:border-slate-400'
                      }`}
                    >
                      {action.label}
                      {action.icon && <span aria-hidden="true">{action.icon}</span>}
                    </a>
                  ))}
                </div>
              )
            }

            case 'metrics': {
              const metrics = module.content as MetricItem[] || []
              return (
                <div key={module.id} className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 ${module.className || ''}`}>
                  {metrics.map((metric, idx) => (
                    <div
                      key={idx}
                      className="rounded-[22px] border px-4 py-3 transition-transform duration-300 hover:-translate-y-0.5"
                      style={{
                        borderColor: 'rgba(148,163,184,0.22)',
                        backgroundColor: 'rgba(255,255,255,0.76)',
                        boxShadow: '0 10px 30px rgba(148, 163, 184, 0.08)',
                        backdropFilter: 'blur(10px)',
                      }}
                    >
                      <p className="text-[11px]" style={{ color: '#94a3b8' }}>{metric.label}</p>
                      <p className="mt-1 text-lg font-semibold sm:text-xl" style={{ color: '#1f2937' }}>
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>
              )
            }

            case 'tags': {
              const tags = module.content as TagItem[] || []
              return (
                <div key={module.id} className={`flex flex-wrap items-center gap-1 text-[11px] sm:text-[13px] ${module.className || ''}`} style={{ color: '#64748b' }}>
                  {tags.map((tag, idx) => (
                    <span key={tag.label}>
                      {tag.label}
                      {idx < tags.length - 1 && <span className="mx-1 text-slate-400">/</span>}
                    </span>
                  ))}
                </div>
              )
            }

            case 'alert':
              return (
                <div
                  key={module.id}
                  className={`flex flex-col gap-3 rounded-[24px] border px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5 ${module.className || ''}`}
                  style={{
                    borderColor: 'rgba(245, 158, 11, 0.18)',
                    background: 'linear-gradient(135deg, rgba(255, 248, 235, 0.95), rgba(255, 251, 243, 0.92))',
                    color: '#92400E',
                    boxShadow: '0 10px 28px rgba(217, 119, 6, 0.08)',
                  }}
                >
                  {module.content as ReactNode}
                </div>
              )

            case 'code':
              return (
                <div
                  key={module.id}
                  className={`rounded-[24px] border px-4 py-4 sm:px-5 ${module.className || ''}`}
                  style={{
                    borderColor: 'rgba(148,163,184,0.22)',
                    background: 'rgba(255,255,255,0.72)',
                    boxShadow: '0 10px 30px rgba(148, 163, 184, 0.08)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  {module.content as ReactNode}
                </div>
              )

            case 'custom':
              return (
                <div key={module.id} className={module.className}>
                  {module.content as ReactNode}
                </div>
              )

            default:
              return null
          }
        })}
      </div>
    </section>
  )
}

export default AgentSkillCard
