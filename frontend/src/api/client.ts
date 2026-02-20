import axios from 'axios'

const api = axios.create({
  baseURL: '/topic-lab/api',
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
  mode: 'human_agent' | 'discussion' | 'both'
  num_rounds: number
  expert_names: string[]
  discussion_result: DiscussionResult | null
  discussion_status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  updated_at: string
}

export interface DiscussionResult {
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
  in_reply_to_id?: string | null
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

export const ROUNDTABLE_MODELS = [
  { value: 'qwen-flash', label: 'Qwen Flash（默认）' },
  { value: 'qwen3.5-plus', label: 'Qwen3.5 Plus' },
  { value: 'qwen3-max', label: 'Qwen3 Max' },
  { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
  { value: 'MiniMax-M2.1', label: 'MiniMax M2.1' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5' },
  { value: 'glm-5', label: 'GLM-5' },
  { value: 'glm-4.7', label: 'GLM-4.7' },
]

export interface StartDiscussionRequest {
  num_rounds: number
  max_turns: number
  max_budget_usd: number
  model?: string
  /** 启用的工具列表，如 Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch。不传则使用默认全量 */
  allowed_tools?: string[]
  /** 可选的 skill 列表（id），从全局 skill 库拷贝到工作区，供主持人分配给专家 */
  skill_list?: string[]
  /** 可选的 MCP 服务器 ID 列表，从全局 mcp.json 拷贝到话题工作区 */
  mcp_server_ids?: string[]
}

export interface AssignableSkill {
  id: string
  source?: string
  name: string
  description?: string
  category?: string
  category_name?: string
}

export interface ListAssignableParams {
  category?: string
  fields?: 'minimal' | 'full'
  limit?: number
  offset?: number
}

export interface AssignableCategory {
  id: string
  name: string
  description: string
}

export interface DiscussionProgress {
  completed_turns: number
  total_turns: number
  current_round: number
  latest_speaker: string
}

export interface DiscussionStatusResponse {
  status: 'pending' | 'running' | 'completed' | 'failed'
  result: DiscussionResult | null
  progress: DiscussionProgress | null
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

export const discussionApi = {
  start: (topicId: string, data: StartDiscussionRequest) => api.post<DiscussionStatusResponse>(`/topics/${topicId}/discussion`, data),
  getStatus: (topicId: string) => api.get<DiscussionStatusResponse>(`/topics/${topicId}/discussion/status`),
}

export const skillsApi = {
  listAssignable: (params?: ListAssignableParams) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.fields) searchParams.set('fields', params.fields)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<AssignableSkill[]>(`/skills/assignable${qs ? `?${qs}` : ''}`)
  },
  listCategories: () => api.get<AssignableCategory[]>('/skills/assignable/categories'),
  getContent: (skillId: string) =>
    api.get<{ content: string }>(`/skills/assignable/${encodeURIComponent(skillId)}/content`),
}

export interface ExpertInfo {
  name: string
  label: string
  description: string
  skill_file: string
  skill_content: string
  perspective?: string  // 用于分组展示，如 physics, biology
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
  getContent: (topicId: string, expertName: string) =>
    api.get<{ role_content: string }>(`/topics/${topicId}/experts/${expertName}/content`),
  share: (topicId: string, expertName: string) =>
    api.post(`/topics/${topicId}/experts/${expertName}/share`),
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

/** Assignable moderator mode (from skills/moderator_modes/, for library grid) */
export interface AssignableModeratorMode {
  id: string
  source?: string
  name: string
  description?: string
  category?: string
  category_name?: string
  num_rounds?: number
  convergence_strategy?: string
}

export interface ListAssignableModeratorModeParams {
  category?: string
  fields?: 'minimal' | 'full'
  limit?: number
  offset?: number
}

export const moderatorModesApi = {
  listPresets: () => api.get<ModeratorModeInfo[]>('/moderator-modes'),
  getConfig: (topicId: string) => api.get<ModeratorModeConfig>(`/topics/${topicId}/moderator-mode`),
  setConfig: (topicId: string, data: SetModeratorModeRequest) =>
    api.put<ModeratorModeConfig>(`/topics/${topicId}/moderator-mode`, data),
  generate: (topicId: string, data: { prompt: string }) =>
    api.post(`/topics/${topicId}/moderator-mode/generate`, data),
  listAssignable: (params?: ListAssignableModeratorModeParams) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.fields) searchParams.set('fields', params.fields)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<AssignableModeratorMode[]>(`/moderator-modes/assignable${qs ? `?${qs}` : ''}`)
  },
  listCategories: () => api.get<AssignableCategory[]>('/moderator-modes/assignable/categories'),
  getContent: (modeId: string) =>
    api.get<{ content: string }>(`/moderator-modes/assignable/${encodeURIComponent(modeId)}/content`),
}

// MCP assignable API (read-only, from skills/mcps/)
export interface AssignableMCP {
  id: string
  source?: string
  name: string
  description?: string
  category?: string
  category_name?: string
}

export interface ListAssignableMCPParams {
  category?: string
  fields?: 'minimal' | 'full'
  limit?: number
  offset?: number
}

export const mcpApi = {
  listAssignable: (params?: ListAssignableMCPParams) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.fields) searchParams.set('fields', params.fields)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<AssignableMCP[]>(`/mcp/assignable${qs ? `?${qs}` : ''}`)
  },
  listCategories: () => api.get<AssignableCategory[]>('/mcp/assignable/categories'),
  getContent: (mcpId: string) =>
    api.get<{ content: string }>(`/mcp/assignable/${encodeURIComponent(mcpId)}/content`),
}

export default api
