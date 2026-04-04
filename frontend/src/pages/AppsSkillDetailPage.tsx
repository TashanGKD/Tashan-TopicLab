import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubSkillContentResponse, type SkillHubSkillDetail } from '../api/client'
import {
  AppsInput,
  AppsInsetCard,
  AppsMetricCard,
  AppsPanel,
  AppsPillButton,
  AppsSkillCard,
  AppsTextarea,
  buildAppUrl,
  compatibilityLabel,
  copyText,
  formatCompactNumber,
  formatSkillHubShareClipboard,
} from '../components/apps/appsShared'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

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
      handleApiError(err, '加载应用 / Skill 详情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [slug])

  const toggleFavorite = async () => {
    if (!skill) return
    if (!requireLogin('请先登录后再收藏该应用 / Skill')) return
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
    if (!requireLogin('请先登录后再下载或安装该应用 / Skill')) return
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
      handleApiError(err, '下载或安装应用 / Skill 失败')
    }
  }

  const loadContent = async () => {
    if (!skill || contentLoading || contentPayload) return
    try {
      setContentLoading(true)
      const res = await skillHubApi.getSkillContent(skill.slug)
      setContentPayload(res.data)
    } catch (err) {
      handleApiError(err, '加载 Skill 全文说明失败')
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
    <ImmersiveAppShell title={skill?.name ?? '应用详情 / Skill 详情'} subtitle={skill?.summary ?? '加载中…'}>
      {loading || !skill ? (
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在加载应用 / Skill 详情…</div>
      ) : (
        <>
          <AppsPanel className="p-6">
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
              <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-tertiary)' }}>
                该对象在前台按应用展示；其底层能力形态仍然是 Skill，因此会保留版本、安装命令、全文说明，以及按“几他山石”展示的售价信息。
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <AppsPillButton onClick={handleDownload}>
                  下载 / 安装应用
                </AppsPillButton>
                <AppsPillButton variant="secondary" onClick={() => void loadContent()}>
                  {contentPayload ? '已加载 Skill 全文说明' : contentLoading ? '加载 Skill 全文说明…' : '查看 Skill 全文说明'}
                </AppsPillButton>
                <AppsPillButton variant="secondary" onClick={toggleFavorite}>
                  {skill.viewer_favorited ? '取消收藏' : '收藏'}
                </AppsPillButton>
                <AppsPillButton variant="secondary" onClick={() => void handleShareCopy()}>
                  复制分享文案
                </AppsPillButton>
              </div>

              <AppsInsetCard className="mt-4 w-full px-3 py-2.5 sm:px-4">
                <div className="text-[11px] font-medium leading-tight" style={{ color: 'var(--text-tertiary)' }}>分享预览</div>
                <pre className="mt-2 max-h-28 cursor-text select-all overflow-y-auto whitespace-pre-wrap break-words text-left font-sans text-[11px] leading-relaxed sm:max-h-32 sm:text-xs sm:leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {shareClipboardText}
                </pre>
              </AppsInsetCard>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <AppsMetricCard label="评分" value={skill.avg_rating.toFixed(1)} valueSize="xl" />
              <AppsMetricCard label="评测" value={formatCompactNumber(skill.total_reviews)} valueSize="xl" />
              <AppsMetricCard label="下载" value={formatCompactNumber(skill.total_downloads)} valueSize="xl" />
              <AppsMetricCard label="收藏" value={formatCompactNumber(skill.total_favorites)} valueSize="xl" />
              <AppsMetricCard label="售价" value={skill.price_points > 0 ? `${skill.price_points} 他山石` : '免费'} valueSize="xl" />
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
                    <AppsInsetCard key={version.id} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{version.version}</div>
                        {version.is_latest ? <span className="text-xs" style={{ color: '#0f766e' }}>Latest</span> : null}
                      </div>
                      <div className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{version.changelog || '暂无版本说明'}</div>
                      {version.install_command ? (
                        <AppsPillButton
                          onClick={() => { void copyText(version.install_command || ''); toast.success('已复制安装命令') }}
                          className="mt-3 px-3 py-1.5 text-xs"
                        >
                          复制命令
                        </AppsPillButton>
                      ) : null}
                    </AppsInsetCard>
                  ))}
                </div>
                <AppsInsetCard className="mt-6 p-4">
                  <h4 className="font-medium" style={{ color: 'var(--text-primary)' }}>标签与能力</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {skill.tags.map((tag) => (
                      <span key={tag} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{tag}</span>
                    ))}
                    {skill.capabilities.map((capability) => (
                      <span key={capability} className="rounded-full px-2.5 py-1 text-xs" style={{ backgroundColor: 'rgba(13,148,136,0.08)', color: '#0f766e' }}>{capability}</span>
                    ))}
                  </div>
                </AppsInsetCard>

                {contentPayload ? (
                  <AppsInsetCard className="mt-6 p-4">
                    <div className="flex items-center justify-between gap-3">
                    <h4 className="font-medium" style={{ color: 'var(--text-primary)' }}>Skill 全文说明</h4>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {contentPayload.version.version}
                      </div>
                    </div>
                    <div className="markdown-content mt-4 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                      <ReactMarkdown>{contentPayload.content}</ReactMarkdown>
                    </div>
                  </AppsInsetCard>
                ) : null}
              </div>

              <div>
                <h3 className="text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>结构化评测</h3>
                {!isLoggedIn ? (
                  <AppsInsetCard className="mt-4 text-sm" >
                    登录后可以提交评测、标记 Helpful、收藏，并在下载时按售价消耗他山石。
                  </AppsInsetCard>
                ) : null}
                <AppsInsetCard className="mt-4 p-4">
                  <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>评分</label>
                  <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-primary)' }}>
                    {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} 分</option>)}
                  </select>
                  <label className="mt-4 block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>使用模型</label>
                  <AppsInput value={reviewModel} onChange={(e) => setReviewModel(e.target.value)} className="mt-2 rounded-xl px-3 py-2" placeholder="例如 gpt-5.4" />
                  <label className="mt-4 block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>评测内容</label>
                  <AppsTextarea value={reviewContent} onChange={(e) => setReviewContent(e.target.value)} rows={5} className="mt-2 px-3 py-3" placeholder="写下适用场景、优缺点、运行反馈…" />
                  <AppsPillButton type="button" disabled={submitting} onClick={handleReviewSubmit} className="mt-4 disabled:opacity-50">
                    提交评测
                  </AppsPillButton>
                </AppsInsetCard>

                <div className="mt-4 space-y-3">
                  {skill.reviews.map((review) => (
                    <AppsInsetCard key={review.id} className="p-4" >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{review.author.display_name || '匿名评测者'}</div>
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{review.model || '未标注模型'} · {review.rating} 分</div>
                        </div>
                        <AppsPillButton type="button" variant="secondary" onClick={() => voteHelpful(review.id)} className="px-3 py-1.5 text-xs">
                          Helpful {review.helpful_count}
                        </AppsPillButton>
                      </div>
                      <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{review.content}</p>
                    </AppsInsetCard>
                  ))}
                </div>
              </div>
            </div>
          </AppsPanel>

          {skill.related_skills.length > 0 ? (
            <section className="mt-8">
              <h3 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>相关应用 / Skill</h3>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {skill.related_skills.map((item) => <AppsSkillCard key={item.id} skill={item} />)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </ImmersiveAppShell>
  )
}
