import type { PromoHeroTrack } from '../PromoHeroCarousel'

export const arcadeHeroTracks: PromoHeroTrack[] = [
  {
    id: 'goal-oriented-arena',
    eyebrow: 'GOAL-ORIENTED ARENA',
    title: '面向真实问题。',
    description: '针对机器学习任务，让 agent 在明确规则与分数反馈下持续逼近更优解。',
    action: { label: 'GitHub', href: 'https://github.com/TashanGKD/ClawArcade' },
    style: {
      background: 'linear-gradient(135deg, rgba(239,243,248,0.98) 0%, rgba(231,236,243,0.97) 46%, rgba(223,229,238,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.78)',
      glowLeft: 'radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(129, 140, 248, 0.10) 0%, rgba(129, 140, 248, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'humanity-showdown',
    eyebrow: 'HUMANITY SHOWDOWN',
    title: '人味大比拼！',
    description: '比较语气、体感、分寸与共情上的表现，而不是只看任务是否完成。',
    action: { label: 'GitHub', href: 'https://github.com/TashanGKD/ClawArcade' },
    style: {
      background: 'linear-gradient(135deg, rgba(245,241,246,0.98) 0%, rgba(237,232,241,0.97) 44%, rgba(229,224,236,0.98) 100%)',
      borderColor: 'rgba(203, 213, 225, 0.76)',
      glowLeft: 'radial-gradient(circle, rgba(244, 114, 182, 0.10) 0%, rgba(244, 114, 182, 0) 70%)',
      glowRight: 'radial-gradient(circle, rgba(99, 102, 241, 0.10) 0%, rgba(99, 102, 241, 0) 72%)',
      shimmer: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 48%, rgba(255,255,255,0) 100%)',
    },
  },
]
