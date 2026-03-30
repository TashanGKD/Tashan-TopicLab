import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubCategoriesResponse } from '../api/client'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

export default function AppsSkillPublishPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const skillSlug = searchParams.get('skill')
  const isLoggedIn = Boolean(tokenManager.get())
  const [categories, setCategories] = useState<SkillHubCategoriesResponse | null>(null)
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [categoryKey, setCategoryKey] = useState('07')
  const [clusterKey, setClusterKey] = useState('general')
  const [compatibilityLevel, setCompatibilityLevel] = useState('metadata')
  const [pricingStatus, setPricingStatus] = useState('free')
  const [pricePoints, setPricePoints] = useState(0)
  const [version, setVersion] = useState('0.1.0')
  const [installCommand, setInstallCommand] = useState('')
  const [changelog, setChangelog] = useState('')
  const [tags, setTags] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    let alive = true
    skillHubApi.listCategories()
      .then((res) => { if (alive) setCategories(res.data) })
      .catch((err) => { if (alive) handleApiError(err, '加载分类失败') })
    return () => { alive = false }
  }, [])

  const submit = async () => {
    try {
      if (skillSlug) {
        await skillHubApi.publishVersion(skillSlug, { version, changelog, install_command: installCommand || undefined, file })
        toast.success('新版本已发布')
        navigate(`/apps/skills/${skillSlug}`)
        return
      }
      const res = await skillHubApi.publishSkill({
        name,
        summary,
        description,
        category_key: categoryKey,
        cluster_key: clusterKey,
        compatibility_level: compatibilityLevel,
        pricing_status: pricingStatus,
        price_points: pricePoints,
        version,
        install_command: installCommand,
        changelog,
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
        capabilities: capabilities.split(',').map((item) => item.trim()).filter(Boolean),
        file,
      })
      toast.success('Skill 已发布')
      navigate(`/apps/skills/${res.data.slug}`)
    } catch (err) {
      handleApiError(err, skillSlug ? '发布版本失败' : '发布 Skill 失败')
    }
  }

  return (
    <ImmersiveAppShell title={skillSlug ? '发布新版本' : '发布 Skill'} subtitle={skillSlug ? '为已有 Skill 上传新版本、更新 changelog 或附件。' : '把科研工作流整理成可分发、可评测、可复用的 Skill。'}>
      {!isLoggedIn ? (
        <section className="rounded-[28px] border p-6" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Publish</div>
          <h2 className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
            登录后才能发布 Skill
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            Skill 发布、版本更新和文件上传都会绑定到你的 OpenClaw Agent 身份。先登录，再回来完成发布。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              去登录
            </button>
            <Link to="/register" state={{ from: `${location.pathname}${location.search}` }} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
              去注册
            </Link>
          </div>
        </section>
      ) : (
      <section className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="grid gap-4 xl:grid-cols-2">
          {skillSlug ? null : (
            <>
              <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
              <Field label="摘要"><input value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
              <Field label="详细描述"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="w-full rounded-2xl border px-4 py-3 text-sm leading-6" style={FIELD_STYLE} /></Field>
              <Field label="一级学科">
                <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE}>
                  {(categories?.disciplines ?? []).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="研究方向">
                <select value={clusterKey} onChange={(e) => setClusterKey(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE}>
                  {(categories?.clusters ?? []).map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
                </select>
              </Field>
              <Field label="兼容等级">
                <select value={compatibilityLevel} onChange={(e) => setCompatibilityLevel(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE}>
                  <option value="metadata">metadata</option>
                  <option value="install">install</option>
                  <option value="runtime_partial">runtime_partial</option>
                  <option value="runtime_full">runtime_full</option>
                </select>
              </Field>
              <Field label="计费方式">
                <select value={pricingStatus} onChange={(e) => setPricingStatus(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE}>
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="paid">paid</option>
                </select>
              </Field>
              <Field label="点数价格"><input type="number" value={pricePoints} onChange={(e) => setPricePoints(Number(e.target.value) || 0)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
              <Field label="标签（逗号分隔）"><input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
              <Field label="能力（逗号分隔）"><input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
            </>
          )}
          <Field label="版本号"><input value={version} onChange={(e) => setVersion(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
          <Field label="安装命令"><input value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
          <Field label="更新说明"><textarea value={changelog} onChange={(e) => setChangelog(e.target.value)} rows={6} className="w-full rounded-2xl border px-4 py-3 text-sm leading-6" style={FIELD_STYLE} /></Field>
          <Field label="附件"><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full rounded-2xl border px-4 py-3 text-sm" style={FIELD_STYLE} /></Field>
        </div>
        <button type="button" onClick={submit} className="mt-6 rounded-full border px-5 py-2.5 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          {skillSlug ? '发布版本' : '发布 Skill'}
        </button>
      </section>
      )}
    </ImmersiveAppShell>
  )
}

const FIELD_STYLE = {
  borderColor: 'var(--border-default)',
  backgroundColor: 'var(--bg-page)',
  color: 'var(--text-primary)',
} as const

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
      {children}
    </label>
  )
}
