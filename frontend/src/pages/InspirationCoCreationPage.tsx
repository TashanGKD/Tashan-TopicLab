import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { inspirationApi, type InspirationDemand, type InspirationDemandOverview } from '../api/client'
import { refreshCurrentUserProfile, tokenManager, type User } from '../api/auth'
import { ProgramHero, ProgramPosterFrame } from '../components/publicProgram'

const SUBMISSION_PATH = '/inspiration-co-creation/submit'
const POSTER_URL = '/media/inspiration-co-creation/poster.webp'
const DEMAND_PAGE_LIMIT = 12

const builderTypes = [
  '真实问题提出者',
  'AI 应用开发者',
  '行业观察者',
  '产品与设计伙伴',
  '高校社群成员',
  '项目验证志愿者',
]

const needCards = [
  {
    title: '英语阅读课堂的 AI 助教',
    body: '把一套大学英语阅读课拆成词汇、语法、阅读、翻译和写作训练，让 AI 承接完整课堂链路，最终服务提分。',
    tags: ['教育 / 学习', '需求拆解'],
    stuck: '问题太大，需要拆成可先验证的一步。',
  },
  {
    title: '就业规划与校园服务工作台',
    body: '面向学生就业焦虑，整合职业规划、岗位画像、简历修改、面试模拟、政策解读和本地实习信息推送。',
    tags: ['教育 / 学习', '个人工作流'],
    stuck: '需要判断技术边界和真实用户入口。',
  },
  {
    title: '辅导员日常管理低代码系统',
    body: '从宿舍卫生检查延展到早晚自习、教室、团活动、班级排名和学生基础信息查询，形成轻量校园管理工具。',
    tags: ['教育 / 学习', 'Demo 反馈'],
    stuck: '已有雏形，需要明确下一阶段模块。',
  },
  {
    title: '非遗设计从草图到 Demo',
    body: '把非遗项目草图转成完整设计稿，辅助填色、排版和 Demo 制作，让创意更快进入可展示状态。',
    tags: ['内容创作 / 新媒体', '找伙伴'],
    stuck: '需要技术实现判断和共创伙伴。',
  },
  {
    title: '博弈论模型生成与文献检索',
    body: '输入研究主题和背景，自动推荐相似模型，生成建模过程、均衡定义、求解步骤、比较静态和可检验假说。',
    tags: ['科研 / AI for Science', '工具原型'],
    stuck: '文献获取效率和权限处理是主要瓶颈。',
  },
  {
    title: '旅游规划智能体与小程序',
    body: '已有 Demo 级微信小程序和轻量旅游规划智能体，希望找到真实场景反馈，判断下一步产品方向。',
    tags: ['生活效率 / 个人工作流', 'Demo 反馈'],
    stuck: '缺少真实用户反馈。',
  },
  {
    title: 'AI 工具的大脑',
    body: '把个人使用 Cursor 和 AI 完成工作的经验沉淀成可迭代的方法库，让 AI 参与判断、推导和评估。',
    tags: ['个人工作流', '科研 / AI for Science'],
    stuck: '需要建立可复用的评估体系。',
  },
  {
    title: '深海冷泉数据关系发现',
    body: '从长时间观测的溶解氧、二氧化碳、甲烷、温盐深等数据中寻找关系，并尝试预测冷泉活动。',
    tags: ['科研 / AI for Science', '数据分析'],
    stuck: '需要技术路径和协作伙伴。',
  },
  {
    title: '资讯整理平台找反馈',
    body: '已有资讯整理平台，希望通过真实用户反馈判断信息聚合、筛选和使用体验是否成立。',
    tags: ['个人工作流', 'Demo 反馈'],
    stuck: '缺少真实用户反馈。',
  },
  {
    title: 'AI 文旅景区讲解应用',
    body: '随时随地解释景区文化知识，让游客在现场获得更贴近场景的讲解和延展阅读。',
    tags: ['生活效率 / 个人工作流', '文旅'],
    stuck: '需要拆成可验证的小应用。',
  },
  {
    title: 'Agent 与网安运营练手项目',
    body: '具备 Agent 和网安运营能力，希望进入真实项目，在具体任务中磨练协作和交付。',
    tags: ['科研 / AI for Science', '找项目'],
    stuck: '需要真实项目入口。',
  },
  {
    title: '自我认知 Demo 找反馈',
    body: '已有简易 Demo，希望通过真实反馈判断内容结构、交互方式和后续完善方向。',
    tags: ['其他', 'Demo 反馈'],
    stuck: '缺真实用户反馈。',
  },
  {
    title: '老系统到新规范的代码迁移',
    body: '让大模型理解一代前后端混合项目，生成符合二代规范的前后端 Controller 层和可复用开发 Skill。',
    tags: ['科研 / AI for Science', '工程自动化'],
    stuck: '需要模型组合、提示词和 Agent 技术方案。',
  },
  {
    title: 'AI 教育项目寻找运营伙伴',
    body: '已有可演示的 AI 教育业务闭环，想寻找擅长运营、氛围营造和共创推进的伙伴。',
    tags: ['教育 / 学习', '找伙伴'],
    stuck: '缺少能一起推进的人。',
  },
  {
    title: '在线文档数据导入',
    body: '希望解决在线文档权限、数据导入和后续处理的问题，让资料可以进入 AI 工作流。',
    tags: ['教育 / 学习', '数据接入'],
    stuck: '不知道技术上能不能实现。',
  },
  {
    title: '企业管理培训方案生成',
    body: '根据企业管理培训需求，辅助完成诊断、方案设计和交付内容组织。',
    tags: ['其他', '顾问诊断'],
    stuck: '需要明确可落地的方案形态。',
  },
  {
    title: '业务技能蒸馏系统',
    body: '基于智能体驾驶舱，把业务人员和专家的任务能力抽取成可复用技能，输出接近核心能力的工作单元。',
    tags: ['个人工作流', '科研 / AI for Science'],
    stuck: '需要共创讨论和真实反馈。',
  },
  {
    title: '个人笔记关键词定位',
    body: '让自己做过的笔记可以通过关键词快速定位和搜索，减少复盘和查找成本。',
    tags: ['生活效率 / 个人工作流', '轻工具'],
    stuck: '想先把模糊想法说清楚。',
  },
  {
    title: '用 GitHub 工作流管理知识库',
    body: '把个人知识库纳入 GitHub 工作流，形成可追踪、可复盘、可持续迭代的知识管理方式。',
    tags: ['生活效率 / 个人工作流', 'Demo 反馈'],
    stuck: '需要反馈和协作伙伴。',
  },
  {
    title: '文字驱动 ANSYS 仿真',
    body: '通过自然语言和 Codex 协作，完成动力学仿真、静力分析和模态分析，减少繁琐建模操作。',
    tags: ['科研 / AI for Science', '工程仿真'],
    stuck: '需要判断自动化链路的可靠性。',
  },
  {
    title: '围观真实 AI+X 需求',
    body: '先看看大家都在提出什么问题，从别人的需求里找到可参与、可学习或可共创的方向。',
    tags: ['围观', '找方向'],
    stuck: '想先聊聊，再决定参与方式。',
  },
  {
    title: 'Vibe coding 与 Agent 实战',
    body: '会使用 vibe coding 和 Agent，希望进入真实项目，在项目反馈中提升使用和交付能力。',
    tags: ['教育 / 学习', '找项目'],
    stuck: '缺一个能一起做的人。',
  },
  {
    title: '大 JSON 数据字典生成',
    body: '面对历史遗留项目的大体量 JSON 输入，希望用大模型自动解析数据字典，并通过 diff patch 逐步稳定输出。',
    tags: ['个人工作流', '工程自动化'],
    stuck: '需要把问题拆成稳态工作流。',
  },
  {
    title: '工业岗位间的 AI 翻译',
    body: '针对质量、工艺、工人、设备和管理层等不同角色，把同一段现场内容改写成彼此更容易理解的表达。',
    tags: ['个人工作流', '工业场景'],
    stuck: '需要判断场景切入点和模型表达方式。',
  },
  {
    title: 'AI for Science 商业化线索',
    body: '关注化工和高分子材料行业中接近产业应用、企业正在采用或有明确商业模式的 AI for Science 项目。',
    tags: ['科研 / AI for Science', '产业观察'],
    stuck: '需要可靠的信息渠道和可咨询对象。',
  },
]

const fallbackDemands: InspirationDemand[] = needCards.map((need, index) => ({
  id: `fallback-${index + 1}`,
  slug: `need-${String(index + 1).padStart(2, '0')}`,
  clue_number: index + 1,
  status: 'published',
  stage: '模糊想法',
  title: need.title,
  summary: need.body,
  tags: need.tags,
  stuck: need.stuck,
  path_progress: [
    { key: 'submitted', label: '留下线索', status: 'done', summary: '', emotion_note: '' },
    { key: 'defined', label: '问题定义', status: 'current', summary: '', emotion_note: '' },
  ],
  created_at: '',
  updated_at: '',
  latest_update_at: '',
}))

function getClueNumber(need: InspirationDemand, fallbackIndex = 0) {
  if (typeof need.clue_number === 'number' && Number.isFinite(need.clue_number)) {
    return need.clue_number
  }
  const match = /^need-(\d+)/.exec(need.slug)
  return match ? Number(match[1]) : fallbackIndex + 1
}

function getDemandSortTime(need: InspirationDemand) {
  const timestamp = need.latest_update_at || need.updated_at || need.created_at
  const parsed = Date.parse(timestamp || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function sortDemandsByLatestUpdate(items: InspirationDemand[]) {
  return [...items].sort((a, b) => {
    const timeDelta = getDemandSortTime(b) - getDemandSortTime(a)
    if (timeDelta !== 0) return timeDelta
    return getClueNumber(a) - getClueNumber(b)
  })
}

function cleanStageSummary(summary?: string) {
  const text = (summary ?? '').trim()
  if (!text) return ''
  const legacyPatterns = [
    '等待下一次共创更新。',
    '等待下一步共创更新。',
    '一个需求、想法或参与意愿已经被放到这里。',
  ]
  return legacyPatterns.includes(text) ? '' : text
}

function currentPathStage(need: InspirationDemand) {
  const pathProgress = normalizePathProgress(need.path_progress)
  const stage = pathProgress.find((item) => item.status === 'current')
    ?? pathProgress.find((stage) => stage.status === 'needs_input')
    ?? [...pathProgress].reverse().find((stage) => stage.status === 'done')
    // Legacy fallback for older API rows without path_progress.
    ?? { label: need.stage || '留下线索', summary: need.stuck || '' }
  return { ...stage, summary: cleanStageSummary(stage.summary) }
}

function normalizePathProgress(pathProgress?: InspirationDemand['path_progress']) {
  return (pathProgress ?? []).map((stage) => {
    if (stage.key !== 'interview' && stage.label !== '人工访谈') return stage
    return {
      ...stage,
      key: 'defined',
      label: '问题定义',
      summary: cleanStageSummary(stage.summary),
      emotion_note: stage.emotion_note,
    }
  })
}

function getMasonryColumnCount(width: number) {
  if (width < 720) return 1
  return Math.max(2, Math.min(4, Math.floor(width / 340)))
}

function estimateDemandCardHeight(need: InspirationDemand) {
  const textLength = `${need.title}${need.summary}${need.stuck}`.length
  const tagRows = Math.ceil(Math.max(need.tags.length, 1) / 2)
  const progressLength = normalizePathProgress(need.path_progress)
    .slice(0, 6)
    .reduce((total, stage) => total + `${stage.label}${stage.summary}`.length, 0)
  return 180 + textLength * 0.56 + progressLength * 0.18 + tagRows * 24
}

function distributeIntoMasonryColumns(items: InspirationDemand[], columnCount: number) {
  const normalizedColumnCount = Math.max(1, columnCount)
  const columns = Array.from({ length: normalizedColumnCount }, () => ({
    height: 0,
    items: [] as Array<{ need: InspirationDemand; index: number }>,
  }))

  items.forEach((need, index) => {
    const targetColumn = columns.reduce((shortest, column, columnIndex) => (
      column.height < columns[shortest].height ? columnIndex : shortest
    ), 0)
    columns[targetColumn].items.push({ need, index })
    columns[targetColumn].height += estimateDemandCardHeight(need)
  })

  return columns.map((column) => column.items)
}

const nonDirectionTags = new Set([
  '需求拆解',
  'Demo 反馈',
  '找伙伴',
  '找项目',
  '找方向',
  '工具原型',
  '数据分析',
  '数据接入',
  '轻工具',
  '工程自动化',
  '顾问诊断',
  '产业观察',
  '围观',
])

const blockerRules = [
  { label: '问题拆解', pattern: /拆|模糊|边界|说清楚|方向|入口|路径/ },
  { label: '技术可行性', pattern: /技术|实现|模型|Agent|工具|自动化|权限|可靠|方案/ },
  { label: '协作伙伴', pattern: /伙伴|一起|协作|找人|项目入口/ },
  { label: '真实反馈', pattern: /反馈|用户|试用|验证|Demo/ },
]

function compactPublicText(need: InspirationDemand) {
  return [need.title, need.summary, need.stuck, ...(need.tags ?? [])].join(' ')
}

function primaryDirectionTag(tag: string) {
  const primary = tag.split(/[\/／]/)[0]?.trim() || tag.trim()
  return primary
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = value.trim()
    if (!key) return acc
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function topCountEntries(counts: Record<string, number>, limit: number) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, limit)
}

interface DemandOverviewData {
  total: number
  coreStats: Array<{ label: string; value: number; hint: string }>
  directions: Array<[string, number]>
  stages: Array<[string, number]>
  blockers: Array<[string, number]>
}

function buildDemandOverview(demands: InspirationDemand[]) {
  const total = demands.length
  const needsInput = demands.filter((need) => (
    normalizePathProgress(need.path_progress).some((stage) => stage.status === 'needs_input')
    // Legacy fallback for older API rows without path_progress.
    || /待补充/.test(need.stage)
  )).length
  const demoOrFeedback = demands.filter((need) => /Demo|反馈|验证|试用/.test(compactPublicText(need))).length
  const participation = demands.filter((need) => /参与|围观|找项目|找伙伴|练手/.test(compactPublicText(need))).length
  const directionCounts = countValues(
    demands.flatMap((need) => (
      (need.tags ?? [])
        .map(primaryDirectionTag)
        .filter((tag) => tag && !nonDirectionTags.has(tag))
    )),
  )
  const stageCounts = countValues(demands.map((need) => currentPathStage(need).label))
  const blockerCounts = countValues(
    demands.flatMap((need) => {
      const text = compactPublicText(need)
      const labels = blockerRules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label)
      return labels.length ? labels : ['下一步澄清']
    }),
  )
  return {
    total,
    coreStats: [
      { label: '线索总数', value: total, hint: '公开展示中的共创线索' },
      { label: '待补充', value: needsInput, hint: '需要继续回答追问' },
      { label: 'Demo/反馈', value: demoOrFeedback, hint: '已有验证或反馈信号' },
      { label: '参与/围观', value: participation, hint: '偏向加入项目或先观察' },
    ],
    directions: topCountEntries(directionCounts, 5),
    stages: topCountEntries(stageCounts, 5),
    blockers: topCountEntries(blockerCounts, 4),
  }
}

function normalizeDemandOverview(
  overview: InspirationDemandOverview | undefined,
  fallbackDemandsForOverview: InspirationDemand[],
): DemandOverviewData {
  if (!overview) return buildDemandOverview(fallbackDemandsForOverview)
  return {
    total: overview.total,
    coreStats: overview.core_stats ?? [],
    directions: overview.directions ?? [],
    stages: overview.stages ?? [],
    blockers: overview.blockers ?? [],
  }
}

function DistributionList({
  title,
  items,
  total,
}: {
  title: string
  items: Array<[string, number]>
  total: number
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="mt-4 space-y-3">
        {items.map(([label, count]) => {
          const percent = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={label}>
              <div className="flex items-center justify-between gap-4 text-xs">
                <span className="font-medium text-slate-600">{label}</span>
                <span className="text-slate-400">{count} 条</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(percent, count > 0 ? 8 : 0)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DemandOverview({ overview }: { overview: DemandOverviewData }) {
  return (
    <section className="mb-10 border-y border-slate-200 py-6" aria-label="线索概览">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {overview.coreStats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <p className="text-3xl font-semibold leading-none text-slate-950">{stat.value}</p>
            <p className="mt-2 text-sm font-semibold text-slate-700">{stat.label}</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">{stat.hint}</p>
          </div>
        ))}
      </div>
      <div className="mt-7 grid gap-8 lg:grid-cols-3">
        <DistributionList title="方向分布" items={overview.directions} total={overview.total} />
        <DistributionList title="路径分布" items={overview.stages} total={overview.total} />
        <DistributionList title="卡点标签" items={overview.blockers} total={overview.total} />
      </div>
    </section>
  )
}

function useMasonryColumnCount() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [columnCount, setColumnCount] = useState(() => (
    typeof window === 'undefined' ? 1 : getMasonryColumnCount(window.innerWidth)
  ))

  useEffect(() => {
    const updateColumnCount = (width: number) => {
      setColumnCount(getMasonryColumnCount(width))
    }
    const node = containerRef.current
    updateColumnCount(node?.clientWidth || window.innerWidth)

    if (!node || typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateColumnCount(containerRef.current?.clientWidth || window.innerWidth)
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) updateColumnCount(width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { containerRef, columnCount }
}

interface DemandCardProps {
  need: InspirationDemand
  index: number
}

function DemandCard({ need, index }: DemandCardProps) {
  const pathStage = currentPathStage(need)
  const clueNumber = getClueNumber(need, index)
  const normalizedProgress = normalizePathProgress(need.path_progress)
  const pathProgress = normalizedProgress.length ? normalizedProgress : [
    { key: 'submitted', label: '留下线索', status: 'current', summary: need.stuck || '' },
  ]

  return (
    <article
      className="relative rounded-[var(--radius-md)] border border-slate-200 bg-[#fbfdfc] p-5 shadow-[0_18px_42px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_22px_52px_rgba(15,118,110,0.1)]"
    >
      <Link
        to={`/inspiration-co-creation/needs/${need.slug}`}
        aria-label={`打开线索 ${String(clueNumber).padStart(2, '0')}：${need.title}`}
        className="absolute inset-0 z-10 rounded-[var(--radius-md)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
      />
      <div className="pointer-events-none relative z-20">
        <div className="flex items-start justify-between gap-4">
          <span className="shrink-0 text-xs font-semibold text-teal-700">
            线索 {String(clueNumber).padStart(2, '0')}
          </span>
        </div>
        <h3 className="mt-4 text-xl font-semibold leading-tight text-slate-950">
          {need.title}
        </h3>
        <p className="mt-4 text-sm leading-7 text-slate-600">{need.summary}</p>
        <p className="mt-4 border-l-2 border-teal-400 pl-3 text-sm leading-7 text-slate-700">
          {need.stuck}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {need.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-1.5" aria-label="路径进度">
            {pathProgress.slice(0, 6).map((stage, stageIndex) => (
              <span
                key={`${stage.key}-${stageIndex}`}
                className={`h-1.5 flex-1 rounded-full ${stage.status === 'done' ? 'bg-teal-500' : stage.status === 'current' ? 'bg-teal-300' : 'bg-slate-200'}`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-teal-700">所处阶段：{pathStage.label}</p>
        </div>
      </div>
    </article>
  )
}

export default function InspirationCoCreationPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => tokenManager.getUser())
  const [demands, setDemands] = useState<InspirationDemand[]>(fallbackDemands)
  const [overview, setOverview] = useState<DemandOverviewData>(() => buildDemandOverview(fallbackDemands))
  const [pagination, setPagination] = useState<{ total: number; hasMore: boolean; nextOffset: number | null }>({
    total: fallbackDemands.length,
    hasMore: false,
    nextOffset: null,
  })
  const [demandStatus, setDemandStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadMoreStatus, setLoadMoreStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const { containerRef: masonryRef, columnCount: masonryColumnCount } = useMasonryColumnCount()
  const demandColumns = useMemo(
    () => distributeIntoMasonryColumns(sortDemandsByLatestUpdate(demands), masonryColumnCount),
    [demands, masonryColumnCount],
  )

  useEffect(() => {
    let cancelled = false
    if (!tokenManager.get()) {
      setCurrentUser(null)
      return () => {
        cancelled = true
      }
    }
    refreshCurrentUserProfile().then((user) => {
      if (!cancelled) setCurrentUser(user)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    inspirationApi.listDemands({
      includeInterest: false,
      includeOverview: true,
      limit: DEMAND_PAGE_LIMIT,
      offset: 0,
    }, { signal: controller.signal })
      .then((response) => {
        if (cancelled) return
        const nextDemands = response.data.list.length ? response.data.list : fallbackDemands
        setDemands(nextDemands)
        setOverview(normalizeDemandOverview(response.data.overview, nextDemands))
        setPagination({
          total: response.data.total ?? nextDemands.length,
          hasMore: response.data.has_more ?? false,
          nextOffset: response.data.next_offset ?? null,
        })
        setDemandStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setDemands(fallbackDemands)
        setDemandStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  function loadMoreDemands() {
    if (!pagination.hasMore || pagination.nextOffset == null || loadMoreStatus === 'loading') return
    setLoadMoreStatus('loading')
    inspirationApi.listDemands({
      includeInterest: false,
      includeOverview: false,
      limit: DEMAND_PAGE_LIMIT,
      offset: pagination.nextOffset,
    })
      .then((response) => {
        setDemands((current) => {
          const seen = new Set(current.map((item) => item.slug))
          const appended = response.data.list.filter((item) => !seen.has(item.slug))
          return [...current, ...appended]
        })
        setOverview((current) => (
          response.data.overview ? normalizeDemandOverview(response.data.overview, []) : current
        ))
        setPagination({
          total: response.data.total ?? pagination.total,
          hasMore: response.data.has_more ?? false,
          nextOffset: response.data.next_offset ?? null,
        })
        setLoadMoreStatus('idle')
      })
      .catch(() => {
        setLoadMoreStatus('error')
      })
  }

  return (
    <div className="bg-[#f6f9f8] text-slate-950">
      <ProgramHero
        accent="teal"
        eyebrow="AI+X 共创线索验证"
        title="灵感共创队"
        subtitle="别让 AI+X 想法只停在聊天框里。"
        body="你可以带来一个明确需求、一个还没成形的想法，也可以只是先报名参与；我们把这些线索放到同一个现场，找到能一起拆解、验证和推进的人。"
        primaryCta={{ href: SUBMISSION_PATH, label: '填写需求/想法表单' }}
        secondaryCta={currentUser?.is_admin ? { href: '/inspiration-co-creation/admin/needs', label: '管理员线索入口', variant: 'secondary' } : undefined}
        audience={builderTypes}
        audienceLabel="适合参与的人群"
        side={
          <ProgramPosterFrame accent="teal" label="灵感共创队活动海报">
            <img
              src={POSTER_URL}
              alt="灵感共创队活动海报"
              className="h-full w-full object-cover"
            />
          </ProgramPosterFrame>
        }
      />

      <section id="needs" className="bg-white px-5 py-20 sm:px-8 lg:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <DemandOverview overview={overview} />
          <div
            ref={masonryRef}
            className="grid gap-5"
            style={{ gridTemplateColumns: `repeat(${masonryColumnCount}, minmax(0, 1fr))` }}
            aria-label="共创线索瀑布流"
          >
            {demandColumns.map((column, columnIndex) => (
              <div key={`masonry-column-${columnIndex}`} className="flex min-w-0 flex-col gap-5">
                {column.map(({ need, index }) => (
                  <DemandCard
                    key={need.slug}
                    need={need}
                    index={index}
                  />
                ))}
              </div>
            ))}
          </div>
          {demandStatus === 'error' ? (
            <p className="mt-6 text-sm text-slate-400">共创线索系统暂时无法连接，当前显示本地脱敏样例。</p>
          ) : null}
          {demandStatus !== 'error' ? (
            <div className="mt-10 flex flex-col items-center gap-3">
              {pagination.hasMore ? (
                <button
                  type="button"
                  disabled={loadMoreStatus === 'loading'}
                  onClick={loadMoreDemands}
                  className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadMoreStatus === 'loading' ? '加载中…' : '加载更多'}
                </button>
              ) : (
                <p className="text-sm text-slate-400">已显示全部 {pagination.total} 条线索。</p>
              )}
              {loadMoreStatus === 'error' ? (
                <p className="text-sm text-red-600">加载更多失败，请稍后再试。</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

    </div>
  )
}
