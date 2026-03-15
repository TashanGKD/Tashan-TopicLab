import axios from 'axios'
import { tokenManager } from './auth'

const api = axios.create({
  baseURL: `${import.meta.env.BASE_URL}api`,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = tokenManager.get()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
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
  /** 讨论方式 ID，由 API 从 config/moderator_mode.json 填充 */
  moderator_mode_id?: string | null
  /** 讨论方式显示名，由 API 填充 */
  moderator_mode_name?: string | null
  /** 话题列表轻量预览图（可选） */
  preview_image?: string | null
  creator_user_id?: number | null
  creator_name?: string | null
  creator_auth_type?: string | null
  posts_count?: number
  interaction?: TopicInteraction
}

export interface TopicCategory {
  id: string
  name: string
  description: string
}

export const TOPIC_CATEGORIES: TopicCategory[] = [
  { id: 'plaza', name: '广场', description: '适合公开发起、泛讨论和社区互动的话题。' },
  { id: 'thought', name: '思考', description: '适合观点整理、开放问题和长线思辨。' },
  { id: 'research', name: '科研', description: '适合论文、实验、方法和研究路线相关的话题。' },
  { id: 'product', name: '产品', description: '适合功能设计、用户反馈和产品判断。' },
  { id: 'news', name: '资讯', description: '适合围绕最新动态、行业消息和热点展开讨论。' },
  { id: 'request', name: '需求', description: '发布需求、寻找协作、对接资源，把想法变成合作。' },
]

export function getTopicCategoryMeta(category?: string | null): TopicCategory | null {
  if (!category) return null
  return TOPIC_CATEGORIES.find((item) => item.id === category) ?? null
}

export interface TopicListItem {
  id: string
  session_id: string
  category?: string | null
  title: string
  body: string
  status: 'draft' | 'open' | 'closed'
  discussion_status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  updated_at: string
  moderator_mode_id?: string | null
  moderator_mode_name?: string | null
  preview_image?: string | null
  /** 信源默认图，可作为预览图加载失败时的 fallback */
  source_preview_image?: string | null
  creator_user_id?: number | null
  creator_name?: string | null
  creator_auth_type?: string | null
  posts_count?: number
  interaction?: TopicInteraction
  favorite_category_ids?: string[]
  favorite_categories?: FavoriteCategoryRef[]
}

export interface TopicInteraction {
  likes_count: number
  shares_count: number
  favorites_count: number
  liked: boolean
  favorited: boolean
}

export interface TopicBundleResponse {
  topic: Topic
  posts: PostListPage
  experts: TopicExpert[]
}

export interface SourceFeedArticle {
  id: number
  title: string
  source_feed_name: string
  source_type: string
  url: string
  pic_url?: string | null
  description: string
  publish_time: string
  created_at: string
  linked_topic_id?: string | null
  linked_topic_posts_count?: number
  interaction?: SourceArticleInteraction
  favorite_category_ids?: string[]
  favorite_categories?: FavoriteCategoryRef[]
}

export interface SourceFeedArticleDetail extends SourceFeedArticle {
  content_md?: string
  content_source?: string
  md_path?: string
  run_dir?: string
}

export interface FavoriteCategoryRef {
  id: string
  name: string
}

export interface FavoriteCategory extends FavoriteCategoryRef {
  description: string
  created_at: string
  updated_at: string
  topics_count: number
  source_articles_count: number
  items_count?: number
  topics?: TopicListItem[]
  source_articles?: SourceFeedArticle[]
}

export interface SourceArticleInteraction {
  likes_count: number
  shares_count: number
  favorites_count: number
  liked: boolean
  favorited: boolean
}

export interface SourceFeedListResponse {
  list: SourceFeedArticle[]
  limit: number
  offset: number
}

/** Literature (学术) API - papers 列表项 */
export interface LiteraturePaper {
  paper_id: string
  title: string
  authors: string[]
  primary_category: string
  categories: string[]
  published: string
  updated: string
  pdf_url: string | null
  doi: string | null
  journal_ref: string | null
  comment: string | null
  created_at: string
  updated_at: string
}

/** Literature recent 视图列表项 (compact) */
export interface LiteratureRecentItem {
  paper_id: string
  title: string
  authors: string[]
  compact_category: string
  published_day: string
  tags: string[]
  similarity_scores?: number[]
  created_at?: string
  updated_at?: string
}

export interface LiteraturePapersListResponse {
  list: LiteraturePaper[]
  limit: number
  offset: number
}

export interface LiteratureRecentListResponse {
  list: LiteratureRecentItem[]
  limit: number
  offset: number
}

export interface EnsureSourceArticleTopicResponse {
  topic: Topic
  created: boolean
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
  delete_token?: string | null
  owner_user_id?: number | null
  owner_auth_type?: string | null
  expert_name: string | null
  expert_label: string | null
  body: string
  mentions: string[]
  in_reply_to_id: string | null
  root_post_id?: string | null
  depth?: number
  reply_count?: number
  latest_replies?: Post[]
  status: 'pending' | 'completed' | 'failed'
  created_at: string
  likes_count?: number
  shares_count?: number
  interaction?: PostInteraction
}

export interface PostInteraction {
  likes_count: number
  shares_count: number
  liked: boolean
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
  reply_post?: Post | null
  reply_post_id: string
  status: 'pending'
}

export interface CreatePostResponse {
  post: Post
  parent_post?: Post | null
}

export interface PostListPage {
  items: Post[]
  next_cursor: string | null
}

export interface ReplyListPage {
  items: Post[]
  parent_post_id: string
  next_cursor: string | null
}

export interface FavoriteCategoryItemsPage {
  items: TopicListItem[] | SourceFeedArticle[]
  next_cursor: string | null
}

export interface TopicListPage {
  items: TopicListItem[]
  next_cursor: string | null
}

export interface ToggleActionRequest {
  enabled: boolean
}

export interface SourceArticleActionRequest extends ToggleActionRequest {
  title: string
  source_feed_name: string
  source_type: string
  url: string
  pic_url?: string | null
  description: string
  publish_time: string
  created_at: string
}

export interface MyFavoritesResponse {
  topics: TopicListItem[]
  source_articles: SourceFeedArticle[]
  categories: FavoriteCategory[]
}

export interface FavoriteCategoryCreateRequest {
  name: string
  description?: string
}

export interface FavoriteCategoryUpdateRequest {
  name?: string
  description?: string
}

export interface CreateTopicRequest {
  title: string
  body?: string
  category?: string
}

export const ROUNDTABLE_MODELS = [
  { value: 'qwen3.5-plus', label: 'Qwen3.5 Plus（默认）' },
  { value: 'qwen-flash', label: 'Qwen Flash' },
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
  q?: string
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
  list: (params?: { category?: string; cursor?: string | null; limit?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    const qs = searchParams.toString()
    return api.get<TopicListPage>(`/topics${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<Topic>(`/topics/${id}`),
  getBundle: (id: string) => api.get<TopicBundleResponse>(`/topics/${id}/bundle`),
  create: (data: CreateTopicRequest) => api.post<Topic>('/topics', data),
  update: (id: string, data: Partial<CreateTopicRequest>) => api.patch<Topic>(`/topics/${id}`, data),
  close: (id: string) => api.post<Topic>(`/topics/${id}/close`),
  delete: (id: string) => api.delete<{ ok: boolean; topic_id: string }>(`/topics/${id}`),
  listCategories: () => api.get<{ list: TopicCategory[] }>('/topics/categories'),
  like: (id: string, enabled: boolean) => api.post<TopicInteraction>(`/topics/${id}/like`, { enabled }),
  favorite: (id: string, enabled: boolean) => api.post<TopicInteraction>(`/topics/${id}/favorite`, { enabled }),
  share: (id: string) => api.post<TopicInteraction>(`/topics/${id}/share`),
  getFavorites: () => api.get<MyFavoritesResponse>('/api/v1/me/favorites'),
  listFavoriteCategories: () => api.get<{ list: FavoriteCategory[] }>('/api/v1/me/favorite-categories'),
  getRecentFavorites: (type: 'topics' | 'sources', params?: { cursor?: string | null; limit?: number }) => {
    const searchParams = new URLSearchParams()
    searchParams.set('type', type)
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    return api.get<FavoriteCategoryItemsPage>(`/api/v1/me/favorites/recent?${searchParams.toString()}`)
  },
  getFavoriteCategoryItems: (
    categoryId: string,
    type: 'topics' | 'sources',
    params?: { cursor?: string | null; limit?: number }
  ) => {
    const searchParams = new URLSearchParams()
    searchParams.set('type', type)
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    return api.get<FavoriteCategoryItemsPage>(`/api/v1/me/favorite-categories/${categoryId}/items?${searchParams.toString()}`)
  },
  createFavoriteCategory: (data: FavoriteCategoryCreateRequest) => api.post<FavoriteCategory>('/api/v1/me/favorite-categories', data),
  updateFavoriteCategory: (categoryId: string, data: FavoriteCategoryUpdateRequest) =>
    api.patch<FavoriteCategory>(`/api/v1/me/favorite-categories/${categoryId}`, data),
  deleteFavoriteCategory: (categoryId: string) =>
    api.delete<{ ok: boolean; category_id: string }>(`/api/v1/me/favorite-categories/${categoryId}`),
  assignTopicToFavoriteCategory: (categoryId: string, topicId: string) =>
    api.post<FavoriteCategory>(`/api/v1/me/favorite-categories/${categoryId}/topics/${topicId}`),
  unassignTopicFromFavoriteCategory: (categoryId: string, topicId: string) =>
    api.delete<FavoriteCategory>(`/api/v1/me/favorite-categories/${categoryId}/topics/${topicId}`),
  assignSourceToFavoriteCategory: (categoryId: string, articleId: number) =>
    api.post<FavoriteCategory>(`/api/v1/me/favorite-categories/${categoryId}/source-articles/${articleId}`),
  unassignSourceFromFavoriteCategory: (categoryId: string, articleId: number) =>
    api.delete<FavoriteCategory>(`/api/v1/me/favorite-categories/${categoryId}/source-articles/${articleId}`),
  classifyFavorites: (data: { category_name: string; description?: string; topic_ids?: string[]; article_ids?: number[] }) =>
    api.post<FavoriteCategory>('/api/v1/me/favorite-categories/classify', data),
  getFavoriteCategorySummaryPayload: (categoryId: string) =>
    api.get<{ category: FavoriteCategoryRef; topics: TopicListItem[]; source_articles: SourceFeedArticle[]; combined_markdown: string }>(
      `/api/v1/me/favorite-categories/${categoryId}/summary-payload`,
    ),
}

export const sourceFeedApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<SourceFeedListResponse>(`/source-feed/articles${qs ? `?${qs}` : ''}`)
  },
  imageUrl: (rawUrl: string) => {
    const searchParams = new URLSearchParams()
    searchParams.set('url', rawUrl)
    return `${import.meta.env.BASE_URL}api/source-feed/image?${searchParams.toString()}`
  },
  detail: (articleId: number) =>
    api.get<SourceFeedArticleDetail>(`/source-feed/articles/${articleId}`),
  like: (articleId: number, data: SourceArticleActionRequest) =>
    api.post<SourceArticleInteraction>(`/source-feed/articles/${articleId}/like`, data),
  favorite: (articleId: number, data: SourceArticleActionRequest) =>
    api.post<SourceArticleInteraction>(`/source-feed/articles/${articleId}/favorite`, data),
  share: (articleId: number) =>
    api.post<SourceArticleInteraction>(`/source-feed/articles/${articleId}/share`),
  ensureTopic: (articleId: number) =>
    api.post<EnsureSourceArticleTopicResponse>(`/source-feed/articles/${articleId}/topic`),
}

/** 学术板块：经 topiclab-backend 代理到 IC（与信源同源 INFORMATION_COLLECTION_BASE_URL） */
export const literatureApi = {
  recent: (params?: {
    limit?: number
    offset?: number
    category?: string
    tag?: string
    published_day_from?: string
    published_day_to?: string
  }) => {
    const searchParams = new URLSearchParams()
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    if (params?.category) searchParams.set('category', params.category)
    if (params?.tag) searchParams.set('tag', params.tag)
    if (params?.published_day_from) searchParams.set('published_day_from', params.published_day_from)
    if (params?.published_day_to) searchParams.set('published_day_to', params.published_day_to)
    const qs = searchParams.toString()
    return api.get<LiteratureRecentListResponse>(`/literature/recent${qs ? `?${qs}` : ''}`)
  },
}

export const postsApi = {
  list: (topicId: string, params?: { cursor?: string | null; limit?: number; previewReplies?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.previewReplies != null) searchParams.set('preview_replies', String(params.previewReplies))
    const qs = searchParams.toString()
    return api.get<PostListPage>(`/topics/${topicId}/posts${qs ? `?${qs}` : ''}`)
  },
  listReplies: (topicId: string, postId: string, params?: { cursor?: string | null; limit?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    const qs = searchParams.toString()
    return api.get<ReplyListPage>(`/topics/${topicId}/posts/${postId}/replies${qs ? `?${qs}` : ''}`)
  },
  getThread: (topicId: string, postId: string) => api.get<{ items: Post[] }>(`/topics/${topicId}/posts/${postId}/thread`),
  create: (topicId: string, data: CreatePostRequest) =>
    api.post<CreatePostResponse>(`/topics/${topicId}/posts`, data),
  mention: (topicId: string, data: MentionExpertRequest) =>
    api.post<MentionExpertResponse>(`/topics/${topicId}/posts/mention`, data),
  getReplyStatus: (topicId: string, replyPostId: string) =>
    api.get<Post>(`/topics/${topicId}/posts/mention/${replyPostId}`),
  delete: (topicId: string, postId: string) =>
    api.delete<{ ok: boolean; topic_id: string; post_id: string; deleted_count?: number }>(`/topics/${topicId}/posts/${postId}`),
  like: (topicId: string, postId: string, enabled: boolean) =>
    api.post<PostInteraction>(`/topics/${topicId}/posts/${postId}/like`, { enabled }),
  share: (topicId: string, postId: string) =>
    api.post<PostInteraction>(`/topics/${topicId}/posts/${postId}/share`),
}

export const discussionApi = {
  start: (topicId: string, data: StartDiscussionRequest) => api.post<DiscussionStatusResponse>(`/topics/${topicId}/discussion`, data),
  getStatus: (topicId: string) => api.get<DiscussionStatusResponse>(`/topics/${topicId}/discussion/status`),
}

export const skillsApi = {
  listAssignable: (params?: ListAssignableParams) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.q) searchParams.set('q', params.q)
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
  perspective?: string  // 学科视角，如 physics, biology
  category?: string  // 分类 id，用于分组（与 skills/mcps 一致）
  category_name?: string  // 分类显示名
  source?: string  // default=内置, topiclab_shared=共享
}

export interface ExpertUpdateRequest {
  skill_content: string
}

export interface ListExpertsParams {
  fields?: 'minimal' | 'full'
}

export const expertsApi = {
  list: (params?: ListExpertsParams) => {
    const searchParams = new URLSearchParams()
    if (params?.fields) searchParams.set('fields', params.fields)
    const qs = searchParams.toString()
    return api.get<ExpertInfo[]>(`/experts${qs ? `?${qs}` : ''}`)
  },
  get: (name: string) => api.get<ExpertInfo>(`/experts/${name}`),
  getContent: (name: string) =>
    api.get<{ content: string }>(`/experts/${encodeURIComponent(name)}/content`),
  update: (name: string, data: ExpertUpdateRequest) => api.put<ExpertInfo>(`/experts/${name}`, data),
}

// Topic-level experts API
export interface TopicExpert {
  name: string
  label: string
  description: string
  source: 'preset' | 'custom' | 'ai_generated' | string
  role_file: string
  added_at: string
  is_from_topic_creation: boolean
  origin_type?: 'digital_twin' | string
  origin_visibility?: 'private' | 'public' | string
  masked?: boolean
}

export interface AddExpertRequest {
  source: 'preset' | 'custom' | 'ai_generated'
  preset_name?: string
  name?: string
  label?: string
  description?: string
  role_content?: string
  user_prompt?: string
  origin_type?: 'digital_twin' | string
  origin_visibility?: 'private' | 'public' | string
  masked?: boolean
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
  skill_list?: string[]
  mcp_server_ids?: string[]
  model?: string | null
}

export interface SetModeratorModeRequest {
  mode_id: string
  num_rounds: number
  custom_prompt?: string | null
  skill_list?: string[]
  mcp_server_ids?: string[]
  model?: string | null
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
  q?: string
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
    if (params?.q) searchParams.set('q', params.q)
    if (params?.fields) searchParams.set('fields', params.fields)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<AssignableModeratorMode[]>(`/moderator-modes/assignable${qs ? `?${qs}` : ''}`)
  },
  listCategories: () => api.get<AssignableCategory[]>('/moderator-modes/assignable/categories'),
  getContent: (modeId: string) =>
    api.get<{ content: string }>(`/moderator-modes/assignable/${encodeURIComponent(modeId)}/content`),
  share: (topicId: string, data: { mode_id: string; name?: string; description?: string }) =>
    api.post<{ message: string; mode_id: string }>(`/topics/${topicId}/moderator-mode/share`, data),
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
  q?: string
  fields?: 'minimal' | 'full'
  limit?: number
  offset?: number
}

export const mcpApi = {
  listAssignable: (params?: ListAssignableMCPParams) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.q) searchParams.set('q', params.q)
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

// Libs admin API (cache invalidation for hot-reload)
export const libsApi = {
  invalidateCache: () => api.post<{ message: string }>('/libs/invalidate-cache'),
}

// Profile helper models (same as AI generation, user-selectable)
export const PROFILE_HELPER_MODELS = [
  { value: 'qwen3.5-plus', label: 'Qwen3.5 Plus（默认）' },
  { value: 'qwen-flash', label: 'Qwen Flash' },
  { value: 'qwen3-max', label: 'Qwen3 Max' },
  { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
  { value: 'MiniMax-M2.1', label: 'MiniMax M2.1' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5' },
  { value: 'glm-5', label: 'GLM-5' },
  { value: 'glm-4.7', label: 'GLM-4.7' },
]

// Profile helper API
export const profileHelperApi = {
  getOrCreateSession: (existingId?: string) =>
    api.get<{ session_id: string }>(
      `/profile-helper/session${existingId ? `?session_id=${encodeURIComponent(existingId)}` : ''}`
    ),
  getProfile: (sessionId: string) =>
    api.get<{ profile: string; forum_profile: string }>(`/profile-helper/profile/${sessionId}`),
  resetSession: (sessionId: string) =>
    api.post<{ ok: boolean; session_id: string }>(`/profile-helper/session/reset/${sessionId}`),
  getDownloadUrl: (sessionId: string) =>
    `${import.meta.env.BASE_URL}api/profile-helper/download/${sessionId}`,
  getForumDownloadUrl: (sessionId: string) =>
    `${import.meta.env.BASE_URL}api/profile-helper/download/${sessionId}/forum`,
}

export default api
