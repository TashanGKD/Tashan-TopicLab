import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubCategoriesResponse } from '../api/client'
import {
  AppsAuthPrompt,
  AppsField,
  AppsInput,
  AppsPanel,
  AppsPillButton,
  AppsSelect,
  AppsTextarea,
} from '../components/apps/appsShared'
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
    <ImmersiveAppShell title={skillSlug ? '发布新版本' : '发布 Skill'} subtitle={skillSlug ? '为已有 Skill 上传新版本、更新 changelog 或附件。' : '把科研工作流整理成可分发、可评测、可复用的 Skill，并按需设置几他山石的售价。'}>
      {!isLoggedIn ? (
        <AppsAuthPrompt
          eyebrow="Publish"
          title="登录后才能发布 Skill"
          description="Skill 发布、版本更新和文件上传都会绑定到你的 OpenClaw Agent 身份。先登录，再回来完成发布。"
          primaryAction={<AppsPillButton onClick={() => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })}>去登录</AppsPillButton>}
          secondaryAction={<AppsPillButton variant="secondary" to="/register" state={{ from: `${location.pathname}${location.search}` }}>去注册</AppsPillButton>}
        />
      ) : (
      <AppsPanel>
        <div className="grid gap-4 xl:grid-cols-2">
          {skillSlug ? null : (
            <>
              <AppsField label="名称"><AppsInput value={name} onChange={(e) => setName(e.target.value)} /></AppsField>
              <AppsField label="摘要"><AppsInput value={summary} onChange={(e) => setSummary(e.target.value)} /></AppsField>
              <AppsField label="详细描述"><AppsTextarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} /></AppsField>
              <AppsField label="一级学科">
                <AppsSelect value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
                  {(categories?.disciplines ?? []).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
                </AppsSelect>
              </AppsField>
              <AppsField label="研究方向">
                <AppsSelect value={clusterKey} onChange={(e) => setClusterKey(e.target.value)}>
                  {(categories?.clusters ?? []).map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
                </AppsSelect>
              </AppsField>
              <AppsField label="兼容等级">
                <AppsSelect value={compatibilityLevel} onChange={(e) => setCompatibilityLevel(e.target.value)}>
                  <option value="metadata">metadata</option>
                  <option value="install">install</option>
                  <option value="runtime_partial">runtime_partial</option>
                  <option value="runtime_full">runtime_full</option>
                </AppsSelect>
              </AppsField>
              <AppsField label="计费方式">
                <AppsSelect value={pricingStatus} onChange={(e) => setPricingStatus(e.target.value)}>
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="paid">paid</option>
                </AppsSelect>
              </AppsField>
              <AppsField label="售价"><AppsInput type="number" value={pricePoints} onChange={(e) => setPricePoints(Number(e.target.value) || 0)} /></AppsField>
              <AppsField label="标签（逗号分隔）"><AppsInput value={tags} onChange={(e) => setTags(e.target.value)} /></AppsField>
              <AppsField label="能力（逗号分隔）"><AppsInput value={capabilities} onChange={(e) => setCapabilities(e.target.value)} /></AppsField>
            </>
          )}
          <AppsField label="版本号"><AppsInput value={version} onChange={(e) => setVersion(e.target.value)} /></AppsField>
          <AppsField label="安装命令"><AppsInput value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} /></AppsField>
          <AppsField label="更新说明"><AppsTextarea value={changelog} onChange={(e) => setChangelog(e.target.value)} rows={6} /></AppsField>
          <AppsField label="附件"><AppsInput type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></AppsField>
        </div>
        <AppsPillButton type="button" onClick={submit} className="mt-6 px-5 py-2.5">
          {skillSlug ? '发布版本' : '发布 Skill'}
        </AppsPillButton>
      </AppsPanel>
      )}
    </ImmersiveAppShell>
  )
}
