import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sourceFeedApi, SourceFeedArticle } from '../api/client'
import { tokenManager, User } from '../api/auth'
import SourceArticleCard from '../components/SourceArticleCard'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'

const PAGE_SIZE = 12
const CARD_MAX_WIDTH = 280
const GRID_GAP = 12
const MOBILE_GRID_GAP = 10
const MIN_COLUMNS = 2
const MAX_COLUMNS = 4
const MOBILE_VIEWPORT_PADDING = 24
const DESKTOP_VIEWPORT_PADDING = 32
const DESKTOP_CARD_FLOOR_WIDTH = 220
const QUICK_LINKS = [
  { label: '学术', href: 'https://daiduo2.github.io/academic-trend-monitor/' },
  { label: '全球情报', href: 'https://42vf4xnfxh.coze.site/' },
  { label: '开源代码库', href: 'https://home.gqy20.top/TrendPluse/' },
  { label: 'AI 技术', href: 'https://info.gqy20.top/' },
]

function dedupeArticles(items: SourceFeedArticle[]) {
  const seen = new Set<number>()
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }
    seen.add(item.id)
    return true
  })
}

function getColumnCount(width: number) {
  if (width < 640) {
    return MIN_COLUMNS
  }
  const usableWidth = Math.max(width - DESKTOP_VIEWPORT_PADDING, DESKTOP_CARD_FLOOR_WIDTH)
  const count = Math.floor((usableWidth + GRID_GAP) / (DESKTOP_CARD_FLOOR_WIDTH + GRID_GAP))
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, count))
}

function getColumnWidth(width: number, columnCount: number) {
  const isMobile = width < 640
  const viewportPadding = isMobile ? MOBILE_VIEWPORT_PADDING : DESKTOP_VIEWPORT_PADDING
  const gap = isMobile ? MOBILE_GRID_GAP : GRID_GAP
  const usableWidth = Math.max(width - viewportPadding, 0)
  const widthPerColumn = (usableWidth - gap * (columnCount - 1)) / columnCount
  return Math.min(CARD_MAX_WIDTH, Math.max(0, Math.floor(widthPerColumn)))
}

function splitIntoColumns(items: SourceFeedArticle[], columnCount: number) {
  const columns = Array.from({ length: columnCount }, () => [] as SourceFeedArticle[])
  items.forEach((item, index) => {
    columns[index % columnCount].push(item)
  })
  return columns
}

export default function SourceFeedPage() {
  const navigate = useNavigate()
  const [articles, setArticles] = useState<SourceFeedArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [query, setQuery] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<number>>(new Set())
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<number>>(new Set())
  const [pendingReplyIds, setPendingReplyIds] = useState<Set<number>>(new Set())
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const pageRef = useRef(0)

  useEffect(() => {
    void loadFirstPage()
  }, [])

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth)
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const syncUser = () => {
      const token = tokenManager.get()
      const savedUser = tokenManager.getUser()
      setCurrentUser(token && savedUser ? savedUser : null)
    }

    syncUser()
    window.addEventListener('storage', syncUser)
    window.addEventListener('auth-change', syncUser)
    return () => {
      window.removeEventListener('storage', syncUser)
      window.removeEventListener('auth-change', syncUser)
    }
  }, [])

  useEffect(() => {
    const onScroll = () => {
      const remaining = document.documentElement.scrollHeight - (window.innerHeight + window.scrollY)
      if (remaining < 900 && !loadingMoreRef.current && hasMoreRef.current) {
        void loadMore()
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (loading || loadingMore || !hasMore || articles.length === 0) {
      return
    }
    if (document.documentElement.scrollHeight <= window.innerHeight + 160) {
      void loadMore()
    }
  }, [articles.length, hasMore, loading, loadingMore])

  const loadFirstPage = async () => {
    setLoading(true)
    try {
      const res = await sourceFeedApi.list({ limit: PAGE_SIZE, offset: 0 })
      const nextList = dedupeArticles(res.data.list)
      setArticles(nextList)
      pageRef.current = 1
      const nextHasMore = nextList.length === PAGE_SIZE
      setHasMore(nextHasMore)
      hasMoreRef.current = nextHasMore
    } catch {
      setArticles([])
      setHasMore(false)
      hasMoreRef.current = false
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    loadingMoreRef.current = true
    setLoadingMore(true)

    try {
      const offset = pageRef.current * PAGE_SIZE
      const res = await sourceFeedApi.list({ limit: PAGE_SIZE, offset })
      const nextPage = res.data.list

      setArticles((prev) => dedupeArticles([...prev, ...nextPage]))
      pageRef.current += 1

      const nextHasMore = nextPage.length === PAGE_SIZE
      setHasMore(nextHasMore)
      hasMoreRef.current = nextHasMore
    } catch {
      setHasMore(false)
      hasMoreRef.current = false
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }

  const filteredArticles = articles.filter((article) => {
    if (!query.trim()) {
      return true
    }
    const haystack = `${article.title} ${article.source_feed_name} ${article.description}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })
  const columnCount = getColumnCount(viewportWidth)
  const columnWidth = getColumnWidth(viewportWidth, columnCount)
  const articleColumns = splitIntoColumns(filteredArticles, columnCount)

  const requireCurrentUser = () => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
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
    setArticles(prev => prev.map(item => item.id === articleId ? { ...item, interaction } : item))
  }

  const handleLike = async (article: SourceFeedArticle) => {
    if (!requireCurrentUser()) return
    const nextEnabled = !(article.interaction?.liked ?? false)
    setPendingLikeIds(prev => new Set(prev).add(article.id))
    try {
      const res = await sourceFeedApi.like(article.id, buildSourceActionPayload(article, nextEnabled))
      updateArticleInteraction(article.id, res.data)
    } catch (err) {
      handleApiError(err, nextEnabled ? '信源点赞失败' : '取消信源点赞失败')
    } finally {
      setPendingLikeIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  const handleFavorite = async (article: SourceFeedArticle) => {
    if (!requireCurrentUser()) return
    const nextEnabled = !(article.interaction?.favorited ?? false)
    setPendingFavoriteIds(prev => new Set(prev).add(article.id))
    try {
      const res = await sourceFeedApi.favorite(article.id, buildSourceActionPayload(article, nextEnabled))
      updateArticleInteraction(article.id, res.data)
    } catch (err) {
      handleApiError(err, nextEnabled ? '信源收藏失败' : '取消信源收藏失败')
    } finally {
      setPendingFavoriteIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  const handleShare = async (article: SourceFeedArticle) => {
    try {
      const res = await sourceFeedApi.share(article.id)
      updateArticleInteraction(article.id, res.data)
    } catch (err) {
      handleApiError(err, '记录信源分享失败')
    }
    try {
      await navigator.clipboard.writeText(article.url)
      toast.success('信源链接已复制')
    } catch {
      toast.error('复制链接失败')
    }
  }

  const handleReply = async (article: SourceFeedArticle) => {
    setPendingReplyIds(prev => new Set(prev).add(article.id))
    try {
      const res = await sourceFeedApi.ensureTopic(article.id)
      navigate(`/topics/${res.data.topic.id}`)
      toast.success('已打开对应话题')
    } catch (err) {
      handleApiError(err, '打开信源对应话题失败')
    } finally {
      setPendingReplyIds(prev => {
        const next = new Set(prev)
        next.delete(article.id)
        return next
      })
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl font-serif font-bold text-black sm:text-2xl">信源流</h1>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="mr-1 flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="text-sm font-serif font-semibold text-gray-800">Trends</span>
                <span className="text-xs font-serif text-gray-400">外部导航</span>
              </div>
              {QUICK_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={link.label}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-serif font-semibold text-gray-700 transition-colors hover:border-black hover:text-black"
                >
                  <span>{link.label}</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        d="M7 13L13 7M8 7h5v5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </a>
              ))}
            </div>

            <form
              className="w-full lg:w-[320px]"
              onSubmit={(event) => {
                event.preventDefault()
                setQuery(searchValue)
              }}
            >
              <div className="relative">
                <input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="搜索标题或来源"
                  aria-label="搜索信源"
                  className="w-full rounded-full border border-gray-200 py-2 pl-4 pr-16 text-sm font-serif text-gray-700 outline-none transition-colors focus:border-black"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black px-3 py-1.5 text-xs font-serif text-white"
                >
                  搜索
                </button>
              </div>
            </form>
          </div>
        </div>

        {loading && (
          <p className="font-serif text-gray-500">加载中...</p>
        )}

        {!loading && articles.length === 0 && (
          <p className="font-serif text-gray-500">暂无文章</p>
        )}

        {!loading && articles.length > 0 && filteredArticles.length === 0 && (
          <p className="font-serif text-gray-500">没有匹配结果</p>
        )}

        {filteredArticles.length > 0 && (
          <div
            data-testid="source-feed-grid"
            className="grid items-start gap-3"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, ${columnWidth}px)`,
              gap: `${viewportWidth < 640 ? MOBILE_GRID_GAP : GRID_GAP}px`,
              justifyContent: 'center',
            }}
          >
            {articleColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="flex flex-col gap-3">
                {column.map((article) => (
                  <SourceArticleCard
                    key={article.id}
                    article={article}
                    onLike={handleLike}
                    onFavorite={handleFavorite}
                    onShare={handleShare}
                    onReply={handleReply}
                    likePending={pendingLikeIds.has(article.id)}
                    favoritePending={pendingFavoriteIds.has(article.id)}
                    replyPending={pendingReplyIds.has(article.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {loadingMore && (
          <div className="py-6 text-center text-sm font-serif text-gray-500">加载更多中...</div>
        )}

        {!hasMore && articles.length > 0 && (
          <div className="py-6 text-center text-sm font-serif text-gray-400">已加载全部内容</div>
        )}
      </div>
    </div>
  )
}
