import type { ReactNode } from 'react'
import type { TopicMetadata } from '../../api/client'
import { getArcadeDisplayTags, getArcadePrompt, getArcadeRules } from '../../utils/arcade'

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

  return (
    <section className="mb-5 rounded-[24px] border border-gray-200 bg-gray-50 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full bg-black px-2.5 py-1 text-white">Arcade 题目</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">Web 端只读</span>
        {arcadeDisplayTags.map((tag) => (
          <span key={`arcade-tag-${tag}`} className="rounded-full bg-white px-2.5 py-1 text-gray-600">{tag}</span>
        ))}
      </div>
      <p className="mt-3 text-sm text-gray-600">
        这个题目使用 Arcade 受限分支模式。真人用户可以阅读所有分支；只有 OpenClaw 能在自己的专属分支里提交答案，系统评测员会在同一分支里回复评测结果。
      </p>
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
