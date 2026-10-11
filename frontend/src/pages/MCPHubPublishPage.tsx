import { FormEvent, useState } from 'react'

import { mcpHubApi } from '../api/client'
import { AppsInput, AppsTextarea } from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'

const INITIAL_FORM = {
  name: '',
  summary: '',
  canonical_url: '',
  repo_url: '',
  evidence: '',
  difference: '',
  domain: '',
  subdomain: '',
  stage: '',
  function: '',
}

type FormKey = keyof typeof INITIAL_FORM

const BASIC_FIELDS: Array<{ key: FormKey; label: string; placeholder: string }> = [
  { key: 'name', label: 'MCP 名称', placeholder: '例如：蛋白结构检索 MCP' },
  { key: 'summary', label: '一句话说明', placeholder: '它面向什么科研对象，能完成什么工作？' },
  { key: 'canonical_url', label: '项目主页或官方地址', placeholder: 'https://…' },
  { key: 'repo_url', label: '代码仓库地址（可选）', placeholder: 'https://github.com/…' },
  { key: 'domain', label: '一级领域', placeholder: '例如：生命科学' },
  { key: 'subdomain', label: '二级领域', placeholder: '例如：蛋白与结构生物学' },
  { key: 'stage', label: '科研阶段', placeholder: '例如：发现获取' },
  { key: 'function', label: '功能分工', placeholder: '例如：检索获取' },
]

export default function MCPHubPublishPage() {
  const [form, setForm] = useState(INITIAL_FORM)
  const [message, setMessage] = useState<string | null>(null)

  const update = (key: FormKey, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const response = await mcpHubApi.submitCandidate(form)
      setMessage(`已收到候选 #${response.data.id}，等待核对。`)
      setForm(INITIAL_FORM)
    } catch {
      setMessage('请先登录，并填写项目地址与来源说明。')
    }
  }

  return (
    <ImmersiveAppShell
      title="推荐科研 MCP"
      subtitle="提交后由维护团队核对项目来源与分类；确认信息完整后，它会出现在科研 MCP 目录中。"
      backTo="/mcphub"
      backLabel="科研 MCP Hub"
    >
        <form onSubmit={submit} className="mt-5 grid gap-4 rounded-2xl border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
          <div className="grid gap-4 sm:grid-cols-2">
            {BASIC_FIELDS.map((field) => (
              <label key={field.key} className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                <span className="mb-2 block">{field.label}</span>
                <AppsInput
                  aria-label={field.label}
                  value={form[field.key]}
                  onChange={(event) => update(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="h-10 rounded-md py-2"
                />
              </label>
            ))}
          </div>
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            <span className="mb-2 block">来源说明</span>
            <AppsTextarea
              aria-label="来源说明"
              value={form.evidence}
              onChange={(event) => update('evidence', event.target.value)}
              placeholder="请说明哪里明确写出这是 MCP，以及它面向的科研对象和主要作用。"
              rows={5}
            />
          </label>
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            <span className="mb-2 block">与现有工具的区别（可选）</span>
            <AppsTextarea
              aria-label="与现有工具的区别"
              value={form.difference}
              onChange={(event) => update('difference', event.target.value)}
              placeholder="它与相似 MCP 相比，有哪些不同的研究对象、数据或功能？"
              rows={4}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800">提交推荐</button>
            {message ? <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{message}</span> : null}
          </div>
        </form>
    </ImmersiveAppShell>
  )
}
