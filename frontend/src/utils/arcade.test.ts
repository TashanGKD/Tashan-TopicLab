import { describe, expect, it } from 'vitest'

import {
  getArcadeDisplayTags,
  getArcadeExternalRelay,
  getArcadeKind,
  getArcadeScore,
  isArcadeTopic,
} from './arcade'

describe('arcade utils', () => {
  it('prefers explicit tags over board and difficulty fallback', () => {
    expect(getArcadeDisplayTags({
      scene: 'arcade',
      arcade: {
        tags: ['tag-a', 'tag-b'],
        board: 'board-x',
        difficulty: 'hard',
      },
    })).toEqual(['tag-a', 'tag-b'])
  })

  it('falls back to board and difficulty when tags are absent', () => {
    expect(getArcadeDisplayTags({
      scene: 'arcade',
      arcade: {
        board: 'mlx',
        difficulty: 'hard',
      },
    })).toEqual(['MLX', 'hard'])
  })

  it('parses arcade kind and score from post metadata', () => {
    const post = {
      metadata: {
        scene: 'arcade',
        arcade: {
          post_kind: 'evaluation',
          result: { score: 0.91 },
        },
      },
    }

    expect(getArcadeKind(post as any)).toBe('evaluation')
    expect(getArcadeScore(post as any)).toBe(0.91)
  })

  it('detects arcade topics by category and scene', () => {
    expect(isArcadeTopic({ category: 'arcade', metadata: { scene: 'arcade' } } as any)).toBe(true)
    expect(isArcadeTopic({ category: 'research', metadata: { scene: 'arcade' } } as any)).toBe(false)
  })

  it('extracts external relay endpoints from arcade metadata', () => {
    expect(getArcadeExternalRelay({
      scene: 'arcade',
      arcade: {
        validator: {
          type: 'custom',
          config: {
            review_mode: 'external_relay',
            relay_api_base: 'http://49.233.162.81:8788',
          },
        },
        skill_url: 'http://49.233.162.81:8788/skill.md',
        claim_endpoint: 'http://49.233.162.81:8788/api/claim',
        submit_endpoint: 'http://49.233.162.81:8788/api/submit',
        status_endpoint: 'http://49.233.162.81:8788/api/status',
      },
    })).toEqual({
      relayApiBase: 'http://49.233.162.81:8788',
      skillUrl: 'http://49.233.162.81:8788/skill.md',
      claimEndpoint: 'http://49.233.162.81:8788/api/claim',
      submitEndpoint: 'http://49.233.162.81:8788/api/submit',
      statusEndpoint: 'http://49.233.162.81:8788/api/status',
    })
  })
})
