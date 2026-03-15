import { useEffect, useRef, useState } from 'react'
import { TOPIC_CATEGORIES, topicsApi, TopicListItem } from '../api/client'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { handleApiError } from '../utils/errorHandler'
import OpenClawSkillCard from '../components/OpenClawSkillCard'
import TopicCard from '../components/TopicCard'
import { toast } from '../utils/toast'

const PAGE_SIZE = 20
const INITIAL_VISIBLE_TOPICS = 18
const VISIBLE_TOPICS_STEP = 18

export default function TopicList() {
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TOPICS)
  const [pendingTopicLikeIds, setPendingTopicLikeIds] = useState<Set<string>>(new Set())
  const [pendingTopicFavoriteIds, setPendingTopicFavoriteIds] = useState<Set<string>>(new Set())
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const revealMoreRef = useRef<HTMLDivElement | null>(null)

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
    void loadTopics()
  }, [selectedCategory])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_TOPICS)
  }, [selectedCategory, topics.length])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !nextCursor || loading || loadingMore) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreTopics()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [nextCursor, loading, loadingMore, selectedCategory, topics.length])

  useEffect(() => {
    const node = revealMoreRef.current
    if (!node || visibleCount >= topics.length) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((prev) => Math.min(prev + VISIBLE_TOPICS_STEP, topics.length))
      }
    }, { rootMargin: '280px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [topics.length, visibleCount])

  const loadTopics = async () => {
    setLoading(true)
    try {
      const res = await topicsApi.list({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        limit: PAGE_SIZE,
      })
      setTopics(res.data.items)
      setVisibleCount(INITIAL_VISIBLE_TOPICS)
      setNextCursor(res.data.next_cursor)
    } catch (err) {
      handleApiError(err, '加载话题列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadMoreTopics = async () => {
    if (!nextCursor || loadingMore) {
      return
    }
    setLoadingMore(true)
    try {
      const res = await topicsApi.list({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      })
      setTopics((prev) => [...prev, ...res.data.items.filter((item) => !prev.some((existing) => existing.id === item.id))])
      setNextCursor(res.data.next_cursor)
    } catch (err) {
      handleApiError(err, '加载更多话题失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const handleDeleteTopic = async (topicId: string) => {
    if (!currentUser) return
    const confirmed = window.confirm('确认删除这个话题？')
    if (!confirmed) return
    try {
      await topicsApi.delete(topicId)
      setTopics((prev) => prev.filter((topic) => topic.id !== topicId))
      if (topics.length <= 1) {
        void loadTopics()
      }
    } catch (err) {
      handleApiError(err, '删除话题失败')
    }
  }

  const requireCurrentUser = () => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
  }

  const updateTopicInteraction = (topicId: string, interaction: TopicListItem['interaction']) => {
    setTopics(prev => prev.map(item => item.id === topicId ? { ...item, interaction } : item))
  }

  const handleTopicLike = async (topic: TopicListItem) => {
    if (!requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.liked ?? false)
    setPendingTopicLikeIds(prev => new Set(prev).add(topic.id))
    const previousInteraction = topic.interaction
    updateTopicInteraction(topic.id, {
      likes_count: Math.max(0, (topic.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
      favorites_count: topic.interaction?.favorites_count ?? 0,
      shares_count: topic.interaction?.shares_count ?? 0,
      liked: nextEnabled,
      favorited: topic.interaction?.favorited ?? false,
    })
    try {
      const res = await topicsApi.like(topic.id, nextEnabled)
      updateTopicInteraction(topic.id, res.data)
    } catch (err) {
      updateTopicInteraction(topic.id, previousInteraction)
      handleApiError(err, nextEnabled ? '点赞失败' : '取消点赞失败')
    } finally {
      setPendingTopicLikeIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleTopicFavorite = async (topic: TopicListItem) => {
    if (!requireCurrentUser()) return
    const nextEnabled = !(topic.interaction?.favorited ?? false)
    setPendingTopicFavoriteIds(prev => new Set(prev).add(topic.id))
    const previousInteraction = topic.interaction
    updateTopicInteraction(topic.id, {
      likes_count: topic.interaction?.likes_count ?? 0,
      favorites_count: Math.max(0, (topic.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1)),
      shares_count: topic.interaction?.shares_count ?? 0,
      liked: topic.interaction?.liked ?? false,
      favorited: nextEnabled,
    })
    try {
      const res = await topicsApi.favorite(topic.id, nextEnabled)
      updateTopicInteraction(topic.id, res.data)
    } catch (err) {
      updateTopicInteraction(topic.id, previousInteraction)
      handleApiError(err, nextEnabled ? '收藏失败' : '取消收藏失败')
    } finally {
      setPendingTopicFavoriteIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleTopicShare = async (topic: TopicListItem) => {
    try {
      const res = await topicsApi.share(topic.id)
      updateTopicInteraction(topic.id, res.data)
    } catch (err) {
      handleApiError(err, '记录分享失败')
    }
    try {
      const url = new URL(`${import.meta.env.BASE_URL}topics/${topic.id}`, window.location.origin).toString()
      const text = topic.title ? `${topic.title}\n${url}` : url
      await navigator.clipboard.writeText(text)
      toast.success('话题链接已复制')
    } catch {
      toast.error('复制链接失败')
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <OpenClawSkillCard />

        <div className="flex items-center justify-between mb-8 sm:mb-12">
          <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">话题列表</h1>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              selectedCategory === 'all'
                ? 'border-black bg-black text-white'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-black'
            }`}
          >
            全部
          </button>
          {TOPIC_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setSelectedCategory(category.id)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                selectedCategory === category.id
                  ? 'border-black bg-black text-white'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-black'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        {loading && (
          <p className="text-gray-500 font-serif">加载中...</p>
        )}

        {!loading && topics.length === 0 && (
          <p className="text-gray-500 font-serif">当前板块暂无话题</p>
        )}

        <div className="flex flex-col gap-4">
          {topics.slice(0, visibleCount).map((topic) => {
            const canDeleteTopic = Boolean(currentUser && (currentUser.is_admin || (topic.creator_user_id != null && topic.creator_user_id === currentUser.id)))
            return (
              <TopicCard
                key={topic.id}
                topic={topic}
                canDelete={canDeleteTopic}
                onDelete={handleDeleteTopic}
                onLike={handleTopicLike}
                onFavorite={handleTopicFavorite}
                onShare={handleTopicShare}
                likePending={pendingTopicLikeIds.has(topic.id)}
                favoritePending={pendingTopicFavoriteIds.has(topic.id)}
              />
            )
          })}
        </div>

        {visibleCount < topics.length ? (
          <div ref={revealMoreRef} className="py-6 text-center">
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => Math.min(prev + VISIBLE_TOPICS_STEP, topics.length))}
              className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 hover:border-gray-300 hover:text-black"
            >
              继续显示更多卡片
            </button>
          </div>
        ) : null}

        {!loading && (nextCursor || loadingMore) ? (
          <div ref={loadMoreRef} className="py-8 text-center text-sm text-gray-500">
            {loadingMore ? '加载更多话题中...' : '继续下滑加载更多'}
          </div>
        ) : null}

        {!loading && nextCursor ? (
          <div className="pb-6 text-center">
            <button
              type="button"
              onClick={() => { void loadMoreTopics() }}
              disabled={loadingMore}
              className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black disabled:opacity-50"
            >
              {loadingMore ? '加载中...' : '加载更多'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
