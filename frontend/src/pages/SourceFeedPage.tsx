import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { sourceFeedApi, SourceFeedArticle } from '../api/client'
import { tokenManager, User } from '../api/auth'
import LibraryPageLayout from '../components/LibraryPageLayout'
import SourceArticleCard from '../components/SourceArticleCard'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'
import { useThrottledCallbackByKey } from '../hooks/useThrottledCallback'

const PAGE_SIZE = 12
const CARD_MAX_WIDTH = 280
const GRID_GAP = 12
const MOBILE_GRID_GAP = 10
const MIN_COLUMNS = 2
const MAX_COLUMNS = 4
const DESKTOP_CARD_FLOOR_WIDTH = 220
const LIBRARY_LAYOUT_MAX_WIDTH = 1152
const LIBRARY_LAYOUT_MOBILE_PADDING = 32
const LIBRARY_LAYOUT_DESKTOP_PADDING = 48
const QUICK_LINKS = [
  { label: '学术', href: 'https://daiduo2.github.io/academic-trend-monitor/' },
  { label: '全球情报', href: 'https://42vf4xnfxh.coze.site/' },
  { label: '开源代码库', href: 'https://home.gqy20.top/TrendPluse/' },
  { label: 'AI 技术', href: 'https://info.gqy20.top/' },
]

const SOURCE_FEED_SECTIONS = [
  { id: 'source' as const, label: '媒体' },
  { id: 'academic' as const, label: '学术' },
]

/** 媒体页仅展示微信公众号 RSS 入库信源（与上游 IC articles 筛选一致） */
const MEDIA_SOURCE_TYPE_FILTER = 'we-mp-rss'
/** 学术页信源类型（与上游 IC articles 筛选一致） */
const ACADEMIC_SOURCE_TYPE_FILTER = 'gqy'
/** 只展示这三个分区；上游 IC 当前会忽略 source_feed_name，故在 gqy 流里按字段筛选 */
const ACADEMIC_ARXIV_FEEDS = [
  'arXiv cs.AI',
  'arXiv cs.LG',
  'arXiv cs.CV',
] as const
const ACADEMIC_ARXIV_FEED_SET = new Set<string>(
  ACADEMIC_ARXIV_FEEDS as unknown as string[],
)
/** 单次首屏/加载更多最多翻上游 gqy 页数，避免全非目标分区时死循环 */
const ACADEMIC_MAX_RAW_PAGES = 24

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
  const usableWidth = Math.max(width, DESKTOP_CARD_FLOOR_WIDTH)
  const count = Math.floor(
    (usableWidth + GRID_GAP) / (DESKTOP_CARD_FLOOR_WIDTH + GRID_GAP),
  )
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, count))
}

function getContentWidth(width: number) {
  const isMobile = width < 640
  const viewportPadding = isMobile
    ? LIBRARY_LAYOUT_MOBILE_PADDING
    : LIBRARY_LAYOUT_DESKTOP_PADDING
  const maxWidth = LIBRARY_LAYOUT_MAX_WIDTH - viewportPadding
  return Math.max(Math.min(width - viewportPadding, maxWidth), 0)
}

function getColumnWidth(width: number, columnCount: number, isMobile: boolean) {
  const gap = isMobile ? MOBILE_GRID_GAP : GRID_GAP
  const usableWidth = Math.max(width, 0)
  const widthPerColumn = (usableWidth - gap * (columnCount - 1)) / columnCount
  return Math.min(CARD_MAX_WIDTH, Math.max(0, Math.floor(widthPerColumn)))
}

function splitIntoColumns<T>(items: T[], columnCount: number): T[][] {
  const columns = Array.from({ length: columnCount }, () => [] as T[])
  items.forEach((item, index) => {
    columns[index % columnCount].push(item)
  })
  return columns
}

function buildArticleSnapshot(article: SourceFeedArticle) {
  return {
    title: article.title,
    source_feed_name: article.source_feed_name,
    source_type: article.source_type,
    url: article.url,
    pic_url: article.pic_url ?? null,
    description: article.description,
    publish_time: article.publish_time,
    created_at: article.created_at,
  }
}

type SourceFeedSectionId = (typeof SOURCE_FEED_SECTIONS)[number]['id']

function isSourceFeedSectionId(
  value: string | undefined,
): value is SourceFeedSectionId {
  return SOURCE_FEED_SECTIONS.some((s) => s.id === value)
}

async function pullArxivRowsFromGqy(startRawOffset: number): Promise<{
  rows: SourceFeedArticle[]
  nextRawOffset: number
  hasMore: boolean
}> {
  const collected: SourceFeedArticle[] = []
  const seenIds = new Set<number>()
  let off = startRawOffset
  let lastUpstreamFull = false
  for (
    let n = 0;
    n < ACADEMIC_MAX_RAW_PAGES && collected.length < PAGE_SIZE;
    n++
  ) {
    const res = await sourceFeedApi.list({
      limit: PAGE_SIZE,
      offset: off,
      source_type: ACADEMIC_SOURCE_TYPE_FILTER,
    })
    const raw = res.data.list
    lastUpstreamFull = raw.length === PAGE_SIZE
    for (const a of raw) {
      if (!ACADEMIC_ARXIV_FEED_SET.has((a.source_feed_name || '').trim()))
        continue
      if (seenIds.has(a.id)) continue
      seenIds.add(a.id)
      collected.push(a)
      if (collected.length >= PAGE_SIZE) break
    }
    off += PAGE_SIZE
    if (!lastUpstreamFull) break
  }
  return { rows: collected, nextRawOffset: off, hasMore: lastUpstreamFull }
}

export default function SourceFeedPage() {
  const { section } = useParams<{ section: string }>()
  const navigate = useNavigate()

  if (!isSourceFeedSectionId(section)) {
    return <Navigate to="/source-feed/source" replace />
  }

  const [articles, setArticles] = useState<SourceFeedArticle[]>([])
  const [academicArticles, setAcademicArticles] = useState<SourceFeedArticle[]>(
    [],
  )
  const [loading, setLoading] = useState(true)
  const [academicLoading, setAcademicLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [academicLoadingMore, setAcademicLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [academicHasMore, setAcademicHasMore] = useState(true)
  const [query, setQuery] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<number>>(new Set())
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<number>>(
    new Set(),
  )
  const [pendingReplyIds, setPendingReplyIds] = useState<Set<number>>(new Set())
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const pageRef = useRef(0)
  const academicRawOffsetRef = useRef(0)
  const academicLoadingMoreRef = useRef(false)
  const academicHasMoreRef = useRef(true)
  const academicLoadingRef = useRef(false)
  const loadMoreFnRef = useRef<() => Promise<void>>(async () => {})
  const loadMoreAcademicFnRef = useRef<() => Promise<void>>(async () => {})

  const activeSection =
    SOURCE_FEED_SECTIONS.find((s) => s.id === section) ??
    SOURCE_FEED_SECTIONS[0]

  useEffect(() => {
    academicLoadingRef.current = academicLoading
  }, [academicLoading])

  useEffect(() => {
    if (section !== 'source') return
    void loadFirstPage()
  }, [section])

  useEffect(() => {
    if (section !== 'academic') return
    void loadAcademicFirstPage()
  }, [section])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
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
      const remaining =
        document.documentElement.scrollHeight -
        (window.innerHeight + window.scrollY)
      if (remaining > 900) return
      if (
        section === 'source' &&
        !loadingMoreRef.current &&
        hasMoreRef.current
      ) {
        void loadMoreFnRef.current()
      }
      if (
        section === 'academic' &&
        !academicLoadingRef.current &&
        !academicLoadingMoreRef.current &&
        academicHasMoreRef.current
      ) {
        void loadMoreAcademicFnRef.current()
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [section])

  useEffect(() => {
    if (
      section === 'source' &&
      (loading || loadingMore || !hasMore || articles.length === 0)
    )
      return
    if (
      section === 'source' &&
      document.documentElement.scrollHeight <= window.innerHeight + 160
    ) {
      void loadMore()
    }
  }, [section, articles.length, hasMore, loading, loadingMore])

  const loadFirstPage = async () => {
    setLoading(true)
    try {
      const res = await sourceFeedApi.list({
        limit: PAGE_SIZE,
        offset: 0,
        source_type: MEDIA_SOURCE_TYPE_FILTER,
      })
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
      const res = await sourceFeedApi.list({
        limit: PAGE_SIZE,
        offset,
        source_type: MEDIA_SOURCE_TYPE_FILTER,
      })
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

  const loadAcademicFirstPage = async () => {
    setAcademicLoading(true)
    try {
      academicRawOffsetRef.current = 0
      const { rows, nextRawOffset, hasMore } = await pullArxivRowsFromGqy(0)
      academicRawOffsetRef.current = nextRawOffset
      setAcademicArticles(rows)
      setAcademicHasMore(hasMore)
      academicHasMoreRef.current = hasMore
    } catch {
      setAcademicArticles([])
      setAcademicHasMore(false)
      academicHasMoreRef.current = false
    } finally {
      setAcademicLoading(false)
    }
  }

  const loadMoreAcademic = async () => {
    academicLoadingMoreRef.current = true
    setAcademicLoadingMore(true)
    try {
      const { rows, nextRawOffset, hasMore } = await pullArxivRowsFromGqy(
        academicRawOffsetRef.current,
      )
      academicRawOffsetRef.current = nextRawOffset
      setAcademicArticles((prev) => {
        const ids = new Set(prev.map((a) => a.id))
        return dedupeArticles([...prev, ...rows.filter((a) => !ids.has(a.id))])
      })
      setAcademicHasMore(hasMore)
      academicHasMoreRef.current = hasMore
    } catch {
      setAcademicHasMore(false)
      academicHasMoreRef.current = false
    } finally {
      academicLoadingMoreRef.current = false
      setAcademicLoadingMore(false)
    }
  }

  loadMoreFnRef.current = loadMore
  loadMoreAcademicFnRef.current = loadMoreAcademic

  const filteredArticles = articles.filter((article) => {
    if (!query.trim()) return true
    const haystack =
      `${article.title} ${article.source_feed_name} ${article.description}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  const filteredAcademicArticles = academicArticles.filter((article) => {
    if (!query.trim()) return true
    const haystack =
      `${article.title} ${article.source_feed_name} ${article.description}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  const isMobileViewport = viewportWidth < 640
  const contentWidth = getContentWidth(viewportWidth)
  const columnCount = isMobileViewport
    ? MIN_COLUMNS
    : getColumnCount(contentWidth)
  const columnWidth = getColumnWidth(
    contentWidth,
    columnCount,
    isMobileViewport,
  )
  const articleColumns = splitIntoColumns(filteredArticles, columnCount)
  const academicColumns = splitIntoColumns(
    filteredAcademicArticles,
    columnCount,
  )

  const requireCurrentUser = useCallback(() => {
    if (currentUser) return true
    toast.error('请先登录后再操作')
    return false
  }, [currentUser])

  const buildSourceActionPayload = useCallback(
    (article: SourceFeedArticle, enabled: boolean) => ({
      enabled,
      title: article.title,
      source_feed_name: article.source_feed_name,
      source_type: article.source_type,
      url: article.url,
      pic_url: article.pic_url ?? null,
      description: article.description,
      publish_time: article.publish_time,
      created_at: article.created_at,
    }),
    [],
  )

  const updateArticleInteraction = useCallback(
    (articleId: number, interaction: SourceFeedArticle['interaction']) => {
      const patch = (prev: SourceFeedArticle[]) =>
        prev.map((item) =>
          item.id === articleId ? { ...item, interaction } : item,
        )
      if (section === 'academic') {
        setAcademicArticles(patch)
      } else {
        setArticles(patch)
      }
    },
    [section],
  )

  const handleLike = useCallback(
    async (article: SourceFeedArticle) => {
      if (!requireCurrentUser()) return
      const nextEnabled = !(article.interaction?.liked ?? false)
      setPendingLikeIds((prev) => new Set(prev).add(article.id))
      const previousInteraction = article.interaction
      updateArticleInteraction(article.id, {
        likes_count: Math.max(
          0,
          (article.interaction?.likes_count ?? 0) + (nextEnabled ? 1 : -1),
        ),
        favorites_count: article.interaction?.favorites_count ?? 0,
        shares_count: article.interaction?.shares_count ?? 0,
        liked: nextEnabled,
        favorited: article.interaction?.favorited ?? false,
      })
      try {
        const res = await sourceFeedApi.like(
          article.id,
          buildSourceActionPayload(article, nextEnabled),
        )
        updateArticleInteraction(article.id, res.data)
      } catch (err) {
        updateArticleInteraction(article.id, previousInteraction)
        handleApiError(err, nextEnabled ? '信源点赞失败' : '取消信源点赞失败')
      } finally {
        setPendingLikeIds((prev) => {
          const next = new Set(prev)
          next.delete(article.id)
          return next
        })
      }
    },
    [requireCurrentUser, updateArticleInteraction, buildSourceActionPayload],
  )

  const handleFavorite = useCallback(
    async (article: SourceFeedArticle) => {
      if (!requireCurrentUser()) return
      const nextEnabled = !(article.interaction?.favorited ?? false)
      setPendingFavoriteIds((prev) => new Set(prev).add(article.id))
      const previousInteraction = article.interaction
      updateArticleInteraction(article.id, {
        likes_count: article.interaction?.likes_count ?? 0,
        favorites_count: Math.max(
          0,
          (article.interaction?.favorites_count ?? 0) + (nextEnabled ? 1 : -1),
        ),
        shares_count: article.interaction?.shares_count ?? 0,
        liked: article.interaction?.liked ?? false,
        favorited: nextEnabled,
      })
      try {
        const res = await sourceFeedApi.favorite(
          article.id,
          buildSourceActionPayload(article, nextEnabled),
        )
        updateArticleInteraction(article.id, res.data)
      } catch (err) {
        updateArticleInteraction(article.id, previousInteraction)
        handleApiError(err, nextEnabled ? '信源收藏失败' : '取消信源收藏失败')
      } finally {
        setPendingFavoriteIds((prev) => {
          const next = new Set(prev)
          next.delete(article.id)
          return next
        })
      }
    },
    [requireCurrentUser, updateArticleInteraction, buildSourceActionPayload],
  )

  const handleShare = useCallback(
    async (article: SourceFeedArticle) => {
      try {
        const res = await sourceFeedApi.share(article.id)
        updateArticleInteraction(article.id, res.data)
      } catch (err) {
        handleApiError(err, '记录信源分享失败')
      }
      try {
        const text = article.title
          ? `${article.title}\n${article.url}`
          : article.url
        await navigator.clipboard.writeText(text)
        toast.success('信源链接已复制')
      } catch {
        toast.error('复制链接失败')
      }
    },
    [updateArticleInteraction],
  )

  const handleReply = useCallback(
    async (article: SourceFeedArticle) => {
      setPendingReplyIds((prev) => new Set(prev).add(article.id))
      try {
        const res = await sourceFeedApi.ensureTopic(
          article.id,
          buildArticleSnapshot(article),
        )
        navigate(`/topics/${res.data.topic.id}`)
        toast.success('已打开对应话题')
      } catch (err) {
        handleApiError(err, '打开信源对应话题失败')
      } finally {
        setPendingReplyIds((prev) => {
          const next = new Set(prev)
          next.delete(article.id)
          return next
        })
      }
    },
    [navigate],
  )

  const throttledLike = useThrottledCallbackByKey(handleLike, (a) => a.id)
  const throttledFavorite = useThrottledCallbackByKey(
    handleFavorite,
    (a) => a.id,
  )
  const throttledShare = useThrottledCallbackByKey(handleShare, (a) => a.id)
  const throttledReply = useThrottledCallbackByKey(handleReply, (a) => a.id)

  return (
    <LibraryPageLayout
      title="信源"
      description="集中查看平台沉淀的媒体与学术信源，支持搜索、收藏、点赞，并从信源直接进入对应话题。"
      actions={
        <form
          className="w-full sm:w-[320px]"
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(searchValue)
          }}
        >
          <div className="relative">
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="搜索标题或来源"
              aria-label="搜索"
              className="w-full rounded-full border py-2 pl-4 pr-16 text-sm font-serif outline-none transition-colors"
              style={{
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-container)',
              }}
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 text-xs font-serif text-white"
              style={{ backgroundColor: 'var(--text-primary)' }}
            >
              搜索
            </button>
          </div>
        </form>
      }
    >
      <div className="max-w-5xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="mr-1 flex items-center gap-2 rounded-full border px-3 py-2"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <span
              className="text-sm font-serif font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Trends
            </span>
            <span
              className="text-xs font-serif"
              style={{ color: 'var(--text-tertiary)' }}
            >
              外部导航
            </span>
          </div>
          {QUICK_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              aria-label={link.label}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-serif font-semibold transition-colors"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-container)',
                color: 'var(--text-secondary)',
              }}
            >
              <span>{link.label}</span>
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-tertiary)',
                }}
              >
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
      </div>

      <div className="-mx-1 mb-4 mt-6 px-1">
        <div className="flex gap-1 border-b border-gray-200">
          {SOURCE_FEED_SECTIONS.map((item) => {
            const active = item.id === activeSection.id
            return (
              <Link
                key={item.id}
                to={`/source-feed/${item.id}`}
                className={`-mb-px flex-shrink-0 px-3 py-2.5 text-sm font-serif transition-colors border-b-2 ${
                  active
                    ? 'border-[var(--color-dark)] text-[var(--color-dark)] font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </div>

      {section === 'source' && (
        <>
          {loading && <p className="font-serif text-gray-500">加载中...</p>}
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
                gap: `${isMobileViewport ? MOBILE_GRID_GAP : GRID_GAP}px`,
                justifyContent: 'center',
              }}
            >
              {articleColumns.map((column, columnIndex) => (
                <div key={columnIndex} className="flex flex-col gap-3">
                  {column.map((article) => (
                    <SourceArticleCard
                      key={article.id}
                      article={article}
                      onLike={throttledLike}
                      onFavorite={throttledFavorite}
                      onShare={throttledShare}
                      onReply={throttledReply}
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
            <div className="py-6 text-center text-sm font-serif text-gray-500">
              加载更多中...
            </div>
          )}
          {!hasMore && articles.length > 0 && (
            <div className="py-6 text-center text-sm font-serif text-gray-400">
              已加载全部内容
            </div>
          )}
        </>
      )}

      {section === 'academic' && (
        <>
          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-4 sm:px-5 sm:py-5">
            <h2 className="font-serif text-base font-semibold text-gray-900 sm:text-lg">
              学术板块能做什么
            </h2>
            <ul className="mt-3 list-none space-y-2 font-serif text-sm text-gray-700 sm:text-base [&>li]:flex [&>li]:items-start [&>li]:gap-2 [&>li]:before:mt-1.5 [&>li]:before:shrink-0 [&>li]:before:content-['·'] [&>li]:before:font-bold [&>li]:before:text-gray-400">
              <li>
                <span className="min-w-0">
                  <strong>论文流</strong>：浏览与 arXiv
                  相关的最新预印本条目，支持搜索、点赞、收藏和从信源开题；滑到底可加载更多。
                </span>
              </li>
              <li>
                <span className="min-w-0">
                  <strong>开题讨论</strong>
                  ：从条目一键开话题，和多专家讨论流程与「媒体」信源一致。
                </span>
              </li>
              <li>
                <span className="min-w-0">
                  <strong>更多检索</strong>：关键词、学者、机构等深度检索可用
                  OpenClaw 智能体；文献趋势与研报类页面后续会陆续上线。
                </span>
              </li>
            </ul>
            <div className="mt-4 rounded-xl bg-amber-50/80 px-3 py-2.5 sm:px-4">
              <p className="font-serif text-sm font-medium text-amber-900">
                <strong>提示</strong>：已接入 OpenClaw
                的用户可直接用智能体做更完整的文献与检索能力。
              </p>
            </div>
          </div>
          {academicLoading && (
            <p className="font-serif text-gray-500">加载中...</p>
          )}
          {!academicLoading && academicArticles.length === 0 && (
            <p className="font-serif text-gray-500">暂无论文，下拉可加载更多</p>
          )}
          {!academicLoading &&
            academicArticles.length > 0 &&
            filteredAcademicArticles.length === 0 && (
              <p className="font-serif text-gray-500">没有匹配结果</p>
            )}
          {filteredAcademicArticles.length > 0 && (
            <div
              data-testid="academic-feed-grid"
              className="grid items-start gap-3"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, ${columnWidth}px)`,
                gap: `${isMobileViewport ? MOBILE_GRID_GAP : GRID_GAP}px`,
                justifyContent: 'center',
              }}
            >
              {academicColumns.map((column, columnIndex) => (
                <div key={columnIndex} className="flex flex-col gap-3">
                  {column.map((article) => (
                    <SourceArticleCard
                      key={article.id}
                      article={article}
                      onLike={throttledLike}
                      onFavorite={throttledFavorite}
                      onShare={throttledShare}
                      onReply={throttledReply}
                      likePending={pendingLikeIds.has(article.id)}
                      favoritePending={pendingFavoriteIds.has(article.id)}
                      replyPending={pendingReplyIds.has(article.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {academicLoadingMore && (
            <div className="py-6 text-center text-sm font-serif text-gray-500">
              加载更多中...
            </div>
          )}
          {!academicHasMore && academicArticles.length > 0 && (
            <div className="py-6 text-center text-sm font-serif text-gray-400">
              已加载全部内容
            </div>
          )}
        </>
      )}
    </LibraryPageLayout>
  )
}
