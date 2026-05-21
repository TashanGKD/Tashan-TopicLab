import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useLocation } from 'react-router-dom'

type WechatGroupQrPageProps = {
  assetKey: 'wechat-group-qr' | 'lggc-wechat-group'
  title: string
}

type UploadState = {
  status: 'idle' | 'uploading' | 'success' | 'error'
  message: string
}

function buildAssetUrl(assetKey: string, version: number): string {
  const baseUrl = `${import.meta.env.BASE_URL}api/v1/site/assets/${assetKey}.webp`
  return version ? `${baseUrl}?v=${version}` : baseUrl
}

export default function WechatGroupQrPage({ assetKey, title }: WechatGroupQrPageProps) {
  const location = useLocation()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadKey = useMemo(() => new URLSearchParams(location.search).get('key')?.trim() ?? '', [location.search])
  const [imageVersion, setImageVersion] = useState(0)
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle', message: '' })
  const qrPosterUrl = buildAssetUrl(assetKey, imageVersion)

  async function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!uploadKey) {
      setUploadState({ status: 'error', message: '缺少上传 key' })
      return
    }

    const formData = new FormData()
    formData.append('image', file)
    setUploadState({ status: 'uploading', message: '上传中...' })
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}api/v1/site/assets/${assetKey}?key=${encodeURIComponent(uploadKey)}`,
        {
          method: 'POST',
          body: formData,
        },
      )
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      setImageVersion(Date.now())
      setUploadState({ status: 'success', message: '已更新二维码' })
    } catch {
      setUploadState({ status: 'error', message: '上传失败，请检查 key 或图片文件' })
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="min-h-svh bg-[#161616] text-zinc-100">
      <section className="mx-auto flex min-h-svh w-full flex-col items-center justify-center px-4 py-5 sm:px-8">
        <h1 className="sr-only">{title}</h1>
        <img
          src={qrPosterUrl}
          alt={title}
          className="h-auto max-h-[96svh] w-full max-w-[min(92vw,560px)] select-none object-contain"
          loading="eager"
          decoding="async"
        />
        {uploadKey ? (
          <div className="fixed bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="选择新二维码图片"
              onChange={handleImageSelected}
            />
            <button
              type="button"
              className="rounded-full border border-white/15 bg-white px-4 py-2 text-sm font-medium text-zinc-950 shadow-[0_12px_36px_rgba(0,0,0,0.24)] transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={uploadState.status === 'uploading'}
              onClick={() => uploadInputRef.current?.click()}
            >
              {uploadState.status === 'uploading' ? '上传中' : '上传更新二维码'}
            </button>
            {uploadState.message ? (
              <p
                role="status"
                className={`text-xs ${uploadState.status === 'error' ? 'text-red-300' : 'text-zinc-400'}`}
              >
                {uploadState.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
