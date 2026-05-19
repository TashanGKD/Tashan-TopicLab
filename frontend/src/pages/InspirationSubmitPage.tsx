import { FormEvent, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { inspirationApi, type InspirationDemandSubmitRequest } from '../api/client'

type IntentKey = 'demand' | 'idea' | 'participant' | 'observer'

const intentOptions: Array<{ key: IntentKey; label: string; description: string }> = [
  {
    key: 'demand',
    label: '我有一个明确需求',
    description: '我知道自己想解决什么，希望把它说清楚、找人一起推进。',
  },
  {
    key: 'idea',
    label: '我有一个还没想清楚的想法',
    description: '我有一个灵感、观察或方向，但还不知道它能不能变成一个项目。',
  },
  {
    key: 'participant',
    label: '我想参与别人的项目',
    description: '我想找一个真实问题参与，比如一起讨论、拆解、开发、调研或试用反馈。',
  },
  {
    key: 'observer',
    label: '我想先加入看看',
    description: '我还没想好要做什么，只想先进来看看大家都在关心什么问题。',
  },
]

const categoryOptions = [
  '学习 / 教育',
  '科研 / 数据',
  '工作效率',
  '内容创作',
  '生活服务',
  '还说不清 / 其他',
]

const demandHelpOptions = [
  '想把需求边界说清楚',
  '想找人一起拆解',
  '想判断 AI 能不能帮上忙',
  '想找共创伙伴',
  '想找真实反馈',
]

const ideaMaturityOptions = [
  '只是一个灵感',
  '观察到一个问题',
  '想到一个可能方案',
  '已经试过一点',
]

const ideaUncertaintyOptions = [
  '不知道它是不是真问题',
  '不知道从哪里开始',
  '不知道谁会需要',
  '不知道技术能不能做到',
  '缺少一起讨论的人',
]

const participantRoleOptions = [
  '讨论想法',
  '拆解需求',
  '做原型 / 开发',
  '找资料 / 调研',
  '试用反馈',
]

const publicOptions = [
  { value: true, label: '愿意匿名公开，让更多人看到' },
  { value: false, label: '先不公开，只提交给共创队' },
]

const successParticles = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: 12 + ((index * 17) % 78),
  delay: (index % 8) * 0.045,
  color: ['#0f766e', '#14b8a6', '#60a5fa', '#facc15', '#fb7185'][index % 5],
  size: 7 + (index % 4) * 2,
  drift: -80 + (index % 9) * 20,
}))

const initialForm: InspirationDemandSubmitRequest = {
  submitter_name: '',
  participation_mode: intentOptions[0].label,
  contact: '',
  problem: '',
  category: '',
  category_extra: '',
  current_blockers: '',
  note: '',
  allow_public: true,
}

function RequiredMark() {
  return <span aria-hidden="true" className="ml-1 text-red-500">*</span>
}

function optionClass(checked: boolean, shape: 'box' | 'pill' = 'box') {
  const base = shape === 'pill'
    ? 'group relative cursor-pointer rounded-full border px-3 py-2 text-sm transition-all duration-200 motion-reduce:transition-none'
    : 'group relative flex min-h-11 cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm leading-6 transition-all duration-200 motion-reduce:transition-none'
  return `${base} ${checked ? 'border-teal-500 bg-teal-50 text-teal-900 shadow-[0_10px_24px_rgba(13,148,136,0.08)]' : 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-50/40 hover:shadow-[0_14px_32px_rgba(15,23,42,0.06)]'}`
}

function primaryProblemFeedback(value: string) {
  const length = value.trim().length
  if (length >= 80) return '很好，已经比较清楚了，我们可以接着往下拆。'
  if (length >= 20) return '已经能看到一个真实场景或需求了。'
  return '哪怕一句话也行。'
}

function isFilled(value?: string | null) {
  return Boolean(value?.trim())
}

function getCompletion(intent: IntentKey, form: InspirationDemandSubmitRequest) {
  const checks = intent === 'observer'
    ? [true, isFilled(form.contact)]
    : intent === 'participant'
      ? [true, isFilled(form.category), isFilled(form.current_blockers), isFilled(form.contact)]
      : intent === 'idea'
        ? [
            true,
            isFilled(form.category_extra),
            isFilled(form.problem),
            isFilled(form.category),
            isFilled(form.current_blockers),
            isFilled(form.contact),
          ]
        : [
            true,
            isFilled(form.problem),
            isFilled(form.category),
            isFilled(form.current_blockers),
            isFilled(form.contact),
          ]
  const completed = checks.filter(Boolean).length
  return {
    completed,
    total: checks.length,
    percent: Math.round((completed / checks.length) * 100),
  }
}

function getMissingHint(intent: IntentKey, form: InspirationDemandSubmitRequest) {
  if (intent === 'observer') {
    return isFilled(form.contact) ? '可以报名了。' : '留下一个联系方式就可以。'
  }
  if (intent === 'participant') {
    if (!isFilled(form.category)) return '先选你想参与哪类项目。'
    if (!isFilled(form.current_blockers)) return '再选一个你更想承担的角色。'
    if (!isFilled(form.contact)) return '最后留下联系方式，方便后续联系你。'
    return '可以提交参与意愿了。'
  }
  if (intent === 'idea') {
    if (!isFilled(form.category_extra)) return '先点一下这个想法现在到哪一步。'
    if (!isFilled(form.problem)) return '用一句话把这个想法写下来就行。'
    if (!isFilled(form.category)) return '再选一个大概相关的方向。'
    if (!isFilled(form.current_blockers)) return '选出你现在最不确定的地方。'
    if (!isFilled(form.contact)) return '最后留下联系方式，方便一起聊清楚。'
    return '可以提交这个想法了。'
  }
  if (!isFilled(form.problem)) return '先把这个需求写下来，一句话也可以。'
  if (!isFilled(form.category)) return '再选一个大致方向。'
  if (!isFilled(form.current_blockers)) return '选出你最希望得到的帮助。'
  if (!isFilled(form.contact)) return '最后留下联系方式，方便后续沟通。'
  return '可以提交这个需求了。'
}

const inputClass = 'mt-2 min-h-11 w-full rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 text-sm outline-none transition-all duration-200 focus:border-teal-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(20,184,166,0.10)] motion-reduce:transition-none'
const textareaClass = 'mt-2 w-full rounded-[var(--radius-sm)] border border-slate-200 bg-white px-3 py-3 text-sm leading-7 outline-none transition-all duration-200 focus:border-teal-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(20,184,166,0.10)] motion-reduce:transition-none'

function ChoiceCheck({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] transition-all duration-200 ${
        checked ? 'border-teal-600 bg-teal-600 text-white scale-110' : 'border-slate-300 bg-white text-transparent group-hover:border-teal-300'
      }`}
    >
      ✓
    </span>
  )
}

function TextStrength({ value }: { value: string }) {
  const length = value.trim().length
  const percent = Math.min(100, Math.max(12, Math.round((length / 80) * 100)))
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-teal-500 transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export default function InspirationSubmitPage() {
  const navigate = useNavigate()
  const [intent, setIntent] = useState<IntentKey>('demand')
  const [form, setForm] = useState<InspirationDemandSubmitRequest>(initialForm)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  function updateField<K extends keyof InspirationDemandSubmitRequest>(key: K, value: InspirationDemandSubmitRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function switchIntent(nextIntent: IntentKey) {
    const option = intentOptions.find((item) => item.key === nextIntent)
    setIntent(nextIntent)
    setError('')
    setForm((current) => ({
      ...current,
      participation_mode: option?.label ?? current.participation_mode,
      problem: '',
      category: '',
      category_extra: '',
      current_blockers: '',
      note: '',
      allow_public: nextIntent === 'demand' || nextIntent === 'idea' ? current.allow_public : false,
    }))
  }

  function buildPayload(): InspirationDemandSubmitRequest {
    if (intent === 'participant') {
      const category = form.category || '还说不清 / 其他'
      const role = form.current_blockers || '想先参与真实项目'
      return {
        ...form,
        allow_public: false,
        problem: `我想参与别人的项目。想参与的方向：${category}。希望承担的角色：${role}。`,
        note: form.note || form.category_extra,
      }
    }

    if (intent === 'observer') {
      return {
        ...form,
        allow_public: false,
        problem: '我想先加入看看大家在做什么。',
        category: '先加入看看',
        current_blockers: '先加入看看',
        note: form.note || '先报名加入共创队。',
      }
    }

    return form
  }

  function validate() {
    if (getCompletion(intent, form).completed !== getCompletion(intent, form).total) return getMissingHint(intent, form)
    return ''
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setStatus('submitting')
    setError('')
    try {
      const response = await inspirationApi.submitDemand(buildPayload())
      const slug = response.data.demand.slug
      const claimToken = response.data.claim_token || null
      const path = `/inspiration-co-creation/needs/${encodeURIComponent(slug)}${claimToken ? `?claim_token=${encodeURIComponent(claimToken)}` : ''}`
      if (claimToken) {
        localStorage.setItem(`inspiration_claim_${slug}`, claimToken)
      }
      navigate(path, { replace: true })
    } catch {
      setStatus('error')
      setError('提交失败，请稍后再试。')
    }
  }

  const submitLabel = intent === 'demand'
    ? '提交这个需求'
    : intent === 'idea'
      ? '提交这个想法'
      : intent === 'participant'
        ? '提交参与意愿'
        : '报名加入共创队'

  const completion = getCompletion(intent, form)
  const missingHint = getMissingHint(intent, form)
  const isReady = completion.completed === completion.total

  return (
    <div className="relative overflow-hidden bg-[#f6f9f8] px-5 py-12 text-slate-950 sm:px-8 lg:py-16">
      {status === 'success' ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-white/92 px-6 text-center backdrop-blur-md"
          role="status"
          aria-live="assertive"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,184,166,0.18),transparent_36%)]" />
          <div className="pointer-events-none absolute inset-0">
            {successParticles.map((particle) => (
              <span
                key={particle.id}
                className="inspiration-confetti-piece"
                style={{
                  left: `${particle.left}%`,
                  width: `${particle.size}px`,
                  height: `${particle.size * 1.55}px`,
                  backgroundColor: particle.color,
                  animationDelay: `${particle.delay}s`,
                  '--confetti-drift': `${particle.drift}px`,
                } as CSSProperties & Record<'--confetti-drift', string>}
              />
            ))}
          </div>
          <div className="relative">
            <div className="inspiration-success-mark mx-auto grid h-20 w-20 place-items-center rounded-full bg-teal-600 text-4xl font-semibold text-white shadow-[0_22px_58px_rgba(13,148,136,0.28)]">
              ✓
            </div>
            <h2 className="mt-6 text-3xl font-semibold tracking-normal text-slate-950">提交成功</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              正在打开这条线索，你可以继续更新它。
            </p>
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(20,184,166,0.10)_0%,rgba(255,255,255,0.92)_34%,rgba(148,163,184,0.12)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(20,184,166,0.10),transparent_34%),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(0deg,rgba(15,23,42,0.025)_1px,transparent_1px)] bg-[length:auto,42px_42px,42px_42px]" />
      <div className="relative mx-auto w-full max-w-4xl">
        <section>
          <p className="text-sm font-semibold text-teal-700">灵感共创队</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-normal sm:text-5xl">说说你在琢磨的事儿</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600">
            不用整理成方案，也不用给出明确答案，抛出一个明确的需求或者模糊的念头，我们会根据你的情况用尽量少的问题帮你看清下一步。
          </p>
        </section>

        <section className="mt-8 rounded-[var(--radius-lg)] border border-white/80 bg-white/90 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur sm:p-7 lg:p-8">
          <form onSubmit={handleSubmit} className="space-y-8">
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">你现在更接近哪种情况<RequiredMark /></legend>
              <div className="mt-3 grid gap-3">
                {intentOptions.map((option) => {
                  const checked = intent === option.key
                  return (
                    <label key={option.key} className={optionClass(checked)}>
                      <input
                        type="radio"
                        name="intent"
                        required
                        checked={checked}
                        value={option.key}
                        onChange={() => switchIntent(option.key)}
                        className="sr-only"
                      />
                      <ChoiceCheck checked={checked} />
                      <span>
                        <span className="block font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {intent === 'demand' ? (
              <div key="demand" className="animate-stage-enter-right space-y-8">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">把这个需求说明白一点<RequiredMark /></span>
                  <span className="mt-1 block text-sm leading-6 text-slate-500">
                    可以写场景、谁遇到了这个问题、你希望解决后是什么样子。
                  </span>
                  <textarea
                    aria-label="把这个需求说明白一点"
                    required
                    value={form.problem}
                    onChange={(event) => updateField('problem', event.target.value)}
                    rows={5}
                    className={textareaClass}
                    placeholder="比如：我们社群里很多同学写简历很痛苦，不知道怎么把经历讲清楚。我希望有人一起把这个问题拆成一个可验证的小工具。"
                  />
                  <TextStrength value={form.problem} />
                  <p className="mt-2 text-sm font-medium text-teal-700" aria-live="polite">{primaryProblemFeedback(form.problem)}</p>
                </label>

                <div className="grid gap-5">
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">这个需求大致在什么方向<RequiredMark /></legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {categoryOptions.map((option) => (
                        <label key={option} className={optionClass(form.category === option, 'pill')}>
                          <input
                            type="radio"
                            name="category"
                            required
                            checked={form.category === option}
                            value={option}
                            onChange={(event) => updateField('category', event.target.value)}
                            className="sr-only"
                          />
                          <span className="inline-flex items-center gap-1.5">
                            {form.category === option ? <span aria-hidden="true" className="text-teal-700">✓</span> : null}
                            {option}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">你希望得到什么样的帮助<RequiredMark /></legend>
                    <div className="mt-2 grid gap-2">
                      {demandHelpOptions.map((option) => (
                        <label key={option} className={optionClass(form.current_blockers === option)}>
                          <input
                            type="radio"
                            name="demand_help"
                            required
                            checked={form.current_blockers === option}
                            value={option}
                            onChange={(event) => updateField('current_blockers', event.target.value)}
                            className="sr-only"
                          />
                          <ChoiceCheck checked={form.current_blockers === option} />
                          {option}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">还有什么想补充的（可选）</span>
                  <textarea
                    value={form.note}
                    onChange={(event) => updateField('note', event.target.value)}
                    rows={3}
                    placeholder="可以写背景、已有材料、希望谁参与，或者任何你觉得重要的细节。"
                    className={textareaClass}
                  />
                </label>
              </div>
            ) : null}

            {intent === 'idea' ? (
              <div key="idea" className="animate-stage-enter-right space-y-8">
                <fieldset>
                  <legend className="text-sm font-medium text-slate-700">这个想法现在到什么阶段了<RequiredMark /></legend>
                  <div className="mt-2 grid gap-3">
                    {ideaMaturityOptions.map((option) => (
                      <label key={option} className={optionClass(form.category_extra === option)}>
                        <input
                          type="radio"
                          name="idea_maturity"
                          required
                          checked={form.category_extra === option}
                          value={option}
                          onChange={(event) => updateField('category_extra', event.target.value)}
                          className="sr-only"
                        />
                        <ChoiceCheck checked={form.category_extra === option} />
                        {option}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">先用一句话描述一下这个想法<RequiredMark /></span>
                  <span className="mt-1 block text-sm leading-6 text-slate-500">
                    可以不用太具体。说说它来自什么场景、想帮谁，或者哪里值得一试。
                  </span>
                  <textarea
                    aria-label="先用一句话描述一下这个想法"
                    required
                    value={form.problem}
                    onChange={(event) => updateField('problem', event.target.value)}
                    rows={5}
                    className={textareaClass}
                    placeholder="比如：我发现大家经常把想法聊完就散了，我想看看能不能有一个方式把它变成一周内能试的小行动。"
                  />
                  <TextStrength value={form.problem} />
                  <p className="mt-2 text-sm font-medium text-teal-700" aria-live="polite">{primaryProblemFeedback(form.problem)}</p>
                </label>

                <div className="grid gap-5">
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">这个想法大致和哪个领域相关<RequiredMark /></legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {categoryOptions.map((option) => (
                        <label key={option} className={optionClass(form.category === option, 'pill')}>
                          <input
                            type="radio"
                            name="category"
                            required
                            checked={form.category === option}
                            value={option}
                            onChange={(event) => updateField('category', event.target.value)}
                            className="sr-only"
                          />
                          <span className="inline-flex items-center gap-1.5">
                            {form.category === option ? <span aria-hidden="true" className="text-teal-700">✓</span> : null}
                            {option}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">你现在最不确定的是什么<RequiredMark /></legend>
                    <div className="mt-2 grid gap-2">
                      {ideaUncertaintyOptions.map((option) => (
                        <label key={option} className={optionClass(form.current_blockers === option)}>
                          <input
                            type="radio"
                            name="idea_uncertainty"
                            required
                            checked={form.current_blockers === option}
                            value={option}
                            onChange={(event) => updateField('current_blockers', event.target.value)}
                            className="sr-only"
                          />
                          <ChoiceCheck checked={form.current_blockers === option} />
                          {option}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>
            ) : null}

            {intent === 'participant' ? (
              <div key="participant" className="animate-stage-enter-right space-y-8">
                <fieldset>
                  <legend className="text-sm font-medium text-slate-700">你想参与哪类项目<RequiredMark /></legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {categoryOptions.map((option) => (
                      <label key={option} className={optionClass(form.category === option, 'pill')}>
                        <input
                          type="radio"
                          name="category"
                          required
                          checked={form.category === option}
                          value={option}
                          onChange={(event) => updateField('category', event.target.value)}
                          className="sr-only"
                        />
                        <span className="inline-flex items-center gap-1.5">
                          {form.category === option ? <span aria-hidden="true" className="text-teal-700">✓</span> : null}
                          {option}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-sm font-medium text-slate-700">你更想怎么参与<RequiredMark /></legend>
                  <div className="mt-2 grid gap-3">
                    {participantRoleOptions.map((option) => (
                      <label key={option} className={optionClass(form.current_blockers === option)}>
                        <input
                          type="radio"
                          name="participant_role"
                          required
                        checked={form.current_blockers === option}
                        value={option}
                        onChange={(event) => updateField('current_blockers', event.target.value)}
                        className="sr-only"
                      />
                      <ChoiceCheck checked={form.current_blockers === option} />
                      {option}
                    </label>
                  ))}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">还有什么想让我们知道的（可选）</span>
                  <textarea
                    value={form.note}
                    onChange={(event) => updateField('note', event.target.value)}
                    rows={3}
                    placeholder="比如你擅长什么、希望投入多少时间、想参与什么样的真实问题。"
                    className={textareaClass}
                  />
                </label>
              </div>
            ) : null}

            {intent === 'observer' ? (
              <div className="animate-stage-enter-right rounded-[var(--radius-md)] border border-teal-100 bg-teal-50/70 px-4 py-4 text-sm leading-7 text-teal-900 shadow-[0_16px_36px_rgba(13,148,136,0.08)]">
                没问题。留下联系方式就好，后续我们会把最新动态和真实问题同步给你。
              </div>
            ) : null}

            {(intent === 'demand' || intent === 'idea') ? (
              <fieldset className="animate-fade-in">
                <legend className="text-sm font-medium text-slate-700">是否愿意把它匿名展示出来<RequiredMark /></legend>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  公开时会隐藏你的称呼和联系方式，只展示整理后的问题。说不定有人看到后愿意一起讨论、拆解或验证。
                </p>
                <div className="mt-2 grid gap-3">
                  {publicOptions.map((option) => {
                    const checked = form.allow_public === option.value
                    return (
                      <label key={option.label} className={optionClass(checked)}>
                        <input
                          type="radio"
                          name="allow_public"
                          checked={checked}
                          value={String(option.value)}
                          onChange={() => updateField('allow_public', option.value)}
                          className="sr-only"
                        />
                        <ChoiceCheck checked={checked} />
                        {option.label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            ) : null}

            <div className="border-t border-teal-100 pt-6">
              <p className="text-sm font-medium text-slate-700">如果你愿意，后续我们可以找你一起聊聊这件事。</p>
              <div className="mt-4 grid gap-5">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">怎么联系你<RequiredMark /></span>
                  <input
                    aria-label="怎么联系你"
                    required
                    value={form.contact}
                    onChange={(event) => updateField('contact', event.target.value)}
                    placeholder="微信、手机号、邮箱都可以"
                    className={inputClass}
                  />
                  <p className={`mt-2 text-xs leading-5 transition-colors ${form.contact.trim() ? 'text-teal-700' : 'text-slate-400'}`} aria-live="polite">
                    {form.contact.trim() ? '没问题，后续可以联系到你。' : '只用于后续沟通，不会公开展示。'}
                  </p>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">怎么称呼你（可选）</span>
                  <input
                    aria-label="怎么称呼你（可选）"
                    value={form.submitter_name}
                    onChange={(event) => updateField('submitter_name', event.target.value)}
                    placeholder="不填也可以"
                    className={inputClass}
                  />
                </label>
              </div>
            </div>

            {error ? <p className="animate-fade-in rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={status === 'submitting'}
                className={`inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 motion-reduce:transition-none ${
                  isReady
                    ? 'bg-teal-700 shadow-[0_18px_38px_rgba(13,148,136,0.22)] hover:bg-teal-800'
                    : 'bg-slate-800 shadow-[0_16px_34px_rgba(15,23,42,0.14)] hover:bg-slate-950'
                }`}
              >
                {status === 'submitting' ? '正在提交…' : isReady ? submitLabel : '看看还差什么'}
              </button>
              <p className={`text-sm leading-6 ${isReady ? 'text-teal-700' : 'text-slate-500'}`} aria-live="polite">
                {status === 'submitting' ? '正在提交这条记录。' : missingHint}
              </p>
            </div>
          </form>

        </section>
      </div>
    </div>
  )
}
