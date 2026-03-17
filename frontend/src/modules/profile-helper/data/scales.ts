/** 量表定义：完整版，与 digital-twin-bootstrap 保持一致 */

export interface ScaleQuestion {
  id: string
  text: string
  dimension: string
  reverse?: boolean
}

export interface ScaleDimension {
  id: string
  name: string
  question_ids: string[]
}

export interface ScaleDefinition {
  id: string
  name: string
  description: string
  instructions: string
  min_val: number
  max_val: number
  min_label: string
  max_label: string
  questions: ScaleQuestion[]
  dimensions: ScaleDimension[]
  /** 'average' = 均值计分; 'sum' = 求和计分 */
  scoring: 'average' | 'sum'
}

// ── RCSS：科研认知风格量表（8 题，1-7 分）────────────────────────

export const RCSS_SCALE: ScaleDefinition = {
  id: 'rcss',
  name: '科研认知风格量表 (RCSS)',
  description: '评估你在科研中的思维习惯：偏向「跨领域整合」还是「专业深耕」。共 8 题，约 3 分钟。',
  instructions: '请根据你在科研中的真实倾向，对以下陈述评分。',
  min_val: 1,
  max_val: 7,
  min_label: '完全不同意',
  max_label: '完全同意',
  questions: [
    { id: 'A1', text: '我习惯于在非本专业的领域中寻找可以跨界使用的灵感或方法。', dimension: 'integration' },
    { id: 'A2', text: '在处理科研障碍时，我倾向于跳出当前具体问题，试图构建一个更宏大、更通用的理论框架或模型。', dimension: 'integration' },
    { id: 'A3', text: '我认为跨学科的"连接"能力比单一学科的"深度"在现代科学研究中更为稀缺和重要。', dimension: 'integration' },
    { id: 'A4', text: '我倾向于将不同的算法、模型和理论"组装"在一起，形成一套完整的系统或解决方案。', dimension: 'integration' },
    { id: 'B1', text: '我更喜欢深耕一个垂直细分领域，成为那个领域里掌握技术细节最精准、最全面的专家。', dimension: 'depth' },
    { id: 'B2', text: '我更喜欢针对某个具体的模型、数据集或物理现象进行极致的参数调优、数学建模或实验验证。', dimension: 'depth' },
    { id: 'B3', text: '我更喜欢一个人安静地钻研极其复杂的数学推导、代码细节或实验操作，而不喜欢频繁讨论宏观架构。', dimension: 'depth' },
    { id: 'B4', text: '我认为把一件技术小事做到极致的"工匠精神"是科研工作者的最高准则。', dimension: 'depth' },
  ],
  dimensions: [
    { id: 'integration', name: '横向整合', question_ids: ['A1', 'A2', 'A3', 'A4'] },
    { id: 'depth', name: '垂直深度', question_ids: ['B1', 'B2', 'B3', 'B4'] },
  ],
  scoring: 'sum',
}

// ── Mini-IPIP：大五人格量表（20 题，1-5 分）────────────────────────

export const MINI_IPIP_SCALE: ScaleDefinition = {
  id: 'mini-ipip',
  name: '大五人格量表 (Mini-IPIP)',
  description: '评估你的五大人格特质：外向性、宜人性、尽责性、神经质、开放性。共 20 题，约 5 分钟。',
  instructions: '请描述你「通常的状态」，而非理想状态。',
  min_val: 1,
  max_val: 5,
  min_label: '非常不符合',
  max_label: '非常符合',
  questions: [
    { id: '1',  text: '我是聚会中的焦点人物。',          dimension: 'E' },
    { id: '2',  text: '我同情他人的感受。',              dimension: 'A' },
    { id: '3',  text: '我会立即完成杂务。',              dimension: 'C' },
    { id: '4',  text: '我情绪波动频繁。',                dimension: 'N' },
    { id: '5',  text: '我有生动的想象力。',              dimension: 'I' },
    { id: '6',  text: '我不常说话。',                   dimension: 'E', reverse: true },
    { id: '7',  text: '我对别人的问题不感兴趣。',        dimension: 'A', reverse: true },
    { id: '8',  text: '我经常忘记把东西放回原处。',      dimension: 'C', reverse: true },
    { id: '9',  text: '我大部分时间都很放松。',          dimension: 'N', reverse: true },
    { id: '10', text: '我对抽象概念不感兴趣。',          dimension: 'I', reverse: true },
    { id: '11', text: '在聚会上我会与许多不同的人交谈。', dimension: 'E' },
    { id: '12', text: '我能感受到他人的情绪。',          dimension: 'A' },
    { id: '13', text: '我喜欢有条理。',                  dimension: 'C' },
    { id: '14', text: '我很容易心烦意乱。',              dimension: 'N' },
    { id: '15', text: '我理解抽象概念有困难。',          dimension: 'I', reverse: true },
    { id: '16', text: '我保持在背景中（不引人注目）。',  dimension: 'E', reverse: true },
    { id: '17', text: '我对他人不太感兴趣。',            dimension: 'A', reverse: true },
    { id: '18', text: '我把事情搞得一团糟。',            dimension: 'C', reverse: true },
    { id: '19', text: '我很少感到忧郁。',                dimension: 'N', reverse: true },
    { id: '20', text: '我没有很好的想象力。',            dimension: 'I', reverse: true },
  ],
  dimensions: [
    { id: 'E', name: '外向性',    question_ids: ['1', '6', '11', '16'] },
    { id: 'A', name: '宜人性',    question_ids: ['2', '7', '12', '17'] },
    { id: 'C', name: '尽责性',    question_ids: ['3', '8', '13', '18'] },
    { id: 'N', name: '神经质',    question_ids: ['4', '9', '14', '19'] },
    { id: 'I', name: '开放性/智力', question_ids: ['5', '10', '15', '20'] },
  ],
  scoring: 'average',
}

// ── AMS-GSR 28：学术动机量表（28 题，1-7 分）─────────────────────

export const AMS_SCALE: ScaleDefinition = {
  id: 'ams',
  name: '学术动机量表 (AMS-GSR 28)',
  description: '评估你从事科研的动机结构：内在动机、外在动机和无动机。共 28 题，约 8 分钟。',
  instructions: '请根据"你为什么攻读研究生学位并从事科研工作？"来回答。',
  min_val: 1,
  max_val: 7,
  min_label: '完全不符合',
  max_label: '非常符合',
  questions: [
    { id: '1',  text: '因为仅有本科学历，我以后找不到高薪工作。',                             dimension: 'external' },
    { id: '2',  text: '因为在自己的领域学习新事物时我能体验到快乐和满足。',                  dimension: 'know' },
    { id: '3',  text: '因为我认为研究生教育能帮助我更好地为选择的职业做准备。',              dimension: 'identified' },
    { id: '4',  text: '因为当与他人交流自己的研究想法时我体验到强烈的感受。',                dimension: 'stimulation' },
    { id: '5',  text: '说实话，我不知道；我真的觉得读研究生是浪费时间。',                    dimension: 'amotivation' },
    { id: '6',  text: '因为在研究中超越自我时我能体验到愉悦。',                              dimension: 'accomplishment' },
    { id: '7',  text: '为了向自己证明我有能力完成研究生学位。',                              dimension: 'introjected' },
    { id: '8',  text: '为了日后能在学术界或产业界获得更有声望的职位。',                      dimension: 'external' },
    { id: '9',  text: '因为发现前所未见的新现象或新观点时我能体验到愉悦。',                  dimension: 'know' },
    { id: '10', text: '因为这最终能使我进入我喜欢的领域就业。',                              dimension: 'identified' },
    { id: '11', text: '因为阅读有趣的学术论文或著作时我能体验到愉悦。',                      dimension: 'stimulation' },
    { id: '12', text: '我曾经有充分的理由读研究生；然而，现在我怀疑是否应该继续。',          dimension: 'amotivation' },
    { id: '13', text: '因为在研究成就中超越自我时我能体验到快乐。',                          dimension: 'accomplishment' },
    { id: '14', text: '因为当我在研究中取得成功时，我会感到自己很重要。',                    dimension: 'introjected' },
    { id: '15', text: '因为我想日后拥有"美好生活"。',                                        dimension: 'external' },
    { id: '16', text: '因为拓宽我感兴趣研究主题的知识时我能体验到愉悦。',                    dimension: 'know' },
    { id: '17', text: '因为这能帮助我就研究方向和职业定位做出更好的选择。',                  dimension: 'identified' },
    { id: '18', text: '因为全神贯注于某些学者的著作时我能体验到愉悦。',                      dimension: 'stimulation' },
    { id: '19', text: '我不明白为什么做科研，坦率地说，我根本不在乎。',                      dimension: 'amotivation' },
    { id: '20', text: '因为完成困难的研究任务过程中我能感到满足。',                          dimension: 'accomplishment' },
    { id: '21', text: '为了向自己展示我是一个聪明且有能力的研究者。',                        dimension: 'introjected' },
    { id: '22', text: '为了日后能有更好的职业前景和薪水。',                                  dimension: 'external' },
    { id: '23', text: '因为我的研究生学习使我能继续了解许多我感兴趣的事物。',                dimension: 'know' },
    { id: '24', text: '因为我相信额外几年的研究生教育会提高我作为研究者的能力。',            dimension: 'identified' },
    { id: '25', text: '因为探索各种有趣的研究主题时我能体验到"兴奋"的感觉。',                dimension: 'stimulation' },
    { id: '26', text: '我不知道；我无法理解我在研究中做什么。',                              dimension: 'amotivation' },
    { id: '27', text: '因为研究生学习使我在追求研究卓越的过程中体验到个人满足感。',          dimension: 'accomplishment' },
    { id: '28', text: '因为我想向自己展示我能在研究生学习和研究中取得成功。',                dimension: 'introjected' },
  ],
  dimensions: [
    { id: 'know',          name: '求知内在动机',     question_ids: ['2', '9', '16', '23'] },
    { id: 'accomplishment',name: '成就内在动机',     question_ids: ['6', '13', '20', '27'] },
    { id: 'stimulation',   name: '体验刺激内在动机', question_ids: ['4', '11', '18', '25'] },
    { id: 'identified',    name: '认同调节',         question_ids: ['3', '10', '17', '24'] },
    { id: 'introjected',   name: '内摄调节',         question_ids: ['7', '14', '21', '28'] },
    { id: 'external',      name: '外部调节',         question_ids: ['1', '8', '15', '22'] },
    { id: 'amotivation',   name: '无动机',           question_ids: ['5', '12', '19', '26'] },
  ],
  scoring: 'average',
}

export const ALL_SCALES: ScaleDefinition[] = [RCSS_SCALE, MINI_IPIP_SCALE, AMS_SCALE]

export function getScaleById(id: string): ScaleDefinition | undefined {
  return ALL_SCALES.find((s) => s.id === id)
}
