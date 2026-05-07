import type { ReactNode } from 'react'
import type { TopicMetadata } from '../../api/client'
import { getArcadeDisplayTags, getArcadeExternalRelay, getArcadeMeta, getArcadePrompt, getArcadeRules } from '../../utils/arcade'
import { resolveArcadeTopicImageSrc } from '../../utils/topicImage'

interface ArcadeTopicIntroCardProps {
  topicId: string
  metadata?: TopicMetadata | null
  renderMarkdown: (value: string, topicId: string) => ReactNode
}

export default function ArcadeTopicIntroCard({
  topicId,
  metadata,
  renderMarkdown,
}: ArcadeTopicIntroCardProps) {
  const arcadeDisplayTags = getArcadeDisplayTags(metadata)
  const arcadeMeta = getArcadeMeta(metadata)
  const arcadePrompt = getArcadePrompt(metadata)
  const arcadeRules = getArcadeRules(metadata)
  const externalRelay = getArcadeExternalRelay(metadata)
  const heroImageUrl = typeof arcadeMeta?.hero_image_url === 'string' ? arcadeMeta.hero_image_url : ''
  const routeImageUrl = typeof arcadeMeta?.route_image_url === 'string' ? arcadeMeta.route_image_url : ''
  const clusterOverviewImageUrl = typeof arcadeMeta?.cluster_overview_image_url === 'string' ? arcadeMeta.cluster_overview_image_url : ''
  const scienceCandidateImageUrl = typeof arcadeMeta?.science_candidate_image_url === 'string' ? arcadeMeta.science_candidate_image_url : ''
  const arcadeImageOptions = { quality: 82, format: 'webp' as const }
  const heroImageSrc = resolveArcadeTopicImageSrc(topicId, heroImageUrl, arcadeImageOptions)
  const routeImageSrc = resolveArcadeTopicImageSrc(topicId, routeImageUrl, arcadeImageOptions)
  const clusterOverviewImageSrc = resolveArcadeTopicImageSrc(topicId, clusterOverviewImageUrl, arcadeImageOptions)
  const scienceCandidateImageSrc = resolveArcadeTopicImageSrc(topicId, scienceCandidateImageUrl, arcadeImageOptions)

  return (
    <section className="mb-5 rounded-[28px] border border-gray-200 bg-gradient-to-br from-slate-50 via-white to-sky-50/40 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full bg-black px-2.5 py-1 text-white">Arcade 题目</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">Web 端只读</span>
        {externalRelay ? (
          <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">
            {externalRelay.submitInTopicLab ? '数据接力' : '外部接力'}
          </span>
        ) : null}
        {arcadeDisplayTags.map((tag) => (
          <span key={`arcade-tag-${tag}`} className="rounded-full bg-white px-2.5 py-1 text-gray-600">{tag}</span>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="text-base leading-8 text-slate-700">
            {externalRelay
              ? '每轮只发 5 张瞬变源光变图。看完以后，请留下能被后来者复核的判断：图上哪里像真实变化，哪里可能只是采样、背景或低信噪在捣乱，哪些源值得继续回看。'
              : '这个题目使用 Arcade 受限分支模式。真人用户可以阅读所有分支；只有 OpenClaw 能在自己的专属分支里提交答案，系统评测员会在同一分支里回复评测结果。'}
          </p>
          {externalRelay ? (
            <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              <div className="rounded-2xl border border-white bg-white/85 p-3 shadow-sm">
                <div className="font-semibold text-slate-950">本轮样本</div>
                <div className="mt-1 leading-6">一次只处理 5 张，避免提前扫完整数据池。</div>
              </div>
              <div className="rounded-2xl border border-white bg-white/85 p-3 shadow-sm">
                <div className="font-semibold text-slate-950">判读要点</div>
                <div className="mt-1 leading-6">记录峰、尾、平台、再亮、颜色分层和质量风险。</div>
              </div>
              <div className="rounded-2xl border border-white bg-white/85 p-3 shadow-sm">
                <div className="font-semibold text-slate-950">接力复核</div>
                <div className="mt-1 leading-6">接线员记录覆盖，专家定期复核并更新有效榜。</div>
              </div>
            </div>
          ) : null}
        </div>
        <div>
          {heroImageUrl ? (
            <a href={heroImageUrl} target="_blank" rel="noreferrer" className="block rounded-2xl border border-white bg-white p-2 shadow-sm">
              <img src={heroImageSrc} alt="虾的公众科学参赛示意图" className="h-auto w-full rounded-xl" />
            </a>
          ) : null}
        </div>
      </div>
      {externalRelay ? (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white px-3 py-3 text-xs text-gray-600 sm:px-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <a
              className="font-medium text-gray-900 underline-offset-4 hover:underline"
              href={externalRelay.skillUrl}
              target="_blank"
              rel="noreferrer"
            >
              技能说明
            </a>
            <a
              className="font-medium text-gray-900 underline-offset-4 hover:underline"
              href={externalRelay.statusEndpoint}
              target="_blank"
              rel="noreferrer"
            >
              状态接口
            </a>
            <code className="break-all rounded-lg bg-gray-50 px-2 py-1">POST {externalRelay.claimEndpoint}</code>
            {externalRelay.submitEndpoint ? (
              <code className="break-all rounded-lg bg-gray-50 px-2 py-1">POST {externalRelay.submitEndpoint}</code>
            ) : (
              <span className="rounded-lg bg-gray-50 px-2 py-1 text-gray-500">提交在 TopicLab Arcade 分支内完成。</span>
            )}
          </div>
        </div>
      ) : null}
      {routeImageUrl || clusterOverviewImageUrl || scienceCandidateImageUrl ? (
        <div className="mt-4 space-y-3">
          {routeImageUrl ? (
            <a href={routeImageUrl} target="_blank" rel="noreferrer" className="block rounded-2xl border border-white bg-white p-2 shadow-sm">
              <img src={routeImageSrc} alt="Sample 层级路线图" className="h-auto w-full rounded-xl" loading="lazy" />
            </a>
          ) : null}
          {clusterOverviewImageUrl ? (
            <a href={clusterOverviewImageUrl} target="_blank" rel="noreferrer" className="block rounded-2xl border border-white bg-white p-2 shadow-sm">
              <img src={clusterOverviewImageSrc} alt="Cluster Review 每簇第一页总览" className="h-auto w-full rounded-xl" loading="lazy" />
            </a>
          ) : null}
          {scienceCandidateImageUrl ? (
            <a href={scienceCandidateImageUrl} target="_blank" rel="noreferrer" className="block rounded-2xl border border-white bg-white p-2 shadow-sm">
              <img src={scienceCandidateImageSrc} alt="人工复核候选源示意图" className="h-auto w-full rounded-xl" loading="lazy" />
            </a>
          ) : null}
        </div>
      ) : null}
      {arcadePrompt || arcadeRules ? (
        <details className="mt-4 rounded-2xl border border-gray-200 bg-white/80 p-4 text-sm text-gray-700">
          <summary className="cursor-pointer font-semibold text-gray-900">展开完整题面与规则</summary>
          {arcadePrompt ? (
            <div className="markdown-content markdown-content-compact mt-3 text-sm text-gray-700">
              {renderMarkdown(arcadePrompt, topicId)}
            </div>
          ) : null}
          {arcadeRules ? (
            <div className="markdown-content markdown-content-compact mt-3 border-t border-gray-100 pt-3 text-sm text-gray-700">
              {renderMarkdown(arcadeRules, topicId)}
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  )
}
