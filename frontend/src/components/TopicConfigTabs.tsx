import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { moderatorModesApi, ROUNDTABLE_MODELS, AssignableModeratorMode, topicsApi, SourceFeedArticle } from '../api/client'
import SourceArticlePreviewCard from './SourceArticlePreviewCard'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'
import { inputClass } from './selectors/styles'
import TabPanel from './TabPanel'
import ExpertManagement from './ExpertManagement'
import ModeratorModeSelector from './ModeratorModeSelector'
import SkillSelector from './SkillSelector'
import MCPServerSelector from './MCPServerSelector'

export type ConfigTabId = 'detail' | 'experts' | 'mode' | 'skills' | 'mcp' | 'model'

interface TopicConfigTabsProps {
  topicId: string
  topicBody?: string
  onTopicBodyUpdated?: (body: string) => void
  onExpertsChange?: () => void
  onModeChange?: () => void
  onStartDiscussion?: (model: string, skillList?: string[], mcpServerIds?: string[]) => Promise<void>
  isStarting?: boolean
  isRunning?: boolean
  isCompleted?: boolean
  initialSkillIds?: string[]
  linkedSourceArticle?: SourceFeedArticle | null
  viewportWidth?: number
}

export default function TopicConfigTabs({
  topicId,
  topicBody = '',
  onTopicBodyUpdated,
  onExpertsChange,
  onModeChange,
  onStartDiscussion,
  isStarting = false,
  isRunning = false,
  isCompleted = false,
  initialSkillIds,
  linkedSourceArticle,
  viewportWidth,
}: TopicConfigTabsProps) {
  const [activeTabId, setActiveTabId] = useState<ConfigTabId>('detail')
  const [detailBody, setDetailBody] = useState(topicBody)
  const [editingDetail, setEditingDetail] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)

  // Moderator mode state
  const [modeLoading, setModeLoading] = useState(true)
  const [assignableModes, setAssignableModes] = useState<AssignableModeratorMode[]>([])
  const [selectedModeId, setSelectedModeId] = useState('standard')
  const [numRounds, setNumRounds] = useState(5)
  const [customPrompt, setCustomPrompt] = useState('')
  const [showCustomDialog, setShowCustomDialog] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [shareModeId, setShareModeId] = useState('')
  const [shareName, setShareName] = useState('')
  const [shareDescription, setShareDescription] = useState('')
  const [sharing, setSharing] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  // Skills, MCP, Model
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(ROUNDTABLE_MODELS[0].value)

  useEffect(() => {
    loadCurrentConfig()
    moderatorModesApi.listAssignable().then((r) => setAssignableModes(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [topicId])

  useEffect(() => {
    if (!editingDetail) {
      setDetailBody(topicBody || '')
    }
  }, [topicBody, editingDetail])


  const skipNextSaveRef = useRef(false)
  const skipNextPrefsSaveRef = useRef(false)
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    if (!modeLoading) {
      handleSaveMode()
    }
  }, [selectedModeId, numRounds])

  const savePrefs = async () => {
    try {
      await moderatorModesApi.setConfig(topicId, {
        mode_id: selectedModeId,
        num_rounds: numRounds,
        custom_prompt: selectedModeId === 'custom' ? customPrompt : null,
        skill_list: selectedSkillIds,
        mcp_server_ids: selectedMcpIds,
        model: selectedModel,
      })
    } catch (err: unknown) {
      handleApiError(err, '保存配置失败')
    }
  }
  useEffect(() => {
    if (skipNextPrefsSaveRef.current) {
      skipNextPrefsSaveRef.current = false
      return
    }
    if (!modeLoading) {
      savePrefs()
    }
  }, [selectedSkillIds, selectedMcpIds, selectedModel])

  const loadCurrentConfig = async () => {
    try {
      const res = await moderatorModesApi.getConfig(topicId)
      skipNextSaveRef.current = true
      skipNextPrefsSaveRef.current = true
      setSelectedModeId(res.data.mode_id)
      setNumRounds(res.data.num_rounds)
      setCustomPrompt(res.data.custom_prompt || '')
      setSelectedSkillIds(res.data.skill_list?.length ? res.data.skill_list : (initialSkillIds || []))
      setSelectedMcpIds(res.data.mcp_server_ids || [])
      if (res.data.model) setSelectedModel(res.data.model)
    } catch (err) {
      handleApiError(err, '加载主持人配置失败')
    } finally {
      setModeLoading(false)
    }
  }

  const handleSaveMode = async () => {
    try {
      await moderatorModesApi.setConfig(topicId, {
        mode_id: selectedModeId,
        num_rounds: numRounds,
        custom_prompt: selectedModeId === 'custom' ? customPrompt : null,
      })
      await loadCurrentConfig()
      onModeChange?.()
      handleApiSuccess('讨论方式已更新')
    } catch (err: unknown) {
      handleApiError(err, '保存失败')
    }
  }

  const handleShareMode = async () => {
    const modeId = shareModeId.trim().toLowerCase().replace(/\s+/g, '_')
    if (!modeId || !/^[a-z0-9_]+$/.test(modeId)) {
      handleApiError({ message: '请输入有效的模式 ID（仅小写字母、数字、下划线）' }, '分享失败')
      return
    }
    setSharing(true)
    try {
      await moderatorModesApi.share(topicId, {
        mode_id: modeId,
        name: shareName.trim() || undefined,
        description: shareDescription.trim() || undefined,
      })
      setShowShareDialog(false)
      setShareModeId('')
      setShareName('')
      setShareDescription('')
      moderatorModesApi.listAssignable().then((r) => setAssignableModes(Array.isArray(r.data) ? r.data : [])).catch(() => {})
      handleApiSuccess('已共享到讨论方式库')
    } catch (err: unknown) {
      handleApiError(err, '分享失败')
    } finally {
      setSharing(false)
    }
  }

  const handleGenerateMode = async () => {
    if (!aiPrompt.trim()) {
      handleApiError({ message: '请输入讨论方式描述' }, '请输入讨论方式描述')
      return
    }
    if (!aiPrompt.trim()) {
      handleApiError({ message: '请输入模式描述' }, '请输入模式描述')
      return
    }
    setGenerating(true)
    try {
      const res = await moderatorModesApi.generate(topicId, { prompt: aiPrompt })
      setCustomPrompt(res.data.custom_prompt)
      setAiPrompt('')
      handleApiSuccess('AI 生成成功！请检查并编辑主持人提示词')
    } catch (err: unknown) {
      handleApiError(err, 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleStartDiscussion = async () => {
    await handleSaveMode()
    await onStartDiscussion?.(
      selectedModel,
      selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
      selectedMcpIds.length > 0 ? selectedMcpIds : undefined
    )
  }

  const handleSaveTopicBody = async () => {
    setSavingDetail(true)
    try {
      const res = await topicsApi.update(topicId, { body: detailBody })
      const updatedBody = res.data.body || ''
      setDetailBody(updatedBody)
      setEditingDetail(false)
      onTopicBodyUpdated?.(updatedBody)
      handleApiSuccess('话题描述已更新')
    } catch (err) {
      handleApiError(err, '更新话题描述失败')
    } finally {
      setSavingDetail(false)
    }
  }

  const tabs = [
    {
      id: 'detail' as ConfigTabId,
      label: '话题详情',
      content: (() => {
        const showSideBySide = !editingDetail && !!linkedSourceArticle && (viewportWidth ?? 0) >= 1200
        const showHorizontal = !editingDetail && !!linkedSourceArticle && (viewportWidth ?? 0) < 1200
        return (
          <div>
            <div className="flex items-center justify-between mb-3">
              {!editingDetail ? (
                <button
                  type="button"
                  onClick={() => setEditingDetail(true)}
                  className="text-xs border border-gray-200 rounded px-2.5 py-1 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  编辑描述
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailBody(topicBody || '')
                      setEditingDetail(false)
                    }}
                    className="text-xs border border-gray-200 rounded px-2.5 py-1 text-gray-600 hover:bg-gray-50 transition-colors"
                    disabled={savingDetail}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTopicBody}
                    className="text-xs bg-black text-white rounded px-2.5 py-1 hover:bg-gray-900 transition-colors disabled:opacity-50"
                    disabled={savingDetail}
                  >
                    {savingDetail ? '保存中...' : '保存'}
                  </button>
                </div>
              )}
            </div>
            {editingDetail ? (
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none transition-colors min-h-[160px] resize-y"
                value={detailBody}
                onChange={(e) => setDetailBody(e.target.value)}
                placeholder="输入话题描述（支持 Markdown）"
              />
            ) : showSideBySide ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 markdown-content text-gray-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {detailBody || '暂无内容'}
                  </ReactMarkdown>
                </div>
                <div data-testid="source-article-vertical-card" className="self-start">
                  <SourceArticlePreviewCard article={linkedSourceArticle!} layout="vertical" />
                </div>
              </div>
            ) : (
              <>
                <div className="markdown-content text-gray-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {detailBody || '暂无内容'}
                  </ReactMarkdown>
                </div>
                {showHorizontal && (
                  <div data-testid="source-article-horizontal-card" className="mt-4">
                    <SourceArticlePreviewCard article={linkedSourceArticle!} layout="horizontal" />
                  </div>
                )}
              </>
            )}
          </div>
        )
      })(),
    },
    {
      id: 'experts' as ConfigTabId,
      label: '角色',
      content: (
        <div className="h-full flex flex-col min-h-0 overflow-hidden">
          <ExpertManagement topicId={topicId} onExpertsChange={onExpertsChange} fillHeight />
        </div>
      ),
    },
    {
      id: 'mode' as ConfigTabId,
      label: '讨论方式',
      content: modeLoading ? (
        <p className="text-gray-500 text-sm">加载中...</p>
      ) : (
        <div className="h-full flex flex-col min-h-0 overflow-hidden">
          <p className="text-xs text-gray-500 mb-2 flex-shrink-0">点击 + 选择讨论方式，选中的会用于本次讨论。</p>
          <div className="flex flex-wrap items-center gap-3 flex-shrink-0 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">讨论轮数</span>
              <input
                type="number"
                className="w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-serif focus:border-black focus:outline-none transition-colors"
                min={1}
                max={20}
                value={numRounds}
                onChange={(e) => setNumRounds(parseInt(e.target.value) || 1)}
              />
            </div>
            {selectedModeId && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-black">
                  {selectedModeId === 'custom' ? '自定义模式' : assignableModes.find((m) => m.id === selectedModeId)?.name ?? selectedModeId}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedModeId('standard')}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200 transition-colors text-sm"
                  aria-label="取消选择"
                >
                  ×
                </button>
              </div>
            )}
            <button
              onClick={() => {
                setSelectedModeId('custom')
                setShowCustomDialog(true)
              }}
              className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              创建或编辑自定义模式
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <ModeratorModeSelector
                value={selectedModeId}
                onChange={setSelectedModeId}
                fillHeight
                hideSelectedChips
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'skills' as ConfigTabId,
      label: '技能',
      content: (
        <div className="h-full flex flex-col min-h-0 overflow-hidden">
          <p className="text-xs text-gray-500 mb-2 flex-shrink-0">
            点击 + 将技能加入话题，选中的会拷贝到工作区供主持人分配给各角色。
          </p>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SkillSelector
              value={selectedSkillIds}
              onChange={setSelectedSkillIds}
              fillHeight
            />
          </div>
        </div>
      ),
    },
    {
      id: 'mcp' as ConfigTabId,
      label: 'MCP',
      content: (
        <div className="h-full flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <MCPServerSelector
              value={selectedMcpIds}
              onChange={setSelectedMcpIds}
              fillHeight
            />
          </div>
        </div>
      ),
    },
    {
      id: 'model' as ConfigTabId,
      label: 'AI讨论',
      highlight: true,
      content: (
        <div className="space-y-4 overflow-auto min-h-0">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              启动前请确认：<strong>角色</strong>、<strong>讨论方式</strong>、<strong>技能</strong>等是否已配置好；也可使用默认配置。选择推理模型后即可开始。
            </p>
            <p className="text-xs text-gray-500 mb-2">选择推理模型</p>
            <select
              className={`${inputClass} max-w-xs`}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isStarting || isRunning}
            >
              {ROUNDTABLE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {onStartDiscussion && (
            <button
              onClick={handleStartDiscussion}
              disabled={isStarting || isRunning}
              className="border border-gray-300 bg-gray-100 text-gray-800 px-4 py-2 rounded-lg text-sm font-serif font-medium hover:bg-gray-200 hover:border-gray-400 transition-colors disabled:opacity-60 disabled:bg-gray-50 disabled:border-gray-200 disabled:text-gray-400"
            >
              {isStarting ? '启动中...' : isRunning ? '运行中...' : isCompleted ? '重新启动' : '启动讨论'}
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      {/* 当不在 AI 讨论 标签且未发起过讨论时，显示快捷入口（移动端该标签可能被横向滚动遮挡） */}
      {activeTabId !== 'model' && onStartDiscussion && !isRunning && !isCompleted && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setActiveTabId('model')}
            className="w-full md:w-auto md:inline-flex flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-gray-300 bg-gray-100 text-gray-800 text-sm font-medium hover:bg-gray-200 hover:border-gray-400 active:bg-gray-300 transition-colors"
          >
            <span>启动 AI 讨论</span>
            <svg className="w-4 h-4 text-gray-500 animate-nudge-right" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
        </div>
      )}
      <TabPanel
        tabs={tabs}
        activeId={activeTabId}
        onChange={(id) => setActiveTabId(id as ConfigTabId)}
        autoHeightTabId="detail"
      />
      {/* Custom prompt dialog */}
      {showCustomDialog && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowCustomDialog(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-[90%] max-h-[80vh] overflow-auto border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 mb-1">自定义主持人提示词</h3>
            <p className="text-sm text-gray-500 mb-4">编写主持人的完整提示词。可以使用以下占位符：</p>
            <code className="block bg-gray-900 text-gray-100 rounded-lg p-3 text-xs font-mono mb-4">
              {'{topic}'} - 话题标题{'\n'}
              {'{ws_abs}'} - 工作目录路径{'\n'}
              {'{expert_names_str}'} - 角色名称列表{'\n'}
              {'{num_experts}'} - 角色数量{'\n'}
              {'{num_rounds}'} - 轮数
            </code>
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-1">AI 生成主持人提示词</label>
              <textarea
                className={`${inputClass} min-h-[80px] mb-2 resize-none`}
                placeholder="描述你需要的讨论模式，例如：我需要一个评估 AI 风险的主持模式，要求深入讨论潜在问题..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <button
                onClick={handleGenerateMode}
                className="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                disabled={generating || !aiPrompt.trim()}
              >
                {generating ? 'AI 生成中...' : 'AI 生成提示词'}
              </button>
              <p className="text-xs text-gray-400 mt-1.5">描述讨论的重点、流程、收敛策略和期望的产出物</p>
            </div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">主持人提示词（Markdown）</label>
            <textarea
              className={`${inputClass} min-h-[350px] font-mono resize-y mb-4`}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="使用上方 AI 生成，或手动输入主持人提示词..."
            />
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={async () => {
                  await handleSaveMode()
                  setShowCustomDialog(false)
                }}
                className="bg-black text-white px-4 py-2 rounded-lg text-sm font-serif font-medium hover:bg-gray-900 transition-colors"
              >
                完成
              </button>
              {customPrompt.trim() && (
                <button
                  onClick={() => {
                    setShareModeId('')
                    setShareName('')
                    setShareDescription('')
                    setShowShareDialog(true)
                  }}
                  className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  共享到讨论方式库
                </button>
              )}
              <button
                onClick={() => setShowCustomDialog(false)}
                className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Share moderator mode dialog */}
      {showShareDialog && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowShareDialog(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-md w-[90%] border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 mb-3">共享到讨论方式库</h3>
            <p className="text-sm text-gray-500 mb-4">将当前自定义模式共享到平台，所有用户均可添加使用。</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">模式 ID（必填，小写字母、数字、下划线）</label>
                <input
                  type="text"
                  className={`${inputClass} w-full`}
                  placeholder="例如 risk_assessment"
                  value={shareModeId}
                  onChange={(e) => setShareModeId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">显示名称（选填）</label>
                <input
                  type="text"
                  className={`${inputClass} w-full`}
                  placeholder="例如 风险评估模式"
                  value={shareName}
                  onChange={(e) => setShareName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述（选填）</label>
                <input
                  type="text"
                  className={`${inputClass} w-full`}
                  placeholder="简要描述该模式的用途"
                  value={shareDescription}
                  onChange={(e) => setShareDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleShareMode}
                disabled={sharing || !shareModeId.trim()}
                className="bg-black text-white px-4 py-2 rounded-lg text-sm font-serif font-medium hover:bg-gray-900 transition-colors disabled:opacity-50"
              >
                {sharing ? '共享中...' : '确认共享'}
              </button>
              <button
                onClick={() => setShowShareDialog(false)}
                className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
