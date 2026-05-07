import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Post } from '../api/client'
import ReactionButton from './ReactionButton'
import { isVideoMediaSrc, resolveTopicImageSrc } from '../utils/topicImage'
import { getArcadeKind, getArcadeScore } from '../utils/arcade'

function HeartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 16.25l-1.15-1.04C4.775 11.53 2.5 9.47 2.5 6.95A3.45 3.45 0 016 3.5c1.14 0 2.23.53 3 1.36A4.05 4.05 0 0112 3.5a3.45 3.45 0 013.5 3.45c0 2.52-2.27 4.58-6.35 8.27L10 16.25z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M8 10.5l4-2.5m-4 1.5l4 2.5M13.5 6.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zm0 10.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zM5.5 12.25a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface Props {
  posts: Post[]
  onDelete?: (post: Post) => void
  onLike?: (post: Post) => void
  onShare?: (post: Post) => void
  canDelete?: (post: Post) => boolean
  canLike?: boolean
  pendingLikePostIds?: Set<string>
}

function getBranchRootId(post: Post): string {
  return post.root_post_id ?? post.id
}

function getLatestBranchScore(posts: Post[]): number | null {
  for (let index = posts.length - 1; index >= 0; index -= 1) {
    const score = getArcadeScore(posts[index])
    if (score != null) {
      return score
    }
  }
  return null
}

function getRankMedal(rank: number): string | null {
  if (rank === 0) return '🥇'
  if (rank === 1) return '🥈'
  if (rank === 2) return '🥉'
  return null
}

interface RelaySubmissionRow {
  imageUrl: string
  sourceId: string
  role: string
  anomalyScore: string
  confidence: string
  needsFollowup: string
  evidenceTags: string[]
  qualityFlags: string[]
  reason: string
}

const ROLE_LABELS: Record<string, string> = {
  interesting: '优先回看',
  bridge: '需要复核',
  data_issue: '先查质量',
  typical: '普通样本',
  control: '对照样本',
  unsure: '证据不足',
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  interesting: '图上有较清楚的异常结构，值得优先进入人工复核。',
  bridge: '有可疑线索，但还需要散点、背景或上下文交叉确认。',
  data_issue: '主要风险来自采样、背景、缺测、低信噪或单点牵引。',
  typical: '没有明显峰、尾、再亮或长期漂移，可暂作普通样本。',
  control: '适合当普通参照，用来校准本轮判断尺度。',
  unsure: '图像证据不足，先保留记录，不把拟合形状当成确定变化。',
}

const TAG_LABELS: Record<string, string> = {
  peak_or_bump: '峰或鼓包',
  tail_or_plateau: '尾部/平台',
  rebrightening: '再亮',
  nonmonotonic: '非单调',
  color_separation: '双波段分离',
  large_amplitude: '大振幅',
  rapid_rise: '快速上升',
  rapid_decline: '快速衰减',
  slow_decline: '缓慢衰减',
  long_duration: '持续时间长',
  smooth_control: '平稳对照',
  sparse_sampling: '采样稀疏',
  background_or_contamination: '背景/污染',
  single_band_signal: '单波段信号',
  band_missing: '波段缺失',
  baseline_offset: '基线错位',
  outlier_only: '离群点主导',
  context_risk: '上下文风险',
  low_snr: '低信噪',
  unclear: '证据不清',
  good_sampling: '采样可用',
  cadence_gap: '观测空窗',
  heavy_imputation: '插补较多',
  background_issue: '背景问题',
  saturation_or_edge: '饱和/边缘',
  image_unreadable: '图像难读',
  none: '暂无明显质量问题',
}

function tagLabel(tag: string): string {
  const label = TAG_LABELS[tag]
  return label ? `${label} · ${tag}` : tag
}

function sourceIdFromImageUrl(url: string): string {
  const fileName = decodeURIComponent(url.split('?')[0].split('#')[0].split('/').pop() || '')
  return fileName
    .replace(/_sample_review\.png$/i, '')
    .replace(/_sample_gp\.png$/i, '')
    .replace(/_sample_scatter\.png$/i, '')
    .replace(/\.png$/i, '')
}

function reviewImageUrl(url: string): string {
  if (url.includes('/all_sample_review/')) return url
  if (url.includes('/all_sample_gp/')) {
    return url.replace('/all_sample_gp/', '/all_sample_review/').replace(/_sample_gp\.png(\?|#|$)/, '_sample_review.png$1')
  }
  if (url.includes('/all_sample_scatter/')) {
    return url.replace('/all_sample_scatter/', '/all_sample_review/').replace(/_sample_scatter\.png(\?|#|$)/, '_sample_review.png$1')
  }
  return url
}

const DATA_SAMPLE_REVIEW_VERSION = 'scatter-card-v7'

function reviewDisplayImageUrl(url: string): string {
  const reviewUrl = reviewImageUrl(url)
  if (!reviewUrl.includes('/all_sample_review/')) return reviewUrl
  const separator = reviewUrl.includes('?') ? '&' : '?'
  return `${reviewUrl}${separator}v=${DATA_SAMPLE_REVIEW_VERSION}`
}

function scatterImageUrl(url: string): string {
  if (url.includes('/all_sample_scatter/')) return url
  if (url.includes('/all_sample_review/')) {
    return url.replace('/all_sample_review/', '/all_sample_scatter/').replace(/_sample_review\.png(\?|#|$)/, '_sample_scatter.png$1')
  }
  if (url.includes('/all_sample_gp/')) {
    return url.replace('/all_sample_gp/', '/all_sample_scatter/').replace(/_sample_gp\.png(\?|#|$)/, '_sample_scatter.png$1')
  }
  return url
}

function parseRelaySubmission(body: string): RelaySubmissionRow[] {
  const rows: RelaySubmissionRow[] = []
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return rows
  for (const line of lines) {
    const match = line.match(/^!\[[^\]]*]\(([^)]+)\)\s*\|\s*(.+)$/)
    if (!match) return []
    const fields = match[2].split('|').map((field) => field.trim())
    if (fields.length !== 7) return []
    const [role, anomalyScore, confidence, needsFollowup, evidenceText, qualityText, reason] = fields
    rows.push({
      imageUrl: match[1].trim(),
      sourceId: sourceIdFromImageUrl(match[1].trim()),
      role,
      anomalyScore,
      confidence,
      needsFollowup,
      evidenceTags: evidenceText.split(',').map((tag) => tag.trim()).filter(Boolean),
      qualityFlags: qualityText.split(',').map((tag) => tag.trim()).filter(Boolean),
      reason,
    })
  }
  return rows
}

export default function ArcadeBranchTimeline({
  posts,
  onDelete,
  onLike,
  onShare,
  canDelete,
  canLike = true,
  pendingLikePostIds,
}: Props) {
  if (posts.length === 0) {
    return <p className="text-sm font-serif text-gray-400">暂无分支</p>
  }

  const byId = Object.fromEntries(posts.map((post) => [post.id, post]))
  const roots = posts
    .filter((post) => !post.in_reply_to_id || !byId[post.in_reply_to_id])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const branches = roots.map((root) => {
    const branchPosts = posts
      .filter((post) => getBranchRootId(post) === root.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const latest = branchPosts[branchPosts.length - 1] ?? root
    const latestScore = getLatestBranchScore(branchPosts)
    const submissions = branchPosts.filter((post) => getArcadeKind(post) === 'submission').length
    const evaluations = branchPosts.filter((post) => getArcadeKind(post) === 'evaluation').length
    return { root, branchPosts, latest, latestScore, submissions, evaluations }
  }).sort((a, b) => {
    if (a.latestScore != null && b.latestScore != null && a.latestScore !== b.latestScore) {
      return b.latestScore - a.latestScore
    }
    if (a.latestScore != null && b.latestScore == null) {
      return -1
    }
    if (a.latestScore == null && b.latestScore != null) {
      return 1
    }
    return b.latest.created_at.localeCompare(a.latest.created_at)
  })

  return (
    <div className="space-y-3">
      {branches.map(({ root, branchPosts, latest, latestScore, submissions, evaluations }, branchIndex) => {
        const latestKind = getArcadeKind(latest)
        const rankMedal = getRankMedal(branchIndex)
        return (
          <section
            key={root.id}
            className="overflow-hidden rounded-[1.15rem] border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {rankMedal ? (
                  <span className="text-lg leading-none" aria-label={`第 ${branchIndex + 1} 名`}>
                    {rankMedal}
                  </span>
                ) : null}
                <span className="font-serif text-[1.55rem] leading-none text-black">{root.author}</span>
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
                  {submissions} 次提交 / {evaluations} 次评测
                </span>
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
                  {latestKind === 'evaluation' ? '评测已返回' : '等待评测'}
                </span>
                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
                  {latestScore != null ? latestScore.toFixed(4) : 'Pending'}
                </span>
                <span className="text-xs text-gray-400">
                  latest {new Date(latest.created_at).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="relative">
                <div className="absolute bottom-0 left-[0.82rem] top-0 hidden w-px bg-gray-200 sm:block" />
                <div className="space-y-2.5">
                  {branchPosts.map((post, index) => {
                    const isSystem = post.author_type === 'system'
                    const kind = getArcadeKind(post)
                    const score = getArcadeScore(post)
                    const likesCount = post.interaction?.likes_count ?? 0
                    const sharesCount = post.interaction?.shares_count ?? 0
                    const liked = post.interaction?.liked ?? false
                    const liking = pendingLikePostIds?.has(post.id) ?? false
                    const isLatest = latest.id === post.id
                    return (
                      <CompactArcadeEntry
                        key={post.id}
                        post={post}
                        index={index}
                        isSystem={isSystem}
                        kind={kind}
                        score={score}
                        isLatest={isLatest}
                        onDelete={onDelete}
                        canDelete={canDelete}
                        onLike={onLike}
                        onShare={onShare}
                        canLike={canLike}
                        likesCount={likesCount}
                        sharesCount={sharesCount}
                        liked={liked}
                        liking={liking}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CompactArcadeEntry({
  post,
  index,
  isSystem,
  kind,
  score,
  isLatest,
  onDelete,
  canDelete,
  onLike,
  onShare,
  canLike,
  likesCount,
  sharesCount,
  liked,
  liking,
}: {
  post: Post
  index: number
  isSystem: boolean
  kind: string
  score: number | null
  isLatest: boolean
  onDelete?: (post: Post) => void
  canDelete?: (post: Post) => boolean
  onLike?: (post: Post) => void
  onShare?: (post: Post) => void
  canLike: boolean
  likesCount: number
  sharesCount: number
  liked: boolean
  liking: boolean
}) {
  const [expanded, setExpanded] = useState(kind === 'submission' || kind === 'evaluation')
  const relayRows = kind === 'submission' ? parseRelaySubmission(post.body) : []
  const needsClamp = post.body.length > 220

  return (
    <article
      id={`post-${post.id}`}
      className="group relative pl-0 sm:pl-9"
    >
      <div className={`absolute left-0 top-2.5 hidden h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold sm:flex ${
        isSystem
          ? 'border-gray-300 bg-gray-100 text-gray-700'
          : 'border-gray-300 bg-white text-gray-700'
      }`}>
        {isSystem ? '评' : `v${index + 1}`}
      </div>
      <div className={`overflow-hidden rounded-[0.95rem] border px-3 py-2.5 transition-all duration-200 ${
        kind === 'evaluation'
          ? 'border-gray-200 bg-gray-50/80 shadow-sm'
          : 'border-gray-200 bg-white shadow-sm'
      }`}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-black">{isSystem ? '评测员' : post.author}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${
              kind === 'evaluation'
                ? 'bg-gray-200 text-gray-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {kind === 'evaluation' ? 'Evaluation' : 'Submission'}
            </span>
            {isLatest ? (
              <span className="rounded-full bg-black px-2 py-0.5 text-[11px] text-white">Latest</span>
            ) : null}
            {score != null ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-600">{score.toFixed(4)}</span>
            ) : null}
            <span className="text-xs text-gray-400">
              {new Date(post.created_at).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {onDelete && canDelete?.(post) ? (
              <button
                type="button"
                onClick={() => onDelete(post)}
                className="ml-auto rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                aria-label={`删除 ${isSystem ? '评测员' : post.author} 的帖子`}
              >
                删除
              </button>
            ) : null}
          </div>

          <div className="rounded-[0.8rem] border border-gray-100 bg-white px-3 py-2.5">
            {relayRows.length > 0 ? (
              <RelaySubmissionCards rows={relayRows} expanded={expanded} />
            ) : (
              <div className={`markdown-content markdown-content-compact arcade-post-body text-sm text-gray-700 ${
                !expanded && needsClamp ? 'max-h-24 overflow-hidden' : ''
              }`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    img: ({ src = '', alt = '', ...props }) => {
                      const resolvedSrc = resolveTopicImageSrc(post.topic_id, src, { format: 'webp', quality: 82 })
                      if (isVideoMediaSrc(resolvedSrc)) {
                        return (
                          <video
                            controls
                            preload="metadata"
                            className="max-h-[20rem] w-full rounded-lg bg-black/90"
                            src={resolvedSrc}
                            aria-label={alt || 'video'}
                          />
                        )
                      }
                      return <img {...props} src={resolvedSrc} alt={alt} loading="lazy" />
                    },
                  }}
                >
                  {post.body}
                </ReactMarkdown>
              </div>
            )}
            {needsClamp || relayRows.length > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 text-xs text-gray-500 hover:text-black"
              >
                {expanded ? '收起' : '展开'}
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onLike && canLike ? (
              <ReactionButton
                label="点赞"
                count={likesCount}
                active={liked}
                pending={liking}
                icon={<HeartIcon />}
                subtle
                onClick={() => onLike(post)}
              />
            ) : (
              <span className="text-xs text-gray-500">点赞 {likesCount}</span>
            )}
            {onShare ? (
              <ReactionButton
                label="分享"
                count={sharesCount}
                icon={<ShareIcon />}
                subtle
                onClick={() => onShare(post)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function RelaySubmissionCards({
  rows,
  expanded,
}: {
  rows: RelaySubmissionRow[]
  expanded: boolean
}) {
  const visibleRows = expanded ? rows : rows.slice(0, 2)
  return (
    <div className="space-y-3">
      {visibleRows.map((row, index) => {
        const imageSrc = reviewDisplayImageUrl(row.imageUrl)
        const roleLabel = ROLE_LABELS[row.role] ?? row.role
        const followupLabel = row.needsFollowup === 'yes' ? '建议回看' : '暂不追'
        return (
          <div key={`${row.imageUrl}-${index}`} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="grid items-start gap-4 p-3 lg:grid-cols-[minmax(34rem,1.32fr)_minmax(22rem,0.68fr)]">
              <a href={reviewImageUrl(row.imageUrl)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 bg-white">
                <img src={imageSrc} alt={`${row.sourceId} 复核图`} loading="lazy" className="h-auto w-full" />
              </a>
              <div className="space-y-2.5 rounded-xl bg-white/70 p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white">{index + 1}</span>
                  <span className="font-serif text-xl text-slate-950">{row.sourceId || '未知源'}</span>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs text-rose-700">
                    {roleLabel} · 异常分 {row.anomalyScore}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">{ROLE_DESCRIPTIONS[row.role] ?? '结构化判读结果。'}</p>
                <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">置信度：{row.confidence}</div>
                  <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">回看建议：{followupLabel}</div>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm leading-7 text-slate-800 shadow-sm">
                  <div className="mb-1 text-xs font-semibold text-slate-500">模型留下的复核便签</div>
                  {row.reason}
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {row.evidenceTags.map((tag) => (
                      <span key={`e-${tag}`} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{tagLabel(tag)}</span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.qualityFlags.map((tag) => (
                      <span key={`q-${tag}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{tagLabel(tag)}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <a href={scatterImageUrl(row.imageUrl)} target="_blank" rel="noreferrer" className="rounded-full bg-white px-2.5 py-1 text-slate-500 underline-offset-2 hover:text-black hover:underline">原始散点</a>
                  <a href={row.imageUrl} target="_blank" rel="noreferrer" className="rounded-full bg-white px-2.5 py-1 text-slate-500 underline-offset-2 hover:text-black hover:underline">提交图</a>
                </div>
              </div>
            </div>
          </div>
        )
      })}
      {!expanded && rows.length > visibleRows.length ? (
        <p className="text-xs text-slate-400">还有 {rows.length - visibleRows.length} 张，展开查看完整本轮判读。</p>
      ) : null}
    </div>
  )
}
