import { startTransition, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  topicsApi,
  discussionApi,
  postsApi,
  topicExpertsApi,
  sourceFeedApi,
  Topic,
  TopicExpert,
  Post,
  SourceFeedArticle,
  StartDiscussionRequest,
  DiscussionProgress,
  getTopicCategoryMeta,
} from '../api/client'
import TopicConfigTabs from '../components/TopicConfigTabs'
import ResizableToc from '../components/ResizableToc'
import PostThread from '../components/PostThread'
import MentionTextarea from '../components/MentionTextarea'
import ReactionButton from '../components/ReactionButton'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'
import { toast } from '../utils/toast'
import { resolveTopicImageSrc } from '../utils/topicImage'
import { useThrottledCallback, useThrottledCallbackByKey } from '../hooks/useThrottledCallback'

interface DiscussionPost {
  round: number
  expertName: string
  expertKey: string
  content: string
  id: string
}

interface NavigationItem {
  type: 'round' | 'summary' | 'posts'
  round?: number
  label: string
  id: string
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 16.25l-1.15-1.04C4.775 11.53 2.5 9.47 2.5 6.95A3.45 3.45 0 016 3.5c1.14 0 2.23.53 3 1.36A4.05 4.05 0 0112 3.5a3.45 3.45 0 013.5 3.45c0 2.52-2.27 4.58-6.35 8.27L10 16.25z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M6 3.75h8a1 1 0 011 1v11l-5-2.6-5 2.6v-11a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M8 10.5l4-2.5m-4 1.5l4 2.5M13.5 6.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zm0 10.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zM5.5 12.25a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const POLL_INTERVAL_MS = 3500

export default function TopicDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const initialSkillIds = (location.state as { skillList?: string[] } | null)?.skillList
  const [topic, setTopic] = useState<Topic | null>(null)
  const [loading, setLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(true)
  const [topicExperts, setTopicExperts] = useState<TopicExpert[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [postNextCursor, setPostNextCursor] = useState<string | null>(null)
  const [loadingMorePosts, setLoadingMorePosts] = useState(false)
  const [replyLoadingPostIds, setReplyLoadingPostIds] = useState<Set<string>>(new Set())
  const [replyNextCursorByPostId, setReplyNextCursorByPostId] = useState<Record<string, string | null>>({})
  const [postText, setPostText] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [startingDiscussion, setStartingDiscussion] = useState(false)
  const [polling, setPolling] = useState(false)
  const [progress, setProgress] = useState<DiscussionProgress | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const discussionStartRef = useRef<number | null>(null)
  const [activeNavId, setActiveNavId] = useState<string>('')
  const [replyingTo, setReplyingTo] = useState<Post | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [topicLikePending, setTopicLikePending] = useState(false)
  const [topicFavoritePending, setTopicFavoritePending] = useState(false)
  const [postLikePendingIds, setPostLikePendingIds] = useState<Set<string>>(new Set())
  const [linkedSourceArticle, setLinkedSourceArticle] = useState<SourceFeedArticle | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingRepliesRef = useRef<Set<string>>(new Set())
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (id) {
      void bootstrapTopicDetail(id)
    }
  }, [id])

  useEffect(() => {
    if (topic?.discussion_status === 'running' && !polling) {
      setPolling(true)
      startPolling()
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [topic?.discussion_status])

  // Local elapsed timer — no backend round-trip needed
  useEffect(() => {
    if (topic?.discussion_status !== 'running') {
      discussionStartRef.current = null
      setElapsedSeconds(0)
      return
    }
    if (!discussionStartRef.current) {
      discussionStartRef.current = Date.now()
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - discussionStartRef.current!) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [topic?.discussion_status])

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!id || pendingRepliesRef.current.size === 0) return
      for (const replyId of [...pendingRepliesRef.current]) {
        try {
          const res = await postsApi.getReplyStatus(id, replyId)
          if (res.data.status !== 'pending') {
            pendingRepliesRef.current.delete(replyId)
            setPosts(prev => mergePosts(prev, [res.data]))
          }
        } catch {
          pendingRepliesRef.current.delete(replyId)
        }
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const syncUser = async () => {
      const token = tokenManager.get()
      if (token) {
        const latestUser = await refreshCurrentUserProfile()
        if (latestUser) {
          setCurrentUser(latestUser)
          return
        }
      }
      const savedUser = tokenManager.getUser()
      setCurrentUser(token && savedUser ? savedUser : null)
    }

    void syncUser()
    const handleStorage = () => { void syncUser() }
    const handleAuthChange = () => { void syncUser() }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth-change', handleAuthChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth-change', handleAuthChange)
    }
  }, [])

  useEffect(() => {
    const articleId = extractSourceArticleId(topic?.body || '')
    if (!articleId) {
      setLinkedSourceArticle(null)
      return
    }
    let cancelled = false
    sourceFeedApi.detail(articleId)
      .then((res) => {
        if (!cancelled) {
          setLinkedSourceArticle(res.data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedSourceArticle(buildSourcePreviewFromTopicBody(topic?.body || '', articleId))
        }
      })
    return () => {
      cancelled = true
    }
  }, [topic?.body])

  // 信源话题且 expert_names 为空时轮询刷新 topic，以显示 AI 生成的角色（替代「生成中…」）
  useEffect(() => {
    if (!id || !topic || !linkedSourceArticle) return
    const expertNames = topic.expert_names ?? []
    if (expertNames.length > 0) return
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (cancelled) return
      try {
        const res = await topicsApi.get(id)
        if (!cancelled && (res.data.expert_names?.length ?? 0) > 0) {
          setTopic(res.data)
          return
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, 2000)
      }
    }
    timeoutId = setTimeout(poll, 2000)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [id, topic?.id, linkedSourceArticle, topic?.expert_names?.length])

  const mergePosts = (existing: Post[], incoming: Post[]) => {
    const byId = new Map(existing.map(item => [item.id, item]))
    for (const post of incoming) {
      byId.set(post.id, { ...byId.get(post.id), ...post })
    }
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  const flattenPostPage = (items: Post[]) => {
    const flat: Post[] = []
    for (const post of items) {
      flat.push({ ...post, latest_replies: undefined })
      for (const reply of post.latest_replies ?? []) {
        flat.push(reply)
      }
    }
    return flat
  }

  const bootstrapTopicDetail = async (topicId: string) => {
    setLoading(true)
    setPostsLoading(true)
    setPosts([])
    setTopicExperts([])
    setReplyNextCursorByPostId({})
    setPostNextCursor(null)
    try {
      const res = await topicsApi.get(topicId)
      setTopic(res.data)
    } catch (err) {
      handleApiError(err, '加载话题失败')
      setLoading(false)
      setPostsLoading(false)
      return
    }
    setLoading(false)
    void loadPosts(topicId)
    window.setTimeout(() => {
      void loadTopicExperts(topicId)
    }, 0)
  }

  const loadTopicExperts = async (topicId: string) => {
    try {
      const res = await topicExpertsApi.list(topicId)
      setTopicExperts(res.data)
    } catch (err) {
      handleApiError(err, '加载专家列表失败')
    }
  }

  const loadTopic = async (topicId: string) => {
    try {
      const res = await topicsApi.get(topicId)
      setTopic(res.data)
    } catch (err) {
      handleApiError(err, '加载话题失败')
    } finally {
      setLoading(false)
    }
  }

  const loadPosts = async (topicId: string) => {
    setPostsLoading(true)
    try {
      const res = await postsApi.list(topicId, { previewReplies: 0 })
      startTransition(() => {
        setPosts(flattenPostPage(res.data.items))
      })
      setPostNextCursor(res.data.next_cursor)
      setReplyNextCursorByPostId(
        Object.fromEntries(res.data.items.map(post => [post.id, (post.reply_count ?? 0) > (post.latest_replies?.length ?? 0) ? '__more__' : null]))
      )
    } catch { /* ignore */ }
    finally {
      setPostsLoading(false)
    }
  }

  const loadMorePosts = async () => {
    if (!id || !postNextCursor || loadingMorePosts) return
    setLoadingMorePosts(true)
    try {
      const res = await postsApi.list(id, { cursor: postNextCursor, previewReplies: 0 })
      setPosts(prev => mergePosts(prev, flattenPostPage(res.data.items)))
      setPostNextCursor(res.data.next_cursor)
      setReplyNextCursorByPostId(prev => ({
        ...prev,
        ...Object.fromEntries(res.data.items.map(post => [post.id, (post.reply_count ?? 0) > (post.latest_replies?.length ?? 0) ? '__more__' : null])),
      }))
    } catch (err) {
      handleApiError(err, '加载更多帖子失败')
    } finally {
      setLoadingMorePosts(false)
    }
  }

  const handleLoadReplies = async (post: Post) => {
    if (!id) return
    const currentCursor = replyNextCursorByPostId[post.id]
    if (currentCursor === null || replyLoadingPostIds.has(post.id)) return
    setReplyLoadingPostIds(prev => new Set(prev).add(post.id))
    try {
      const res = await postsApi.listReplies(id, post.id, {
        cursor: currentCursor === '__more__' ? undefined : currentCursor,
      })
      setPosts(prev => mergePosts(prev, res.data.items))
      setReplyNextCursorByPostId(prev => ({
        ...prev,
        [post.id]: res.data.next_cursor,
      }))
    } catch (err) {
      handleApiError(err, '加载回复失败')
    } finally {
      setReplyLoadingPostIds(prev => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
    }
  }

  const handleReplyToPost = (post: Post) => {
    setSubmitError('')
    setReplyingTo(post)
    if (post.author_type === 'agent' && topic?.discussion_status !== 'pending' && topic?.discussion_status !== 'running') {
      const mentionName = post.expert_name ?? post.author
      setPostText(prev => ensureExpertMention(prev, mentionName))
    }
    setTimeout(() => composerTextareaRef.current?.focus(), 0)
  }

  const handleDeletePost = async (post: Post) => {
    if (!id) return
    const confirmed = window.confirm('确认删除这条帖子？')
    if (!confirmed) return
    try {
      await postsApi.delete(id, post.id)
      await loadPosts(id)
      await loadTopic(id)
      if (replyingTo?.id === post.id) {
        setReplyingTo(null)
      }
      handleApiSuccess('帖子已删除')
    } catch (err) {
      handleApiError(err, '删除帖子失败')
    }
  }

  const requireCurrentUser = () => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
  }

  const handleToggleTopicLike = async () => {
    if (!id || !topic || !requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.liked ?? false)
    setTopicLikePending(true)
    const previousInteraction = topic.interaction
    setTopic(prev => prev ? {
      ...prev,
      interaction: {
        likes_count: Math.max(0, (prev.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
        favorites_count: prev.interaction?.favorites_count ?? 0,
        shares_count: prev.interaction?.shares_count ?? 0,
        liked: nextEnabled,
        favorited: prev.interaction?.favorited ?? false,
      },
    } : prev)
    try {
      const res = await topicsApi.like(id, nextEnabled)
      setTopic(prev => (prev ? { ...prev, interaction: res.data } : prev))
    } catch (err) {
      setTopic(prev => (prev ? { ...prev, interaction: previousInteraction } : prev))
      handleApiError(err, nextEnabled ? '点赞失败' : '取消点赞失败')
    } finally {
      setTopicLikePending(false)
    }
  }

  const handleToggleTopicFavorite = async () => {
    if (!id || !topic || !requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.favorited ?? false)
    setTopicFavoritePending(true)
    const previousInteraction = topic.interaction
    setTopic(prev => prev ? {
      ...prev,
      interaction: {
        likes_count: prev.interaction?.likes_count ?? 0,
        favorites_count: Math.max(0, (prev.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1)),
        shares_count: prev.interaction?.shares_count ?? 0,
        liked: prev.interaction?.liked ?? false,
        favorited: nextEnabled,
      },
    } : prev)
    try {
      const res = await topicsApi.favorite(id, nextEnabled)
      setTopic(prev => (prev ? { ...prev, interaction: res.data } : prev))
    } catch (err) {
      setTopic(prev => (prev ? { ...prev, interaction: previousInteraction } : prev))
      handleApiError(err, nextEnabled ? '收藏失败' : '取消收藏失败')
    } finally {
      setTopicFavoritePending(false)
    }
  }

  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      handleApiSuccess(successMessage)
      toast.success(successMessage)
    } catch {
      toast.error('复制链接失败')
    }
  }

  const handleShareTopic = async () => {
    if (!id || !topic) return
    const url = new URL(`${import.meta.env.BASE_URL}topics/${id}`, window.location.origin).toString()
    try {
      const res = await topicsApi.share(id)
      setTopic(prev => (prev ? { ...prev, interaction: res.data } : prev))
    } catch (err) {
      handleApiError(err, '记录分享失败')
    }
    const text = topic.title ? `${topic.title}\n${url}` : url
    await copyToClipboard(text, '话题链接已复制')
  }

  const handleLikePost = async (post: Post) => {
    if (!id || !requireCurrentUser()) return
    const nextEnabled = !(post.interaction?.liked ?? false)
    setPostLikePendingIds(prev => new Set(prev).add(post.id))
    const previousInteraction = post.interaction
    setPosts(prev => prev.map(item => item.id === post.id ? {
      ...item,
      interaction: {
        likes_count: Math.max(0, (item.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
        shares_count: item.interaction?.shares_count ?? 0,
        liked: nextEnabled,
      },
    } : item))
    try {
      const res = await postsApi.like(id, post.id, nextEnabled)
      setPosts(prev => prev.map(item => item.id === post.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      setPosts(prev => prev.map(item => item.id === post.id ? { ...item, interaction: previousInteraction } : item))
      handleApiError(err, nextEnabled ? '帖子点赞失败' : '取消帖子点赞失败')
    } finally {
      setPostLikePendingIds(prev => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
    }
  }

  const handleSharePost = async (post: Post) => {
    if (!id || !topic) return
    const url = new URL(`${import.meta.env.BASE_URL}topics/${id}#post-${post.id}`, window.location.origin).toString()
    try {
      const res = await postsApi.share(id, post.id)
      setPosts(prev => prev.map(item => item.id === post.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      handleApiError(err, '记录帖子分享失败')
    }
    const title = (post.body?.split('\n')[0]?.trim() || topic.title || '帖子').slice(0, 80)
    const text = title ? `${title}\n${url}` : url
    await copyToClipboard(text, '帖子链接已复制')
  }

  const throttledToggleTopicLike = useThrottledCallback(handleToggleTopicLike)
  const throttledToggleTopicFavorite = useThrottledCallback(handleToggleTopicFavorite)
  const throttledShareTopic = useThrottledCallback(handleShareTopic)
  const throttledLikePost = useThrottledCallbackByKey(handleLikePost, (p) => p.id)
  const throttledSharePost = useThrottledCallbackByKey(handleSharePost, (p) => p.id)

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !postText.trim() || !currentUser) return

    const mentionMatch = postText.match(/@(\w+)/)
    const mentionedName = mentionMatch?.[1]
    const mentionedExpert = topicExperts.find(e => e.name === mentionedName)
    const inReplyToId = replyingTo?.id ?? null
    const authorName = getUserDisplayName(currentUser)
    const now = new Date().toISOString()
    const tempUserPostId = `temp-${crypto.randomUUID()}`
    let tempReplyId: string | null = null
    const tempUserPost: Post = {
      id: tempUserPostId,
      topic_id: id,
      author: authorName,
      author_type: 'human',
      delete_token: null,
      owner_user_id: currentUser.id,
      owner_auth_type: null,
      expert_name: null,
      expert_label: null,
      body: postText,
      mentions: [],
      in_reply_to_id: inReplyToId,
      root_post_id: inReplyToId ?? tempUserPostId,
      depth: replyingTo ? (replyingTo.depth ?? 0) + 1 : 0,
      reply_count: 0,
      status: 'pending',
      created_at: now,
      interaction: { likes_count: 0, shares_count: 0, liked: false },
    }

    setSubmitting(true)
      setSubmitError('')
      try {
        if (mentionedExpert) {
        tempReplyId = `temp-${crypto.randomUUID()}`
        const tempReplyPost: Post = {
          id: tempReplyId,
          topic_id: id,
          author: mentionedExpert.name,
          author_type: 'agent',
          delete_token: null,
          owner_user_id: null,
          owner_auth_type: null,
          expert_name: mentionedExpert.name,
          expert_label: mentionedExpert.label,
          body: '',
          mentions: [],
          in_reply_to_id: tempUserPostId,
          root_post_id: tempUserPostId,
          depth: (tempUserPost.depth ?? 0) + 1,
          reply_count: 0,
          status: 'pending',
          created_at: now,
          interaction: { likes_count: 0, shares_count: 0, liked: false },
        }
        setPosts(prev => mergePosts(prev, [tempUserPost, tempReplyPost]))
        setTopic(prev => prev ? { ...prev, posts_count: (prev.posts_count ?? 0) + 2 } : prev)
        const res = await postsApi.mention(id, {
          author: authorName,
          body: postText,
          expert_name: mentionedExpert.name,
          in_reply_to_id: inReplyToId,
        })
        pendingRepliesRef.current.add(res.data.reply_post_id)
        setPosts(prev => {
          const withoutTemps = prev.filter(item => item.id !== tempUserPostId && item.id !== tempReplyId)
          return mergePosts(withoutTemps, [res.data.user_post, ...(res.data.reply_post ? [res.data.reply_post] : [])])
        })
        setReplyNextCursorByPostId(prev => ({
          ...prev,
          ...(inReplyToId ? { [inReplyToId]: null } : {}),
          [res.data.user_post.id]: res.data.reply_post ? '__more__' : null,
        }))
        handleApiSuccess(`已向 ${mentionedExpert.label} 提问，等待回复中…`)
      } else {
        setPosts(prev => mergePosts(prev, [tempUserPost]))
        setTopic(prev => prev ? { ...prev, posts_count: (prev.posts_count ?? 0) + 1 } : prev)
        const res = await postsApi.create(id, {
          author: authorName,
          body: postText,
          in_reply_to_id: inReplyToId,
        })
        setPosts(prev => {
          const withoutTemp = prev.filter(item => item.id !== tempUserPostId)
          return mergePosts(withoutTemp, [res.data.post, ...(res.data.parent_post ? [res.data.parent_post] : [])])
        })
        setReplyNextCursorByPostId(prev => ({
          ...prev,
          ...(inReplyToId ? { [inReplyToId]: null } : {}),
          [res.data.post.id]: null,
        }))
        handleApiSuccess('发送成功')
      }
      setPostText('')
      setSubmitError('')
      setReplyingTo(null)
    } catch (err) {
      setPosts(prev => prev.filter(item => item.id !== tempUserPostId && item.id !== tempReplyId))
      setTopic(prev => prev ? { ...prev, posts_count: Math.max(0, (prev.posts_count ?? 0) - (mentionedExpert ? 2 : 1)) } : prev)
      const message = handleApiError(err, '发送失败')
      setSubmitError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartDiscussion = async (
    model: string,
    skillList?: string[],
    mcpServerIds?: string[],
    expertNamesOverride?: string[]
  ) => {
    if (!id) return
    setStartingDiscussion(true)
    const req: StartDiscussionRequest = {
      num_rounds: 5,
      max_turns: 50000,
      max_budget_usd: 500.0,
      model,
      skill_list: skillList && skillList.length > 0 ? skillList : undefined,
      mcp_server_ids: mcpServerIds && mcpServerIds.length > 0 ? mcpServerIds : undefined,
      expert_names: expertNamesOverride && expertNamesOverride.length > 0 ? expertNamesOverride : undefined,
    }
    try {
      await discussionApi.start(id, req)
      setTopic(prev => prev ? { ...prev, discussion_status: 'running' } : prev)
      setPolling(true)
      startPolling()
      handleApiSuccess('讨论已启动')
    } catch (err) {
      handleApiError(err, '启动讨论失败')
    } finally {
      setStartingDiscussion(false)
    }
  }

  const startPolling = () => {
    if (!id || pollIntervalRef.current) return
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await discussionApi.getStatus(id)
        setTopic(prev => {
          if (!prev) return prev
          const nextResult = res.data.result
          // 讨论进行中时，若 API 返回空 result，保留已有 discussion_result，避免内容突然消失
          const keepPrev =
            res.data.status === 'running' &&
            (nextResult == null ||
              (typeof nextResult === 'object' && !(nextResult.discussion_history || nextResult.discussion_summary || (nextResult.turns_count ?? 0) > 0)))
          return {
            ...prev,
            discussion_status: res.data.status,
            discussion_result: keepPrev ? prev.discussion_result : nextResult,
          }
        })
        // 讨论进行中时，若 API 返回全零的 progress，保留已有 progress，避免轮次在 0 与真实值间跳动
        setProgress(prev => {
          const next = res.data.progress
          if (!next) return prev
          if (res.data.status !== 'running') return next
          const nextEmpty = (next.completed_turns ?? 0) === 0 && (next.current_round ?? 0) === 0
          if (nextEmpty && prev && ((prev.completed_turns ?? 0) > 0 || (prev.current_round ?? 0) > 0)) {
            return prev
          }
          return next
        })
        if (res.data.status === 'completed' || res.data.status === 'failed') {
          clearInterval(pollIntervalRef.current!)
          pollIntervalRef.current = null
          setPolling(false)
          setProgress(null)
          await loadTopic(id)
        }
      } catch (err) {
        console.error('Poll failed', err)
      }
    }, POLL_INTERVAL_MS)
  }

  const parseDiscussionHistory = (history: string): DiscussionPost[] => {
    const items: DiscussionPost[] = []
    // Support both formats: "## 第N轮 - " (legacy) and "## Round N - " (Resonnet)
    const sections = history.split(/(?=^## (?:第\d+轮|Round \d+) - )/m)
    for (const section of sections) {
      const trimmed = section.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^## (?:第(\d+)轮|Round (\d+)) - (.+)$/m)
      if (match) {
        const round = parseInt(match[1] || match[2])
        const expertLabel = match[3].trim()
        // Content starts after the heading line
        const headingEnd = trimmed.indexOf('\n')
        const content = headingEnd !== -1
          ? trimmed.slice(headingEnd).trim().replace(/\n\n---\s*$/, '').trim()
          : ''
        if (content) {
          const expertKey = getExpertKey(expertLabel)
          items.push({ round, expertName: expertLabel, expertKey, content, id: `round-${round}-${expertKey}` })
        }
      }
    }
    return items
  }

  const getExpertKey = (label: string): string => {
    // Chinese labels
    if (label.includes('物理')) return 'physicist'
    if (label.includes('生物')) return 'biologist'
    if (label.includes('计算机')) return 'computer_scientist'
    if (label.includes('伦理')) return 'ethicist'
    // English labels (Resonnet topic-lab)
    if (/physics|physicist/i.test(label)) return 'physicist'
    if (/biology|biologist/i.test(label)) return 'biologist'
    if (/computer|science/i.test(label)) return 'computer_scientist'
    if (/ethic|sociolog/i.test(label)) return 'ethicist'
    return 'default'
  }

  const getNavigationItems = (discussionPosts: DiscussionPost[]): NavigationItem[] => {
    const items: NavigationItem[] = []
    if (topic?.discussion_result?.discussion_summary) {
      items.push({ type: 'summary', label: '讨论总结', id: 'summary-section' })
    }
    const rounds = [...new Set(discussionPosts.map(p => p.round))].sort((a, b) => a - b)
    for (const round of rounds) {
      items.push({ type: 'round', round, label: `第 ${round} 轮`, id: `round-section-${round}` })
    }
    const postCount = topic?.posts_count ?? posts.length
    if (postCount > 0) {
      items.push({ type: 'posts', label: `跟贴 (${postCount})`, id: 'posts-section' })
    }
    return items
  }

  const scrollToSection = (sectionId: string) => {
    const element = sectionRefs.current[sectionId]
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setActiveNavId(sectionId)
    }
  }

  const renderMarkdown = (content: string, topicId?: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={topicId ? {
        img: ({ src = '', alt = '', ...props }) => (
          <img
            {...props}
            src={resolveTopicImageSrc(topicId, src, { format: 'webp', quality: 82 })}
            alt={alt}
            loading="lazy"
          />
        ),
      } : undefined}
    >
      {content}
    </ReactMarkdown>
  )

  if (loading) return (
    <div className="bg-white min-h-screen flex items-center justify-center">
      <p className="text-gray-500">加载中...</p>
    </div>
  )
  if (!topic) return (
    <div className="bg-white min-h-screen flex items-center justify-center">
      <p className="text-gray-500">话题不存在</p>
    </div>
  )

  const discussionHistory = topic.discussion_result?.discussion_history || ''
  const discussionPosts = parseDiscussionHistory(discussionHistory)
  const navItems = getNavigationItems(discussionPosts)
  const hasDiscussion = !!(topic.discussion_result || topic.discussion_status === 'running')
  const currentUserName = currentUser ? getUserDisplayName(currentUser) : ''
  const composerReplyName = replyingTo
    ? (replyingTo.author_type === 'agent' ? (replyingTo.expert_label ?? replyingTo.author) : replyingTo.author)
    : ''
  const composerReplyPreview = replyingTo?.body
    ? replyingTo.body.replace(/\s+/g, ' ').slice(0, 72)
    : ''
  const postsByRound: Record<number, DiscussionPost[]> = {}
  for (const post of discussionPosts) {
    if (!postsByRound[post.round]) postsByRound[post.round] = []
    postsByRound[post.round].push(post)
  }

  const isDiscussionMode = topic.mode === 'discussion' || topic.mode === 'both'
  const canMentionExperts = topic.discussion_status !== 'pending' && topic.discussion_status !== 'running' && topicExperts.length > 0
  const shouldShowReplyDock = topic.status === 'open' && replyingTo !== null
  const closeReplyDock = () => setReplyingTo(null)
  const categoryMeta = getTopicCategoryMeta(topic.category)
  const creatorMeta = topic.creator_name
    ? `发起人 ${topic.creator_name}${topic.creator_auth_type === 'openclaw_key' ? ' · OpenClaw' : ''}`
    : null
  const canDeletePost = (post: Post) => {
    if (currentUser?.is_admin) {
      return true
    }
    if (!currentUser || post.author_type !== 'human') {
      return false
    }
    if (post.owner_user_id != null) {
      return post.owner_user_id === currentUser.id
    }
    return post.author === currentUserName
  }
  const topicLikes = topic.interaction?.likes_count ?? 0
  const topicShares = topic.interaction?.shares_count ?? 0
  const topicFavorites = topic.interaction?.favorites_count ?? 0
  const topicLiked = topic.interaction?.liked ?? false
  const topicFavorited = topic.interaction?.favorited ?? false
  return (
    <div className="bg-white min-h-screen overflow-x-hidden">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 sm:py-5 flex flex-col lg:flex-row gap-5 lg:gap-7">
        {/* Main content */}
        <div className="flex-1 min-w-0 min-w-0 w-full">

          {/* Topic title & actions */}
          <div className="mb-4 sm:mb-5">
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">{topic.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-serif text-gray-400">
              {categoryMeta ? <span>板块 {categoryMeta.name}</span> : null}
              <span>创建于 {new Date(topic.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              {creatorMeta ? <span>{creatorMeta}</span> : null}
              {topic.discussion_status !== 'pending' ? <span>AI 话题讨论</span> : null}
              {topic.status === 'closed' ? <span>已关闭</span> : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <ReactionButton
                label="点赞"
                count={topicLikes}
                active={topicLiked}
                pending={topicLikePending}
                icon={<HeartIcon />}
                onClick={throttledToggleTopicLike}
              />
              <ReactionButton
                label="收藏"
                count={topicFavorites}
                active={topicFavorited}
                pending={topicFavoritePending}
                icon={<BookmarkIcon />}
                onClick={throttledToggleTopicFavorite}
              />
              <ReactionButton
                label="分享"
                count={topicShares}
                icon={<ShareIcon />}
                onClick={throttledShareTopic}
              />
            </div>
          </div>

          {/* Topic config - always visible for discussion mode */}
          {isDiscussionMode ? (
            <div className="border-l-2 border-gray-100 pl-4 sm:pl-5 py-2 mb-4 sm:mb-5">
              <TopicConfigTabs
                topicId={id!}
                topicBody={topic.body}
                onTopicBodyUpdated={(body) => {
                  setTopic((prev) => (prev ? { ...prev, body } : prev))
                }}
                onExpertsChange={() => {
                  void loadTopicExperts(id!)
                  void loadTopic(id!)
                }}
                onModeChange={() => loadTopic(id!)}
                onStartDiscussion={handleStartDiscussion}
                isStarting={startingDiscussion}
                isRunning={polling}
                isCompleted={topic.discussion_status === 'completed'}
                initialSkillIds={initialSkillIds}
                linkedSourceArticle={linkedSourceArticle}
                viewportWidth={viewportWidth}
                topicExpertNames={topic.expert_names ?? []}
              />
            </div>
          ) : null}

          <div className="border-t border-gray-100 my-5 sm:my-6" />

          {/* Mobile TOC - horizontal scroll, sticky */}
          {hasDiscussion && navItems.length > 0 && (
            <div className="lg:hidden sticky top-14 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-2 mb-4 bg-white/95 backdrop-blur border-b border-gray-100 overflow-x-auto scrollbar-hide overscroll-x-contain">
              <div className="flex gap-2 min-w-max">
                {navItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors touch-manipulation min-h-[36px] ${
                      activeNavId === item.id
                        ? 'bg-black text-white font-medium'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Discussion summary */}
          {topic.discussion_result?.discussion_summary && (
            <div
              id="summary-section"
              ref={el => { sectionRefs.current['summary-section'] = el }}
              className="mb-6 scroll-mt-6"
            >
              <div className="border-l-2 border-black pl-4 py-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm font-serif font-semibold text-black">讨论总结</span>
                  {topic.discussion_result.cost_usd != null && (
                    <span className="text-xs font-serif text-gray-400">
                      花费：¥{topic.discussion_result.cost_usd.toFixed(4)}
                    </span>
                  )}
                </div>
                <div className="markdown-content text-sm text-gray-700 font-serif">
                  {renderMarkdown(topic.discussion_result.discussion_summary, topic.id)}
                </div>
              </div>
            </div>
          )}

          {/* In-page progress indicator */}
          {topic.discussion_status === 'running' && (
            <div className="mb-5 sm:mb-6 border border-gray-200 rounded-lg p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4">
                <span className="spinner" />
                <span className="text-sm font-semibold text-gray-900">AI讨论进行中</span>
                {elapsedSeconds > 0 && (
                  <span className="text-xs text-gray-400 sm:ml-auto w-full sm:w-auto">
                    已运行 {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              {progress && progress.total_turns > 0 ? (
                <>
                  <div className="w-full h-1 bg-gray-100 mb-3">
                    <div
                      className="h-1 bg-black transition-all duration-500"
                      style={{ width: `${Math.min(100, (progress.completed_turns / progress.total_turns) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>
                      {progress.completed_turns > 0
                        ? `${progress.latest_speaker} 已完成发言`
                        : '等待角色开始发言...'}
                    </span>
                    <span>{progress.completed_turns} / {progress.total_turns} 轮次</span>
                  </div>
                  {progress.current_round > 0 && (
                    <div className="mt-2 text-xs text-gray-400">当前第 {progress.current_round} 轮</div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400">主持人正在协调角色，请稍候...</p>
              )}
            </div>
          )}

          {/* Roundtable discussion rounds - multi-column: 2+ on desktop, 1 on mobile */}
          {Object.keys(postsByRound).length > 0 && (
            <div className="mb-6 overflow-x-hidden">
              <h2 className="text-base font-semibold text-gray-900 mb-1">AI 话题讨论</h2>
              <div className="grid grid-cols-1 gap-5 mt-3">
              {Object.keys(postsByRound).map(roundKey => {
                const round = parseInt(roundKey)
                const roundPosts = postsByRound[round]
                return (
                  <div
                    key={round}
                    id={`round-section-${round}`}
                    ref={el => { sectionRefs.current[`round-section-${round}`] = el }}
                    className="min-w-0 w-full scroll-mt-6"
                  >
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider py-3 border-b border-gray-100">
                      第 {round} 轮
                    </div>
                    {roundPosts.map(post => (
                      <div key={post.id} className="flex gap-3 sm:gap-4 py-4 sm:py-5 border-b border-gray-100">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black text-white flex items-center justify-center text-xs font-serif flex-shrink-0">
                          {post.expertName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0 overflow-x-hidden">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-gray-900">{post.expertName}</span>
                            <span className="text-[10px] border border-gray-200 rounded text-gray-400 px-1">角色</span>
                          </div>
                          <div className="markdown-content text-sm text-gray-700 overflow-x-auto">
                            {renderMarkdown(post.content, topic.id)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
              </div>
            </div>
          )}

          {/* Posts thread */}
          <div
            id="posts-section"
            ref={el => { sectionRefs.current['posts-section'] = el }}
            className="scroll-mt-6"
          >
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              跟贴 ({topic.posts_count ?? posts.length})
              {canMentionExperts && (
                <span className="text-xs font-normal text-gray-400 ml-2">— 输入 @ 可追问角色</span>
              )}
            </h2>

            {postsLoading ? (
              <div className="space-y-3 py-2">
                <div className="h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
                <div className="h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
              </div>
            ) : null}

            {!postsLoading ? (
              <PostThread
                posts={posts}
                onReply={handleReplyToPost}
                onDelete={handleDeletePost}
                onLike={throttledLikePost}
                onShare={throttledSharePost}
                onLoadReplies={handleLoadReplies}
                canReply={topic.status === 'open'}
                canDelete={canDeletePost}
                canLike
                pendingLikePostIds={postLikePendingIds}
                replyLoadingPostIds={replyLoadingPostIds}
                replyNextCursorByPostId={replyNextCursorByPostId}
              />
            ) : null}

            {postNextCursor ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={loadMorePosts}
                  disabled={loadingMorePosts}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:border-gray-300 hover:text-black disabled:opacity-50"
                >
                  {loadingMorePosts ? '加载中...' : '加载更多帖子'}
                </button>
              </div>
            ) : null}

            {topic.status === 'open' ? (
              <div className="mt-6 pt-4 border-t border-gray-100">
                {replyingTo ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">正在回复 {composerReplyName}</span>
                      <span className="ml-1 text-gray-500">输入框已从底部弹出</span>
                    </div>
                  </div>
                ) : currentUser ? (
                  <form
                    onSubmit={handleSubmitPost}
                    className="ml-auto w-full max-w-[42rem] rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-500">发布跟贴</span>
                      {topic.discussion_status === 'running' && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">AI 讨论进行中，@专家回复需等待讨论完成</span>
                      )}
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                      <div className="flex items-end gap-3">
                        <div className="min-w-0 flex-1">
                          <MentionTextarea
                            value={postText}
                            onChange={(value) => {
                              setPostText(value)
                              if (submitError) setSubmitError('')
                            }}
                            experts={canMentionExperts ? topicExperts : []}
                            disabled={submitting}
                            textareaRef={composerTextareaRef}
                            placeholder={
                              topic.discussion_status === 'running'
                                ? '在这里继续讨论… 普通跟贴可直接发送，@专家回复需等待讨论完成'
                                : canMentionExperts
                                  ? '在这里继续讨论… 输入 @ 可追问角色'
                                  : '在这里继续讨论… 先完成一次 AI 讨论后才能 @ 追问角色'
                            }
                            textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                          />
                        </div>
                        <button
                          type="submit"
                          className="mb-1 shrink-0 rounded-xl bg-black px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
                          disabled={submitting || !postText.trim()}
                        >
                          {submitting ? '发送中...' : '发送'}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-gray-400">
                        {topic.discussion_status === 'running'
                          ? 'AI 讨论进行中，普通跟贴可直接发送，@专家回复需等待讨论完成。'
                          : (canMentionExperts ? '输入 @ 可直接追问角色。' : '输入内容后即可发布跟贴；完成一次 AI 讨论后才开放 @追问角色。')}
                      </p>
                      {submitError ? (
                        <p className="mt-2 text-xs text-red-600">{submitError}</p>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <div className="ml-auto w-full max-w-[42rem] rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-black">登录后即可发帖和回帖</p>
                        <p className="mt-1 text-xs text-gray-500">回复角色时会自动补上 @，并以你的账号名发布。</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to="/register"
                          state={{ from: location.pathname }}
                          className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black"
                        >
                          注册
                        </Link>
                        <Link
                          to="/login"
                          state={{ from: location.pathname }}
                          className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-900"
                        >
                          登录后回帖
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 pt-4 border-t border-gray-100 py-4 text-center">
                <p className="text-sm font-serif text-gray-400">此话题已关闭，无法跟帖</p>
              </div>
            )}
          </div>
        </div>

        {/* Right navigation sidebar - desktop */}
        {hasDiscussion && navItems.length > 0 && (
          <ResizableToc defaultWidth={192} side="right" className="sticky top-20 self-start hidden lg:flex flex-shrink-0">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              目录
            </div>
            {navItems.map(item => (
              <div
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`text-sm px-2 py-1.5 rounded cursor-pointer transition-colors mb-0.5 ${
                  activeNavId === item.id
                    ? 'text-gray-900 font-medium'
                    : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                {item.label}
              </div>
            ))}
          </ResizableToc>
        )}
      </div>

      {shouldShowReplyDock && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-end px-4 sm:px-6 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          onClick={closeReplyDock}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/95 to-transparent" />
          <div className="relative w-full max-w-[34rem]">
            {currentUser ? (
              <form
                onSubmit={handleSubmitPost}
                onClick={(event) => event.stopPropagation()}
                className="pointer-events-auto ml-auto w-full max-w-[34rem] animate-fade-in rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-16px_40px_rgba(0,0,0,0.08)] backdrop-blur"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                    <span className="rounded-full bg-black px-2.5 py-1 text-white">正在回复：{composerReplyName}</span>
                    {topic.discussion_status === 'running' && (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">AI 讨论进行中，@专家回复需等待讨论完成</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeReplyDock}
                    className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    aria-label="关闭回复窗口"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">回复 {composerReplyName}</span>
                    {composerReplyPreview ? (
                      <span className="ml-1 text-gray-500">
                        · {composerReplyPreview}{replyingTo.body.length > composerReplyPreview.length ? '...' : ''}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                  <div className="flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <MentionTextarea
                        value={postText}
                        onChange={(value) => {
                          setPostText(value)
                          if (submitError) setSubmitError('')
                        }}
                        experts={canMentionExperts ? topicExperts : []}
                        disabled={submitting}
                        textareaRef={composerTextareaRef}
                        placeholder={
                          topic.discussion_status === 'running'
                            ? '在这里继续讨论… 普通跟贴可直接发送，@专家回复需等待讨论完成'
                            : canMentionExperts
                              ? '在这里继续讨论… 回复角色时会自动补上 @'
                              : '在这里继续讨论… 先完成一次 AI 讨论后才能 @ 追问角色'
                        }
                        textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="mb-1 shrink-0 rounded-xl bg-black px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
                      disabled={submitting || !postText.trim()}
                    >
                      {submitting ? '发送中...' : '发送'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    {topic.discussion_status === 'running'
                      ? 'AI 讨论进行中，普通跟贴可直接发送，@专家回复需等待讨论完成。'
                      : (canMentionExperts ? '输入 @ 可直接追问角色，回复角色时会自动带上 @。' : '输入内容后即可发布跟贴；完成一次 AI 讨论后才开放 @追问角色。')}
                  </p>
                  {submitError ? (
                    <p className="mt-2 text-xs text-red-600">{submitError}</p>
                  ) : null}
                </div>
              </form>
            ) : (
              <div
                onClick={(event) => event.stopPropagation()}
                className="pointer-events-auto ml-auto w-full max-w-[34rem] animate-fade-in rounded-[26px] border border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-16px_40px_rgba(0,0,0,0.08)] backdrop-blur"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-black">登录后即可发帖和回帖</p>
                    <p className="mt-1 text-xs text-gray-500">回复角色时会自动补上 @，并以你的账号名发布。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeReplyDock}
                      className="rounded-xl px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-black"
                    >
                      关闭
                    </button>
                    <Link
                      to="/register"
                      state={{ from: location.pathname }}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black"
                    >
                      注册
                    </Link>
                    <Link
                      to="/login"
                      state={{ from: location.pathname }}
                      className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-900"
                    >
                      登录后回帖
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

function getUserDisplayName(user: User): string {
  return user.username?.trim() || user.phone || `用户-${user.id}`
}

function extractSourceArticleId(topicBody: string): number | null {
  const match = topicBody.match(/^- article_id:\s*(\d+)\s*$/m)
  if (!match) return null
  const articleId = Number.parseInt(match[1], 10)
  return Number.isFinite(articleId) && articleId > 0 ? articleId : null
}

function extractBulletValue(topicBody: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^- ${escaped}：\\s*(.+)$`, 'm')
  const match = topicBody.match(regex)
  return match?.[1]?.trim() ?? ''
}

function buildSourcePreviewFromTopicBody(topicBody: string, articleId: number): SourceFeedArticle {
  return {
    id: articleId,
    title: extractBulletValue(topicBody, '标题') || `信源 ${articleId}`,
    source_feed_name: extractBulletValue(topicBody, '来源') || '未知来源',
    source_type: 'source-feed',
    url: extractBulletValue(topicBody, '原文链接'),
    pic_url: null,
    description: extractBulletValue(topicBody, '原文摘要'),
    publish_time: extractBulletValue(topicBody, '发布时间'),
    created_at: '',
  }
}

function ensureExpertMention(text: string, expertName: string): string {
  const mention = `@${expertName}`
  const trimmed = text.trimStart()
  if (!trimmed) return `${mention} `
  if (new RegExp(`^@${escapeRegExp(expertName)}(?:\\s|$)`).test(trimmed)) {
    return text
  }
  return `${mention} ${trimmed}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
