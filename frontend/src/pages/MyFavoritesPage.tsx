import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  FavoriteCategory,
  sourceFeedApi,
  SourceFeedArticle,
  TopicListItem,
  topicsApi,
} from '../api/client'
import { tokenManager } from '../api/auth'
import LibraryPageLayout from '../components/LibraryPageLayout'
import SourceArticleCard from '../components/SourceArticleCard'
import TopicCard from '../components/TopicCard'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

type FavoriteTab = 'topics' | 'sources'

export default function MyFavoritesPage() {
  const [tab, setTab] = useState<FavoriteTab>('topics')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [sourceArticles, setSourceArticles] = useState<SourceFeedArticle[]>([])
  const [categories, setCategories] = useState<FavoriteCategory[]>([])
  const [pendingTopicLikeIds, setPendingTopicLikeIds] = useState<Set<string>>(new Set())
  const [pendingTopicFavoriteIds, setPendingTopicFavoriteIds] = useState<Set<string>>(new Set())
  const [pendingSourceLikeIds, setPendingSourceLikeIds] = useState<Set<number>>(new Set())
  const [pendingSourceFavoriteIds, setPendingSourceFavoriteIds] = useState<Set<number>>(new Set())
  const [pendingTopicCategoryIds, setPendingTopicCategoryIds] = useState<Set<string>>(new Set())
  const [pendingSourceCategoryIds, setPendingSourceCategoryIds] = useState<Set<number>>(new Set())
  const token = tokenManager.get()

  const loadFavorites = async () => {
    setLoading(true)
    try {
      const res = await topicsApi.getFavorites()
      setTopics(res.data.topics)
      setSourceArticles(res.data.source_articles)
      setCategories(res.data.categories)
    } catch (err) {
      handleApiError(err, '加载收藏失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      return
    }
    void loadFavorites()
  }, [token])

  if (!token) {
    return <Navigate to="/login" replace state={{ from: '/favorites' }} />
  }

  const filteredTopics = useMemo(() => {
    if (selectedCategoryId === 'all') return topics
    return topics.filter((item) => item.favorite_category_ids?.includes(selectedCategoryId))
  }, [topics, selectedCategoryId])

  const filteredSourceArticles = useMemo(() => {
    if (selectedCategoryId === 'all') return sourceArticles
    return sourceArticles.filter((item) => item.favorite_category_ids?.includes(selectedCategoryId))
  }, [sourceArticles, selectedCategoryId])

  const sections = useMemo(() => ([
    {
      id: 'topics' as const,
      label: '话题收藏',
      description: selectedCategoryId === 'all'
        ? `已收藏 ${filteredTopics.length} 个话题`
        : `该分类下 ${filteredTopics.length} 个话题`,
    },
    {
      id: 'sources' as const,
      label: '信源收藏',
      description: selectedCategoryId === 'all'
        ? `已收藏 ${filteredSourceArticles.length} 条信源`
        : `该分类下 ${filteredSourceArticles.length} 条信源`,
    },
  ]), [filteredSourceArticles.length, filteredTopics.length, selectedCategoryId])

  const activeSection = sections.find((item) => item.id === tab) ?? sections[0]
  const activeCategory = selectedCategoryId === 'all'
    ? null
    : categories.find((item) => item.id === selectedCategoryId) ?? null

  const refreshAfterCategoryMutation = async () => {
    await loadFavorites()
  }

  const handleShareTopic = async (topicId: string) => {
    try {
      const res = await topicsApi.share(topicId)
      setTopics(prev => prev.map(item => item.id === topicId ? { ...item, interaction: res.data } : item))
    } catch (err) {
      handleApiError(err, '记录话题分享失败')
    }
    try {
      const url = new URL(`${import.meta.env.BASE_URL}topics/${topicId}`, window.location.origin).toString()
      await navigator.clipboard.writeText(url)
      toast.success('话题链接已复制')
    } catch {
      toast.error('复制链接失败')
    }
  }

  const handleLikeTopic = async (topic: TopicListItem) => {
    const nextEnabled = !(topic.interaction?.liked ?? false)
    setPendingTopicLikeIds(prev => new Set(prev).add(topic.id))
    try {
      const res = await topicsApi.like(topic.id, nextEnabled)
      setTopics(prev => prev.map(item => item.id === topic.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      handleApiError(err, nextEnabled ? '话题点赞失败' : '取消话题点赞失败')
    } finally {
      setPendingTopicLikeIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleFavoriteTopic = async (topic: TopicListItem) => {
    const nextEnabled = !(topic.interaction?.favorited ?? false)
    setPendingTopicFavoriteIds(prev => new Set(prev).add(topic.id))
    try {
      await topicsApi.favorite(topic.id, nextEnabled)
      await loadFavorites()
    } catch (err) {
      handleApiError(err, nextEnabled ? '话题收藏失败' : '取消话题收藏失败')
    } finally {
      setPendingTopicFavoriteIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleShareSource = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('信源链接已复制')
    } catch {
      toast.error('复制链接失败')
    }
  }

  const buildSourceActionPayload = (article: SourceFeedArticle, enabled: boolean) => ({
    enabled,
    title: article.title,
    source_feed_name: article.source_feed_name,
    source_type: article.source_type,
    url: article.url,
    pic_url: article.pic_url ?? null,
    description: article.description,
    publish_time: article.publish_time,
    created_at: article.created_at,
  })

  const updateArticleInteraction = (articleId: number, interaction: SourceFeedArticle['interaction']) => {
    setSourceArticles(prev => prev.map(item => item.id === articleId ? { ...item, interaction } : item))
  }

  const handleLikeSource = async (article: SourceFeedArticle) => {
    const nextEnabled = !(article.interaction?.liked ?? false)
    setPendingSourceLikeIds(prev => new Set(prev).add(article.id))
    try {
      const res = await sourceFeedApi.like(article.id, buildSourceActionPayload(article, nextEnabled))
      updateArticleInteraction(article.id, res.data)
    } catch (err) {
      handleApiError(err, nextEnabled ? '信源点赞失败' : '取消信源点赞失败')
    } finally {
      setPendingSourceLikeIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  const handleFavoriteSource = async (article: SourceFeedArticle) => {
    const nextEnabled = !(article.interaction?.favorited ?? false)
    setPendingSourceFavoriteIds(prev => new Set(prev).add(article.id))
    try {
      await sourceFeedApi.favorite(article.id, buildSourceActionPayload(article, nextEnabled))
      await loadFavorites()
    } catch (err) {
      handleApiError(err, nextEnabled ? '信源收藏失败' : '取消信源收藏失败')
    } finally {
      setPendingSourceFavoriteIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  const handleShareSourceArticle = async (article: SourceFeedArticle) => {
    try {
      const res = await sourceFeedApi.share(article.id)
      updateArticleInteraction(article.id, res.data)
    } catch (err) {
      handleApiError(err, '记录信源分享失败')
    }
    await handleShareSource(article.url)
  }

  const createCategoryAndAssign = async (
    name: string,
    item: TopicListItem | SourceFeedArticle,
    type: FavoriteTab,
  ) => {
    try {
      if (type === 'topics') {
        await topicsApi.classifyFavorites({ category_name: name, topic_ids: [(item as TopicListItem).id] })
      } else {
        await topicsApi.classifyFavorites({ category_name: name, article_ids: [(item as SourceFeedArticle).id] })
      }
      toast.success('已创建收藏分类')
      await refreshAfterCategoryMutation()
    } catch (err) {
      handleApiError(err, '创建收藏分类失败')
    }
  }

  const handleAssignTopicCategory = async (topic: TopicListItem, categoryId: string) => {
    setPendingTopicCategoryIds(prev => new Set(prev).add(topic.id))
    try {
      await topicsApi.assignTopicToFavoriteCategory(categoryId, topic.id)
      await refreshAfterCategoryMutation()
    } catch (err) {
      handleApiError(err, '话题分类失败')
    } finally {
      setPendingTopicCategoryIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleUnassignTopicCategory = async (topic: TopicListItem, categoryId: string) => {
    setPendingTopicCategoryIds(prev => new Set(prev).add(topic.id))
    try {
      await topicsApi.unassignTopicFromFavoriteCategory(categoryId, topic.id)
      await refreshAfterCategoryMutation()
    } catch (err) {
      handleApiError(err, '移出话题分类失败')
    } finally {
      setPendingTopicCategoryIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleAssignSourceCategory = async (article: SourceFeedArticle, categoryId: string) => {
    setPendingSourceCategoryIds(prev => new Set(prev).add(article.id))
    try {
      await topicsApi.assignSourceToFavoriteCategory(categoryId, article.id)
      await refreshAfterCategoryMutation()
    } catch (err) {
      handleApiError(err, '信源分类失败')
    } finally {
      setPendingSourceCategoryIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  const handleUnassignSourceCategory = async (article: SourceFeedArticle, categoryId: string) => {
    setPendingSourceCategoryIds(prev => new Set(prev).add(article.id))
    try {
      await topicsApi.unassignSourceFromFavoriteCategory(categoryId, article.id)
      await refreshAfterCategoryMutation()
    } catch (err) {
      handleApiError(err, '移出信源分类失败')
    } finally {
      setPendingSourceCategoryIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  return (
    <LibraryPageLayout title="我的收藏">
      <div className="flex flex-col md:flex-row md:items-start md:gap-8">
        <div className="relative md:w-[220px] md:flex-shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-200 bg-white px-4 py-3 md:flex-col md:items-stretch md:gap-1 md:border-b-0 md:bg-transparent md:px-0 md:py-0 md:sticky md:top-20 scrollbar-hide">
            {sections.map((item) => {
              const active = item.id === activeSection.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`block rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors md:w-full ${
                    active
                      ? 'bg-gray-100 text-gray-900 font-semibold'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
            <div className="hidden h-px bg-gray-200 md:my-3 md:block" />
            <div className="hidden md:block px-3 text-[11px] tracking-[0.14em] text-gray-400">分类</div>
            <button
              type="button"
              onClick={() => setSelectedCategoryId('all')}
              className={`block rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors md:w-full ${
                selectedCategoryId === 'all'
                  ? 'bg-gray-100 text-gray-900 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              全部收藏
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategoryId(category.id)}
                className={`hidden rounded-md px-3 py-2 text-left text-sm transition-colors md:block ${
                  selectedCategoryId === category.id
                    ? 'bg-gray-100 text-gray-900 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <div>{category.name}</div>
                <div className="mt-0.5 text-xs text-gray-400">
                  {tab === 'topics' ? category.topics_count : category.source_articles_count}
                </div>
              </button>
            ))}
          </div>
          <div className="md:hidden absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent pointer-events-none" aria-hidden />
        </div>

        <div className="flex-1 min-w-0 pt-5 md:pt-0">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-600">{activeSection.description}</p>
            <div className="flex flex-wrap gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selectedCategoryId === 'all'
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                全部
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(category.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    selectedCategoryId === category.id
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {activeCategory ? (
            <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-sm font-semibold text-gray-900">{activeCategory.name}</div>
              <div className="mt-1 text-sm text-gray-500">{activeCategory.description || '这个分类还没有补充说明。'}</div>
            </div>
          ) : null}

          {loading ? <p className="font-serif text-gray-500">加载中...</p> : null}

          {!loading && tab === 'topics' && filteredTopics.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-gray-200 bg-gray-50 px-5 py-8">
              <p className="font-serif text-gray-700">
                {selectedCategoryId === 'all' ? '还没有收藏话题。' : '这个分类里还没有话题。'}
              </p>
              <p className="mt-2 text-sm text-gray-500">
                {selectedCategoryId === 'all'
                  ? '现在去话题列表或话题详情页点一下收藏，内容就会出现在这里。'
                  : '先在某个已收藏话题卡片里把它加入这个分类。'}
              </p>
              <Link to="/" className="mt-4 inline-flex rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black">
                去看话题
              </Link>
            </div>
          ) : null}

          {!loading && tab === 'sources' && filteredSourceArticles.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-gray-200 bg-gray-50 px-5 py-8">
              <p className="font-serif text-gray-700">
                {selectedCategoryId === 'all' ? '还没有收藏信源。' : '这个分类里还没有信源。'}
              </p>
              <p className="mt-2 text-sm text-gray-500">
                {selectedCategoryId === 'all'
                  ? '现在去信源流点一下收藏，内容就会出现在这里。'
                  : '先在某条已收藏信源卡片里把它加入这个分类。'}
              </p>
              <Link to="/source-feed" className="mt-4 inline-flex rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black">
                去看信源
              </Link>
            </div>
          ) : null}

          {!loading && tab === 'topics' && filteredTopics.length > 0 ? (
            <div className="grid gap-4">
              {filteredTopics.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  onLike={handleLikeTopic}
                  onFavorite={handleFavoriteTopic}
                  onShare={(item) => handleShareTopic(item.id)}
                  likePending={pendingTopicLikeIds.has(topic.id)}
                  favoritePending={pendingTopicFavoriteIds.has(topic.id)}
                  favoriteCategories={categories}
                  categoryPending={pendingTopicCategoryIds.has(topic.id)}
                  onAssignCategory={handleAssignTopicCategory}
                  onUnassignCategory={handleUnassignTopicCategory}
                  onCreateCategory={(item, name) => createCategoryAndAssign(name, item, 'topics')}
                />
              ))}
            </div>
          ) : null}

          {!loading && tab === 'sources' && filteredSourceArticles.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredSourceArticles.map((article) => (
                <SourceArticleCard
                  key={article.id}
                  article={article}
                  onLike={handleLikeSource}
                  onFavorite={handleFavoriteSource}
                  onShare={handleShareSourceArticle}
                  likePending={pendingSourceLikeIds.has(article.id)}
                  favoritePending={pendingSourceFavoriteIds.has(article.id)}
                  favoriteCategories={categories}
                  categoryPending={pendingSourceCategoryIds.has(article.id)}
                  onAssignCategory={handleAssignSourceCategory}
                  onUnassignCategory={handleUnassignSourceCategory}
                  onCreateCategory={(item, name) => createCategoryAndAssign(name, item, 'sources')}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </LibraryPageLayout>
  )
}
