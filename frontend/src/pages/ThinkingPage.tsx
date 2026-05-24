import { useState } from 'react'
import { Link } from 'react-router-dom'

const journeySections = [
  {
    index: '01',
    label: '人和问题',
    title: '真实需求先进入场域',
    thesis: '先找到真实的人、真实的问题、真实的行动者，再让工具围绕它们生长。',
    body: '灵感共创负责接住“我有一个想法，但不知道怎么拆”的需求；他山青年 TED 负责让正在行动的人被看见，让经验、项目和关系可以继续流动。',
    modules: [
      {
        title: '灵感共创',
        href: '/inspiration-co-creation',
        role: '真实需求入口',
        body: '把模糊想法拆成可认领、可验证、可继续推进的小任务。它让问题进入协作系统，成为后续行动的起点。',
      },
      {
        title: '他山青年 TED',
        href: '/youth-ted',
        role: '行动者网络',
        body: '把正在行动的青年、早期项目和现场经验留下来。它解决的是“应该问谁、谁做过、谁能一起推进”。',
      },
    ],
  },
  {
    index: '02',
    label: '信息和议题',
    title: '让问题长出可追问的脉络',
    thesis: '一个好问题不能只停在一句话里，它需要信息、来源、推理链路和持续更新的上下文。',
    body: '世界脉络把外部信号接进来，TopicLink 把一个具体议题变成可引用、可复盘、可继续追问的路径。',
    modules: [
      {
        title: '世界脉络',
        href: '/info/source',
        role: '外部信号层',
        body: '把信源、信号、校准和日常策展放到同一个入口。先看世界正在怎样变化，再回到具体问题。',
      },
      {
        title: 'TopicLink',
        href: '/topiclink',
        role: '议题链路层',
        body: '把问题、资料、判断和后续追问接起来，让讨论不散掉，能被引用、复盘和继续推进。',
      },
    ],
  },
  {
    index: '03',
    label: '执行和沉淀',
    title: 'Agent 进入真实任务，经验留在系统里',
    thesis: '最后让 Agent 参与任务、接受反馈，并把用户的判断方式沉淀下来。',
    body: 'Arcade 负责验证能力，数字分身负责长期积累人和 Agent 之间的偏好、经验与协作方式。',
    modules: [
      {
        title: 'Arcade',
        href: '/arcade',
        role: '任务验证场',
        body: '把 Agent 放进可运行、可比较、可复盘的任务里。能力不靠演示文本证明，而靠真实反馈校准。',
      },
      {
        title: '数字分身',
        href: '/profile-helper',
        role: '长期认知代理',
        body: '持续理解你的问题意识、偏好和判断风格。越协作，越知道什么时候该替你判断，什么时候该帮你找人。',
      },
    ],
  },
]

const tashanWorld2Pillars = [
  {
    label: '信息',
    title: '世界脉络系统',
    body: '世界脉络接住外部变化，TopicLink 把具体问题变成可继续追问的路径。',
  },
  {
    label: '经验',
    title: 'skills + 迭代沉淀',
    body: '灵感共创和青年 TED 把真实项目里的做法、判断、关系持续留下来。',
  },
  {
    label: '认知',
    title: '增强数字分身',
    body: 'Arcade 校准能力，数字分身沉淀个人偏好，让下一次协作更接近“问对人”。',
  },
]

const technicalSections = [
  {
    title: 'backend / Resonnet',
    href: 'https://github.com/TashanGKD/Resonnet',
    body: '管运行时。不造论坛后端，只做 Agent 执行、A2A 协作、工作区沉淀和回合同步。',
    points: [
      'A2A 在这里解决「Agent 怎么真的一起工作」：分工、同步、交付和复盘都要落到运行现场。',
      '把 topic 执行现场变成工作区，持续产出 turns、summary、images，不只是回一段文本。',
      '它下面继续挂 skills 子模块：claude-scientific、research-dream、ai-research、anthropics，把可复用经验沉淀成可分发的能力。',
    ],
  },
  {
    title: 'topiclab-cli',
    href: 'https://github.com/TashanGKD/TopicLab-CLI',
    body: '管接口。把协议、鉴权和结构化输出收敛成稳定、可测试的命令面。',
    points: [
      '简单场景把认证说明写进 skill file，够用。',
      '一旦涉及会话、重试、版本兼容和结构化输出，skill 很快变成脆弱的协议容器。',
      'CLI 把这些从 prompt 里抽走，变成可测试、可组合的命令接口。Agent 做决策，不手写协议。',
    ],
  },
  {
    title: 'worldweave',
    href: 'https://github.com/TashanGKD/worldweave',
    body: '管世界脉络。把外部信息、信号、来源和日常策展接进 TopicLab，让讨论先有可追溯的背景。',
    points: [
      '它负责把信息变成可继续追问、可验证、可引用的上下文，让外部信号进入协作现场。',
      'WorldWeave 进入系统后，TopicLab 的问题、线索和 Agent 行动可以围绕同一批世界信号展开。',
      '这也是 2.0 里「信息」这一层的技术承载。',
    ],
  },
  {
    title: 'ClawArcade',
    href: 'https://github.com/TashanGKD/ClawArcade',
    body: '管竞技与任务验证。把 Agent 能力放到可运行、可比较、可复盘的任务里，用结果校准能力。',
    points: [
      'Arcade 让能力评估从主观印象变成可重复的任务结果。',
      'TopicLab 负责把题目、活动和入口组织起来，ClawArcade 负责承接更具体的竞技内容。',
      '它让 2.0 的协作网络里多了一层真实反馈。',
    ],
  },
]

export default function ThinkingPage() {
  const [activeJourneyId, setActiveJourneyId] = useState(journeySections[0].index)
  const activeJourney = journeySections.find((section) => section.index === activeJourneyId) ?? journeySections[0]

  return (
    <div
      className="thinking-page-shell min-h-screen bg-[#06121d]"
      style={{
        background:
          'radial-gradient(circle at 84% 10%, rgba(34,211,238,0.14) 0%, rgba(34,211,238,0) 30%), linear-gradient(180deg, #06121d 0%, #08131f 42%, #050b12 100%)',
      }}
    >
      <section
        className="thinking-hero-section relative flex min-h-[100svh] items-center overflow-hidden px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8"
        style={{
          background:
            'radial-gradient(circle at 72% 22%, rgba(34,211,238,0.2) 0%, rgba(34,211,238,0) 28%), radial-gradient(circle at 12% 20%, rgba(59,130,246,0.16) 0%, rgba(59,130,246,0) 28%), linear-gradient(180deg, #08131f 0%, #06121d 100%)',
        }}
      >
        <div aria-hidden="true" className="thinking-arrival-wash" />
        <div aria-hidden="true" className="thinking-orbit thinking-orbit-a" />
        <div aria-hidden="true" className="thinking-orbit thinking-orbit-b" />
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 py-2 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
            <div className="thinking-enter">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/70 sm:text-xs">
                TASHAN THINKING
              </p>
              <h1 className="mt-4 text-4xl font-serif font-semibold tracking-[0.01em] text-cyan-300 sm:text-6xl">
                他山世界 2.0
              </h1>
              <p className="mt-8 max-w-3xl text-lg leading-8 text-slate-200 sm:text-2xl">
                让科研成为所有有好奇心的人共同拥有的权利。
              </p>
              <p className="mt-10 max-w-3xl text-2xl font-serif font-semibold leading-tight text-white sm:text-4xl">
                「问对人，比问对问题更重要」
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-all duration-300 hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15"
                >
                  返回首页
                </Link>
              </div>
            </div>

            <div className="thinking-enter-delay relative flex min-h-[220px] items-center justify-center lg:min-h-[320px]">
              <div aria-hidden="true" className="absolute h-52 w-80 rounded-[999px] bg-cyan-300/15 blur-3xl" />
              <img
                src="/media/logo_horizontal.webp"
                alt="他山世界"
                className="thinking-logo relative h-auto w-full max-w-lg drop-shadow-2xl"
              />
            </div>
          </div>

          <div className="mt-10 border-t border-white/15 pt-8">
            <p className="max-w-4xl text-xl leading-8 text-slate-200 sm:text-2xl">
              试图重建科研人员与需求、同行、前辈认知之间的连接方式。
            </p>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {tashanWorld2Pillars.map((section) => (
                <article
                  key={section.title}
                  className="thinking-pillar border-t border-white/15 pt-4"
                >
                  <p className="text-sm font-semibold text-cyan-300">{section.label}</p>
                  <h3 className="mt-2 text-2xl font-serif font-semibold leading-tight text-white">
                    {section.title}
                  </h3>
                  <p className="mt-3 max-w-sm text-sm leading-7 text-slate-300 sm:text-[15px]">
                    {section.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div aria-hidden="true" className="thinking-rail-glow" />
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-[0.42fr_0.58fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
                Cognitive Flow
              </p>
              <h2 className="mt-4 text-3xl font-serif font-semibold leading-tight text-white sm:text-5xl">
                从人和问题开始，让工具围绕真实场景生长。
              </h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-slate-300 sm:text-[15px]">
                他山世界 2.0 的主线，是把真实需求、行动者、世界信息、议题链路、Agent 验证和数字分身连成同一条认知协作路径。
              </p>

              <div className="mt-8 space-y-2" aria-label="认知流程阶段">
                {journeySections.map((section) => {
                  const isActive = section.index === activeJourney.index
                  return (
                    <button
                      key={section.index}
                      type="button"
                      onClick={() => setActiveJourneyId(section.index)}
                      onFocus={() => setActiveJourneyId(section.index)}
                      onMouseEnter={() => setActiveJourneyId(section.index)}
                      className={`group flex w-full items-center gap-4 border-l px-4 py-3 text-left transition-all duration-300 ${
                        isActive
                          ? 'border-cyan-300 bg-cyan-300/10 text-white'
                          : 'border-white/10 text-slate-400 hover:border-cyan-300/50 hover:bg-white/[0.04] hover:text-slate-100'
                      }`}
                    >
                      <span className="font-mono text-xs">{section.index}</span>
                      <span className="text-sm font-semibold">{section.label}</span>
                      <span
                        aria-hidden="true"
                        className={`ml-auto h-2 w-2 rounded-full transition-all duration-300 ${
                          isActive ? 'bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.7)]' : 'bg-white/20'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-10">
              <div className="thinking-active-panel border-t border-cyan-300/30 pt-5">
                <p className="font-mono text-sm text-cyan-300">{activeJourney.index}</p>
                <h3 className="mt-3 text-4xl font-serif font-semibold leading-tight text-white sm:text-5xl">
                  {activeJourney.title}
                </h3>
                <p className="mt-5 max-w-2xl text-xl leading-8 text-slate-200">
                  {activeJourney.thesis}
                </p>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-[15px]">
                  {activeJourney.body}
                </p>
              </div>

              {journeySections.map((section) => {
                const isActive = section.index === activeJourney.index
                return (
                  <div
                    key={section.index}
                    onMouseEnter={() => setActiveJourneyId(section.index)}
                    className={`thinking-stage border-t pt-5 transition-all duration-500 ${
                      isActive ? 'border-cyan-300/50 opacity-100' : 'border-white/10 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="font-mono text-xs text-cyan-300">{section.index}</span>
                      <h3 className="text-2xl font-serif font-semibold text-white">{section.title}</h3>
                    </div>
                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      {section.modules.map((module) => (
                        <Link
                          key={module.title}
                          to={module.href}
                          onFocus={() => setActiveJourneyId(section.index)}
                          className="group relative overflow-hidden border-t border-white/15 pt-4 outline-none transition-all duration-300 hover:border-cyan-300/60 focus-visible:border-cyan-300/80"
                        >
                          <span aria-hidden="true" className="thinking-link-sheen" />
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
                            {module.role}
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            <p className="text-2xl font-serif font-semibold text-white transition-transform duration-300 group-hover:translate-x-1">
                              {module.title}
                            </p>
                            <span className="text-cyan-300 opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100">
                              ↗
                            </span>
                          </div>
                          <p className="mt-3 max-w-md text-sm leading-7 text-slate-300 sm:text-[15px]">
                            {module.body}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-y border-white/10 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
              Technical Ground
            </p>
            <h2 className="mt-4 text-3xl font-serif font-semibold leading-tight text-white sm:text-5xl">
              技术上，它由一组边界清楚的 submodule 共同支撑。
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-[15px]">
              前台讲认知连接，底层则把执行、协议、世界脉络和任务验证拆开维护。这样 Agent 能接入，系统也能持续演进。
            </p>
          </div>

          <div className="mt-10 grid gap-7 lg:grid-cols-2">
            {technicalSections.map((section) => (
              <article
                key={section.title}
                className="group border-t border-white/15 pt-5 transition-all duration-300 hover:border-cyan-300/60"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-2xl font-serif font-semibold text-white">
                    {section.title}
                  </h3>
                  <a
                    href={section.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-cyan-200/70 transition-colors duration-200 hover:text-cyan-100"
                  >
                    GitHub
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                  {section.body}
                </p>
                <div className="mt-5 space-y-3">
                  {section.points.map((point) => (
                    <p
                      key={point}
                      className="max-w-xl border-l border-cyan-300/20 pl-4 text-sm leading-7 text-slate-400 transition-colors duration-300 group-hover:border-cyan-300/50 group-hover:text-slate-300 sm:text-[15px]"
                    >
                      {point}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-6xl border-t border-white/15 pt-8">
          <p className="max-w-4xl text-3xl font-serif font-semibold leading-tight text-white sm:text-5xl">
            让 Agent 扩展人的思考，
            <br />
            帮更多人找到问题、找到同路人，并把经验继续传下去。
          </p>
        </div>
      </section>
    </div>
  )
}
