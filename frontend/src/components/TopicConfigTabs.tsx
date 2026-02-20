import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { moderatorModesApi, ROUNDTABLE_MODELS, AssignableModeratorMode } from '../api/client'
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
  onExpertsChange?: () => void
  onModeChange?: () => void
  onStartDiscussion?: (model: string, skillList?: string[], mcpServerIds?: string[]) => Promise<void>
  isStarting?: boolean
  isRunning?: boolean
  isCompleted?: boolean
  initialSkillIds?: string[]
}

export default function TopicConfigTabs({
  topicId,
  topicBody = '',
  onExpertsChange,
  onModeChange,
  onStartDiscussion,
  isStarting = false,
  isRunning = false,
  isCompleted = false,
  initialSkillIds,
}: TopicConfigTabsProps) {
  const [activeTabId, setActiveTabId] = useState<ConfigTabId>('detail')

  // Moderator mode state
  const [modeLoading, setModeLoading] = useState(true)
  const [assignableModes, setAssignableModes] = useState<AssignableModeratorMode[]>([])
  const [selectedModeId, setSelectedModeId] = useState('standard')
  const [numRounds, setNumRounds] = useState(5)
  const [customPrompt, setCustomPrompt] = useState('')
  const [showCustomDialog, setShowCustomDialog] = useState(false)
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
    if (initialSkillIds?.length) {
      setSelectedSkillIds(initialSkillIds)
    }
  }, [topicId, initialSkillIds])

  const skipNextSaveRef = useRef(false)
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    if (!modeLoading) {
      handleSaveMode()
    }
  }, [selectedModeId, numRounds])

  const loadCurrentConfig = async () => {
    try {
      const res = await moderatorModesApi.getConfig(topicId)
      skipNextSaveRef.current = true
      setSelectedModeId(res.data.mode_id)
      setNumRounds(res.data.num_rounds)
      setCustomPrompt(res.data.custom_prompt || '')
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

  const handleGenerateMode = async () => {
    if (!aiPrompt.trim()) {
      handleApiError({ message: '请输入讨论方式描述' }, '请输入讨论方式描述')
      return
    }
    if (aiPrompt.trim().length < 10) {
      handleApiError({ message: '模式描述至少需要 10 个字符' }, '模式描述至少需要 10 个字符')
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

  const tabs = [
    {
      id: 'detail' as ConfigTabId,
      label: '话题详情',
      content: (
        <div className="markdown-content text-gray-700 overflow-auto min-h-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{topicBody || '暂无内容'}</ReactMarkdown>
        </div>
      ),
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
                className="w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                min={1}
                max={999}
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
          <p className="text-xs text-gray-500 mb-2 flex-shrink-0">点击 + 选择要启用的 MCP 服务器，选中的会拷贝到话题工作区。</p>
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
      label: '话题讨论',
      content: (
        <div className="space-y-4 overflow-auto min-h-0">
          <div>
            <p className="text-xs text-gray-500 mb-2">选择推理模型。</p>
            <select
              className={inputClass}
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
              className="bg-gray-900 hover:bg-black text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
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
      <TabPanel
        tabs={tabs}
        activeId={activeTabId}
        onChange={(id) => setActiveTabId(id as ConfigTabId)}
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
                disabled={generating || !aiPrompt.trim() || aiPrompt.trim().length < 10}
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
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await handleSaveMode()
                  setShowCustomDialog(false)
                }}
                className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                完成
              </button>
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
    </>
  )
}
