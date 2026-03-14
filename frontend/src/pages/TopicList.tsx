import { useEffect, useState } from 'react'
import { TOPIC_CATEGORIES, topicsApi, TopicListItem } from '../api/client'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { handleApiError } from '../utils/errorHandler'
import OpenClawSkillCard from '../components/OpenClawSkillCard'
import TopicCard from '../components/TopicCard'
import { toast } from '../utils/toast'

export default function TopicList() {
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingTopicLikeIds, setPendingTopicLikeIds] = useState<Set<string>>(new Set())
  const [pendingTopicFavoriteIds, setPendingTopicFavoriteIds] = useState<Set<string>>(new Set())

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
    loadTopics()
  }, [selectedCategory])

  const loadTopics = async () => {
    try {
      const res = await topicsApi.list({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
      })
      setTopics(res.data)
    } catch (err) {
      if (loading) {
        handleApiError(err, '加载话题列表失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteTopic = async (topicId: string) => {
    if (!currentUser) return
    const confirmed = window.confirm('确认删除这个话题？')
    if (!confirmed) return
    try {
      await topicsApi.delete(topicId)
      await loadTopics()
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
      await navigator.clipboard.writeText(url)
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
          {topics.map((topic) => {
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
      </div>
    </div>
  )
}
