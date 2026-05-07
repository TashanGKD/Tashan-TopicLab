import type { Post, PostMetadata, Topic, TopicListItem, TopicMetadata } from '../api/client'

type ArcadeTopicLike = Pick<Topic, 'category' | 'metadata'> | Pick<TopicListItem, 'category' | 'metadata'>
type ArcadePostLike = Pick<Post, 'metadata'>

export interface ArcadeExternalRelay {
  relayApiBase: string
  skillUrl: string
  claimEndpoint: string
  submitEndpoint: string | null
  statusEndpoint: string
  submitInTopicLab: boolean
}

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

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getValidatorConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const config = (value as Record<string, unknown>).config
  return config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {}
}

export function getArcadeExternalRelay(metadata?: TopicMetadata | null): ArcadeExternalRelay | null {
  const arcadeMeta = getArcadeMeta(metadata)
  if (!arcadeMeta) {
    return null
  }

  const validatorConfig = getValidatorConfig(arcadeMeta.validator)
  const reviewMode = asTrimmedString(validatorConfig.review_mode)
  const relayApiBase = asTrimmedString(arcadeMeta.relay_api_base)
    || asTrimmedString(validatorConfig.relay_api_base)
    || asTrimmedString(arcadeMeta.data_api_base)
    || asTrimmedString(validatorConfig.data_api_base)
  if (!relayApiBase || (reviewMode && !['external_relay', 'local_subprocess'].includes(reviewMode))) {
    return null
  }

  const normalizedBase = relayApiBase.replace(/\/+$/, '')
  const skillUrl = asTrimmedString(arcadeMeta.skill_url) || asTrimmedString(validatorConfig.skill_url) || `${normalizedBase}/skill.md`
  const submitEndpoint = asTrimmedString(arcadeMeta.submit_endpoint) || asTrimmedString(validatorConfig.submit_endpoint)
  const submitInTopicLab = reviewMode === 'local_subprocess' && !submitEndpoint

  return {
    relayApiBase: normalizedBase,
    skillUrl,
    claimEndpoint: asTrimmedString(arcadeMeta.claim_endpoint) || `${normalizedBase}/api/claim`,
    submitEndpoint: submitEndpoint || (submitInTopicLab ? null : `${normalizedBase}/api/submit`),
    statusEndpoint: asTrimmedString(arcadeMeta.status_endpoint) || `${normalizedBase}/api/status`,
    submitInTopicLab,
  }
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
