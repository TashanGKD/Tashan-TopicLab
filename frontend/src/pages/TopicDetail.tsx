import { useEffect, useRef, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
import ExpertManagement from '../components/ExpertManagement'
import ModeratorModeConfig from '../components/ModeratorModeConfig'
import ResizableToc from '../components/ResizableToc'
import PostThread from '../components/PostThread'
import MentionTextarea from '../components/MentionTextarea'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-green-50 text-green-700',
    closed: 'bg-gray-100 text-gray-500',
    running: 'bg-blue-50 text-blue-600',
    completed: 'bg-gray-100 text-gray-600',
  }
  const labels: Record<string, string> = {
    open: '开放',
    closed: '关闭',
    running: '运行中',
    completed: '已完成',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  )
}

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
  const [showConfig, setShowConfig] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Post | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingRepliesRef = useRef<Set<string>>(new Set())
  const formRef = useRef<HTMLFormElement | null>(null)
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
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !postText.trim()) return

    const mentionMatch = postText.match(/@(\w+)/)
    const mentionedName = mentionMatch?.[1]
    const mentionedExpert = topicExperts.find(e => e.name === mentionedName)
    const inReplyToId = replyingTo?.id ?? null

    setSubmitting(true)
    try {
      if (mentionedExpert) {
        const res = await postsApi.mention(id, {
          author: 'user',
          body: postText,
          expert_name: mentionedExpert.name,
          in_reply_to_id: inReplyToId,
        })
        pendingRepliesRef.current.add(res.data.reply_post_id)
        handleApiSuccess(`已向 ${mentionedExpert.label} 提问，等待回复中…`)
      } else {
        await postsApi.create(id, {
          author: 'user',
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

  const handleStartDiscussion = async (model: string, skillList?: string[]) => {
    if (!id) return
    setStartingDiscussion(true)
    const req: StartDiscussionRequest = {
      num_rounds: 5,
      max_turns: 60,
      max_budget_usd: 5.0,
      model,
      skill_list: skillList && skillList.length > 0 ? skillList : undefined,
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

  const renderMarkdown = (content: string) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>

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
  const postsByRound: Record<number, DiscussionPost[]> = {}
  for (const post of discussionPosts) {
    if (!postsByRound[post.round]) postsByRound[post.round] = []
    postsByRound[post.round].push(post)
  }

  const isDiscussionMode = topic.mode === 'discussion' || topic.mode === 'both'
  const modeLabel = topic.mode === 'discussion' ? '圆桌' : topic.mode === 'both' ? '混合' : '人机'

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-[1280px] mx-auto px-6 py-6 flex gap-8">
        {/* Main content */}
        <div className="flex-1 min-w-0">

          {/* Topic title & actions */}
          <div className="flex justify-between items-start mb-6">
            <h1 className="text-2xl font-serif font-bold text-black flex-1">{topic.title}</h1>
            <div className="flex items-center gap-2 ml-4">
              <StatusBadge status={topic.status} />
            </div>
          </div>
          <div className="markdown-content text-gray-700 mb-4">{renderMarkdown(topic.body)}</div>

          {/* Meta info row */}
          <div className="flex items-center gap-3 text-sm text-gray-400 mb-4">
            <span>模式：{modeLabel}</span>
            {topic.category && <span>· 分类：{topic.category}</span>}
            {isDiscussionMode && (
              <>
                <span>·</span>
                <button
                  onClick={() => setShowConfig(v => !v)}
                  className="text-sm font-serif font-medium text-black border border-black px-3 py-1 hover:bg-black hover:text-white transition-colors"
                >
                  圆桌配置 <span className="inline-block w-3 text-center">{showConfig ? '▲' : '▼'}</span>
                </button>
              </>
            )}
          </div>

          {/* Collapsible config panel */}
          {isDiscussionMode && showConfig && (
            <div className="border-l-2 border-gray-100 pl-5 py-2 mb-8">
              <ExpertManagement topicId={id!} onExpertsChange={() => { loadTopic(id!); loadTopicExperts(id!) }} />
              <ModeratorModeConfig
                topicId={id!}
                onModeChange={() => loadTopic(id!)}
                onStartDiscussion={handleStartDiscussion}
                isStarting={startingDiscussion}
                isRunning={polling}
                isCompleted={topic.discussion_status === 'completed'}
                initialSkillIds={initialSkillIds}
              />
            </div>
          )}

          <div className="border-t border-gray-100 my-8" />

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
                  {renderMarkdown(topic.discussion_result.discussion_summary)}
                </div>
              </div>
            </div>
          )}

          {/* In-page progress indicator */}
          {topic.discussion_status === 'running' && (
            <div className="mb-8 border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="spinner" />
                <span className="text-sm font-semibold text-gray-900">话题讨论进行中</span>
                {elapsedSeconds > 0 && (
                  <span className="text-xs text-gray-400 ml-auto">
                    已运行 {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              {progress && progress.total_turns > 0 ? (
                <>
                  <div className="w-full h-1 bg-gray-100 mb-3">
                    <div
                      className="h-1 bg-gray-900 transition-all duration-500"
                      style={{ width: `${Math.min(100, (progress.completed_turns / progress.total_turns) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>
                      {progress.completed_turns > 0
                        ? `${progress.latest_speaker} 已完成发言`
                        : '等待专家开始发言...'}
                    </span>
                    <span>{progress.completed_turns} / {progress.total_turns} 轮次</span>
                  </div>
                  {progress.current_round > 0 && (
                    <div className="mt-2 text-xs text-gray-400">当前第 {progress.current_round} 轮</div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400">主持人正在协调专家，请稍候...</p>
              )}
            </div>
          )}

          {/* Roundtable discussion rounds - multi-column: 2+ on desktop, 1 on mobile */}
          {Object.keys(postsByRound).length > 0 && (
            <div className="mb-8">
              <h2 className="text-base font-semibold text-gray-900 mb-1">圆桌讨论</h2>
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
                      <div key={post.id} className="flex gap-4 py-5 border-b border-gray-100">
                        <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
                          {post.expertName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-gray-900">{post.expertName}</span>
                            <span className="text-[10px] border border-gray-200 text-gray-400 px-1">专家</span>
                          </div>
                          <div className="markdown-content text-sm text-gray-700">
                            {renderMarkdown(post.content)}
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
                <span className="text-xs font-normal text-gray-400 ml-2">— 输入 @ 可追问专家</span>
              )}
            </h2>

            <PostThread
              posts={posts}
              onReply={handleReplyToPost}
              canReply={topic.status === 'open'}
            />

            {topic.status === 'open' ? (
              <form
                ref={formRef}
                onSubmit={handleSubmitPost}
                className="mt-6 pt-4 border-t border-gray-100"
              >
                {replyingTo && (
                  <div className="mb-3 pl-3 border-l-2 border-gray-300 bg-gray-50 py-2 pr-3 rounded-r text-sm flex items-center justify-between">
                    <span className="text-gray-600">
                      回复 <strong>{replyingTo.author_type === 'agent' ? (replyingTo.expert_label ?? replyingTo.author) : replyingTo.author}</strong>
                      {replyingTo.body.length > 40 && `: ${replyingTo.body.slice(0, 40)}...`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      取消
                    </button>
                  </div>
                )}
                <MentionTextarea
                  value={postText}
                  onChange={setPostText}
                  experts={topicExperts}
                  disabled={submitting}
                />
                <button
                  type="submit"
                  className="mt-2 bg-black text-white px-4 py-2 text-sm font-serif hover:bg-gray-900 transition-colors disabled:opacity-50"
                  disabled={submitting || !postText.trim()}
                >
                  {submitting ? '发送中...' : '发送'}
                </button>
              </form>
            ) : (
              <div className="mt-6 pt-4 border-t border-gray-100 py-4 text-center">
                <p className="text-sm font-serif text-gray-400">此话题已关闭，无法跟帖</p>
              </div>
            )}
          </div>
        </div>

        {/* Right navigation sidebar */}
        {hasDiscussion && navItems.length > 0 && (
          <ResizableToc defaultWidth={192} side="right" className="sticky top-20 self-start hidden lg:flex">
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

    </div>
  )
}
