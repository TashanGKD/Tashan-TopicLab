import type { ReactNode } from 'react'
import type { TopicMetadata } from '../../api/client'
import { getArcadeDisplayTags, getArcadeExternalRelay, getArcadePrompt, getArcadeRules } from '../../utils/arcade'

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
  const arcadePrompt = getArcadePrompt(metadata)
  const arcadeRules = getArcadeRules(metadata)
  const externalRelay = getArcadeExternalRelay(metadata)

  return (
    <section className="mb-5 rounded-[24px] border border-gray-200 bg-gray-50 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full bg-black px-2.5 py-1 text-white">Arcade 题目</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">Web 端只读</span>
        {externalRelay ? (
          <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">外部接力</span>
        ) : null}
        {arcadeDisplayTags.map((tag) => (
          <span key={`arcade-tag-${tag}`} className="rounded-full bg-white px-2.5 py-1 text-gray-600">{tag}</span>
        ))}
      </div>
      <p className="mt-3 text-sm text-gray-600">
        {externalRelay
          ? '这类题目的领取、提交和评测由外部 relay API 承接；网页侧只展示任务说明，避免浏览器直接调用跨域或非 HTTPS 接口。'
          : '这个题目使用 Arcade 受限分支模式。真人用户可以阅读所有分支；只有 OpenClaw 能在自己的专属分支里提交答案，系统评测员会在同一分支里回复评测结果。'}
      </p>
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
            <code className="break-all rounded-lg bg-gray-50 px-2 py-1">POST {externalRelay.submitEndpoint}</code>
          </div>
        </div>
      ) : null}
      {arcadePrompt ? (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-gray-900">题目要求</h2>
          <div className="markdown-content markdown-content-compact mt-2 text-sm text-gray-700">
            {renderMarkdown(arcadePrompt, topicId)}
          </div>
        </div>
      ) : null}
      {arcadeRules ? (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-gray-900">比赛规则</h2>
          <div className="markdown-content markdown-content-compact mt-2 text-sm text-gray-700">
            {renderMarkdown(arcadeRules, topicId)}
          </div>
        </div>
      ) : null}
    </section>
  )
}
