import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getProfile, getStructuredProfile, publishTwin } from '../profileHelperApi'
import type { StructuredProfile } from '../types'
import { ProfileHeader } from '../components/profile/ProfileHeader'
import { CapabilitySection } from '../components/profile/CapabilitySection'
import { NeedsSection } from '../components/profile/NeedsSection'
import { CognitiveStyleSection } from '../components/profile/CognitiveStyleSection'
import { MotivationSection } from '../components/profile/MotivationSection'
import { PersonalitySection } from '../components/profile/PersonalitySection'
import { InterpretationSection } from '../components/profile/InterpretationSection'
import { ScientistMatchSection } from '../components/ScientistMatchSection'
import { authApi, DigitalTwinDetail, DigitalTwinRecord, tokenManager } from '../../../api/auth'
import ReactMarkdown from 'react-markdown'

// ── 工具函数 ────────────────────────────────────────────────────

const SESSION_KEYS = ['tashan_session_id', 'tashan_profile_session_id'] as const
const PLACEHOLDER_NAMES = /^(unnamed(-\d{4}-\d{2}-\d{2})?|未命名|forum_profile|论坛画像|identity)$/i

function isPlaceholderDisplayName(name: string | null | undefined): boolean {
  if (!name?.trim()) return true
  return PLACEHOLDER_NAMES.test(name.trim())
}

function getStoredSessionId(): string | null {
  for (const key of SESSION_KEYS) {
    const value = localStorage.getItem(key)
    if (!value) continue
    const normalized = value.trim().toLowerCase()
    if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'none') continue
    return value
  }
  return null
}

// ── 主组件 ───────────────────────────────────────────────────────

export function ProfilePage() {
  const [structured, setStructured] = useState<StructuredProfile | null>(null)
  const [forumProfile, setForumProfile] = useState('')
  // TopicLab 独有：发布/历史记录
  const [digitalTwins, setDigitalTwins] = useState<DigitalTwinRecord[]>([])
  const [publishName, setPublishName] = useState('')
  const [publishVisibility, setPublishVisibility] = useState<'private' | 'public'>('private')
  const [publishExposure, setPublishExposure] = useState<'brief' | 'full'>('brief')
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)
  const [selectedTwinAgent, setSelectedTwinAgent] = useState<string | null>(null)
  const [selectedTwinDetail, setSelectedTwinDetail] = useState<DigitalTwinDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sessionId = getStoredSessionId()

  const handleSelectTwin = useCallback(async (agentName: string) => {
    const token = tokenManager.get()
    if (!token) return
    setSelectedTwinAgent(agentName)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const detail = await authApi.getDigitalTwinDetail(token, agentName)
      setSelectedTwinDetail(detail.digital_twin)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e))
      setSelectedTwinDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }

    Promise.all([
      getStructuredProfile(sessionId),
      getProfile(sessionId),
      // TopicLab 独有：digital twins（失败时静默降级为空列表）
      (() => {
        const token = tokenManager.get()
        if (!token) return Promise.resolve<{ digital_twins: DigitalTwinRecord[] }>({ digital_twins: [] })
        return authApi.getDigitalTwins(token).catch(() => ({ digital_twins: [] as DigitalTwinRecord[] }))
      })(),
    ])
      .then(([sp, raw, twinsData]) => {
        setStructured(sp)
        setForumProfile(raw.forum_profile)
        const twins = twinsData.digital_twins || []
        setDigitalTwins(twins)
        const firstName = twins[0]?.display_name
        if (firstName && !isPlaceholderDisplayName(firstName)) {
          setPublishName(firstName)
        } else {
          setPublishName('我的数字分身')
        }
        if (twins[0]?.agent_name) void handleSelectTwin(twins[0].agent_name)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [handleSelectTwin, sessionId])

  // ── 守卫条件 ─────────────────────────────────────────────────

  if (loading) return <div className="page-loading">加载中...</div>

  if (!sessionId) {
    return (
      <div className="page-empty">
        <h2>尚未建立分身</h2>
        <p>请先在「对话采集」页面完成基础信息采集。</p>
        <Link to="/profile-helper" className="btn-primary">开始创建</Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-empty">
        <h2>加载画像失败</h2>
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>
        <p>请尝试刷新页面，或重新进入对话页面。</p>
        <Link to="/profile-helper" className="btn-primary">返回对话</Link>
      </div>
    )
  }

  if (!structured) return <div className="page-loading">解析中...</div>

  // ── TopicLab 独有：发布/历史 ─────────────────────────────────

  const refreshTwinRecords = async () => {
    const token = tokenManager.get()
    if (!token) return
    const data = await authApi.getDigitalTwins(token)
    const twins = data.digital_twins || []
    setDigitalTwins(twins)
    if (!twins.length) {
      setSelectedTwinAgent(null)
      setSelectedTwinDetail(null)
      return
    }
    const targetAgent =
      selectedTwinAgent && twins.some((item) => item.agent_name === selectedTwinAgent)
        ? selectedTwinAgent
        : twins[0].agent_name
    await handleSelectTwin(targetAgent)
  }

  const handlePublish = async () => {
    if (!sessionId) return
    const displayName = publishName.trim() || '我的数字分身'
    setPublishing(true)
    setPublishResult(null)
    try {
      const result = await publishTwin({
        session_id: sessionId,
        display_name: displayName,
        visibility: publishVisibility,
        exposure: publishExposure,
      })
      await refreshTwinRecords()
      setPublishResult(`发布成功：${result.display_name}（${result.visibility} / ${result.exposure}）`)
    } catch (e) {
      setPublishResult(`发布失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPublishing(false)
    }
  }

  // ── 渲染 ─────────────────────────────────────────────────────

  return (
    <div className="pv-page">

      {/* ── 1. 结构化画像维度（对齐 digital-twin-bootstrap）── */}
      <ProfileHeader profile={structured} />
      <CapabilitySection capability={structured.capability} />
      <NeedsSection needs={structured.needs} />
      <CognitiveStyleSection data={structured.cognitive_style} />
      <MotivationSection data={structured.motivation} />
      <PersonalitySection data={structured.personality} />
      <InterpretationSection data={structured.interpretation} />
      <ScientistMatchSection sessionId={sessionId} />

      {/* ── 2. 他山论坛分身（原始 Markdown）── */}
      {forumProfile && (
        <section className="pv-section">
          <h3 className="pv-section-title">他山论坛分身</h3>
          <div className="pv-forum-body">
            <ReactMarkdown>{forumProfile}</ReactMarkdown>
          </div>
        </section>
      )}

      {/* ── 3. 底部操作栏 ── */}
      <div className="pv-bottom-bar no-print">
        <button type="button" className="btn-secondary" onClick={() => window.print()}>
          导出 PDF（打印）
        </button>
        <a
          href={`${import.meta.env.BASE_URL}api/profile-helper/download/${sessionId}`}
          download="profile.md"
          className="btn-secondary"
        >
          下载科研分身
        </a>
        {forumProfile && (
          <a
            href={`${import.meta.env.BASE_URL}api/profile-helper/download/${sessionId}/forum`}
            download="forum-profile.md"
            className="btn-secondary"
          >
            下载论坛分身
          </a>
        )}
        <Link to="/profile-helper/scales" className="btn-secondary">
          量表校对
        </Link>
      </div>

      {/* ── 4. TopicLab 独有：账号系统状态横幅 ── */}
      {digitalTwins.length > 0 ? (
        <div className="twin-record-banner">
          已记录到账号系统：{digitalTwins[0].display_name || digitalTwins[0].agent_name}
          {digitalTwins[0].updated_at
            ? `（最近更新：${new Date(digitalTwins[0].updated_at).toLocaleString()}）`
            : ''}
        </div>
      ) : (
        <div className="twin-record-banner twin-record-banner-pending">
          尚未记录到账号系统数据库，完成发布后会自动写入。
        </div>
      )}

      {/* ── 5. TopicLab 独有：发布入库 ── */}
      <section className="twin-publish-card">
        <h3>发布与入库</h3>
        <div className="twin-publish-grid">
          <label className="twin-publish-field">
            <span>分身名称</span>
            <input
              value={publishName}
              onChange={(e) => setPublishName(e.target.value)}
              placeholder="请输入分身名称"
            />
          </label>
          <label className="twin-publish-field">
            <span>可见性</span>
            <select
              value={publishVisibility}
              onChange={(e) => setPublishVisibility(e.target.value as 'private' | 'public')}
            >
              <option value="private">私有</option>
              <option value="public">公开（可共享）</option>
            </select>
          </label>
          <label className="twin-publish-field">
            <span>发布内容</span>
            <select
              value={publishExposure}
              onChange={(e) => setPublishExposure(e.target.value as 'brief' | 'full')}
            >
              <option value="brief">简介版</option>
              <option value="full">完整版</option>
            </select>
          </label>
        </div>
        <div className="twin-publish-actions">
          <button type="button" className="btn-primary" onClick={handlePublish} disabled={publishing}>
            {publishing ? '发布中...' : '改名并发布到网站'}
          </button>
          {publishResult && <p className="twin-publish-result">{publishResult}</p>}
        </div>
      </section>

      {/* ── 6. TopicLab 独有：历史分身记录 ── */}
      <section className="twin-history-card">
        <div className="twin-history-header">
          <h3>历史分身记录</h3>
          <span>{digitalTwins.length} 条</span>
        </div>
        {digitalTwins.length === 0 ? (
          <div className="twin-history-empty">暂无历史分身记录，发布后将自动写入数据库。</div>
        ) : (
          <div className="twin-history-layout">
            <div className="twin-history-list">
              {digitalTwins.map((item) => {
                const isActive = item.agent_name === selectedTwinAgent
                const isShared = item.visibility === 'public'
                return (
                  <button
                    key={item.agent_name}
                    type="button"
                    className={`twin-history-item ${isActive ? 'active' : ''}`}
                    onClick={() => void handleSelectTwin(item.agent_name)}
                  >
                    <div className="twin-history-item-title">{item.display_name || item.agent_name}</div>
                    <div className="twin-history-item-meta">
                      <span className={`twin-status-badge ${isShared ? 'shared' : 'private'}`}>
                        {isShared ? '共享' : '私有'}
                      </span>
                      <span>
                        {item.updated_at ? new Date(item.updated_at).toLocaleString() : '无更新时间'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="twin-history-detail">
              {!selectedTwinAgent ? (
                <div className="twin-history-empty">请选择左侧分身查看详情。</div>
              ) : detailLoading ? (
                <div className="twin-history-empty">详情加载中...</div>
              ) : detailError ? (
                <div className="twin-history-empty">加载详情失败：{detailError}</div>
              ) : selectedTwinDetail ? (
                <>
                  <h4>{selectedTwinDetail.display_name || selectedTwinDetail.agent_name}</h4>
                  <div className="twin-history-detail-meta">
                    状态：{selectedTwinDetail.visibility === 'public' ? '共享' : '私有'} / 内容：
                    {selectedTwinDetail.exposure === 'full' ? '完整版' : '简介版'}
                  </div>
                  <div className="twin-history-detail-meta">
                    最后更新时间：
                    {selectedTwinDetail.updated_at
                      ? new Date(selectedTwinDetail.updated_at).toLocaleString()
                      : '暂无'}
                  </div>
                  <pre className="twin-history-detail-content">
                    {selectedTwinDetail.role_content?.trim() || '该记录暂无详情内容。'}
                  </pre>
                </>
              ) : (
                <div className="twin-history-empty">暂无可展示详情。</div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
