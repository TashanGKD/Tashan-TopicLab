import { describe, expect, it } from 'vitest'

import type { SkillHubSkillSummary } from '../api/client'
import {
  EXTERNAL_SOURCE_PROMOTION_DOWNLOAD_THRESHOLD,
  filterAppsPageSkills,
  sortAppsPageSkills,
} from './skillHubRanking'

function makeSkill(overrides: Partial<SkillHubSkillSummary>): SkillHubSkillSummary {
  return {
    id: 1,
    slug: 'skill',
    name: 'Skill',
    summary: 'summary',
    description: 'description',
    category_key: '07',
    category_name: '理学',
    cluster_key: 'ai',
    cluster_name: 'AI 与大模型',
    tags: [],
    capabilities: [],
    framework: 'openclaw',
    compatibility_level: 'install',
    pricing_status: 'free',
    price_points: 0,
    openclaw_ready: true,
    featured: false,
    total_reviews: 0,
    avg_rating: 0,
    total_favorites: 0,
    total_downloads: 0,
    weekly_downloads: 0,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    published_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

describe('sortAppsPageSkills', () => {
  it('keeps featured skills ahead of normal skills', () => {
    const sorted = sortAppsPageSkills([
      makeSkill({
        id: 1,
        slug: 'newer-normal',
        name: 'Newer Normal',
        published_at: '2026-03-14T00:00:00Z',
      }),
      makeSkill({
        id: 2,
        slug: 'featured-older',
        name: 'Featured Older',
        featured: true,
        published_at: '2026-03-01T00:00:00Z',
      }),
    ])

    expect(sorted.map((skill) => skill.slug)).toEqual([
      'featured-older',
      'newer-normal',
    ])
  })

  it('sorts normal sources by published time first, then downloads', () => {
    const sorted = sortAppsPageSkills([
      makeSkill({
        id: 1,
        slug: 'older-popular',
        name: 'Older Popular',
        published_at: '2026-03-10T00:00:00Z',
        total_downloads: 200,
      }),
      makeSkill({
        id: 2,
        slug: 'newer-quiet',
        name: 'Newer Quiet',
        published_at: '2026-03-12T00:00:00Z',
        total_downloads: 5,
      }),
      makeSkill({
        id: 3,
        slug: 'same-day-higher-downloads',
        name: 'Same Day Higher Downloads',
        published_at: '2026-03-12T00:00:00Z',
        total_downloads: 30,
      }),
    ])

    expect(sorted.map((skill) => skill.slug)).toEqual([
      'same-day-higher-downloads',
      'newer-quiet',
      'older-popular',
    ])
  })

  it('demotes imported external sources until downloads cross the promotion threshold', () => {
    const sorted = sortAppsPageSkills([
      makeSkill({
        id: 1,
        slug: 'community-fresh',
        name: 'Community Fresh',
        published_at: '2026-03-12T00:00:00Z',
        total_downloads: 3,
      }),
      makeSkill({
        id: 2,
        slug: 'ai-research-low',
        name: 'AI Research Low',
        source_name: 'Ai Research',
        published_at: '2026-03-13T00:00:00Z',
        total_downloads: EXTERNAL_SOURCE_PROMOTION_DOWNLOAD_THRESHOLD - 1,
      }),
      makeSkill({
        id: 3,
        slug: 'claude-scientific-low',
        name: 'Claude Scientific Low',
        source_name: 'Claude Scientific',
        published_at: '2026-03-11T00:00:00Z',
        total_downloads: 0,
      }),
      makeSkill({
        id: 4,
        slug: 'ai-research-promoted',
        name: 'AI Research Promoted',
        source_name: 'Ai Research',
        published_at: '2026-03-11T00:00:00Z',
        total_downloads: EXTERNAL_SOURCE_PROMOTION_DOWNLOAD_THRESHOLD,
      }),
      makeSkill({
        id: 5,
        slug: 'community-older',
        name: 'Community Older',
        published_at: '2026-03-08T00:00:00Z',
        total_downloads: 1,
      }),
    ])

    expect(sorted.map((skill) => skill.slug)).toEqual([
      'community-fresh',
      'ai-research-promoted',
      'community-older',
      'ai-research-low',
      'claude-scientific-low',
    ])
  })

  it('filters skills by category and cluster keys', () => {
    const skills = [
      makeSkill({ id: 1, slug: 'literature-map', category_key: '07', cluster_key: 'literature' }),
      makeSkill({ id: 2, slug: 'lab-robot-playbook', category_key: '08', cluster_key: 'labos' }),
      makeSkill({ id: 3, slug: 'another-literature', category_key: '08', cluster_key: 'literature' }),
    ]

    expect(filterAppsPageSkills(skills, { categoryKey: '08' }).map((skill) => skill.slug)).toEqual([
      'lab-robot-playbook',
      'another-literature',
    ])
    expect(filterAppsPageSkills(skills, { clusterKey: 'literature' }).map((skill) => skill.slug)).toEqual([
      'literature-map',
      'another-literature',
    ])
    expect(filterAppsPageSkills(skills, { categoryKey: '08', clusterKey: 'literature' }).map((skill) => skill.slug)).toEqual([
      'another-literature',
    ])
  })
})
