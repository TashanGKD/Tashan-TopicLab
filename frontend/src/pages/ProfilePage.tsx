import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LibraryPageLayout from '../components/LibraryPageLayout'
import { profileImportApi, readImportError } from '../api/profileImport'
import type { HistoryItem, ImportField, ImportSource, PreviewResponse, ProfileFieldView } from '../api/profileImport'
import { tokenManager } from '../api/auth'

type Stage = 'idle' | 'consent' | 'preview' | 'saving' | 'done'

const cardStyle = { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' } as const

function formatTime(epoch?: number | null) {
  if (!epoch) return '未记录'
  return new Date(epoch * 1000).toLocaleString('zh-CN', { hour12: false })
}

function formatSourceTime(value: string | null) {
  if (!value) return '来源未提供时间'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '来源未提供时间' : parsed.toLocaleString('zh-CN', { hour12: false })
}

const statusText: Record<string, string> = {
  granted: '已授权，待完成',
  cancelled: '已取消',
  completed: '已保存',
  expired: '已过期',
}

export default function ProfilePage() {
  const signedIn = Boolean(tokenManager.get())
  const [fields, setFields] = useState<ProfileFieldView[]>([])
  const [sources, setSources] = useState<ImportSource[]>([])
  const [consent, setConsent] = useState<{ version: string; text: string } | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [activeSource, setActiveSource] = useState<ImportSource | null>(null)
  const [authorizationId, setAuthorizationId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [adopt, setAdopt] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!signedIn) return
    try {
      const [profile, sourceList, historyList] = await Promise.all([
        profileImportApi.profile(),
        profileImportApi.sources(),
        profileImportApi.history(),
      ])
      setFields(profile.fields)
      setSources(sourceList.sources)
      setConsent(sourceList.consent)
      setHistory(historyList.items)
    } catch (e) {
      setError(readImportError(e))
    }
  }, [signedIn])

  useEffect(() => {
    void load()
  }, [load])

  const reset = useCallback(() => {
    setStage('idle')
    setActiveSource(null)
    setAuthorizationId(null)
    setPreview(null)
    setDraft({})
    setAdopt({})
    setNotice(null)
  }, [])

  const startConsent = (source: ImportSource) => {
    setError(null)
    setSaved(null)
    setActiveSource(source)
    setStage('consent')
  }

  const beginPreview = async () => {
    if (!activeSource) return
    setBusy(true)
    setError(null)
    try {
      const authorization = await profileImportApi.authorize(activeSource.source)
      setAuthorizationId(authorization.authorization_id)
      const result = await profileImportApi.preview(authorization.authorization_id)
      if (!result.bound) {
        setNotice(result.message || '这个来源还没有关联你的他山账号')
        setPreview(result)
        setStage('preview')
        return
      }
      setPreview(result)
      const initialAdopt: Record<string, boolean> = {}
      const initialDraft: Record<string, string> = {}
      for (const field of result.fields ?? []) {
        const usable = Boolean(field.source_value) && field.source_value !== field.current
        initialAdopt[field.field] = usable
        initialDraft[field.field] = field.source_value ?? ''
      }
      setAdopt(initialAdopt)
      setDraft(initialDraft)
      setStage('preview')
    } catch (e) {
      setError(readImportError(e))
    } finally {
      setBusy(false)
    }
  }

  const cancelAuthorization = async () => {
    if (!authorizationId) {
      reset()
      return
    }
    setBusy(true)
    try {
      await profileImportApi.cancel(authorizationId)
      setNotice('已取消这次授权，之后不会再读取该来源。')
      reset()
      await load()
    } catch (e) {
      setError(readImportError(e))
    } finally {
      setBusy(false)
    }
  }

  const selections = useMemo(() => {
    const values: Record<string, string> = {}
    const origin: Record<string, string> = {}
    for (const field of preview?.fields ?? []) {
      if (!adopt[field.field]) continue
      const value = (draft[field.field] ?? '').trim()
      if (!value) continue
      values[field.field] = value
      origin[field.field] = value === (field.source_value ?? '').trim() ? 'source' : 'user'
    }
    return { values, origin }
  }, [adopt, draft, preview])

  const save = async () => {
    if (!preview?.preview_id || !preview.preview_token || !preview.base_version) return
    if (!Object.keys(selections.values).length) {
      setError('请至少选择一项要保存的资料')
      return
    }
    setStage('saving')
    setBusy(true)
    setError(null)
    try {
      const result = await profileImportApi.commit({
        preview_id: preview.preview_id,
        preview_token: preview.preview_token,
        expected_version: preview.base_version,
        idempotency_key: crypto.randomUUID(),
        selections: selections.values,
        origin: selections.origin,
      })
      setSaved(`已保存 ${result.imported.length} 项资料，个人资料版本 ${result.applied_version}。`)
      reset()
      await load()
    } catch (e) {
      const message = readImportError(e)
      setError(message)
      setStage('preview')
      if (message.includes('版本') || message.includes('过期') || message.includes('失效')) {
        setPreview(null)
        setAuthorizationId(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const reloadPreview = async () => {
    reset()
    await load()
  }

  if (!signedIn) {
    return (
      <LibraryPageLayout title="个人资料">
        <div className="rounded-[var(--radius-lg)] border p-6" style={cardStyle}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>登录后可以查看和导入个人资料。</p>
          <Link className="mt-4 inline-block text-sm underline" style={{ color: 'var(--accent-primary)' }} to="/login">
            前往登录
          </Link>
        </div>
      </LibraryPageLayout>
    )
  }

  return (
    <LibraryPageLayout
      title="个人资料"
      description="姓名、单位、专业和研究方向可以用于已授权网站的资料预填。你可以从已关联的活动账号导入，并逐项核对后保存。"
    >
      <div className="space-y-6">
        <section className="rounded-[var(--radius-lg)] border p-5" style={cardStyle} id="profile-import">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                从已有活动导入个人资料
              </h2>
              <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                只读取姓名、单位、专业和研究方向；导入不会修改活动中的报名、投稿或审核记录。
              </p>
            </div>
            {stage !== 'idle' ? (
              <button
                type="button"
                onClick={() => void cancelAuthorization()}
                disabled={busy}
                className="rounded-[var(--radius-md)] border px-3 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              >
                取消本次导入
              </button>
            ) : null}
          </div>

          {saved ? (
            <p className="mt-4 rounded-[var(--radius-md)] px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              {saved}
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 rounded-[var(--radius-md)] px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--accent-error)' }}>
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-4 rounded-[var(--radius-md)] px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              {notice}
            </p>
          ) : null}

          {stage === 'idle' ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {sources.map((source) => (
                <div key={source.source} className="rounded-[var(--radius-md)] border p-4" style={cardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{source.label}</span>
                    <span className="text-xs" style={{ color: source.available ? 'var(--text-secondary)' : 'var(--accent-error)' }}>
                      {source.available ? '可读取' : '暂不可用'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                    {source.available ? `来源活动：${source.activity}` : '可以跳过，其他来源和登录不受影响'}
                  </p>
                  <button
                    type="button"
                    onClick={() => startConsent(source)}
                    disabled={!source.available}
                    className="mt-3 w-full rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--bg-container)' }}
                  >
                    从{source.label}导入
                  </button>
                </div>
              ))}
              {!sources.length ? (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>暂时没有可用的来源。</p>
              ) : null}
            </div>
          ) : null}

          {stage === 'consent' && activeSource ? (
            <div className="mt-4 rounded-[var(--radius-md)] border p-4" style={cardStyle}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                授权读取：{activeSource.label}
              </h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                {consent?.text}
              </p>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                授权文案版本 {consent?.version}；本次授权 10 分钟内有效，只用于这一次导入。
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void beginPreview()}
                  disabled={busy}
                  className="rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--bg-container)' }}
                >
                  {busy ? '正在读取…' : '同意并读取资料'}
                </button>
                <button
                  type="button"
                  onClick={() => void cancelAuthorization()}
                  disabled={busy}
                  className="rounded-[var(--radius-md)] border px-4 py-2 text-sm"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                >
                  不同意，返回
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'preview' && preview ? (
            preview.bound === false ? (
              <div className="mt-4 rounded-[var(--radius-md)] border p-4" style={cardStyle}>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{notice}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                  关联账号需要在该网站用原账号登录后再关联他山账号；他山不会按手机号或姓名自动合并账号。
                </p>
                <button
                  type="button"
                  onClick={() => void reloadPreview()}
                  className="mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                >
                  返回来源列表
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  来源活动：{preview.activity}；核对后再保存到个人资料。未勾选的项目不会改变。
                </p>
                <div className="overflow-x-auto rounded-[var(--radius-md)] border" style={cardStyle}>
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr style={{ color: 'var(--text-secondary)' }}>
                        <th className="px-3 py-2 text-left font-medium">采用</th>
                        <th className="px-3 py-2 text-left font-medium">字段</th>
                        <th className="px-3 py-2 text-left font-medium">当前资料</th>
                        <th className="px-3 py-2 text-left font-medium">来源值</th>
                        <th className="px-3 py-2 text-left font-medium">来源时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.fields ?? []).map((field: ImportField) => (
                        <tr key={field.field} className="align-top" style={{ borderTop: '1px solid var(--border-default)' }}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`采用${field.label}`}
                              checked={Boolean(adopt[field.field])}
                              disabled={!field.source_value}
                              onChange={(event) => setAdopt((prev) => ({ ...prev, [field.field]: event.target.checked }))}
                            />
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                            {field.label}
                            {field.note === 'combined_field' ? (
                              <span className="ml-1 text-xs" style={{ color: 'var(--text-secondary)' }}>（来源为组合字段，保留原文）</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{field.current || '未填写'}</td>
                          <td className="px-3 py-2">
                            {field.source_value ? (
                              <input
                                className="w-full rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                                value={draft[field.field] ?? ''}
                                onChange={(event) => setDraft((prev) => ({ ...prev, [field.field]: event.target.value }))}
                              />
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>来源未填写</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {formatSourceTime(field.source_updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy}
                    className="rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--bg-container)' }}
                  >
                    {busy ? '正在保存…' : '确认保存到个人资料'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelAuthorization()}
                    disabled={busy}
                    className="rounded-[var(--radius-md)] border px-4 py-2 text-sm"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    不保存，取消本次导入
                  </button>
                </div>
              </div>
            )
          ) : null}
        </section>

        <section className="rounded-[var(--radius-lg)] border p-5" style={cardStyle}>
          <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>当前个人资料</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.field} className="rounded-[var(--radius-md)] border p-3" style={cardStyle}>
                <dt className="text-xs" style={{ color: 'var(--text-secondary)' }}>{field.label}</dt>
                <dd className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>{field.value || '未填写'}</dd>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {field.source === 'user' || !field.source
                    ? '由你填写或尚未记录来源'
                    : `来自 ${field.source}${field.source_updated_at ? `（来源时间 ${formatSourceTime(field.source_updated_at)}）` : '（来源未提供时间）'}`}
                </p>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
            个人资料的修改沿用现有个人资料能力；导入不会删除或改写活动中的历史记录。
          </p>
        </section>

        <section className="rounded-[var(--radius-lg)] border p-5" style={cardStyle}>
          <h2 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>导入授权记录</h2>
          {history.length ? (
            <ul className="mt-3 space-y-2">
              {history.map((item) => (
                <li key={item.authorization_id} className="rounded-[var(--radius-md)] border p-3 text-sm" style={cardStyle}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {statusText[item.status] ?? item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    授权时间 {formatTime(item.granted_at)}；用途：导入个人资料；范围：{item.field_scope.join('、') || '无'}；文案版本 {item.consent_version}
                  </p>
                  {item.adopted_fields.length ? (
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      已采用：{item.adopted_fields.map((f) => `${f.field}（${f.source}）`).join('、')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>还没有导入记录。</p>
          )}
        </section>
      </div>
    </LibraryPageLayout>
  )
}
