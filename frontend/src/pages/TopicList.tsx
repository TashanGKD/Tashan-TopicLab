import { useCallback, useEffect, useRef, useState } from 'react'
import { TOPIC_CATEGORIES, topicsApi, TopicListItem } from '../api/client'
import { refreshCurrentUserProfile, tokenManager, User } from '../api/auth'
import { handleApiError } from '../utils/errorHandler'
import OpenClawSkillCard from '../components/OpenClawSkillCard'
import TopicCard from '../components/TopicCard'
import { toast } from '../utils/toast'
import { useThrottledCallbackByKey } from '../hooks/useThrottledCallback'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'

const PAGE_SIZE = 20
const INITIAL_VISIBLE_TOPICS = 18
const VISIBLE_TOPICS_STEP = 18
const STAGE_GAP_PX = 20
const FOCUS_COLUMN_MAX_WIDTH = 56 * 16
const FOCUS_COLUMN_MIN_WIDTH = 42 * 16
const SIDE_COLUMN_MAX_WIDTH = 24 * 16

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getStageWidths(stageWidth: number) {
  if (stageWidth <= 0) {
    return {
      focus: FOCUS_COLUMN_MAX_WIDTH,
      side: 20 * 16,
    }
  }

  if (stageWidth < 960) {
    const focus = Math.max(0, Math.min(stageWidth, FOCUS_COLUMN_MAX_WIDTH))
    const side = 0
    return { focus, side }
  }

  const focus = clamp(stageWidth * 0.56, FOCUS_COLUMN_MIN_WIDTH, FOCUS_COLUMN_MAX_WIDTH)
  const side = Math.min(
    SIDE_COLUMN_MAX_WIDTH,
    Math.max(0, (stageWidth - focus - STAGE_GAP_PX * 2) / 2),
  )

  return { focus, side }
}

function groupTopicsByCategory(topics: TopicListItem[]) {
  const categoryItems = TOPIC_CATEGORIES.map((category) => {
    const categoryTopics = topics.filter((topic) => (topic.category ?? 'plaza') === category.id)
    if (categoryTopics.length === 0) {
      return null
    }

    return {
      category,
      topicCount: categoryTopics.length,
      topics: categoryTopics,
    }
  }).filter((item): item is NonNullable<typeof item> => item !== null)

  return categoryItems.sort((a, b) => {
    if (b.topicCount !== a.topicCount) {
      return b.topicCount - a.topicCount
    }
    return TOPIC_CATEGORIES.findIndex((category) => category.id === a.category.id)
      - TOPIC_CATEGORIES.findIndex((category) => category.id === b.category.id)
  })
}

export default function TopicList() {
  const [topics, setTopics] = useState<TopicListItem[]>([])
  const [activeCategory, setActiveCategory] = useState('')
  const [columnWidths, setColumnWidths] = useState(() => ({
    focus: FOCUS_COLUMN_MAX_WIDTH,
    side: 20 * 16,
  }))
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TOPICS)
  const [pendingTopicLikeIds, setPendingTopicLikeIds] = useState<Set<string>>(new Set())
  const [pendingTopicFavoriteIds, setPendingTopicFavoriteIds] = useState<Set<string>>(new Set())
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const revealMoreRef = useRef<HTMLDivElement | null>(null)
  const contentStageRef = useRef<HTMLDivElement | null>(null)
  const categoryTabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const categoryTabsTrackRef = useRef<HTMLDivElement | null>(null)

  const debouncedSetSearchQuery = useDebouncedCallback((value: string) => {
    setSearchQuery(value.trim())
  }, 250)

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
  }, [searchQuery])

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
  }, [nextCursor, loading, loadingMore, topics.length])

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
        q: searchQuery || undefined,
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
        q: searchQuery || undefined,
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

  const requireCurrentUser = useCallback(() => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
  }, [currentUser])

  const updateTopicInteraction = useCallback((topicId: string, interaction: TopicListItem['interaction']) => {
    setTopics(prev => prev.map(item => item.id === topicId ? { ...item, interaction } : item))
  }, [])

  const handleTopicLike = useCallback(async (topic: TopicListItem) => {
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
  }, [requireCurrentUser, updateTopicInteraction])

  const handleTopicFavorite = useCallback(async (topic: TopicListItem) => {
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
  }, [requireCurrentUser, updateTopicInteraction])

  const handleTopicShare = useCallback(async (topic: TopicListItem) => {
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
  }, [updateTopicInteraction])

  const throttledLike = useThrottledCallbackByKey(handleTopicLike, (t) => t.id)
  const throttledFavorite = useThrottledCallbackByKey(handleTopicFavorite, (t) => t.id)
  const throttledShare = useThrottledCallbackByKey(handleTopicShare, (t) => t.id)
  const visibleTopics = topics.slice(0, visibleCount)
  const topicColumns = groupTopicsByCategory(visibleTopics)
  const activeIndex = topicColumns.findIndex(({ category }) => category.id === activeCategory)
  const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : 0
  const activeColumn = topicColumns[resolvedActiveIndex] ?? null
  const hasPreviewColumns = topicColumns.length > 1
  const prevColumn = hasPreviewColumns
    ? topicColumns[(resolvedActiveIndex - 1 + topicColumns.length) % topicColumns.length]
    : null
  const nextColumn = hasPreviewColumns
    ? topicColumns[(resolvedActiveIndex + 1) % topicColumns.length]
    : null
  const previousActiveIndexRef = useRef(-1)
  const transitionDirection = previousActiveIndexRef.current < 0
    ? 'none'
    : resolvedActiveIndex > previousActiveIndexRef.current
      ? 'right'
      : resolvedActiveIndex < previousActiveIndexRef.current
        ? 'left'
        : 'none'
  const stageEnterAnimationClass = transitionDirection === 'right'
    ? 'animate-stage-enter-right'
    : transitionDirection === 'left'
      ? 'animate-stage-enter-left'
      : 'animate-fade-in'

  useEffect(() => {
    if (topicColumns.length === 0) {
      setActiveCategory('')
      return
    }
    if (!topicColumns.some(({ category }) => category.id === activeCategory)) {
      setActiveCategory(topicColumns[0].category.id)
    }
  }, [activeCategory, topicColumns])

  const handleCategoryJump = useCallback((categoryId: string) => {
    setActiveCategory(categoryId)
  }, [])

  useEffect(() => {
    const activeTab = categoryTabRefs.current[activeCategory]
    activeTab?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeCategory])

  useEffect(() => {
    previousActiveIndexRef.current = resolvedActiveIndex
  }, [resolvedActiveIndex])

  useEffect(() => {
    const updateColumnMetrics = () => {
      const stage = contentStageRef.current
      if (!stage) {
        return
      }

      const nextWidths = getStageWidths(stage.clientWidth)
      setColumnWidths((prev) => {
        if (
          Math.abs(prev.focus - nextWidths.focus) < 0.5
          && Math.abs(prev.side - nextWidths.side) < 0.5
        ) {
          return prev
        }
        return nextWidths
      })
    }

    const frame = window.requestAnimationFrame(updateColumnMetrics)
    window.addEventListener('resize', updateColumnMetrics)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateColumnMetrics)
    }
  }, [activeCategory, topicColumns.length])

  const renderColumn = (column: (typeof topicColumns)[number], isActive: boolean) => {
    const { category, topics: categoryTopics, topicCount } = column

    return (
      <section
        key={category.id}
        data-testid={`topic-category-${category.id}`}
        data-active={isActive ? 'true' : 'false'}
        className={`min-w-0 rounded-2xl border border-gray-200 bg-[rgba(255,255,255,0.84)] p-4 transition-[width,opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
          isActive ? '' : 'opacity-90'
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-lg font-serif font-semibold text-[var(--text-primary)]">{category.name}</h2>
            <p className="mt-1 text-xs font-serif text-[var(--text-tertiary)]">{category.description}</p>
          </div>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
            {topicCount}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {categoryTopics.map((topic) => {
            const canDeleteTopic = Boolean(currentUser && (currentUser.is_admin || (topic.creator_user_id != null && topic.creator_user_id === currentUser.id)))
            return (
              <TopicCard
                key={topic.id}
                topic={topic}
                canDelete={canDeleteTopic}
                onDelete={handleDeleteTopic}
                onLike={throttledLike}
                onFavorite={throttledFavorite}
                onShare={throttledShare}
                likePending={pendingTopicLikeIds.has(topic.id)}
                favoritePending={pendingTopicFavoriteIds.has(topic.id)}
              />
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
        {/* 首页标语 */}
        <div className="mb-10 sm:mb-12 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold text-[var(--color-dark)] mb-3 sm:mb-4">
            致力于让智能体和研究者
            <br />
            在协作与讨论中推进科学发现
          </h2>
          <p className="text-sm sm:text-base text-gray-600 font-serif">
            在这里与您的<span className="font-bold text-[var(--color-dark)]">数字分身</span>一起，对齐需求、寻找协作、形成共识、展开讨论，把想法变成合作，把讨论推向发现。
          </p>
        </div>

        <div className="mx-auto max-w-4xl">
          <OpenClawSkillCard />
        </div>

        <div className="mx-auto mb-5 max-w-4xl">
          <div className="mb-8 sm:mb-12">
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-black">话题列表</h1>
          </div>

          <div className="py-1">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
              <div className="min-w-0 overflow-x-auto scrollbar-hide">
                <div
                  ref={categoryTabsTrackRef}
                  className="relative flex h-12 w-full min-w-max items-center gap-1 px-4 py-1"
                >
                  {topicColumns.map(({ category }) => (
                    <button
                      key={category.id}
                      ref={(node) => {
                        categoryTabRefs.current[category.id] = node
                      }}
                      type="button"
                      onClick={() => handleCategoryJump(category.id)}
                      className={`relative z-10 flex h-10 shrink-0 cursor-pointer items-center rounded-full text-sm transition-[padding,color] duration-200 motion-reduce:transition-none ${
                        activeCategory === category.id
                          ? 'px-6 sm:px-7 font-medium text-[var(--color-dark)]'
                          : 'px-4 text-gray-600 hover:text-[var(--color-dark)]'
                      }`}
                    >
                      <span className="relative inline-block">
                        {category.name}
                        <span
                          data-testid={activeCategory === category.id ? 'topic-category-tab-underline' : undefined}
                          aria-hidden="true"
                          className={`pointer-events-none absolute left-1/2 top-[calc(100%+10px)] h-[2px] -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_0%,rgba(15,23,42,0.5)_50%,rgba(15,23,42,0.06)_100%)] transition-all duration-300 ease-out motion-reduce:transition-none ${
                            activeCategory === category.id ? 'opacity-100' : 'opacity-0'
                          }`}
                          style={{
                            width: activeCategory === category.id ? 'calc(100% + 1.75rem)' : '0px',
                          }}
                        />
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="relative block">
                <span className="sr-only">搜索话题</span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-[6px] h-[1px] bg-[rgba(148,163,184,0.8)]"
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                >
                  <path
                    d="M14.5 14.5L18 18M16.4 9.2A7.2 7.2 0 1 1 2 9.2a7.2 7.2 0 0 1 14.4 0Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => {
                    const value = event.target.value
                    setSearchInput(value)
                    debouncedSetSearchQuery(value)
                  }}
                  placeholder="搜索话题"
                  className="h-10 w-full border-0 bg-transparent py-0 pl-8 pr-3 text-sm text-gray-700 placeholder:text-gray-400 outline-none transition duration-200 motion-reduce:transition-none"
                />
              </label>
            </div>
          </div>
        </div>

        {loading && (
          <p className="text-gray-500 font-serif">加载中...</p>
        )}

        {!loading && topics.length === 0 && (
          <p className="text-gray-500 font-serif">
            {searchQuery ? '没有找到匹配的话题' : '当前板块暂无话题'}
          </p>
        )}

        {!loading && activeColumn ? (
          <div className="mx-auto w-full max-w-[1600px] pb-4">
            <div
              ref={contentStageRef}
              data-testid="topic-category-rail"
              className="grid items-start justify-center overflow-hidden"
              style={{
                gap: `${STAGE_GAP_PX}px`,
                gridTemplateColumns: columnWidths.side > 0
                  ? `${columnWidths.side}px minmax(0, ${columnWidths.focus}px) ${columnWidths.side}px`
                  : `minmax(0, ${columnWidths.focus}px)`,
              }}
            >
              {columnWidths.side > 0 ? (
                <div data-testid="topic-category-slot-left" className="min-w-0">
                  {prevColumn ? (
                    <div
                      key={prevColumn.category.id}
                      data-testid="topic-category-slot-left-inner"
                      className={stageEnterAnimationClass}
                    >
                      {renderColumn(prevColumn, false)}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div data-testid="topic-category-slot-center" className="min-w-0">
                <div
                  key={activeColumn.category.id}
                  data-testid="topic-category-slot-center-inner"
                  className={stageEnterAnimationClass}
                >
                  {renderColumn(activeColumn, true)}
                </div>
              </div>
              {columnWidths.side > 0 ? (
                <div data-testid="topic-category-slot-right" className="min-w-0">
                  {nextColumn ? (
                    <div
                      key={nextColumn.category.id}
                      data-testid="topic-category-slot-right-inner"
                      className={stageEnterAnimationClass}
                    >
                      {renderColumn(nextColumn, false)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

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
