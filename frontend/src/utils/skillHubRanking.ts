import type { SkillHubSkillSummary } from '../api/client'

const DEMOTED_SOURCE_NAMES = new Set([
  'ai research',
  'claude scientific',
])

export const EXTERNAL_SOURCE_PROMOTION_DOWNLOAD_THRESHOLD = 20

function normalizeText(value?: string | null) {
  return (value || '').trim().toLowerCase()
}

function isDemotedExternalSource(skill: Pick<SkillHubSkillSummary, 'source_name' | 'source_url'>) {
  const sourceName = normalizeText(skill.source_name)
  if (DEMOTED_SOURCE_NAMES.has(sourceName)) return true

  const sourceUrl = normalizeText(skill.source_url)
  return sourceUrl.includes('ai-research-skills') || sourceUrl.includes('claude-scientific-skills')
}

function getPublishedTime(skill: Pick<SkillHubSkillSummary, 'published_at' | 'created_at' | 'updated_at'>) {
  const raw = skill.published_at || skill.created_at || skill.updated_at
  if (!raw) return 0
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function getVisibilityBucket(skill: SkillHubSkillSummary) {
  if (!isDemotedExternalSource(skill)) return 0
  return (skill.total_downloads ?? 0) >= EXTERNAL_SOURCE_PROMOTION_DOWNLOAD_THRESHOLD ? 0 : 1
}

export function compareAppsPageSkills(a: SkillHubSkillSummary, b: SkillHubSkillSummary) {
  const featuredDiff = Number(Boolean(b.featured)) - Number(Boolean(a.featured))
  if (featuredDiff !== 0) return featuredDiff

  const bucketDiff = getVisibilityBucket(a) - getVisibilityBucket(b)
  if (bucketDiff !== 0) return bucketDiff

  const timeDiff = getPublishedTime(b) - getPublishedTime(a)
  if (timeDiff !== 0) return timeDiff

  const downloadDiff = (b.total_downloads ?? 0) - (a.total_downloads ?? 0)
  if (downloadDiff !== 0) return downloadDiff

  const ratingDiff = (b.avg_rating ?? 0) - (a.avg_rating ?? 0)
  if (ratingDiff !== 0) return ratingDiff

  return a.name.localeCompare(b.name, 'zh-Hans-CN')
}

export function sortAppsPageSkills(skills: SkillHubSkillSummary[]) {
  return [...skills].sort(compareAppsPageSkills)
}

export function filterAppsPageSkills(
  skills: SkillHubSkillSummary[],
  filters: {
    categoryKey?: string
    clusterKey?: string
  },
) {
  const categoryKey = (filters.categoryKey || '').trim()
  const clusterKey = (filters.clusterKey || '').trim()

  return skills.filter((skill) => {
    if (categoryKey && skill.category_key !== categoryKey) return false
    if (clusterKey && skill.cluster_key !== clusterKey) return false
    return true
  })
}
