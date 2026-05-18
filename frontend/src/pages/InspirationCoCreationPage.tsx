import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { inspirationApi, type InspirationDemand } from '../api/client'

const SUBMISSION_PATH = '/inspiration-co-creation/submit'
const POSTER_URL = '/media/inspiration-co-creation/poster.webp'

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
  status: 'published',
  stage: '模糊想法',
  title: need.title,
  summary: need.body,
  tags: need.tags,
  stuck: need.stuck,
  path_progress: [
    { key: 'submitted', label: '留下线索', status: 'done', summary: '一个需求、想法或参与意愿已经被放到这里。', emotion_note: '先被看见，就是共创的第一步。' },
    { key: 'defined', label: '问题定义', status: 'current', summary: '等待下一次共创更新。', emotion_note: '有人愿意把这件事继续往前推。' },
  ],
  created_at: '',
  updated_at: '',
}))

function currentPathStage(need: InspirationDemand) {
  const pathProgress = normalizePathProgress(need.path_progress)
  return pathProgress.find((stage) => stage.status === 'current')
    ?? pathProgress.find((stage) => stage.status === 'done')
    ?? { label: need.stage || '留下线索', summary: need.stuck || '等待下一步共创更新。' }
}

function normalizePathProgress(pathProgress?: InspirationDemand['path_progress']) {
  return (pathProgress ?? []).map((stage) => {
    if (stage.key !== 'interview' && stage.label !== '人工访谈') return stage
    return {
      ...stage,
      key: 'defined',
      label: '问题定义',
      summary: stage.summary?.replace('等待下一次访谈或共创更新。', '等待下一次共创更新。') || '等待下一次共创更新。',
      emotion_note: stage.emotion_note?.replace('有人愿意把问题留在这里。', '有人愿意把这件事继续往前推。') || stage.emotion_note,
    }
  })
}

export default function InspirationCoCreationPage() {
  const [demands, setDemands] = useState<InspirationDemand[]>(fallbackDemands)
  const [demandStatus, setDemandStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    inspirationApi.listDemands()
      .then((response) => {
        if (cancelled) return
        setDemands(response.data.list.length ? response.data.list : fallbackDemands)
        setDemandStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setDemands(fallbackDemands)
        setDemandStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="bg-[#f6f9f8] text-slate-950">
      <section className="relative isolate overflow-hidden border-b border-teal-100/80 bg-[#f8fcfb] px-5 py-14 sm:px-8 lg:px-10 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(245,251,250,0.92)_58%,rgba(237,247,245,0.96)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[58%] bg-[repeating-linear-gradient(145deg,rgba(13,148,136,0.12)_0_1px,transparent_1px_28px)] opacity-60 [mask-image:linear-gradient(to_left,black_0%,rgba(0,0,0,0.68)_44%,transparent_88%)]"
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(18rem,0.58fr)] lg:items-center lg:gap-16">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <h1 className="text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
                灵感共创队
              </h1>
              <span className="mb-1 text-sm font-medium text-teal-700">AI+X 共创线索验证</span>
            </div>
            <p className="mt-5 max-w-2xl font-serif text-xl italic leading-9 text-slate-800 sm:text-2xl">
              别让 AI+X 想法只停在聊天框里。
            </p>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-600">
              你可以带来一个明确需求、一个还没成形的想法，也可以只是先报名参与；我们把这些线索放到同一个现场，找到能一起拆解、验证和推进的人。
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={SUBMISSION_PATH}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(13,148,136,0.22)] transition hover:-translate-y-0.5 hover:bg-teal-800"
              >
                填写需求/想法表单
                <span aria-hidden="true" className="ml-2 text-base leading-none">›</span>
              </a>
            </div>
            <div
              className="mt-4 max-w-xl text-sm font-medium leading-7 text-slate-500"
              aria-label="适合参与的人群"
            >
              {builderTypes.map((type, index) => (
                <span key={type}>
                  <span className="text-slate-700">{type}</span>
                  {index < builderTypes.length - 1 ? <span className="mx-2 text-teal-500/70">/</span> : null}
                </span>
              ))}
            </div>
          </div>

          <figure className="mx-auto w-full max-w-[23rem] overflow-hidden rounded-[var(--radius-md)] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,118,110,0.16)] lg:max-w-none">
            <img
              src={POSTER_URL}
              alt="灵感共创队活动海报"
              className="h-full w-full object-cover"
            />
          </figure>
        </div>
      </section>

      <section id="needs" className="bg-white px-5 py-20 sm:px-8 lg:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <div className="columns-1 gap-5 md:columns-2 xl:columns-3" aria-label="共创线索瀑布流">
            {demands.map((need, index) => {
              const pathStage = currentPathStage(need)
              const normalizedProgress = normalizePathProgress(need.path_progress)
              const pathProgress = normalizedProgress.length ? normalizedProgress : [
                { key: 'submitted', label: '留下线索', status: 'current', summary: need.stuck || '等待下一步共创更新。' },
              ]

              return (
                <article
                  key={need.slug}
                  className="relative mb-5 break-inside-avoid rounded-[var(--radius-md)] border border-slate-200 bg-[#fbfdfc] p-5 shadow-[0_18px_42px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_22px_52px_rgba(15,118,110,0.1)]"
                >
                <Link
                  to={`/inspiration-co-creation/needs/${need.slug}`}
                  aria-label={`打开线索 ${String(index + 1).padStart(2, '0')}：${need.title}`}
                  className="absolute inset-0 z-10 rounded-[var(--radius-md)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                />
                <div className="pointer-events-none relative z-20">
                <div className="flex items-start justify-between gap-4">
                  <span className="shrink-0 text-xs font-semibold text-teal-700">
                    线索 {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                    {pathStage.label}
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
                  <p className="mt-3 text-xs font-semibold text-teal-700">{pathStage.label}</p>
                  <p className="mt-3 text-xs leading-6 text-slate-500">{pathStage.summary}</p>
                </div>
                </div>
                </article>
              )
            })}
          </div>
          {demandStatus === 'error' ? (
            <p className="mt-6 text-sm text-slate-400">共创线索系统暂时无法连接，当前显示本地脱敏样例。</p>
          ) : null}
        </div>
      </section>

    </div>
  )
}
