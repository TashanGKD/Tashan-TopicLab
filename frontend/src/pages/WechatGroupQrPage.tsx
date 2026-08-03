import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { clearAuthSession, tokenManager } from '../api/auth'

type QrGroup = {
  slug: string
  path: string
  title: string
  key: string
  url: string
  updated_at?: string | null
}

type RequestState = {
  status: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

type EditorState = {
  mode: 'create' | 'edit'
  originalSlug: string | null
  path: string
  title: string
  image: File | null
}

const EMPTY_EDITOR: EditorState = {
  mode: 'create',
  originalSlug: null,
  path: '',
  title: '',
  image: null,
}

function buildApiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}api/v1/site/${path}`
}

function buildAssetUrl(assetKey: string, version: number): string {
  const baseUrl = buildApiUrl(`assets/${assetKey}.webp`)
  return version ? `${baseUrl}?v=${version}` : baseUrl
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '读取中...'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string }
    if (payload.detail) return payload.detail
  } catch {
    // Fall through to the status-based message.
  }
  return `请求失败（HTTP ${response.status}）`
}

export default function WechatGroupQrPage({ adminMode = false }: { adminMode?: boolean }) {
  const { slug = '' } = useParams<{ slug: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [group, setGroup] = useState<QrGroup | null>(null)
  const [pageState, setPageState] = useState<RequestState>({ status: 'loading', message: '' })
  const [adminGroups, setAdminGroups] = useState<QrGroup[]>([])
  const [adminState, setAdminState] = useState<RequestState>({ status: 'idle', message: '' })
  const [saveState, setSaveState] = useState<RequestState>({ status: 'idle', message: '' })
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [imageVersion, setImageVersion] = useState(0)

  const loadCurrentGroup = useCallback(async () => {
    setPageState({ status: 'loading', message: '' })
    try {
      const response = await fetch(buildApiUrl(`qr-groups/${encodeURIComponent(slug)}`))
      if (!response.ok) throw new Error(await responseError(response))
      const payload = (await response.json()) as QrGroup
      setGroup(payload)
      setPageState({ status: 'success', message: '' })
    } catch (error) {
      setGroup(null)
      setPageState({ status: 'error', message: error instanceof Error ? error.message : '二维码不存在' })
    }
  }, [slug])

  const loadAdminGroups = useCallback(async () => {
    if (!adminMode) return
    const token = tokenManager.get()
    if (!token) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true })
      return
    }
    setAdminState({ status: 'loading', message: '正在验证站点管理员账号…' })
    try {
      const response = await fetch(buildApiUrl('qr-groups/admin'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status === 401) {
        clearAuthSession()
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true })
        return
      }
      if (!response.ok) throw new Error(await responseError(response))
      const payload = (await response.json()) as { items: QrGroup[] }
      setAdminGroups(payload.items)
      setGroup((current) => payload.items.find((item) => item.key === current?.key) ?? payload.items[0] ?? null)
      setPageState(payload.items.length
        ? { status: 'success', message: '' }
        : { status: 'error', message: '暂无二维码' })
      setAdminState({ status: 'success', message: '' })
    } catch (error) {
      setAdminGroups([])
      setAdminState({
        status: 'error',
        message: error instanceof Error ? error.message : '管理员账号认证失败',
      })
    }
  }, [adminMode, location.pathname, navigate])

  useEffect(() => {
    if (!adminMode) void loadCurrentGroup()
  }, [adminMode, loadCurrentGroup])

  useEffect(() => {
    if (!adminMode) {
      setAdminGroups([])
      setAdminState({ status: 'idle', message: '' })
      return
    }
    void loadAdminGroups()
  }, [adminMode, loadAdminGroups])

  function startCreate() {
    setEditor(EMPTY_EDITOR)
    setSaveState({ status: 'idle', message: '' })
  }

  function startEdit(item: QrGroup) {
    setGroup(item)
    setEditor({
      mode: 'edit',
      originalSlug: item.slug,
      path: item.slug,
      title: item.title,
      image: null,
    })
    setSaveState({ status: 'idle', message: '' })
  }

  function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    setEditor((current) => ({ ...current, image: event.target.files?.[0] ?? null }))
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPath = editor.path.trim().replace(/^\/?qr\//, '').replace(/^\//, '')
    const normalizedTitle = editor.title.trim()
    if (!normalizedPath || !normalizedTitle) {
      setSaveState({ status: 'error', message: '请填写路径和标题' })
      return
    }
    if (editor.mode === 'create' && !editor.image) {
      setSaveState({ status: 'error', message: '新增二维码时必须选择图片' })
      return
    }

    const formData = new FormData()
    formData.append('path', `/qr/${normalizedPath}`)
    formData.append('title', normalizedTitle)
    if (editor.image) formData.append('image', editor.image)
    const isEditing = editor.mode === 'edit' && editor.originalSlug !== null
    const endpoint = isEditing
      ? `qr-groups/${encodeURIComponent(editor.originalSlug as string)}`
      : 'qr-groups'

    setSaveState({ status: 'loading', message: isEditing ? '正在保存修改…' : '正在创建二维码…' })
    try {
      const token = tokenManager.get()
      if (!token) {
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
        return
      }
      const response = await fetch(buildApiUrl(endpoint), {
        method: isEditing ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (response.status === 401) {
        clearAuthSession()
        navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true })
        return
      }
      if (!response.ok) throw new Error(await responseError(response))
      const saved = (await response.json()) as QrGroup
      setImageVersion(Date.now())
      setSaveState({ status: 'success', message: isEditing ? '修改已保存' : '二维码已创建' })
      setEditor({
        mode: 'edit',
        originalSlug: saved.slug,
        path: saved.slug,
        title: saved.title,
        image: null,
      })
      await loadAdminGroups()
      setGroup(saved)
    } catch (error) {
      setSaveState({ status: 'error', message: error instanceof Error ? error.message : '保存失败' })
    }
  }

  const poster = group ? buildAssetUrl(group.key, imageVersion) : ''
  const isAdminReady = adminMode && adminState.status === 'success'

  return (
    <main className="min-h-svh bg-[#111] text-zinc-100">
      <div className={`mx-auto grid min-h-svh w-full ${adminMode ? 'lg:grid-cols-[minmax(0,1fr)_420px]' : ''}`}>
        <section className="relative flex min-h-[62svh] flex-col items-center justify-center px-4 py-8 sm:px-8 lg:min-h-svh">
          {pageState.status === 'loading' ? <p className="text-sm text-zinc-500">二维码读取中…</p> : null}
          {group ? (
            <>
              <h1 className="mb-5 text-center text-lg font-semibold text-zinc-100">
                {group.title}
              </h1>
              <img
                src={poster}
                alt={group.title}
                className={`h-auto w-full select-none object-contain ${
                  adminMode ? 'max-h-[72svh] max-w-[min(82vw,560px)] lg:max-h-[82svh]' : 'max-h-[96svh] max-w-[min(92vw,560px)]'
                }`}
                loading="eager"
                decoding="async"
              />
              <p
                aria-label="二维码最近更新时间"
                className={`${adminMode ? 'mt-5' : 'fixed bottom-3 left-1/2 -translate-x-1/2'} w-[min(92vw,560px)] text-center text-xs font-semibold text-red-400`}
              >
                最近一次二维码图片更新时间：{formatUpdatedAt(group.updated_at ?? null)}
              </p>
            </>
          ) : pageState.status === 'error' ? (
            <div className="max-w-sm text-center">
              <p className="text-lg font-semibold">这个二维码路径还不存在</p>
              <p className="mt-2 text-sm text-zinc-500">{pageState.message}</p>
            </div>
          ) : null}
        </section>

        {adminMode ? (
          <aside className="border-t border-white/10 bg-[#181818] px-5 py-6 lg:min-h-svh lg:border-l lg:border-t-0 lg:px-7 lg:py-8">
            <div className="mx-auto max-w-md">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">站点管理员 · QR 管理</p>
              <div className="mt-2 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">二维码管理</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">创建独立公开路径，或修改现有二维码。</p>
                </div>
                {isAdminReady ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => navigate('/')}
                      className="rounded-full border border-white/15 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
                    >
                      返回首页
                    </button>
                    <button
                      type="button"
                      onClick={startCreate}
                      className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300"
                    >
                      + 新增
                    </button>
                  </div>
                ) : null}
              </div>

              {adminState.status === 'loading' ? <p className="mt-8 text-sm text-zinc-400">{adminState.message}</p> : null}
              {adminState.status === 'error' ? (
                <div role="alert" className="mt-8 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                  当前账号没有管理员权限，无法管理二维码。
                </div>
              ) : null}

              {isAdminReady ? (
                <>
                  <div className="mt-7 flex gap-2 overflow-x-auto pb-2" aria-label="已有二维码">
                    {adminGroups.map((item) => (
                      <button
                        key={item.slug}
                        type="button"
                        onClick={() => startEdit(item)}
                        className={`min-w-36 rounded-xl border px-3 py-3 text-left transition ${
                          editor.mode === 'edit' && editor.originalSlug === item.slug
                            ? 'border-emerald-400/60 bg-emerald-400/10'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                        }`}
                      >
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                        <span className="mt-1 block truncate text-xs text-zinc-500">{item.path}</span>
                      </button>
                    ))}
                  </div>

                  <form className="mt-6 space-y-5" onSubmit={handleSave}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{editor.mode === 'create' ? '新增二维码' : '编辑二维码'}</h3>
                      {editor.mode === 'edit' ? (
                        <a
                          href={`/qr/${editor.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-4 hover:text-zinc-200"
                        >
                          打开公开页
                        </a>
                      ) : null}
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-300">公开路径</span>
                      <span className="flex overflow-hidden rounded-xl border border-white/10 bg-black/25 focus-within:border-emerald-400/60">
                        <span className="border-r border-white/10 px-3 py-3 text-sm text-zinc-500">/qr/</span>
                        <input
                          aria-label="二维码公开路径"
                          value={editor.path}
                          onChange={(event) => setEditor((current) => ({ ...current, path: event.target.value }))}
                          placeholder="community-name"
                          pattern="[a-z0-9][a-z0-9-]{0,63}"
                          maxLength={64}
                          required
                          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-zinc-700"
                        />
                      </span>
                      <span className="mt-1.5 block text-xs text-zinc-600">仅支持小写字母、数字和连字符</span>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-300">标题</span>
                      <input
                        aria-label="二维码标题"
                        value={editor.title}
                        onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))}
                        placeholder="例如：他山世界交流群"
                        maxLength={120}
                        required
                        className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none placeholder:text-zinc-700 focus:border-emerald-400/60"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-300">
                        二维码图片{editor.mode === 'edit' ? '（不选则保留原图）' : ''}
                      </span>
                      <input
                        aria-label="选择二维码图片"
                        type="file"
                        accept="image/*"
                        required={editor.mode === 'create'}
                        onChange={handleImageSelected}
                        className="block w-full cursor-pointer rounded-xl border border-dashed border-white/15 bg-black/20 p-3 text-xs text-zinc-400 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-900"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={saveState.status === 'loading'}
                      className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saveState.status === 'loading'
                        ? '保存中…'
                        : editor.mode === 'create'
                          ? '创建二维码'
                          : '保存修改'}
                    </button>
                    {saveState.message ? (
                      <p
                        role="status"
                        className={`text-center text-sm ${saveState.status === 'error' ? 'text-red-300' : 'text-emerald-300'}`}
                      >
                        {saveState.message}
                      </p>
                    ) : null}
                  </form>
                </>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  )
}
