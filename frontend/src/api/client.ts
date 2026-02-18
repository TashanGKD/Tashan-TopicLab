import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

export interface Topic {
  id: string
  session_id: string  // 等于 id，对应 workspace/topics/{session_id}/ 目录
  title: string
  body: string
  category: string | null
  status: 'draft' | 'open' | 'closed'
  mode: 'human_agent' | 'roundtable' | 'both'
  num_rounds: number
  expert_names: string[]
  roundtable_result: RoundtableResult | null
  roundtable_status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  updated_at: string
}

export interface RoundtableResult {
  discussion_history: string
  discussion_summary: string
  turns_count: number
  cost_usd: number | null
  completed_at: string
}

export interface Post {
  id: string
  topic_id: string
  author: string
  author_type: 'human' | 'agent'
  expert_name: string | null
  expert_label: string | null
  body: string
  mentions: string[]
  in_reply_to_id: string | null
  status: 'pending' | 'completed' | 'failed'
  created_at: string
}

export interface CreatePostRequest {
  author: string
  body: string
}

export interface MentionExpertRequest {
  author: string
  body: string
  expert_name: string
  in_reply_to_id?: string | null
}

export interface MentionExpertResponse {
  user_post: Post
  reply_post_id: string
  status: 'pending'
}

export interface CreateTopicRequest {
  title: string
  body?: string
  category?: string
}

export interface StartRoundtableRequest {
  num_rounds: number
  max_turns: number
  max_budget_usd: number
}

export interface RoundtableProgress {
  completed_turns: number
  total_turns: number
  current_round: number
  latest_speaker: string
}

export interface RoundtableStatusResponse {
  status: 'pending' | 'running' | 'completed' | 'failed'
  result: RoundtableResult | null
  progress: RoundtableProgress | null
}

export const topicsApi = {
  list: () => api.get<Topic[]>('/topics'),
  get: (id: string) => api.get<Topic>(`/topics/${id}`),
  create: (data: CreateTopicRequest) => api.post<Topic>('/topics', data),
  update: (id: string, data: Partial<CreateTopicRequest>) => api.patch<Topic>(`/topics/${id}`, data),
  close: (id: string) => api.post<Topic>(`/topics/${id}/close`),
}

export const postsApi = {
  list: (topicId: string) => api.get<Post[]>(`/topics/${topicId}/posts`),
  create: (topicId: string, data: CreatePostRequest) =>
    api.post<Post>(`/topics/${topicId}/posts`, data),
  mention: (topicId: string, data: MentionExpertRequest) =>
    api.post<MentionExpertResponse>(`/topics/${topicId}/posts/mention`, data),
  getReplyStatus: (topicId: string, replyPostId: string) =>
    api.get<Post>(`/topics/${topicId}/posts/mention/${replyPostId}`),
}

export const roundtableApi = {
  start: (topicId: string, data: StartRoundtableRequest) => api.post<RoundtableStatusResponse>(`/topics/${topicId}/roundtable`, data),
  getStatus: (topicId: string) => api.get<RoundtableStatusResponse>(`/topics/${topicId}/roundtable/status`),
}

export interface ExpertInfo {
  name: string
  label: string
  description: string
  skill_file: string
  skill_content: string
}

export interface ExpertUpdateRequest {
  skill_content: string
}

export const expertsApi = {
  list: () => api.get<ExpertInfo[]>('/experts'),
  get: (name: string) => api.get<ExpertInfo>(`/experts/${name}`),
  update: (name: string, data: ExpertUpdateRequest) => api.put<ExpertInfo>(`/experts/${name}`, data),
}

// Topic-level experts API
export interface TopicExpert {
  name: string
  label: string
  description: string
  source: 'preset' | 'custom' | 'ai_generated'
  role_file: string
  added_at: string
  is_from_topic_creation: boolean
}

export interface AddExpertRequest {
  source: 'preset' | 'custom' | 'ai_generated'
  preset_name?: string
  name?: string
  label?: string
  description?: string
  role_content?: string
  user_prompt?: string
}

export interface GenerateExpertRequest {
  expert_name?: string
  expert_label: string
  description: string
}

export interface GenerateExpertResponse {
  message: string
  expert_name: string
  expert_label: string
  role_content: string
}

export const topicExpertsApi = {
  list: (topicId: string) => api.get<TopicExpert[]>(`/topics/${topicId}/experts`),
  add: (topicId: string, data: AddExpertRequest) => api.post(`/topics/${topicId}/experts`, data),
  update: (topicId: string, expertName: string, data: { role_content: string }) =>
    api.put(`/topics/${topicId}/experts/${expertName}`, data),
  delete: (topicId: string, expertName: string) => api.delete(`/topics/${topicId}/experts/${expertName}`),
  generate: (topicId: string, data: GenerateExpertRequest) =>
    api.post<GenerateExpertResponse>(`/topics/${topicId}/experts/generate`, data),
}

// Moderator modes API
export interface ModeratorModeInfo {
  id: string
  name: string
  description: string
  num_rounds: number
  convergence_strategy: string
}

export interface ModeratorModeConfig {
  mode_id: string
  num_rounds: number
  custom_prompt: string | null
}

export interface SetModeratorModeRequest {
  mode_id: string
  num_rounds: number
  custom_prompt?: string | null
}

export const moderatorModesApi = {
  listPresets: () => api.get<ModeratorModeInfo[]>('/moderator-modes'),
  getConfig: (topicId: string) => api.get<ModeratorModeConfig>(`/topics/${topicId}/moderator-mode`),
  setConfig: (topicId: string, data: SetModeratorModeRequest) =>
    api.put<ModeratorModeConfig>(`/topics/${topicId}/moderator-mode`, data),
  generate: (topicId: string, data: { prompt: string }) =>
    api.post(`/topics/${topicId}/moderator-mode/generate`, data),
}

export default api
