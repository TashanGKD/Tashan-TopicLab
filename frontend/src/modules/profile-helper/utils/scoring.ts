import type { ScaleDefinition } from '../data/scales'

/**
 * 计算量表各维度得分。
 * 处理反向计分：reverse 题 score = (max_val + 1) - raw
 */
export function calculateScores(
  scale: ScaleDefinition,
  answers: Record<string, number>,
): Record<string, number> {
  const scores: Record<string, number> = {}

  for (const dim of scale.dimensions) {
    const qIds = dim.question_ids
    const vals: number[] = []

    for (const qId of qIds) {
      const raw = answers[qId]
      if (raw == null) continue
      const q = scale.questions.find((qq) => qq.id === qId)
      const val = q?.reverse ? (scale.max_val + 1 - raw) : raw
      vals.push(val)
    }

    if (vals.length === 0) {
      scores[dim.id] = 0
      continue
    }

    if (scale.scoring === 'average') {
      scores[dim.id] = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
    } else {
      scores[dim.id] = vals.reduce((a, b) => a + b, 0)
    }
  }

  return scores
}

/**
 * RCSS 专用：计算 CSI = I - D（求和后相减）
 * 范围 -24 ~ +24
 */
export function calculateRCSS(scores: Record<string, number>) {
  const I = scores['integration'] || 0
  const D = scores['depth'] || 0
  const CSI = I - D

  let type = '平衡型'
  if (CSI >= 17)       type = '强整合型'
  else if (CSI >= 8)   type = '倾向整合型'
  else if (CSI <= -17) type = '强深度型'
  else if (CSI <= -8)  type = '倾向深度型'

  return { I, D, CSI, type }
}

/**
 * AMS-GSR 28 专用：计算 RAI（相对自主性指数）
 * RAI = 3×求知 + 3×成就 + 3×体验刺激 + 2×认同 − 1×内摄 − 2×外部 − 3×无动机
 */
export function calculateAMS_RAI(scores: Record<string, number>) {
  const know          = scores['know']           || 0
  const accomplishment= scores['accomplishment'] || 0
  const stimulation   = scores['stimulation']    || 0
  const identified    = scores['identified']     || 0
  const introjected   = scores['introjected']    || 0
  const external      = scores['external']       || 0
  const amotivation   = scores['amotivation']    || 0

  const RAI =
    3 * know + 3 * accomplishment + 3 * stimulation + 2 * identified
    - 1 * introjected - 2 * external - 3 * amotivation

  return {
    intrinsicTotal: parseFloat((know + accomplishment + stimulation).toFixed(2)),
    extrinsicTotal: parseFloat((identified + introjected + external).toFixed(2)),
    RAI: parseFloat(RAI.toFixed(2)),
  }
}

/** 向后兼容旧名称 */
export const calculateAMSRAI = calculateAMS_RAI
