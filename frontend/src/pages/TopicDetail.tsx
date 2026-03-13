import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  topicsApi,
  discussionApi,
  topicExpertsApi,
  postsApi,
  Topic,
  TopicExpert,
  Post,
  StartDiscussionRequest,
  DiscussionProgress,
} from '../api/client'
import TopicConfigTabs from '../components/TopicConfigTabs'
import ResizableToc from '../components/ResizableToc'
import PostThread from '../components/PostThread'
import MentionTextarea from '../components/MentionTextarea'
import StatusBadge from '../components/StatusBadge'
import { tokenManager, User } from '../api/auth'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'
import { resolveTopicImageSrc } from '../utils/topicImage'

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

const POLL_INTERVAL_MS = 2000

export default function TopicDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const initialSkillIds = (location.state as { skillList?: string[] } | null)?.skillList
  const [topic, setTopic] = useState<Topic | null>(null)
  const [loading, setLoading] = useState(true)
  const [topicExperts, setTopicExperts] = useState<TopicExpert[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [postText, setPostText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [startingDiscussion, setStartingDiscussion] = useState(false)
  const [polling, setPolling] = useState(false)
  const [progress, setProgress] = useState<DiscussionProgress | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const discussionStartRef = useRef<number | null>(null)
  const [activeNavId, setActiveNavId] = useState<string>('')
  const [replyingTo, setReplyingTo] = useState<Post | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingRepliesRef = useRef<Set<string>>(new Set())
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (id) {
      loadTopic(id)
      loadPosts(id)
      loadTopicExperts(id)
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
      let updated = false
      for (const replyId of [...pendingRepliesRef.current]) {
        try {
          const res = await postsApi.getReplyStatus(id, replyId)
          if (res.data.status !== 'pending') {
            pendingRepliesRef.current.delete(replyId)
            updated = true
          }
        } catch {
          pendingRepliesRef.current.delete(replyId)
        }
      }
      if (updated) loadPosts(id)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [id])

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
    try {
      const res = await postsApi.list(topicId)
      setPosts(res.data)
    } catch { /* ignore */ }
  }

  const loadTopicExperts = async (topicId: string) => {
    try {
      const res = await topicExpertsApi.list(topicId)
      setTopicExperts(res.data)
    } catch { /* ignore */ }
  }

  const handleReplyToPost = (post: Post) => {
    setReplyingTo(post)
    if (post.author_type === 'agent') {
      const mentionName = post.expert_name ?? post.author
      setPostText(prev => ensureExpertMention(prev, mentionName))
    }
    setTimeout(() => composerTextareaRef.current?.focus(), 0)
  }

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !postText.trim() || !currentUser) return

    const mentionMatch = postText.match(/@(\w+)/)
    const mentionedName = mentionMatch?.[1]
    const mentionedExpert = topicExperts.find(e => e.name === mentionedName)
    const inReplyToId = replyingTo?.id ?? null
    const authorName = getUserDisplayName(currentUser)

    setSubmitting(true)
    try {
      if (mentionedExpert) {
        const res = await postsApi.mention(id, {
          author: authorName,
          body: postText,
          expert_name: mentionedExpert.name,
          in_reply_to_id: inReplyToId,
        })
        pendingRepliesRef.current.add(res.data.reply_post_id)
        handleApiSuccess(`已向 ${mentionedExpert.label} 提问，等待回复中…`)
      } else {
        await postsApi.create(id, {
          author: authorName,
          body: postText,
          in_reply_to_id: inReplyToId,
        })
        handleApiSuccess('发送成功')
      }
      setPostText('')
      setReplyingTo(null)
      await loadPosts(id)
    } catch (err) {
      handleApiError(err, '发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartDiscussion = async (
    model: string,
    skillList?: string[],
    mcpServerIds?: string[]
  ) => {
    if (!id) return
    setStartingDiscussion(true)
    const req: StartDiscussionRequest = {
      num_rounds: 5,
      max_turns: 10000,
      max_budget_usd: 5.0,
      model,
      skill_list: skillList && skillList.length > 0 ? skillList : undefined,
      mcp_server_ids: mcpServerIds && mcpServerIds.length > 0 ? mcpServerIds : undefined,
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
        setTopic(prev => prev ? {
          ...prev,
          discussion_status: res.data.status,
          discussion_result: res.data.result,
        } : prev)
        if (res.data.progress) setProgress(res.data.progress)
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
    if (posts.length > 0) {
      items.push({ type: 'posts', label: `跟贴 (${posts.length})`, id: 'posts-section' })
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
  const shouldShowReplyDock = topic.status === 'open' && replyingTo !== null
  const closeReplyDock = () => setReplyingTo(null)

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Main content */}
        <div className="flex-1 min-w-0">

          {/* Topic title & actions */}
          <div className="flex flex-row items-start justify-between gap-2 mb-4 sm:mb-6">
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-black flex-1 min-w-0">{topic.title}</h1>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusBadge status={topic.status} />
            </div>
          </div>

          {/* Topic config - always visible for discussion mode */}
          {isDiscussionMode ? (
            <div className="border-l-2 border-gray-100 pl-4 sm:pl-5 py-2 mb-4 sm:mb-6">
              <TopicConfigTabs
                topicId={id!}
                topicBody={topic.body}
                onTopicBodyUpdated={(body) => {
                  setTopic((prev) => (prev ? { ...prev, body } : prev))
                }}
                onExpertsChange={() => {
                  loadTopic(id!)
                  loadTopicExperts(id!)
                }}
                onModeChange={() => loadTopic(id!)}
                onStartDiscussion={handleStartDiscussion}
                isStarting={startingDiscussion}
                isRunning={polling}
                isCompleted={topic.discussion_status === 'completed'}
                initialSkillIds={initialSkillIds}
              />
            </div>
          ) : null}

          <div className="border-t border-gray-100 my-6 sm:my-8" />

          {/* Mobile TOC - horizontal scroll, sticky */}
          {hasDiscussion && navItems.length > 0 && (
            <div className="lg:hidden sticky top-14 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-2 mb-4 bg-white/95 backdrop-blur border-b border-gray-100 overflow-x-auto scrollbar-hide">
              <div className="flex gap-2 min-w-max">
                {navItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors touch-manipulation ${
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
              className="mb-8 scroll-mt-6"
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
            <div className="mb-6 sm:mb-8 border border-gray-200 rounded-lg p-4 sm:p-5">
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
            <div className="mb-8">
              <h2 className="text-base font-semibold text-gray-900 mb-1">AI讨论</h2>
              <div className="grid grid-cols-1 gap-6 mt-4">
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
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-gray-900">{post.expertName}</span>
                            <span className="text-[10px] border border-gray-200 rounded text-gray-400 px-1">角色</span>
                          </div>
                          <div className="markdown-content text-sm text-gray-700">
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
              跟贴 ({posts.length})
              {topicExperts.length > 0 && (
                <span className="text-xs font-normal text-gray-400 ml-2">— 输入 @ 可追问角色</span>
              )}
            </h2>

            <PostThread
              posts={posts}
              onReply={handleReplyToPost}
              canReply={topic.status === 'open'}
            />

            {topic.status === 'open' ? (
              <div className="mt-6 pt-4 border-t border-gray-100">
                {replyingTo ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">正在回复 {composerReplyName}</span>
                      <span className="ml-1 text-gray-500">输入框已从底部弹出</span>
                    </div>
                  </div>
                ) : currentUser ? (
                  <form
                    onSubmit={handleSubmitPost}
                    className="ml-auto w-full max-w-[42rem] rounded-[28px] border border-gray-200 bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-500">发布跟贴</span>
                    </div>
                    <div className="rounded-[22px] border border-gray-200 bg-gray-50 px-3 py-3">
                      <div className="flex items-end gap-3">
                        <div className="min-w-0 flex-1">
                          <MentionTextarea
                            value={postText}
                            onChange={setPostText}
                            experts={topicExperts}
                            disabled={submitting}
                            textareaRef={composerTextareaRef}
                            placeholder="在这里继续讨论… 输入 @ 可追问角色"
                            textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                          />
                        </div>
                        <button
                          type="submit"
                          className="mb-1 shrink-0 rounded-2xl bg-black px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
                          disabled={submitting || !postText.trim()}
                        >
                          {submitting ? '发送中...' : '发送'}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-gray-400">
                        {topicExperts.length > 0 ? '输入 @ 可直接追问角色。' : '输入内容后即可发布跟贴。'}
                      </p>
                    </div>
                  </form>
                ) : (
                  <div className="ml-auto w-full max-w-[42rem] rounded-[28px] border border-gray-200 bg-white px-4 py-4 shadow-sm">
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
                className="pointer-events-auto ml-auto w-full max-w-[34rem] animate-fade-in rounded-[26px] border border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-16px_40px_rgba(0,0,0,0.08)] backdrop-blur"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">当前账号：{currentUserName}</span>
                    <span className="rounded-full bg-black px-2.5 py-1 text-white">正在回复：{composerReplyName}</span>
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

                <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">回复 {composerReplyName}</span>
                    {composerReplyPreview ? (
                      <span className="ml-1 text-gray-500">
                        · {composerReplyPreview}{replyingTo.body.length > composerReplyPreview.length ? '...' : ''}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[22px] border border-gray-200 bg-gray-50 px-3 py-3">
                  <div className="flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <MentionTextarea
                        value={postText}
                        onChange={setPostText}
                        experts={topicExperts}
                        disabled={submitting}
                        textareaRef={composerTextareaRef}
                        placeholder="在这里继续讨论… 回复角色时会自动补上 @"
                        textareaClassName="w-full bg-transparent px-1 py-1 text-sm font-serif text-gray-800 focus:outline-none resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="mb-1 shrink-0 rounded-2xl bg-black px-4 py-2 text-sm font-serif text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
                      disabled={submitting || !postText.trim()}
                    >
                      {submitting ? '发送中...' : '发送'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    {topicExperts.length > 0 ? '输入 @ 可直接追问角色，回复角色时会自动带上 @。' : '输入内容后即可发布跟贴。'}
                  </p>
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
