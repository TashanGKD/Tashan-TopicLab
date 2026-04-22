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
  topic_origin?: 'app' | 'source' | null
  posts_count?: number
  metadata?: TopicMetadata | null
  interaction?: TopicInteraction
}

export interface TopicMetadata {
  scene?: string
  arcade?: {
    tags?: string[]
    board?: string
    difficulty?: string
    task_type?: string
    prompt?: string
    rules?: string
    output_mode?: string
    output_schema?: unknown
    validator?: unknown
    heartbeat_interval_minutes?: number
    visibility?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface PostMetadata {
  scene?: string
  arcade?: {
    post_kind?: 'submission' | 'evaluation' | string
    branch_owner_openclaw_agent_id?: number
    branch_root_post_id?: string
    for_post_id?: string | null
    version?: number | null
    payload?: unknown
    result?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface TopicCategory {
  id: string
  name: string
  description: string
}

export const TOPIC_CATEGORIES: TopicCategory[] = [
  { id: 'plaza', name: '广场', description: '适合公开发起、泛讨论和社区互动的话题。' },
  { id: 'arcade', name: 'Arcade', description: '面向评测与迭代优化的竞技题目板块。' },
  { id: '2050', name: '2050', description: '围绕 2050 会议议程、活动推荐、参会路线和现场协作展开讨论。' },
  { id: 'thought', name: '思考', description: '适合观点整理、开放问题和长线思辨。' },
  { id: 'research', name: '科研', description: '适合论文、实验、方法和研究路线相关的话题。' },
  { id: 'product', name: '产品', description: '适合功能设计、用户反馈和产品判断。' },
  { id: 'app', name: '应用', description: '适合围绕应用、插件、工具能力与使用体验展开讨论。' },
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
  source_feed_name?: string | null
  creator_user_id?: number | null
  creator_name?: string | null
  creator_auth_type?: string | null
  topic_origin?: 'app' | 'source' | null
  posts_count?: number
  metadata?: TopicMetadata | null
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

export interface SourceArticleSnapshotPayload {
  title: string
  source_feed_name: string
  source_type: string
  url: string
  pic_url: string | null
  description: string
  publish_time: string
  created_at: string
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
  author_type: 'human' | 'agent' | 'system'
  delete_token?: string | null
  owner_user_id?: number | null
  owner_auth_type?: string | null
  expert_name: string | null
  expert_label: string | null
  body: string
  metadata?: PostMetadata | null
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

export interface InboxMessage {
  id: string
  type: 'post_reply' | string
  is_read: boolean
  created_at: string
  read_at?: string | null
  actor_user_id?: number | null
  actor_openclaw_agent?: {
    agent_uid: string
    display_name: string
    handle: string
  } | null
  topic_id: string
  topic_title: string
  topic_category?: string | null
  reply_post_id: string
  reply_author: string
  reply_author_type: 'human' | 'agent' | string
  reply_expert_label?: string | null
  reply_body: string
  reply_status: 'pending' | 'completed' | 'failed' | string
  reply_created_at: string
  parent_post_id: string
  parent_author: string
  parent_author_type: 'human' | 'agent' | string
  parent_expert_label?: string | null
  parent_body: string
  parent_created_at: string
}

export interface InboxListResponse {
  items: InboxMessage[]
  unread_count: number
  total: number
  limit: number
  offset: number
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

export interface AppCatalogLinks {
  docs?: string
  repo?: string
  catalog_source?: string
}

export interface AppCatalogTopicSeed {
  category?: string
  title?: string
  body?: string
}

export interface AppCatalogReviewFeedback {
  scenario?: string
  body_template?: string
}

export interface AppCatalogOpenClawMeta {
  topic_seed?: AppCatalogTopicSeed
  review_feedback?: AppCatalogReviewFeedback
}

export interface AppCatalogItem {
  id: string
  name: string
  command?: string
  summary?: string
  description?: string
  icon?: string
  tags?: string[]
  builtin?: boolean
  linked_topic_id?: string | null
  linked_topic_posts_count?: number
  interaction?: TopicInteraction
  links?: AppCatalogLinks
  openclaw?: AppCatalogOpenClawMeta
}

export interface AppCatalogListResponse {
  version: string
  count: number
  import_sources: string[]
  list: AppCatalogItem[]
}

export interface EnsureAppTopicResponse {
  topic: Topic
  created: boolean
  catalog_version: string
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

/** 内置四角色：物理、生物、计算机、伦理 */
export const BUILTIN_EXPERT_NAMES = [
  'physicist',
  'biologist',
  'computer_scientist',
  'ethicist',
] as const

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
  /** 覆盖角色集：传则用此列表替代 topic.expert_names，用于「使用内置角色」选择 */
  expert_names?: string[]
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
  list: (params?: { category?: string; q?: string; cursor?: string | null; limit?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.category) searchParams.set('category', params.category)
    if (params?.q) searchParams.set('q', params.q)
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
  getFavorites: () => api.get<MyFavoritesResponse>('v1/me/favorites'),
  listFavoriteCategories: () => api.get<{ list: FavoriteCategory[] }>('v1/me/favorite-categories'),
  getRecentFavorites: (type: 'topics' | 'sources', params?: { cursor?: string | null; limit?: number }) => {
    const searchParams = new URLSearchParams()
    searchParams.set('type', type)
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    return api.get<FavoriteCategoryItemsPage>(`v1/me/favorites/recent?${searchParams.toString()}`)
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
    return api.get<FavoriteCategoryItemsPage>(`v1/me/favorite-categories/${categoryId}/items?${searchParams.toString()}`)
  },
  createFavoriteCategory: (data: FavoriteCategoryCreateRequest) => api.post<FavoriteCategory>('v1/me/favorite-categories', data),
  updateFavoriteCategory: (categoryId: string, data: FavoriteCategoryUpdateRequest) =>
    api.patch<FavoriteCategory>(`v1/me/favorite-categories/${categoryId}`, data),
  deleteFavoriteCategory: (categoryId: string) =>
    api.delete<{ ok: boolean; category_id: string }>(`v1/me/favorite-categories/${categoryId}`),
  assignTopicToFavoriteCategory: (categoryId: string, topicId: string) =>
    api.post<FavoriteCategory>(`v1/me/favorite-categories/${categoryId}/topics/${topicId}`),
  unassignTopicFromFavoriteCategory: (categoryId: string, topicId: string) =>
    api.delete<FavoriteCategory>(`v1/me/favorite-categories/${categoryId}/topics/${topicId}`),
  assignSourceToFavoriteCategory: (categoryId: string, articleId: number) =>
    api.post<FavoriteCategory>(`v1/me/favorite-categories/${categoryId}/source-articles/${articleId}`),
  unassignSourceFromFavoriteCategory: (categoryId: string, articleId: number) =>
    api.delete<FavoriteCategory>(`v1/me/favorite-categories/${categoryId}/source-articles/${articleId}`),
  classifyFavorites: (data: { category_name: string; description?: string; topic_ids?: string[]; article_ids?: number[] }) =>
    api.post<FavoriteCategory>('v1/me/favorite-categories/classify', data),
  getFavoriteCategorySummaryPayload: (categoryId: string) =>
    api.get<{ category: FavoriteCategoryRef; topics: TopicListItem[]; source_articles: SourceFeedArticle[]; combined_markdown: string }>(
      `v1/me/favorite-categories/${categoryId}/summary-payload`,
    ),
}

export const sourceFeedApi = {
  list: (params?: { limit?: number; offset?: number; source_type?: string; source_feed_name?: string }) => {
    const searchParams = new URLSearchParams()
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    if (params?.source_type != null && params.source_type !== '') {
      searchParams.set('source_type', params.source_type)
    }
    if (params?.source_feed_name != null && params.source_feed_name !== '') {
      searchParams.set('source_feed_name', params.source_feed_name)
    }
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
  ensureTopic: (articleId: number, snapshot?: SourceArticleSnapshotPayload) =>
    api.post<EnsureSourceArticleTopicResponse>(`/source-feed/articles/${articleId}/topic`, snapshot),
}

export const appsApi = {
  list: () => api.get<AppCatalogListResponse>('v1/apps'),
  get: (appId: string) => api.get<{ version: string; app: AppCatalogItem }>(`v1/apps/${encodeURIComponent(appId)}`),
  ensureTopic: (appId: string) => api.post<EnsureAppTopicResponse>(`v1/apps/${encodeURIComponent(appId)}/topic`),
  like: (appId: string, enabled: boolean) => api.post<TopicInteraction>(`v1/apps/${encodeURIComponent(appId)}/like`, { enabled }),
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
  /** 根据话题标题和正文生成 4 个讨论角色（异步，返回 202），前端需轮询 GET /topics/{id} 获取结果 */
  generateFromTopic: (topicId: string) =>
    api.post<{ status: string; message: string }>(`/topics/${topicId}/experts/generate-from-topic`),
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

export interface FeedbackSubmitPayload {
  body: string
  scenario?: string
  steps_to_reproduce?: string
  page_url?: string | null
}

export interface FeedbackSubmitResponse {
  id: number
  username: string
  created_at: string
}

export const feedbackApi = {
  submit: (payload: FeedbackSubmitPayload) =>
    api.post<FeedbackSubmitResponse>('v1/feedback', {
      body: payload.body,
      scenario: payload.scenario ?? '',
      steps_to_reproduce: payload.steps_to_reproduce ?? '',
      page_url: payload.page_url ?? null,
    }),
}

export const inboxApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<InboxListResponse>(`/v1/me/inbox${qs ? `?${qs}` : ''}`)
  },
  markRead: (messageId: string) => api.post<{ ok: boolean; message_id: string }>(`/v1/me/inbox/${messageId}/read`),
  markAllRead: () => api.post<{ ok: boolean; updated_count: number }>('/v1/me/inbox/read-all'),
}

export interface SkillHubDiscipline {
  key: string
  name: string
  summary: string
}

export interface SkillHubCluster {
  key: string
  title: string
  summary: string
}

export interface SkillHubSkillSummary {
  id: number
  slug: string
  name: string
  tagline?: string | null
  summary: string
  description: string
  category_key: string
  category_name: string
  cluster_key: string
  cluster_name: string
  tags: string[]
  capabilities: string[]
  framework: string
  compatibility_level: 'metadata' | 'install' | 'runtime_partial' | 'runtime_full' | string
  pricing_status: 'free' | 'pro' | 'paid' | string
  price_points: number
  license?: string | null
  source_url?: string | null
  source_name?: string | null
  docs_url?: string | null
  install_command?: string | null
  latest_version?: string | null
  openclaw_ready: boolean
  featured: boolean
  hero_note?: string | null
  total_reviews: number
  avg_rating: number
  total_favorites: number
  total_downloads: number
  weekly_downloads: number
  viewer_favorited?: boolean
  author_openclaw_agent_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  published_at?: string | null
}

export interface SkillHubSkillVersion {
  id: number
  version: string
  changelog?: string | null
  has_content?: boolean
  artifact_filename?: string | null
  artifact_size: number
  install_command?: string | null
  is_latest: boolean
  created_at?: string | null
}

export interface SkillHubReview {
  id: number
  skill_id: number
  rating: number
  title?: string | null
  content: string
  model?: string | null
  pros: string[]
  cons: string[]
  dimensions: Record<string, unknown>
  helpful_count: number
  author: {
    id?: number | null
    display_name?: string | null
    handle?: string | null
  }
  created_at?: string | null
  updated_at?: string | null
}

export interface SkillHubWish {
  id: number
  title: string
  content: string
  category_key?: string | null
  status: string
  votes_count: number
  author: {
    id?: number | null
    display_name?: string | null
    handle?: string | null
  }
  created_at?: string | null
}

export interface SkillHubCollection {
  id: number
  slug: string
  title: string
  description: string
  accent: string
  skills: SkillHubSkillSummary[]
  created_at?: string | null
}

export interface SkillHubTask {
  task_key: string
  title: string
  description: string
  reason_code: string
  points_reward: number
  daily_limit: number
  goal_count: number
  progress_count: number
  completed: boolean
}

export interface SkillHubProfile {
  has_agent: boolean
  openclaw_agent: {
    id?: number
    agent_uid?: string
    display_name?: string
    handle?: string
    skill_token?: string | null
    status?: string
  } | null
  wallet: {
    balance: number
    lifetime_earned: number
    lifetime_spent: number
    updated_at?: string | null
  } | null
  key: {
    key_id?: number
    masked_key?: string | null
    created_at?: string | null
    last_used_at?: string | null
    agent_uid?: string | null
    openclaw_agent?: {
      agent_uid?: string
      display_name?: string
      handle?: string
      status?: string
    } | null
  } | null
  my_skills: SkillHubSkillSummary[]
  my_reviews: Array<{
    id: number
    skill_id: number
    skill_name: string
    skill_slug: string
    rating: number
    title?: string | null
    content: string
    helpful_count: number
    created_at?: string | null
  }>
  my_downloads: Array<{
    id: number
    skill_id: number
    skill_name: string
    skill_slug: string
    version?: string | null
    points_spent: number
    created_at?: string | null
  }>
  my_favorites: SkillHubSkillSummary[]
}

export interface SkillHubLeaderboard {
  users: Array<{
    id: number
    agent_uid: string
    display_name: string
    handle: string
    balance: number
    total_skills: number
    total_reviews: number
    total_downloads: number
  }>
  skills: SkillHubSkillSummary[]
  weekly: SkillHubSkillSummary[]
}

export interface SkillHubSkillDetail extends SkillHubSkillSummary {
  versions: SkillHubSkillVersion[]
  reviews: SkillHubReview[]
  related_skills: SkillHubSkillSummary[]
}

export interface SkillHubSkillContentResponse {
  skill: {
    id: number
    slug: string
    name: string
    summary: string
    description: string
    category_key: string
    category_name: string
    latest_version?: string | null
  }
  version: {
    id: number
    version: string
    created_at?: string | null
  }
  content: string
  content_type: 'text/markdown'
  format: 'skill_md'
}

export interface SkillHubSkillsListResponse {
  list: SkillHubSkillSummary[]
  total: number
  limit: number
  offset: number
}

export interface SkillHubCategoriesResponse {
  disciplines: SkillHubDiscipline[]
  clusters: SkillHubCluster[]
}

function buildSkillHubPublishForm(payload: {
  name: string
  summary: string
  description: string
  category_key: string
  cluster_key: string
  tagline?: string
  slug?: string
  tags?: string[]
  capabilities?: string[]
  framework?: string
  compatibility_level?: string
  pricing_status?: string
  price_points?: number
  install_command?: string
  source_url?: string
  source_name?: string
  docs_url?: string
  license?: string
  hero_note?: string
  version?: string
  changelog?: string
  content_markdown?: string
  file?: File | null
}) {
  const form = new FormData()
  form.set('name', payload.name)
  form.set('summary', payload.summary)
  form.set('description', payload.description)
  form.set('category_key', payload.category_key)
  form.set('cluster_key', payload.cluster_key)
  if (payload.tagline) form.set('tagline', payload.tagline)
  if (payload.slug) form.set('slug', payload.slug)
  if (payload.tags?.length) form.set('tags', payload.tags.join(','))
  if (payload.capabilities?.length) form.set('capabilities', payload.capabilities.join(','))
  if (payload.framework) form.set('framework', payload.framework)
  if (payload.compatibility_level) form.set('compatibility_level', payload.compatibility_level)
  if (payload.pricing_status) form.set('pricing_status', payload.pricing_status)
  if (payload.price_points != null) form.set('price_points', String(payload.price_points))
  if (payload.install_command) form.set('install_command', payload.install_command)
  if (payload.source_url) form.set('source_url', payload.source_url)
  if (payload.source_name) form.set('source_name', payload.source_name)
  if (payload.docs_url) form.set('docs_url', payload.docs_url)
  if (payload.license) form.set('license', payload.license)
  if (payload.hero_note) form.set('hero_note', payload.hero_note)
  if (payload.version) form.set('version', payload.version)
  if (payload.changelog) form.set('changelog', payload.changelog)
  if (payload.content_markdown) form.set('content_markdown', payload.content_markdown)
  if (payload.file) form.set('file', payload.file)
  return form
}

export const skillHubApi = {
  listSkills: (params?: {
    q?: string
    category?: string
    cluster?: string
    sort?: string
    featured_only?: boolean
    openclaw_ready_only?: boolean
    limit?: number
    offset?: number
  }) => {
    const searchParams = new URLSearchParams()
    if (params?.q) searchParams.set('q', params.q)
    if (params?.category) searchParams.set('category', params.category)
    if (params?.cluster) searchParams.set('cluster', params.cluster)
    if (params?.sort) searchParams.set('sort', params.sort)
    if (params?.featured_only) searchParams.set('featured_only', 'true')
    if (params?.openclaw_ready_only) searchParams.set('openclaw_ready_only', 'true')
    if (params?.limit != null) searchParams.set('limit', String(params.limit))
    if (params?.offset != null) searchParams.set('offset', String(params.offset))
    const qs = searchParams.toString()
    return api.get<SkillHubSkillsListResponse>(`/v1/skill-hub/skills${qs ? `?${qs}` : ''}`)
  },
  getSkill: (idOrSlug: string) => api.get<SkillHubSkillDetail>(`/v1/skill-hub/skills/${encodeURIComponent(idOrSlug)}`),
  getSkillContent: (idOrSlug: string) =>
    api.get<SkillHubSkillContentResponse>(`/v1/skill-hub/skills/${encodeURIComponent(idOrSlug)}/content`),
  listCategories: () => api.get<SkillHubCategoriesResponse>('/v1/skill-hub/categories'),
  search: (params: { q: string; category?: string; cluster?: string; sort?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams()
    searchParams.set('q', params.q)
    if (params.category) searchParams.set('category', params.category)
    if (params.cluster) searchParams.set('cluster', params.cluster)
    if (params.sort) searchParams.set('sort', params.sort)
    if (params.limit != null) searchParams.set('limit', String(params.limit))
    if (params.offset != null) searchParams.set('offset', String(params.offset))
    return api.get<SkillHubSkillsListResponse>(`/v1/skill-hub/search?${searchParams.toString()}`)
  },
  listReviews: (skillId: string, sort: 'helpful' | 'rating' = 'helpful') =>
    api.get<{ reviews: SkillHubReview[]; summary: { total: number; avg_rating: number } }>(
      `/v1/skill-hub/reviews?skill_id=${encodeURIComponent(skillId)}&sort=${encodeURIComponent(sort)}`
    ),
  createReview: (payload: {
    skill_id: string
    rating: number
    content: string
    model?: string
    title?: string
    pros?: string[]
    cons?: string[]
    dimensions?: Record<string, unknown>
  }) => api.post<SkillHubReview>('/v1/skill-hub/reviews', payload),
  voteHelpful: (reviewId: number, enabled = true) =>
    api.post<{ review_id: number; helpful_count: number; enabled: boolean }>(`/v1/skill-hub/reviews/${reviewId}/helpful`, { enabled }),
  listLeaderboard: () => api.get<SkillHubLeaderboard>('/v1/skill-hub/leaderboard'),
  listWishes: (limit = 50) => api.get<{ list: SkillHubWish[] }>(`/v1/skill-hub/wishes?limit=${limit}`),
  createWish: (payload: { title: string; content: string; category_key?: string }) =>
    api.post<SkillHubWish>('/v1/skill-hub/wishes', payload),
  voteWish: (wishId: number, enabled = true) =>
    api.post<{ wish_id: number; votes_count: number; enabled: boolean }>(`/v1/skill-hub/wishes/${wishId}/vote`, { enabled }),
  listTasks: () => api.get<{ tasks: SkillHubTask[] }>('/v1/skill-hub/tasks'),
  listCollections: () => api.get<{ list: SkillHubCollection[] }>('/v1/skill-hub/collections'),
  getProfile: () => api.get<SkillHubProfile>('/v1/skill-hub/profile'),
  rotateOpenClawKey: () => api.post('/v1/skill-hub/profile/openclaw-key'),
  toggleFavorite: (idOrSlug: string, enabled = true) =>
    api.post<{ skill_id: number; favorited: boolean; total_favorites: number }>(`/v1/skill-hub/skills/${encodeURIComponent(idOrSlug)}/favorite?enabled=${enabled ? 'true' : 'false'}`),
  downloadSkill: (idOrSlug: string, referrer?: string) => {
    const qs = referrer ? `?referrer=${encodeURIComponent(referrer)}` : ''
    return api.get<{
      skill_id: number
      download_id: number
      version: string
      points_spent: number
      install_command?: string | null
      download_url?: string | null
      artifact_filename?: string | null
    }>(`/v1/skill-hub/skills/${encodeURIComponent(idOrSlug)}/download${qs}`)
  },
  publishSkill: (payload: Parameters<typeof buildSkillHubPublishForm>[0]) =>
    api.post<SkillHubSkillDetail>('/v1/skill-hub/skills', buildSkillHubPublishForm(payload), {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  publishVersion: (idOrSlug: string, payload: { version: string; changelog?: string; install_command?: string; content_markdown?: string; file?: File | null }) => {
    const form = new FormData()
    form.set('version', payload.version)
    if (payload.changelog) form.set('changelog', payload.changelog)
    if (payload.install_command) form.set('install_command', payload.install_command)
    if (payload.content_markdown) form.set('content_markdown', payload.content_markdown)
    if (payload.file) form.set('file', payload.file)
    return api.post<SkillHubSkillDetail>(`/v1/skill-hub/skills/${encodeURIComponent(idOrSlug)}/versions`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

export default api
