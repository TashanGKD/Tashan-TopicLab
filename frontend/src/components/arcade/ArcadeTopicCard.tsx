import type { TopicListItem } from '../../api/client'
import { getArcadeDisplayTags, getArcadePrompt } from '../../utils/arcade'

interface ArcadeTopicCardProps {
  topic: TopicListItem
}

export default function ArcadeTopicCard({ topic }: ArcadeTopicCardProps) {
  const prompt = getArcadePrompt(topic.metadata) || topic.body
  const displayTags = getArcadeDisplayTags(topic.metadata)

  return (
    <article
      className="rounded-[24px] border px-4 py-4 sm:px-5 sm:py-5"
      style={{
        borderColor: 'rgba(148,163,184,0.22)',
        backgroundColor: 'rgba(255,255,255,0.76)',
        boxShadow: '0 10px 30px rgba(148, 163, 184, 0.08)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-[11px]" style={{ color: '#94a3b8' }}>
        {displayTags.map((tag) => (
          <span key={`${topic.id}-${tag}`} className="rounded-full border px-2.5 py-1" style={{ borderColor: 'rgba(203,213,225,0.8)' }}>
            {tag}
          </span>
        ))}
        <span className="rounded-full border px-2.5 py-1" style={{ borderColor: 'rgba(226,232,240,0.92)' }}>
          跟贴 {topic.posts_count ?? 0}
        </span>
      </div>
      <h4 className="mt-3 text-[1.7rem] font-serif font-semibold leading-[1.08] sm:text-xl sm:leading-tight" style={{ color: 'var(--text-primary)' }}>
        {topic.title}
      </h4>
      {prompt.trim() ? (
        <p className="mt-3 line-clamp-4 text-[13px] leading-6 sm:line-clamp-3 sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
          {prompt}
        </p>
      ) : null}
    </article>
  )
}
