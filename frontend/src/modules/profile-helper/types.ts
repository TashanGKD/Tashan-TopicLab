/** Block 协议类型定义，与 digital-twin-bootstrap 保持一致 */

export interface ChoiceOption {
  id: string
  label: string
  description?: string
  /** 若设置，点击该选项后在右侧展示内联文本输入框，用户填写后再发送。值为 placeholder 文字 */
  text_prompt?: string
}

export interface ActionButton {
  id: string
  label: string
  href?: string
  style?: 'primary' | 'secondary'
}

export type Block =
  | { type: 'text'; content: string }
  | { type: 'choice'; id: string; question: string; options: ChoiceOption[] }
  | { type: 'text_input'; id: string; question: string; placeholder?: string; multiline?: boolean }
  | { type: 'rating'; id: string; question: string; min_val: number; max_val: number; min_label?: string; max_label?: string }
  | { type: 'chart'; chart_type: 'radar' | 'bar'; title: string; dimensions: string[]; values: number[]; max_value?: number }
  | { type: 'actions'; message?: string; buttons: ActionButton[] }
  | { type: 'copyable'; title?: string; content: string }

export interface ChatMessage {
  role: 'user' | 'assistant'
  /** 旧式纯文本消息（backward compat） */
  content?: string
  /** Block 协议消息 */
  blocks?: Block[]
  /** Block 级已响应集合（存储已回答的 block id），替代消息级 _responded */
  _responded_blocks?: string[]
  /** @deprecated 消息级已响应标记，仅向后兼容用，新逻辑以 _responded_blocks 为准 */
  _responded?: boolean
}

// ── 科学家匹配类型 ────────────────────────────────────────────────

export interface FamousMatch {
  name: string
  name_en: string
  field: string
  era: string
  similarity: number
  reason: string
  signature: string
  csi: number
  rai: number
}

export interface ScatterPoint {
  name: string
  name_en: string
  csi: number
  rai: number
  is_top3: boolean
}

export interface FieldRecommendation {
  name: string
  name_en?: string
  institution: string
  field: string
  reason: string
}

export interface FamousMatchResult {
  top3: FamousMatch[]
  scatter_data: ScatterPoint[]
  user_point: { csi: number; rai: number }
}

// ── StructuredProfile（画像结构化数据，用于维度可视化）────────────

export interface ProcessScore {
  score: number | null
  description: string
}

export interface TechItem {
  category: string
  tech: string
  level: string
}

export interface NeedItem {
  item?: string
  desc?: string
  feeling?: string
  issue?: string
  detail?: string
  help_type?: string
}

export interface PersonalityDim {
  score: number
  level: string
}

export interface StructuredProfile {
  name: string
  meta: { created_at: string; updated_at: string; stage: string; source: string }
  identity: {
    research_stage: string
    primary_field: string
    secondary_field: string
    cross_field: string
    method: string
    institution: string
    network: string
  }
  capability: {
    tech_stack: TechItem[]
    process: Record<string, ProcessScore>
    outputs: string
  }
  needs: {
    time_occupation: NeedItem[]
    pain_points: NeedItem[]
    want_to_change: string
  }
  cognitive_style: {
    integration?: number
    depth?: number
    csi?: number
    type?: string
    source?: string
  }
  motivation: {
    dimensions: Record<string, number>
    intrinsic_total: number | null
    extrinsic_total: number | null
    rai: number | null
    source: string
  }
  personality: Record<string, PersonalityDim | string>
  interpretation: {
    core_driver: string
    risks: string
    path: string
  }
  completion: Record<string, boolean>
}
