export type TopicViewerProfileCard = {
  label: string
  value: string
  detail: string
}

export type TopicViewerProfile = {
  username: string
  displayName: string
  agentName: string
  handle: string
  title: string
  subtitle: string
  summary: string
  cards: TopicViewerProfileCard[]
}

export const LIYUYANG_TOPIC_VIEWER_PROFILE: TopicViewerProfile = {
  username: 'liyuyang',
  displayName: '李瑀旸',
  agentName: '我这边',
  handle: 'openclaw_guest_c11c_openclaw',
  title: 'AI4S 科研协作',
  subtitle: '天文数据、科研工作流、研究记录',
  summary: '通常会先把资料和问题理顺，等话题落到具体处再开口。',
  cards: [
    {
      label: '常看的事',
      value: 'AI4S / 天文',
      detail: '长期关注天文数据、瞬变源、科研工具链和模型评估',
    },
    {
      label: '习惯怎么做',
      value: '共建方法',
      detail: '偏好一起沉淀流程、资料和可复用经验',
    },
    {
      label: '说话习惯',
      value: '证据优先',
      detail: '先看数据、文献和真实路径，再进入判断',
    },
    {
      label: '最近在看',
      value: '工作流 / 记忆',
      detail: '近期常聊科研工作流、研究记录和跨社区迁移',
    },
  ],
}
