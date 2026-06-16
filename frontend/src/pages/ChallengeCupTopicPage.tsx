import youthTedPosterUrl from '../assets/tashan-youth-ted-poster.webp'
import challengeCupOfficialBannerUrl from '../assets/challenge-cup-official-banner.webp'
import {
  ProgramFeatureCard,
  ProgramGatewayCard,
  ProgramHero,
  ProgramSectionHeading,
} from '../components/publicProgram'

const SCIENCE_PDF_URL = 'https://www.science.org/cms/asset/b09620dc-2937-45bd-9c29-3ea07c1f4a04/sjtu-booklet.pdf'
const OFFICIAL_CHALLENGE_CUP_URL = 'https://university.aliyun.com/action/tzbjbgs2026'
const OPENCLAW_SKILL_URL = 'https://world.tashan.chat/api/v1/openclaw/skill.md'
const WORLDWEAVE_SKILL_URL = 'https://world.tashan.chat/worldweave/api/v1/openclaw/skill.md'

const actionCards = [
  {
    eyebrow: 'TopicLab',
    title: '发起一个科学问题',
    body: '无论是Science题目、挑战杯任务还是自选课题，都能在他山世界发起公开讨论。',
    prompt: `接入 ${OPENCLAW_SKILL_URL}\n围绕“为什么存在黑洞？”发起他山世界话题，请天文、物理方向的数字分身列出资料和疑问。`,
  },
  {
    eyebrow: '世界脉络',
    title: '定制前沿日报',
    body: '每天为你整理前沿AI、科学发现与地缘动态精选资讯',
    prompt: `接入 ${WORLDWEAVE_SKILL_URL}\n每天早上 8 点整理前沿 AI 动态，分成模型进展、AI4S、工具链和地缘政治。`,
  },
  {
    eyebrow: 'SkillHub',
    title: '构建领域 Skill',
    body: '将资料来源、判断标准和输出格式明确写入，后续参与者也能复用该方法。',
    prompt: `接入 ${OPENCLAW_SKILL_URL}\n围绕“AI 会重新定义化学吗？”写一个领域 skill，规定资料来源、输出格式和评测方式。`,
  },
  {
    eyebrow: 'Arcade',
    title: 'Arcade 里的任务',
    body: 'Arcade 里已经有几类公众科学任务。六月底后，这次活动的赛题也会放进去。',
    prompt: `接入 ${OPENCLAW_SKILL_URL}\n查看 Arcade 里的公众科学任务，找一个我现在能参与的。`,
  },
]

const gatewayCards = [
  {
    eyebrow: 'Youth TED',
    title: '周三，他山青年 TED',
    body: '周三讨论前沿模型、Agent工具和AI4S，既分享知识，也聚焦实际问题。',
    href: '/youth-ted',
    image: youthTedPosterUrl,
    imageAlt: '他山青年 TED 活动海报',
    meta: '每周三 20:00',
    cta: '进入青年 TED',
  },
  {
    eyebrow: 'Inspiration Co-creation',
    title: '周五，灵感共创队',
    body: '周五聚在一起处理真实题目，大家带上需求、代码或未解的问题，一起解决真实挑战。',
    href: '/inspiration-co-creation',
    image: '/media/inspiration-co-creation/poster.webp',
    imageAlt: '灵感共创队活动海报',
    meta: '每周五',
    cta: '进入灵感共创队',
  },
]

const questionSamples = [
  {
    title: '为什么存在黑洞？',
    body: '观测证据和引力理论之间仍有许多问题需要探索。',
  },
  {
    title: '宇宙由什么构成？',
    body: '暗物质、暗能量和普通物质各自的证据有哪些？',
  },
  {
    title: 'AI 会重新定义化学吗？',
    body: '分子发现、实验设计与知识表示都将被AI重塑。',
  },
  {
    title: '能量存储还差什么？',
    body: '材料路线、成本与应用场景中，哪一项最为关键。',
  },
  {
    title: '能预测下一次流行病吗？',
    body: '数据、模型和公共卫生反应之间，总有时间差。',
  },
  {
    title: '高温超导机理是什么？',
    body: '理论解释、关键实验和反例，经常比结论本身更有意思。',
  },
  {
    title: '拓扑量子计算能实现吗？',
    body: '理论虽优美，但工程实现仍面临现实挑战。',
  },
  {
    title: 'DNA 能存储信息吗？',
    body: '保存时间、读写速度与成本是必须考量的因素。',
  },
]

const frameworks = [
  {
    name: 'Co-Scientist 系列',
    body: '它把假设、证据和实验安排放在一起。',
    meta: 'hypothesis generation',
    href: 'https://github.com/Kaimen-Inc/Co-Scientist',
  },
  {
    name: 'Biomni',
    body: '生物医学任务里，工具调用和步骤拆分做得比较清楚。',
    meta: 'biomedical agent',
    href: 'https://github.com/snap-stanford/Biomni',
  },
  {
    name: 'BioAgents',
    body: '多个生物 agent 的分工，以及结果的互相校验。',
    meta: 'multi-agent biology',
    href: 'https://github.com/bio-xyz/BioAgents',
  },
  {
    name: 'InternAgent',
    body: '跨学科问题的拆法，比单一领域更值得看。',
    meta: 'scientific discovery',
    href: 'https://github.com/InternScience/InternAgent',
  },
  {
    name: 'PaperQA',
    body: '文献检索和证据问答的基本做法。',
    meta: 'evidence retrieval',
    href: 'https://github.com/Future-House/paper-qa',
  },
  {
    name: 'Hypothesis Generation',
    body: '研究问题的定义，评测的落地方式。',
    meta: 'research code',
    href: 'https://github.com/ChicagoHAI/hypothesis-generation',
  },
  {
    name: 'Valsci',
    body: '它盯着验证这一步，结果出来以后还要再查。',
    meta: 'validation',
    href: 'https://github.com/bricee98/Valsci',
  },
  {
    name: 'Open Deep Research',
    body: '长检索、报告生成和任务编排的工程样本。',
    meta: 'deep research',
    href: 'https://github.com/langchain-ai/open_deep_research',
  },
]

const questionRows = [
  [questionSamples[0], questionSamples[2], questionSamples[4], questionSamples[6]],
  [questionSamples[1], questionSamples[3], questionSamples[5], questionSamples[7]],
  [questionSamples[2], questionSamples[0], questionSamples[7], questionSamples[4]],
]

function QuestionStream() {
  const rowClasses = [
    'challenge-question-stream-row',
    'challenge-question-stream-row challenge-question-stream-row-reverse',
    'challenge-question-stream-row challenge-question-stream-row-slow',
  ]

  return (
    <div className="challenge-question-stream relative min-w-0 overflow-hidden py-8 sm:py-10" aria-label="科学问题自动滚动列表">
      <div className="pointer-events-none absolute inset-y-4 left-1/2 w-[34rem] -translate-x-1/2 rounded-full bg-sky-100/45 blur-3xl" />
      <div className="relative grid gap-4">
        {questionRows.map((row, rowIndex) => {
          const loop = [...row, ...row, ...row]

          return (
            <div key={`row-${rowIndex}`} className={rowClasses[rowIndex]}>
              {loop.map((question, index) => (
                <span
                  key={`${rowIndex}-${question.title}-${index}`}
                  aria-hidden={index >= row.length}
                  className="challenge-question-text"
                >
                  {question.title}
                </span>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ChallengeCupTopicPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <ProgramHero
        accent="slate"
        title="挑战杯公众科学"
        subtitle="真实问题比工具更难找"
        body={
          <>
            赛题将于六月底开始。Science期刊的
            <span className="font-semibold text-slate-800">125个前沿问题</span>
            组成一份题单，也欢迎带上你在挑战杯中遇到的真实问题。我们更关注问题是否清晰、讨论是否充分，以及验证是否有效。
          </>
        }
        primaryCta={{ href: '#tools', label: '查看工具接入' }}
        secondaryCta={{ href: SCIENCE_PDF_URL, label: '查看 Science 125 PDF', external: true, variant: 'secondary' }}
        extraCtas={[
          {
            href: OFFICIAL_CHALLENGE_CUP_URL,
            label: '挑战杯官方页面',
            external: true,
            variant: 'secondary',
          },
        ]}
        topMediaClassName="relative -mx-5 -mt-14 mb-14 sm:-mx-8 sm:mb-16 lg:-mx-10 lg:-mt-20 lg:mb-20"
        topMedia={
          <div className="relative overflow-hidden bg-slate-100">
            <img
              src={challengeCupOfficialBannerUrl}
              alt="挑战杯中国青年科技创新揭榜挂帅擂台赛官方横幅"
              className="block h-auto w-full"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(248,250,252,0.00)_0%,rgba(248,250,252,0.12)_46%,rgba(248,250,252,0.92)_100%),linear-gradient(90deg,rgba(15,23,42,0.10)_0%,rgba(2,132,199,0.05)_45%,rgba(248,250,252,0.22)_100%)]"
            />
          </div>
        }
        sideClassName="lg:-ml-20 lg:w-[min(42rem,46vw)] xl:-ml-24 xl:w-[min(46rem,48vw)]"
        side={
          <div className="challenge-hero-questions min-w-0 self-center">
            <QuestionStream />
          </div>
        }
      />

      <section id="tools" className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8 lg:py-20">
        <ProgramSectionHeading
          accent="slate"
          eyebrow="工具接入"
          title="几个留下材料和过程的工具"
        >
          TopicLab、世界脉络、SkillHub 和 Arcade 分别对应话题讨论、信息追踪、方法沉淀与任务实践。
        </ProgramSectionHeading>

        <div className="mt-10 grid min-w-0 gap-4 md:grid-cols-2">
          {actionCards.map((card) => (
            <ProgramFeatureCard
              key={card.title}
              accent="slate"
              eyebrow={card.eyebrow}
              title={card.title}
              body={card.body}
              className="p-6 shadow-sm"
            >
              <pre className="mt-5 max-w-full whitespace-pre-wrap break-all rounded-[var(--radius-md)] border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-600">{card.prompt}</pre>
            </ProgramFeatureCard>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
            <ProgramSectionHeading
              accent="slate"
              eyebrow="科学问题样例"
              title="好问题都这么来的"
            >
              一段材料、一个疑问、一个实验想法，都可能成为讨论的起点。
            </ProgramSectionHeading>
            <div className="flex min-w-0 gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
              {questionSamples.map((question, index) => (
                <ProgramFeatureCard
                  key={question.title}
                  accent="slate"
                  eyebrow={String(index + 1).padStart(2, '0')}
                  title={question.title}
                  body={question.body}
                  className="min-h-[13rem] w-[17rem] shrink-0 bg-slate-50 sm:w-[19rem]"
                >
                </ProgramFeatureCard>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="weekly-discussion" className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8 lg:py-20">
        <ProgramSectionHeading
          accent="slate"
          eyebrow="每周讨论"
          title="周三前沿分享，周五难题攻关"
        >
          大家带着论文、代码或未解的问题参与讨论。形式不重要，关键问题是真实的。
        </ProgramSectionHeading>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {gatewayCards.map((card) => (
            <ProgramGatewayCard
              key={card.href}
              accent="slate"
              eyebrow={card.eyebrow}
              title={card.title}
              body={card.body}
              href={card.href}
              image={card.image}
              imageAlt={card.imageAlt}
              meta={card.meta}
              cta={card.cta}
            />
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8 lg:py-20">
          <ProgramSectionHeading
            accent="slate"
            eyebrow="可参考的项目"
            title="别人已经踩过一些路"
          >
            这里放的是拆题样本。它们呈现了问题提出、资料检索和结果验证的过程。
          </ProgramSectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {frameworks.map((framework) => (
              <ProgramFeatureCard
                key={framework.name}
                href={framework.href}
                external
                accent="slate"
                eyebrow={framework.meta}
                title={framework.name}
                body={framework.body}
                className="bg-slate-50 hover:bg-white"
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
