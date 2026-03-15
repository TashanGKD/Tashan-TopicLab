import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  FavoriteCategory,
  FavoriteCategoryItemsPage,
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

function updateCategoryList(categories: FavoriteCategory[], updated: FavoriteCategory) {
  return categories.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
}

export default function MyFavoritesPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<FavoriteTab>('topics')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [sourceArticles, setSourceArticles] = useState<SourceFeedArticle[]>([])
  const [topicNextCursor, setTopicNextCursor] = useState<string | null>(null)
  const [sourceNextCursor, setSourceNextCursor] = useState<string | null>(null)
  const [categories, setCategories] = useState<FavoriteCategory[]>([])
  const [pendingTopicLikeIds, setPendingTopicLikeIds] = useState<Set<string>>(new Set())
  const [pendingTopicFavoriteIds, setPendingTopicFavoriteIds] = useState<Set<string>>(new Set())
  const [pendingSourceLikeIds, setPendingSourceLikeIds] = useState<Set<number>>(new Set())
  const [pendingSourceFavoriteIds, setPendingSourceFavoriteIds] = useState<Set<number>>(new Set())
  const [pendingSourceReplyIds, setPendingSourceReplyIds] = useState<Set<number>>(new Set())
  const [pendingTopicCategoryIds, setPendingTopicCategoryIds] = useState<Set<string>>(new Set())
  const [pendingSourceCategoryIds, setPendingSourceCategoryIds] = useState<Set<number>>(new Set())
  const token = tokenManager.get()

  const activeCategory = selectedCategoryId === 'all'
    ? null
    : categories.find((item) => item.id === selectedCategoryId) ?? null

  const loadCategories = async () => {
    const res = await topicsApi.listFavoriteCategories()
    setCategories(res.data.list)
    return res.data.list
  }

  const loadItems = async (options?: { append?: boolean; explicitTab?: FavoriteTab; explicitCategoryId?: string }) => {
    const currentTab = options?.explicitTab ?? tab
    const currentCategoryId = options?.explicitCategoryId ?? selectedCategoryId
    const append = options?.append ?? false
    const cursor = currentTab === 'topics' ? topicNextCursor : sourceNextCursor
    if (append && !cursor) {
      return
    }

    const request = currentCategoryId === 'all'
      ? topicsApi.getRecentFavorites(currentTab, { cursor: append ? cursor : undefined, limit: 20 })
      : topicsApi.getFavoriteCategoryItems(currentCategoryId, currentTab, { cursor: append ? cursor : undefined, limit: 20 })

    const res = await request
    const payload = res.data as FavoriteCategoryItemsPage
    if (currentTab === 'topics') {
      const items = payload.items as TopicListItem[]
      setTopics((prev) => (append ? [...prev, ...items] : items))
      setTopicNextCursor(payload.next_cursor)
    } else {
      const items = payload.items as SourceFeedArticle[]
      setSourceArticles((prev) => (append ? [...prev, ...items] : items))
      setSourceNextCursor(payload.next_cursor)
    }
  }

  useEffect(() => {
    if (!token) {
      return
    }
    let cancelled = false
    const bootstrap = async () => {
      setLoading(true)
      try {
        const loadedCategories = await loadCategories()
        if (cancelled) {
          return
        }
        if (selectedCategoryId !== 'all' && !loadedCategories.some((item) => item.id === selectedCategoryId)) {
          setSelectedCategoryId('all')
        }
      } catch (err) {
        handleApiError(err, '加载收藏失败')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      return
    }
    let cancelled = false
    const syncVisibleItems = async () => {
      setLoading(true)
      try {
        await loadItems({ explicitCategoryId: selectedCategoryId, explicitTab: tab })
      } catch (err) {
        if (!cancelled) {
          handleApiError(err, '加载收藏失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void syncVisibleItems()
    return () => {
      cancelled = true
    }
  }, [token, selectedCategoryId, tab])

  if (!token) {
    return <Navigate to="/login" replace state={{ from: '/favorites' }} />
  }

  const currentTopicsCount = activeCategory ? activeCategory.topics_count : topics.length
  const currentSourcesCount = activeCategory ? activeCategory.source_articles_count : sourceArticles.length

  const sections = useMemo(() => ([
    {
      id: 'topics' as const,
      label: '话题收藏',
      description: selectedCategoryId === 'all'
        ? `已加载 ${topics.length} 个话题收藏`
        : `该分类共 ${currentTopicsCount} 个话题`,
    },
    {
      id: 'sources' as const,
      label: '信源收藏',
      description: selectedCategoryId === 'all'
        ? `已加载 ${sourceArticles.length} 条信源收藏`
        : `该分类共 ${currentSourcesCount} 条信源`,
    },
  ]), [currentSourcesCount, currentTopicsCount, selectedCategoryId, sourceArticles.length, topics.length])

  const activeSection = sections.find((item) => item.id === tab) ?? sections[0]

  const refreshCategoriesOnly = async () => {
    try {
      await loadCategories()
    } catch (err) {
      handleApiError(err, '刷新收藏分类失败')
    }
  }

  const refreshCurrentItems = async () => {
    try {
      await loadItems({ explicitCategoryId: selectedCategoryId, explicitTab: tab })
    } catch (err) {
      handleApiError(err, '刷新收藏列表失败')
    }
  }

  const handleLoadMore = async () => {
    const hasNextCursor = tab === 'topics' ? topicNextCursor : sourceNextCursor
    if (!hasNextCursor || loadingMore) {
      return
    }
    setLoadingMore(true)
    try {
      await loadItems({ append: true })
    } catch (err) {
      handleApiError(err, '加载更多收藏失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const handleShareTopic = async (topic: TopicListItem) => {
    try {
      const res = await topicsApi.share(topic.id)
      setTopics(prev => prev.map(item => item.id === topic.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      handleApiError(err, '记录话题分享失败')
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

  const handleLikeTopic = async (topic: TopicListItem) => {
    const nextEnabled = !(topic.interaction?.liked ?? false)
    setPendingTopicLikeIds(prev => new Set(prev).add(topic.id))
    const previousInteraction = topic.interaction
    setTopics(prev => prev.map(item => item.id === topic.id ? {
      ...item,
      interaction: {
        likes_count: Math.max(0, (item.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
        favorites_count: item.interaction?.favorites_count ?? 0,
        shares_count: item.interaction?.shares_count ?? 0,
        liked: nextEnabled,
        favorited: item.interaction?.favorited ?? false,
      },
    } : item))
    try {
      const res = await topicsApi.like(topic.id, nextEnabled)
      setTopics(prev => prev.map(item => item.id === topic.id ? { ...item, interaction: res.data } : item))
    } catch (err) {
      setTopics(prev => prev.map(item => item.id === topic.id ? { ...item, interaction: previousInteraction } : item))
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
    const previousInteraction = topic.interaction
    setTopics(prev => prev.map(item => item.id === topic.id ? {
      ...item,
      interaction: {
        likes_count: item.interaction?.likes_count ?? 0,
        favorites_count: Math.max(0, (item.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1)),
        shares_count: item.interaction?.shares_count ?? 0,
        liked: item.interaction?.liked ?? false,
        favorited: nextEnabled,
      },
    } : item))
    try {
      const res = await topicsApi.favorite(topic.id, nextEnabled)
      if (!nextEnabled) {
        setTopics(prev => prev.filter(item => item.id !== topic.id))
        await refreshCategoriesOnly()
      } else {
        setTopics(prev => prev.map(item => item.id === topic.id ? { ...item, interaction: res.data } : item))
      }
    } catch (err) {
      setTopics(prev => prev.map(item => item.id === topic.id ? { ...item, interaction: previousInteraction } : item))
      handleApiError(err, nextEnabled ? '话题收藏失败' : '取消话题收藏失败')
    } finally {
      setPendingTopicFavoriteIds(prev => {
        const next = new Set(prev)
        next.delete(topic.id)
        return next
      })
    }
  }

  const handleShareSource = async (title: string, url: string) => {
    try {
      const text = title ? `${title}\n${url}` : url
      await navigator.clipboard.writeText(text)
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
    const previousInteraction = article.interaction
    updateArticleInteraction(article.id, {
      likes_count: Math.max(0, (article.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1)),
      shares_count: article.interaction?.shares_count ?? 0,
      favorites_count: article.interaction?.favorites_count ?? 0,
      liked: nextEnabled,
      favorited: article.interaction?.favorited ?? false,
    })
    try {
      const res = await sourceFeedApi.like(article.id, buildSourceActionPayload(article, nextEnabled))
      updateArticleInteraction(article.id, res.data)
    } catch (err) {
      updateArticleInteraction(article.id, previousInteraction)
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
    const previousInteraction = article.interaction
    updateArticleInteraction(article.id, {
      likes_count: article.interaction?.likes_count ?? 0,
      shares_count: article.interaction?.shares_count ?? 0,
      favorites_count: Math.max(0, (article.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1)),
      liked: article.interaction?.liked ?? false,
      favorited: nextEnabled,
    })
    try {
      const res = await sourceFeedApi.favorite(article.id, buildSourceActionPayload(article, nextEnabled))
      if (!nextEnabled) {
        setSourceArticles(prev => prev.filter(item => item.id !== article.id))
        await refreshCategoriesOnly()
      } else {
        updateArticleInteraction(article.id, res.data)
      }
    } catch (err) {
      updateArticleInteraction(article.id, previousInteraction)
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
    await handleShareSource(article.title, article.url)
  }

  const createCategoryAndAssign = async (
    name: string,
    item: TopicListItem | SourceFeedArticle,
    type: FavoriteTab,
  ) => {
    try {
      if (type === 'topics') {
        const category = (await topicsApi.classifyFavorites({ category_name: name, topic_ids: [(item as TopicListItem).id] })).data
        setCategories(prev => prev.some((entry) => entry.id === category.id) ? updateCategoryList(prev, category) : [...prev, category])
        setTopics(prev => prev.map(entry => entry.id === (item as TopicListItem).id ? {
          ...entry,
          favorite_category_ids: [...new Set([...(entry.favorite_category_ids ?? []), category.id])],
          favorite_categories: [...(entry.favorite_categories ?? []), { id: category.id, name: category.name }],
        } : entry))
      } else {
        const category = (await topicsApi.classifyFavorites({ category_name: name, article_ids: [(item as SourceFeedArticle).id] })).data
        setCategories(prev => prev.some((entry) => entry.id === category.id) ? updateCategoryList(prev, category) : [...prev, category])
        setSourceArticles(prev => prev.map(entry => entry.id === (item as SourceFeedArticle).id ? {
          ...entry,
          favorite_category_ids: [...new Set([...(entry.favorite_category_ids ?? []), category.id])],
          favorite_categories: [...(entry.favorite_categories ?? []), { id: category.id, name: category.name }],
        } : entry))
      }
      toast.success('已创建收藏分类')
      await refreshCategoriesOnly()
      if (selectedCategoryId !== 'all') {
        await refreshCurrentItems()
      }
    } catch (err) {
      handleApiError(err, '创建收藏分类失败')
    }
  }

  const handleReplySourceArticle = async (article: SourceFeedArticle) => {
    setPendingSourceReplyIds(prev => new Set(prev).add(article.id))
    try {
      const res = await sourceFeedApi.ensureTopic(article.id)
      navigate(`/topics/${res.data.topic.id}`)
      toast.success('已打开对应话题')
    } catch (err) {
      handleApiError(err, '打开信源对应话题失败')
    } finally {
      setPendingSourceReplyIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  const handleAssignTopicCategory = async (topic: TopicListItem, categoryId: string) => {
    setPendingTopicCategoryIds(prev => new Set(prev).add(topic.id))
    try {
      const category = (await topicsApi.assignTopicToFavoriteCategory(categoryId, topic.id)).data
      setCategories(prev => updateCategoryList(prev, category))
      setTopics(prev => prev.map(item => item.id === topic.id ? {
        ...item,
        favorite_category_ids: [...new Set([...(item.favorite_category_ids ?? []), category.id])],
        favorite_categories: [...(item.favorite_categories ?? []).filter(entry => entry.id !== category.id), { id: category.id, name: category.name }],
      } : item))
      if (selectedCategoryId !== 'all' && selectedCategoryId !== categoryId) {
        await refreshCurrentItems()
      }
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
      const category = (await topicsApi.unassignTopicFromFavoriteCategory(categoryId, topic.id)).data
      setCategories(prev => updateCategoryList(prev, category))
      if (selectedCategoryId === categoryId) {
        setTopics(prev => prev.filter(item => item.id !== topic.id))
      } else {
        setTopics(prev => prev.map(item => item.id === topic.id ? {
          ...item,
          favorite_category_ids: (item.favorite_category_ids ?? []).filter(id => id !== categoryId),
          favorite_categories: (item.favorite_categories ?? []).filter(entry => entry.id !== categoryId),
        } : item))
      }
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
      const category = (await topicsApi.assignSourceToFavoriteCategory(categoryId, article.id)).data
      setCategories(prev => updateCategoryList(prev, category))
      setSourceArticles(prev => prev.map(item => item.id === article.id ? {
        ...item,
        favorite_category_ids: [...new Set([...(item.favorite_category_ids ?? []), category.id])],
        favorite_categories: [...(item.favorite_categories ?? []).filter(entry => entry.id !== category.id), { id: category.id, name: category.name }],
      } : item))
      if (selectedCategoryId !== 'all' && selectedCategoryId !== categoryId) {
        await refreshCurrentItems()
      }
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
      const category = (await topicsApi.unassignSourceFromFavoriteCategory(categoryId, article.id)).data
      setCategories(prev => updateCategoryList(prev, category))
      if (selectedCategoryId === categoryId) {
        setSourceArticles(prev => prev.filter(item => item.id !== article.id))
      } else {
        setSourceArticles(prev => prev.map(item => item.id === article.id ? {
          ...item,
          favorite_category_ids: (item.favorite_category_ids ?? []).filter(id => id !== categoryId),
          favorite_categories: (item.favorite_categories ?? []).filter(entry => entry.id !== categoryId),
        } : item))
      }
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

  const visibleTopics = topics
  const visibleSources = sourceArticles
  const hasMore = tab === 'topics' ? Boolean(topicNextCursor) : Boolean(sourceNextCursor)

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

        <div className="flex-1 min-w-0 pt-5 pb-20 md:pt-0 md:pb-28">
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

          {!loading && tab === 'topics' && visibleTopics.length === 0 ? (
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

          {!loading && tab === 'sources' && visibleSources.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-gray-200 bg-gray-50 px-5 py-8">
              <p className="font-serif text-gray-700">
                {selectedCategoryId === 'all' ? '还没有收藏信源。' : '这个分类里还没有信源。'}
              </p>
              <p className="mt-2 text-sm text-gray-500">
                {selectedCategoryId === 'all'
                  ? '现在去信源页点一下收藏，内容就会出现在这里。'
                  : '先在某条已收藏信源卡片里把它加入这个分类。'}
              </p>
              <Link to="/source-feed" className="mt-4 inline-flex rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black">
                去看信源
              </Link>
            </div>
          ) : null}

          {!loading && tab === 'topics' && visibleTopics.length > 0 ? (
            <div className="grid gap-4">
              {visibleTopics.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  onLike={handleLikeTopic}
                  onFavorite={handleFavoriteTopic}
                  onShare={handleShareTopic}
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

          {!loading && tab === 'sources' && visibleSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {visibleSources.map((article) => (
                <SourceArticleCard
                  key={article.id}
                  article={article}
                  onLike={handleLikeSource}
                  onFavorite={handleFavoriteSource}
                  onShare={handleShareSourceArticle}
                  onReply={handleReplySourceArticle}
                  likePending={pendingSourceLikeIds.has(article.id)}
                  favoritePending={pendingSourceFavoriteIds.has(article.id)}
                  replyPending={pendingSourceReplyIds.has(article.id)}
                  favoriteCategories={categories}
                  categoryPending={pendingSourceCategoryIds.has(article.id)}
                  onAssignCategory={handleAssignSourceCategory}
                  onUnassignCategory={handleUnassignSourceCategory}
                  onCreateCategory={(item, name) => createCategoryAndAssign(name, item, 'sources')}
                />
              ))}
            </div>
          ) : null}

          {!loading && hasMore ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:text-black disabled:opacity-50"
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </LibraryPageLayout>
  )
}
