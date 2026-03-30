import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubSkillContentResponse, type SkillHubSkillDetail } from '../api/client'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'
import { buildAppUrl, compatibilityLabel, copyText, formatCompactNumber, formatSkillHubShareClipboard, SkillCard } from './skillHubShared'

export default function AppsSkillDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [skill, setSkill] = useState<SkillHubSkillDetail | null>(null)
  const [contentPayload, setContentPayload] = useState<SkillHubSkillContentResponse | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewContent, setReviewContent] = useState('')
  const [reviewModel, setReviewModel] = useState('')
  const [rating, setRating] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const isLoggedIn = Boolean(tokenManager.get())

  const requireLogin = (message: string) => {
    if (isLoggedIn) return true
    toast.error(message)
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
    return false
  }

  const load = async () => {
    try {
      setLoading(true)
      setContentPayload(null)
      const res = await skillHubApi.getSkill(slug)
      setSkill(res.data)
    } catch (err) {
      handleApiError(err, '加载 Skill 详情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [slug])

  const toggleFavorite = async () => {
    if (!skill) return
    if (!requireLogin('请先登录后再收藏 Skill')) return
    try {
      const res = await skillHubApi.toggleFavorite(skill.slug, !skill.viewer_favorited)
      setSkill({
        ...skill,
        viewer_favorited: res.data.favorited,
        total_favorites: res.data.total_favorites,
      })
    } catch (err) {
      handleApiError(err, skill.viewer_favorited ? '取消收藏失败' : '收藏失败')
    }
  }

  const handleDownload = async () => {
    if (!skill) return
    if (!requireLogin('请先登录后再下载或安装 Skill')) return
    try {
      const res = await skillHubApi.downloadSkill(skill.slug, 'detail-page')
      if (res.data.download_url) {
        window.open(buildAppUrl(res.data.download_url), '_blank', 'noopener,noreferrer')
      } else if (res.data.install_command) {
        await copyText(res.data.install_command)
        toast.success('已复制安装命令')
      }
      await load()
    } catch (err) {
      handleApiError(err, '下载 Skill 失败')
    }
  }

  const loadContent = async () => {
    if (!skill || contentLoading || contentPayload) return
    try {
      setContentLoading(true)
      const res = await skillHubApi.getSkillContent(skill.slug)
      setContentPayload(res.data)
    } catch (err) {
      handleApiError(err, '加载 Skill 全文失败')
    } finally {
      setContentLoading(false)
    }
  }

  const handleReviewSubmit = async () => {
    if (!skill) return
    if (!requireLogin('请先登录后再提交评测')) return
    if (reviewContent.trim().length < 20) {
      toast.error('评测内容至少 20 字')
      return
    }
    try {
      setSubmitting(true)
      await skillHubApi.createReview({
        skill_id: skill.slug,
        rating,
        content: reviewContent,
        model: reviewModel || undefined,
      })
      setReviewContent('')
      setReviewModel('')
      setRating(5)
      await load()
    } catch (err) {
      handleApiError(err, '提交评测失败')
    } finally {
      setSubmitting(false)
    }
  }

  const shareClipboardText = useMemo(
    () => (skill ? formatSkillHubShareClipboard(skill, skill.slug) : ''),
    [skill],
  )

  const handleShareCopy = async () => {
    if (!skill) return
    try {
      await copyText(shareClipboardText)
      toast.success('已复制分享文案')
    } catch {
      toast.error('复制失败，请手动选中下方文字复制')
    }
  }

  const voteHelpful = async (reviewId: number) => {
    if (!requireLogin('请先登录后再标记 Helpful')) return
    try {
      await skillHubApi.voteHelpful(reviewId, true)
      await load()
    } catch (err) {
      handleApiError(err, '标记 helpful 失败')
    }
  }

  return (
    <ImmersiveAppShell title={skill?.name ?? 'Skill 详情'} subtitle={skill?.summary ?? '加载中…'}>
      {loading || !skill ? (
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在加载 Skill 详情…</div>
      ) : (
        <>
          <section className="rounded-[28px] border p-6" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0f766e' }}>
                  {compatibilityLabel(skill.compatibility_level)}
                </span>
                <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  {skill.category_name} / {skill.cluster_name}
                </span>
              </div>
              <h2 className="mt-4 text-[2rem] font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{skill.name}</h2>
              {skill.tagline ? <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{skill.tagline}</p> : null}
              <p className="mt-4 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{skill.description}</p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleDownload} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                  下载 / 安装
                </button>
                <button type="button" onClick={() => void loadContent()} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
                  {contentPayload ? '已加载全文' : contentLoading ? '加载全文…' : '查看全文'}
                </button>
                <button type="button" onClick={toggleFavorite} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
                  {skill.viewer_favorited ? '取消收藏' : '收藏'}
                </button>
                <button type="button" onClick={() => void handleShareCopy()} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
                  复制分享文案
                </button>
              </div>

              <div className="mt-4 w-full rounded-xl border px-3 py-2.5 sm:px-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                <div className="text-[11px] font-medium leading-tight" style={{ color: 'var(--text-tertiary)' }}>分享预览</div>
                <pre className="mt-2 max-h-28 cursor-text select-all overflow-y-auto whitespace-pre-wrap break-words text-left font-sans text-[11px] leading-relaxed sm:max-h-32 sm:text-xs sm:leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {shareClipboardText}
                </pre>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="评分" value={skill.avg_rating.toFixed(1)} />
              <Stat label="评测" value={formatCompactNumber(skill.total_reviews)} />
              <Stat label="下载" value={formatCompactNumber(skill.total_downloads)} />
              <Stat label="收藏" value={formatCompactNumber(skill.total_favorites)} />
              <Stat label="价格" value={skill.price_points > 0 ? `${skill.price_points} pts` : 'Free'} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
              <div>
                <div className="flex items-end justify-between gap-3">
                  <h3 className="text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>版本与能力</h3>
                  {isLoggedIn ? (
                    <Link to={`/apps/skills/publish?skill=${encodeURIComponent(skill.slug)}`} className="text-sm underline underline-offset-4" style={{ color: 'var(--text-secondary)' }}>
                      发布新版本
                    </Link>
                  ) : null}
                </div>
                <div className="mt-4 space-y-3">
                  {skill.versions.map((version) => (
                    <article key={version.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{version.version}</div>
                        {version.is_latest ? <span className="text-xs" style={{ color: '#0f766e' }}>Latest</span> : null}
                      </div>
                      <div className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{version.changelog || '暂无版本说明'}</div>
                      {version.install_command ? (
                        <button
                          type="button"
                          onClick={() => { void copyText(version.install_command || ''); toast.success('已复制安装命令') }}
                          className="mt-3 rounded-full border px-3 py-1.5 text-xs"
                          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }}
                        >
                          复制命令
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
                <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                  <h4 className="font-medium" style={{ color: 'var(--text-primary)' }}>标签与能力</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {skill.tags.map((tag) => (
                      <span key={tag} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{tag}</span>
                    ))}
                    {skill.capabilities.map((capability) => (
                      <span key={capability} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: 'rgba(13,148,136,0.08)', color: '#0f766e' }}>{capability}</span>
                    ))}
                  </div>
                </div>

                {contentPayload ? (
                  <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-medium" style={{ color: 'var(--text-primary)' }}>Skill 全文</h4>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {contentPayload.version.version}
                      </div>
                    </div>
                    <div className="markdown-content mt-4 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                      <ReactMarkdown>{contentPayload.content}</ReactMarkdown>
                    </div>
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>结构化评测</h3>
                {!isLoggedIn ? (
                  <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
                    登录后可以提交评测、标记 Helpful、收藏并记录下载积分。
                  </div>
                ) : null}
                <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
                  <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>评分</label>
                  <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }}>
                    {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} 分</option>)}
                  </select>
                  <label className="mt-4 block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>使用模型</label>
                  <input value={reviewModel} onChange={(e) => setReviewModel(e.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }} placeholder="例如 gpt-5.4" />
                  <label className="mt-4 block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>评测内容</label>
                  <textarea value={reviewContent} onChange={(e) => setReviewContent(e.target.value)} rows={5} className="mt-2 w-full rounded-2xl border px-3 py-3 text-sm leading-6" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }} placeholder="写下适用场景、优缺点、运行反馈…" />
                  <button type="button" disabled={submitting} onClick={handleReviewSubmit} className="mt-4 rounded-full border px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    提交评测
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {skill.reviews.map((review) => (
                    <article key={review.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{review.author.display_name || '匿名评测者'}</div>
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{review.model || '未标注模型'} · {review.rating} 分</div>
                        </div>
                        <button type="button" onClick={() => voteHelpful(review.id)} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
                          Helpful {review.helpful_count}
                        </button>
                      </div>
                      <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{review.content}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {skill.related_skills.length > 0 ? (
            <section className="mt-8">
              <h3 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>相关 Skill</h3>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {skill.related_skills.map((item) => <SkillCard key={item.id} skill={item} />)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </ImmersiveAppShell>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
      <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="mt-2 text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}
