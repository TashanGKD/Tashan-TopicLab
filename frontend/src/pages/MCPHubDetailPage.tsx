import { FormEvent, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { mcpHubApi, type ScienceMcpCatalogItem, type ScienceMcpReview } from '../api/client'
import {
  AppsInsetCard,
  AppsMetricCard,
  AppsPanel,
  AppsPillButton,
  AppsStatusCard,
  AppsTextarea,
} from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { formatMcpLicense, formatMcpLicenseSource, formatMcpNarrative, formatMcpSourceName, formatMcpStatus, formatSourceTimestamp, getMcpPurpose } from '../utils/mcpHubPresentation'
import { toast } from '../utils/toast'

function buildShareText(item: ScienceMcpCatalogItem) {
  return `【他山世界科研 MCP Hub】${item.name}\n${getMcpPurpose(item)}\n${item.domain} / ${item.subdomain} · ${item.stage} · ${item.function}\n${window.location.href}`
}

export default function MCPHubDetailPage() {
  const { mcpId = '' } = useParams<{ mcpId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [item, setItem] = useState<ScienceMcpCatalogItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviews, setReviews] = useState<ScienceMcpReview[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [reviewBody, setReviewBody] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)

  const sourceFacts = item ? [
    ['框架', item.framework],
    ['许可证', formatMcpLicense(item)],
    ['许可证来源', formatMcpLicenseSource(item)],
    ['版本', item.latest_version],
    ['传输方式', item.transport?.join('、')],
    ['安装提示', item.install_command],
  ] : []
  const licenseEvidenceUrl = item?.license_evidence?.final_url || item?.license_evidence?.source_url || item?.source_verification?.final_url || item?.source_url
  const licenseEvidenceStatus = item?.license_evidence?.license_status || item?.license_status
  const licenseEvidenceStatusLabel = licenseEvidenceStatus === 'identified'
    ? '已识别'
    : licenseEvidenceStatus === 'referenced'
      ? '许可证原文已记录，名称未识别'
      : licenseEvidenceStatus === 'unavailable'
        ? '来源暂不可访问'
        : '名称未识别'
  const toolNames = item?.capability_evidence?.tool_names ?? []
  const capabilityMode = item?.capability_evidence?.capability_mode || (toolNames.length ? 'tool_list' : 'task_description')
  const toolCount = item?.capability_evidence?.tool_count || toolNames.length
  const toolCountLabel = item?.capability_evidence?.tool_count_kind === 'at_least' ? `至少 ${toolCount} 个` : `${toolCount} 个`
  const capabilityLabels = item ? [...new Set((toolNames.length ? toolNames : item.capabilities ?? [])
    .map((value) => String(value).trim())
    .filter((value) => value && value.length <= 64 && !/^https?:\/\//i.test(value)))] : []
  const purpose = item ? getMcpPurpose(item) : ''
  const normalizedPurpose = purpose.toLocaleLowerCase().replace(/[.!。]+$/g, '').trim()
  const secondaryDescription = item ? [item.tagline, item.description, item.summary]
    .map((value) => formatMcpNarrative(String(value || '')))
    .find((value) => value && value.toLocaleLowerCase().replace(/[.!。]+$/g, '').trim() !== normalizedPurpose) : ''

  const requireLogin = (message: string) => {
    if (tokenManager.get()) return true
    toast.error(message)
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
    return false
  }

  const loadReviews = async () => {
    try {
      setReviewsLoading(true)
      setReviewsError(null)
      const response = await mcpHubApi.listReviews(mcpId, { limit: 20 })
      setReviews(response.data.list)
    } catch {
      setReviews([])
      setReviewsError('社区评议暂时无法加载，请稍后重试。')
    } finally {
      setReviewsLoading(false)
    }
  }

  const load = async () => {
    try {
      setLoading(true)
      setContent(null)
      const [response] = await Promise.all([mcpHubApi.get(mcpId), loadReviews()])
      setItem(response.data)
    } catch (error) {
      handleApiError(error, '加载科研 MCP 详情失败；该条目可能暂未收录。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [mcpId])

  const toggleFavorite = async () => {
    if (!item || !requireLogin('请先登录后再收藏科研 MCP')) return
    try {
      const response = await mcpHubApi.toggleFavorite(item.id, !favorite)
      setFavorite(response.data.enabled)
      toast.success(response.data.enabled ? '已加入科研 MCP 收藏' : '已从收藏移除')
    } catch (error) {
      handleApiError(error, favorite ? '取消收藏失败' : '收藏失败')
    }
  }

  const loadContent = async () => {
    if (contentLoading || content !== null) return
    setContentLoading(true)
    try {
      const response = await mcpHubApi.getContent(mcpId)
      setContent(response.data.content)
    } catch (error) {
      handleApiError(error, '完整来源记录暂时无法加载')
    } finally {
      setContentLoading(false)
    }
  }

  const handleReviewSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!item || !reviewBody.trim() || !requireLogin('请先登录后再提交评议')) return
    setReviewBusy(true)
    try {
      const response = await mcpHubApi.createReview(item.id, { rating: reviewRating, content: reviewBody.trim() })
      setReviews((current) => [response.data, ...current])
      setReviewBody('')
      toast.success('评议已提交')
    } catch (error) {
      handleApiError(error, '评议提交失败；请检查登录状态或是否已经评议过该 MCP')
    } finally {
      setReviewBusy(false)
    }
  }

  const handleShareCopy = async () => {
    if (!item) return
    try {
      await navigator.clipboard.writeText(buildShareText(item))
      toast.success('已复制科研 MCP 分享文案')
    } catch (error) {
      handleApiError(error, '复制分享文案失败')
    }
  }

  return (
    <ImmersiveAppShell
      title={item?.name ?? '科研 MCP 详情'}
      subtitle={purpose || '查看科研 MCP 的分类、来源和社区信息。'}
      backTo="/mcphub"
      backLabel="科研 MCP Hub"
    >
      {loading ? <AppsStatusCard>正在加载科研 MCP 详情…</AppsStatusCard> : null}
      {!loading && !item ? <AppsStatusCard tone="error">暂未找到这个科研 MCP。</AppsStatusCard> : null}
      {!loading && item ? (
        <>
          <AppsPanel className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>科研 MCP</div>
                <h2 className="mt-2 break-words text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{purpose}</p>
                {secondaryDescription ? <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{secondaryDescription}</p> : null}
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{formatMcpStatus(item.status)}</span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <AppsPillButton onClick={() => void loadContent()}>
                {content ? '已加载详细说明' : contentLoading ? '加载详细说明…' : '查看详细说明'}
              </AppsPillButton>
              <AppsPillButton variant="secondary" onClick={toggleFavorite}>{favorite ? '取消收藏' : '收藏'}</AppsPillButton>
              <AppsPillButton variant="secondary" onClick={() => void handleShareCopy()}>复制分享文案</AppsPillButton>
              <AppsPillButton variant="secondary" href={item.source_url}>打开一手来源</AppsPillButton>
              <Link to="/mcphub" className="text-sm font-medium text-teal-700 underline underline-offset-4">返回 MCP Hub</Link>
            </div>

            <AppsInsetCard className="mt-4 px-4 py-3">
              <div className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>分享预览</div>
              <pre className="mt-2 max-h-32 cursor-text select-all overflow-y-auto whitespace-pre-wrap break-words text-left font-sans text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{buildShareText(item)}</pre>
            </AppsInsetCard>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <AppsMetricCard label="评分" value={(item.avg_rating ?? 0).toFixed(1)} valueSize="xl" />
              <AppsMetricCard label="评议" value={String(item.total_reviews ?? reviews.length)} valueSize="xl" />
              <AppsMetricCard label="下载" value={String(item.total_downloads ?? 0)} valueSize="xl" />
              <AppsMetricCard label="收藏" value={String(item.total_favorites ?? 0)} valueSize="xl" />
              <AppsMetricCard label="售价" value={(item.price_points ?? 0) > 0 ? `${item.price_points} 他山石` : '免费'} valueSize="xl" />
            </div>

            <AppsInsetCard className="mt-6 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>它提供什么</h3>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatMcpSourceName(item.source_name)}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>研究对象</dt><dd className="mt-1" style={{ color: 'var(--text-secondary)' }}>{item.subdomain}</dd></div>
                <div><dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>主要动作</dt><dd className="mt-1" style={{ color: 'var(--text-secondary)' }}>{formatMcpNarrative(item.task) || item.function}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {(item.tags ?? [item.domain, item.subdomain, item.stage, item.function]).map((tag) => (
                  <span key={tag} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{tag}</span>
                ))}
                {capabilityLabels.map((capability) => (
                  <span key={capability} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: 'rgba(13,148,136,0.08)', color: '#0f766e' }}>{capability}</span>
                ))}
              </div>
            </AppsInsetCard>

            <AppsInsetCard className="mt-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>使用与来源</h3>
              </div>
              {sourceFacts.length ? (
                <dl className="mt-3 space-y-2 text-sm">
                  {sourceFacts.map(([term, value]) => <div key={term} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3"><dt style={{ color: 'var(--text-tertiary)' }}>{term}</dt><dd className="break-words" style={{ color: value ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>{value || '未记录'}</dd></div>)}
                </dl>
              ) : null}
              {licenseEvidenceUrl ? (
                <div className="mt-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                  <span>许可证：{licenseEvidenceStatusLabel}；</span>
                  <a href={licenseEvidenceUrl} target="_blank" rel="noreferrer" className="text-teal-700 underline underline-offset-2">查看出处</a>
                </div>
              ) : null}
              {item.license_raw ? <p className="mt-3 break-words text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>许可证原文：{item.license_raw}</p> : null}
              {toolNames.length ? <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>可用工具：{toolNames.slice(0, 6).join('、')}{toolNames.length > 6 ? `，另有 ${toolNames.length - 6} 项` : ''}</p> : null}
              {capabilityMode === 'tool_count' ? <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>项目说明列出 {toolCountLabel}工具。</p> : null}
              {item.source_verification ? (
                <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
                  <p className="text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>资料更新：{formatSourceTimestamp(item.source_verification.fetched_at) || '未记录'}</p>
                  {item.source_verification.final_url ? <a href={item.source_verification.final_url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-teal-700 underline underline-offset-2">查看项目资料</a> : null}
                </div>
              ) : null}
            </AppsInsetCard>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <AppsInsetCard className="p-4">
                <h3 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>适用范围</h3>
                <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{formatMcpNarrative(item.classification_rationale)}</p>
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
                  <div className="text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--text-tertiary)' }}>研究路径</div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>{item.domain} / {item.subdomain} · {item.stage} · {item.function}</div>
                </div>
              </AppsInsetCard>
              <AppsInsetCard className="p-4">
                <h3 className="text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>来源与特点</h3>
                <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{formatMcpNarrative(item.evidence)}</p>
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
                  <div className="text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--text-tertiary)' }}>特点与差异</div>
                  <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{formatMcpNarrative(item.overlap_difference)}</p>
                </div>
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
                  <div className="text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--text-tertiary)' }}>来源与文档</div>
                  <a href={item.docs_url || item.source_url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-teal-700 underline underline-offset-4">
                    {item.docs_url || item.source_url}
                  </a>
                </div>
              </AppsInsetCard>
            </div>
          </AppsPanel>

          {content ? (
            <AppsPanel className="mt-6 p-6">
              <details open>
                <summary className="cursor-pointer text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>详细说明</summary>
                <div className="markdown-content mt-4 rounded-2xl border p-4 text-sm leading-7" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                  <ReactMarkdown>{formatMcpNarrative(content)}</ReactMarkdown>
                </div>
                <p className="mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>具体使用方式请以项目来源页为准。</p>
              </details>
            </AppsPanel>
          ) : null}

          {item.related_mcps?.length ? (
            <AppsPanel className="mt-6 p-6">
              <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>相关科研 MCP</h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>同一科研领域或相邻研究对象的目录条目。</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {item.related_mcps.map((related) => (
                  <Link
                    key={related.id}
                    to={`/mcphub/${encodeURIComponent(related.id)}`}
                    className="rounded-xl border p-4 transition-colors hover:border-teal-400"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}
                  >
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{related.name}</div>
                    <div className="mt-1 text-xs" style={{ color: '#0f766e' }}>{related.function || related.subdomain}</div>
                    {related.tagline || related.summary ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                        {formatMcpNarrative(related.tagline || related.summary || '')}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </AppsPanel>
          ) : null}

          <AppsPanel className="mt-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>社区评议</h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>分享你对资料清晰度、科研对象与主要用途的判断。</p>
              </div>
              <Link to="/mcphub/leaderboard" className="text-sm font-medium text-teal-700 underline underline-offset-4">查看贡献榜</Link>
            </div>
            <AppsInsetCard className="mt-4 p-4">
              <form onSubmit={handleReviewSubmit}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>评分
                    <select value={reviewRating} onChange={(event) => setReviewRating(Number(event.target.value))} className="ml-2 rounded-full border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }}>
                      {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                    </select>
                  </label>
                </div>
                <AppsTextarea aria-label="写下科研 MCP 评议" value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} rows={5} className="mt-3" placeholder="记录研究对象、科研动作、证据清晰度与使用边界…" />
                <AppsPillButton type="submit" disabled={reviewBusy || !reviewBody.trim()} className="mt-4 disabled:cursor-not-allowed disabled:opacity-50">{reviewBusy ? '提交中…' : '提交评议'}</AppsPillButton>
              </form>
            </AppsInsetCard>
            <div className="mt-4 space-y-3">
              {reviewsLoading ? <AppsStatusCard>正在加载社区评议…</AppsStatusCard> : null}
              {!reviewsLoading && reviewsError ? (
                <AppsStatusCard tone="error">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{reviewsError}</span>
                    <AppsPillButton type="button" variant="secondary" onClick={() => void loadReviews()} className="px-3 py-1.5 text-xs">重新加载</AppsPillButton>
                  </div>
                </AppsStatusCard>
              ) : null}
              {!reviewsLoading && !reviewsError && reviews.length === 0 ? <AppsStatusCard>还没有评议；首条评议应聚焦证据和科研动作。</AppsStatusCard> : reviews.map((review) => (
                <AppsInsetCard key={review.id} className="p-4">
                  <div className="flex justify-between gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}><span>{review.author.display_name || '匿名研究者'} · {review.rating}/5</span><span>有帮助 {review.helpful_count}</span></div>
                  {review.title ? <h3 className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{review.title}</h3> : null}
                  <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{review.content}</p>
                  <AppsPillButton type="button" variant="secondary" onClick={() => void mcpHubApi.voteHelpful(review.id, true)} className="mt-3 px-3 py-1.5 text-xs">有帮助 {review.helpful_count}</AppsPillButton>
                </AppsInsetCard>
              ))}
            </div>
          </AppsPanel>
        </>
      ) : null}
    </ImmersiveAppShell>
  )
}
