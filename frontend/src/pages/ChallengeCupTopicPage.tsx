import { useEffect, useState } from 'react'
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
const AGENT4S_WECHAT_ALBUM_URL = 'https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzkyNjY0NjI3NA==&action=getalbum&album_id=4525736241471864843'

type Agent4SWechatArticle = {
  msgid: string
  title: string
  coverUrl: string
  link: string
  publishedAt: string
  readCount: number | null
  likeCount?: number | null
}

type Agent4SWechatApiArticle = {
  msgid?: unknown
  title?: unknown
  cover_url?: unknown
  link?: unknown
  published_at?: unknown
  read_count?: unknown
  like_count?: unknown
}

const agent4sWechatFallbackArticles: Agent4SWechatArticle[] = [
  {
    msgid: '2247485930',
    title: 'Agent4S｜实验科学重构：从人为决策逐渐走向智能闭环',
    coverUrl: 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/qRKI1DmoqOAIYnSROEAqqYD7rQewLiabBHLDXkgXy5adbCl49bTybXIZPYdxpH1icJp2rwRHjwr3K34Sv0smicAmS23XUia67vZArx8G8VZSRqo/0?wx_fmt=jpeg',
    link: 'http://mp.weixin.qq.com/s?__biz=MzkyNjY0NjI3NA==&mid=2247485930&idx=1&sn=03b503b1ff7bf3445e15af6d82975b8f&chksm=c2356087f542e99147fce693e65f8d8c3f0fa74057f543ec07f81114a1796bada8df9cca60fe#rd',
    publishedAt: '2026-06-15T17:04:57+08:00',
    readCount: 214,
  },
  {
    msgid: '2247485805',
    title: 'Agent4S｜科研第五范式革命：从人类认知中心到人机共生系统',
    coverUrl: 'https://mmbiz.qpic.cn/mmbiz_jpg/qRKI1DmoqOB3IdlEGmddjps4SCQdH5dw9WnPrBIibgSALw8W86Mib0DHxYG08S4akDicAKqxrOBJH9EwnGQkIqGQHV0p8OC02uQ97Vp006Vyt4/0?wx_fmt=jpeg',
    link: 'http://mp.weixin.qq.com/s?__biz=MzkyNjY0NjI3NA==&mid=2247485805&idx=1&sn=8a6bdbeee106c43e1003f19dc2f9a025&chksm=c2356000f542e9160e11463609a31983cc78ab974ca8ed46a3837a7fd4d37236f91f362593cf#rd',
    publishedAt: '2026-05-28T01:36:05+08:00',
    readCount: 2723,
  },
  {
    msgid: '2247485794',
    title: 'Agent4S｜智能体框架举例：OpenClaw 的运行过程是什么',
    coverUrl: 'https://mmbiz.qpic.cn/mmbiz_jpg/qRKI1DmoqOBNqEZ32yMicNkUWeBrXQTOjUUxb1e8g466UdGvkXYViaZ7r3c1NUxK2UmJKCgWGHSumy4zyTFD8YDB4UaC3gdTtxKsb1IvYougQ/0?wx_fmt=jpeg',
    link: 'http://mp.weixin.qq.com/s?__biz=MzkyNjY0NjI3NA==&mid=2247485794&idx=1&sn=02b63c97671037dc18e365f22e0b27bc&chksm=c235600ff542e9194f4ea6e9ae77edde42106702688accc884cce8b0b2183250c3e4a1a83d04#rd',
    publishedAt: '2026-05-22T05:14:55+08:00',
    readCount: 261,
  },
  {
    msgid: '2247485791',
    title: 'Agent4S｜从LLM到Agent：记忆与工具',
    coverUrl: 'https://mmbiz.qpic.cn/mmbiz_jpg/qRKI1DmoqOD88cO94hgK7ib9YAicP7NWibo1vk43jO72guvxRo3icCwCoHSrW5icgmeIT0IgS10VzjMgmFg26jkpiap5MB85UzDFO1M6pSZsWt3XI/0?wx_fmt=jpeg',
    link: 'http://mp.weixin.qq.com/s?__biz=MzkyNjY0NjI3NA==&mid=2247485791&idx=1&sn=c89c4fa09f4cedf0a871eda665781192&chksm=c2356032f542e924603e2532ac09ed29f91ea6b0ec810c72c3328f646a9e5854318291169b76#rd',
    publishedAt: '2026-05-19T05:42:00+08:00',
    readCount: 256,
  },
  {
    msgid: '2247485775',
    title: 'Agent4S｜科研数据规范为什么需要重写：第五科研范式下的数据、上下文与闭环',
    coverUrl: 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/qRKI1DmoqOCll9j7b4D02YyfGMpZMvTjQy9q3FticbUjC88swY0Ddpu9Ghvia5lAdibk29wCicUibxK1SFfr3ZbiaOtYadRnHKckzwThTobibuOibOg/0?wx_fmt=jpeg',
    link: 'http://mp.weixin.qq.com/s?__biz=MzkyNjY0NjI3NA==&mid=2247485775&idx=1&sn=3ccca3cf78e0bf6f8d9f42def55b466a&chksm=c2356022f542e934028ad6aa2c34b95ee7f1bdf615e4252e2921812d9bd657add7c780b86529#rd',
    publishedAt: '2026-05-17T23:46:45+08:00',
    readCount: 1435,
  },
]

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeAgent4SArticle(article: Agent4SWechatApiArticle): Agent4SWechatArticle | null {
  const msgid = readString(article.msgid)
  const title = readString(article.title)
  const coverUrl = readString(article.cover_url)
  const link = readString(article.link)
  const publishedAt = readString(article.published_at)

  if (!msgid || !title || !coverUrl || !link) return null

  return {
    msgid,
    title,
    coverUrl,
    link,
    publishedAt,
    readCount: readNullableNumber(article.read_count),
    likeCount: readNullableNumber(article.like_count),
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`
  return String(value)
}

const actionCards = [
  {
    eyebrow: 'TopicLab',
    title: '提出科学问题',
    body: '在这里提出科学问题，获得跨领域专家的建议。',
    prompt: `接入 ${OPENCLAW_SKILL_URL}\n围绕“为什么存在黑洞？”发起他山世界话题，请天文、物理方向的数字分身列出资料和疑问。`,
  },
  {
    eyebrow: '世界脉络',
    title: '追领域新动态',
    body: '每日更新领域前沿动态，含最新研究与工具发布。',
    prompt: `接入 ${WORLDWEAVE_SKILL_URL}\n每天早上 8 点整理前沿 AI 动态，分成模型进展、AI4S、工具链和地缘政治。`,
  },
  {
    eyebrow: 'SkillHub',
    title: '用现成方法模板',
    body: '查看已验证的研究方法模板，可直接用于项目。',
    prompt: `接入 ${OPENCLAW_SKILL_URL}\n围绕“AI 会重新定义化学吗？”写一个领域 skill，规定资料来源、输出格式和评测方式。`,
  },
  {
    eyebrow: 'Arcade',
    title: '找练手小任务',
    body: '提供适合不同阶段的实践任务，六月底更新赛题。',
    prompt: `接入 ${OPENCLAW_SKILL_URL}\n查看 Arcade 里的公众科学任务，找一个我现在能参与的。`,
  },
]

const gatewayCards = [
  {
    eyebrow: 'Youth TED',
    title: '周三，他山青年 TED',
    body: '分享最新AI模型和科研工具的应用案例。',
    href: '/youth-ted',
    image: youthTedPosterUrl,
    imageAlt: '他山青年 TED 活动海报',
    meta: '每周三 20:00',
    cta: '进入青年 TED',
  },
  {
    eyebrow: 'Inspiration Co-creation',
    title: '周五，灵感共创队',
    body: '针对科研中的具体问题进行集体讨论。',
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
    body: '黑洞的观测与理论存在差异，需要进一步研究。',
  },
  {
    title: '宇宙由什么构成？',
    body: '暗物质、暗能量和普通物质各自的证据有哪些？',
  },
  {
    title: 'AI 会重新定义化学吗？',
    body: 'AI如何改变分子发现和实验设计方法。',
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
    body: 'DNA数据存储的可行性：读写速度与成本分析。',
  },
]

const frameworks = [
  {
    name: 'Co-Scientist 系列',
    body: '管理研究假设和实验设计的工具。',
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
    body: '自动化文献检索与证据提取工具。',
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
    body: '确保实验结果可靠性的验证工具。',
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
  const [agent4sArticles, setAgent4sArticles] = useState<Agent4SWechatArticle[]>(agent4sWechatFallbackArticles)

  useEffect(() => {
    const controller = new AbortController()

    fetch(`${import.meta.env.BASE_URL}api/v1/agent4s/wechat-articles`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Agent4S articles unavailable')
        return response.json()
      })
      .then((payload) => {
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.articles)) return
        const articles = payload.articles
          .map((article: Agent4SWechatApiArticle) => normalizeAgent4SArticle(article))
          .filter((article: Agent4SWechatArticle | null): article is Agent4SWechatArticle => article !== null)
        if (articles.length > 0) setAgent4sArticles(articles)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
      })

    return () => controller.abort()
  }, [])

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
            组成一份题单，也欢迎带上你在挑战杯中遇到的真实问题。我们更在意问题有没有说清楚、大家能不能聊透，以及结果能不能落地。
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
              className="block h-[8.75rem] w-full object-cover object-center sm:h-auto"
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

      <section className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8 lg:py-20">
          <ProgramSectionHeading
            accent="slate"
            eyebrow="Agent4S 专栏"
            title="Agent4S：人工智能驱动的科研范式革命"
            action={
              <a
                href={AGENT4S_WECHAT_ALBUM_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-[var(--radius-md)] border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
              >
                查看专辑
              </a>
            }
          />

          <div
            aria-label="Agent4S 文章列表"
            className="mt-10 flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin] md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:pb-0 xl:grid-cols-5"
          >
            {agent4sArticles.map((article) => (
              <a
                key={article.msgid}
                href={article.link}
                target="_blank"
                rel="noreferrer"
                className="group flex w-[13.5rem] shrink-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-slate-200 bg-slate-50 transition hover:-translate-y-1 hover:border-sky-300 hover:bg-white hover:shadow-lg hover:shadow-sky-100/70 md:w-auto md:min-w-0"
              >
                <div className="h-24 overflow-hidden bg-slate-100 md:h-auto md:aspect-[16/10]">
                  <img
                    src={article.coverUrl}
                    alt={article.title}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex flex-1 flex-col p-3 md:p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                    {formatDate(article.publishedAt) ? <span>{formatDate(article.publishedAt)}</span> : null}
                    {article.readCount !== null ? (
                      <>
                        <span aria-hidden="true">/</span>
                        <span>阅读 {formatCount(article.readCount)}</span>
                      </>
                    ) : null}
                    {article.likeCount !== null && article.likeCount !== undefined ? (
                      <>
                        <span aria-hidden="true">/</span>
                        <span>点赞 {formatCount(article.likeCount)}</span>
                      </>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-xs font-semibold leading-5 text-slate-950 md:text-sm md:leading-6">{article.title}</h3>
                  <span className="mt-auto pt-4 text-sm font-medium text-sky-700 md:pt-5">阅读原文</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="tools" className="mx-auto max-w-6xl px-5 py-14 sm:px-6 lg:px-8 lg:py-20">
        <ProgramSectionHeading
          accent="slate"
          eyebrow="工具接入"
          title="科研实用工具"
        >
          这些工具帮你讨论问题、追踪动态、复用方法和参与实践。
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
              title="科研问题示例"
            >
              这些是科研讨论的常见起点，涵盖不同研究方向。
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
          title="每周科研讨论安排"
        >
          每周三讨论前沿研究，周五解决具体问题。
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
            title="参考项目资源"
          >
            这些开源项目展示了解决方案，可作参考案例。
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
