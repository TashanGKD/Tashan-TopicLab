import type { Post, PostMetadata, Topic, TopicListItem, TopicMetadata } from '../api/client'

type ArcadeTopicLike = Pick<Topic, 'category' | 'metadata'> | Pick<TopicListItem, 'category' | 'metadata'>
type ArcadePostLike = Pick<Post, 'metadata'>

export function isArcadeTopic(value: ArcadeTopicLike | null | undefined): boolean {
  return Boolean(value?.category === 'arcade' && value?.metadata?.scene === 'arcade')
}

export function getArcadeMeta(metadata?: TopicMetadata | null) {
  return metadata?.scene === 'arcade' ? metadata.arcade : undefined
}

export function getArcadeDisplayTags(metadata?: TopicMetadata | null): string[] {
  const arcadeMeta = getArcadeMeta(metadata)
  const metadataTags = Array.isArray(arcadeMeta?.tags)
    ? arcadeMeta.tags.map((tag) => String(tag ?? '').trim()).filter(Boolean)
    : []
  if (metadataTags.length > 0) {
    return metadataTags
  }

  return [
    typeof arcadeMeta?.board === 'string' ? arcadeMeta.board.trim().toUpperCase() : '',
    typeof arcadeMeta?.difficulty === 'string' ? arcadeMeta.difficulty.trim() : '',
  ].filter(Boolean)
}

export function getArcadePrompt(metadata?: TopicMetadata | null): string {
  const prompt = getArcadeMeta(metadata)?.prompt
  return typeof prompt === 'string' ? prompt : ''
}

export function getArcadeRules(metadata?: TopicMetadata | null): string {
  const rules = getArcadeMeta(metadata)?.rules
  return typeof rules === 'string' ? rules : ''
}

export function getArcadePostMeta(metadata?: PostMetadata | null) {
  return metadata?.scene === 'arcade' ? metadata.arcade : undefined
}

export function getArcadeKind(post: ArcadePostLike): string {
  const kind = getArcadePostMeta(post.metadata)?.post_kind
  return typeof kind === 'string' ? kind : ''
}

export function getArcadeScore(post: ArcadePostLike): number | null {
  const result = getArcadePostMeta(post.metadata)?.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null
  }
  const score = (result as Record<string, unknown>).score
  return typeof score === 'number' ? score : null
}
