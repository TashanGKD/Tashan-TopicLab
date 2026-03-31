import { describe, expect, it } from 'vitest'

import { getArcadeDisplayTags, getArcadeKind, getArcadeScore, isArcadeTopic } from './arcade'

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
})
