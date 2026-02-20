import { useState, useEffect } from 'react'
import {
  ModeratorModeConfig,
  ModeratorModeInfo,
  moderatorModesApi,
  ROUNDTABLE_MODELS,
} from '../api/client'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'
import SkillSelector from './SkillSelector'

interface ModeratorModeConfigProps {
  topicId: string
  onModeChange?: () => void
  onStartDiscussion?: (model: string, skillList?: string[]) => Promise<void>
  isStarting?: boolean
  isRunning?: boolean
  isCompleted?: boolean
  initialSkillIds?: string[]
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent'
const labelClass = 'block text-sm font-semibold text-gray-700 mb-1'

export default function ModeratorModeConfigComponent({
  topicId,
  onModeChange,
  onStartDiscussion,
  isStarting = false,
  isRunning = false,
  isCompleted = false,
  initialSkillIds,
}: ModeratorModeConfigProps) {
  const [presetModes, setPresetModes] = useState<ModeratorModeInfo[]>([])
  const [currentConfig, setCurrentConfig] = useState<ModeratorModeConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedModeId, setSelectedModeId] = useState('standard')
  const [numRounds, setNumRounds] = useState(5)
  const [customPrompt, setCustomPrompt] = useState('')
  const [showCustomDialog, setShowCustomDialog] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [selectedModel, setSelectedModel] = useState(ROUNDTABLE_MODELS[0].value)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])

  useEffect(() => {
    loadPresetModes()
    loadCurrentConfig()
  }, [topicId])

  useEffect(() => {
    if (initialSkillIds?.length) {
      setSelectedSkillIds(initialSkillIds)
    }
  }, [topicId, initialSkillIds])

  const loadPresetModes = async () => {
    try {
      const res = await moderatorModesApi.listPresets()
      setPresetModes(res.data)
    } catch (err) {
      handleApiError(err, '加载预设模式失败')
    }
  }

  const loadCurrentConfig = async () => {
    try {
      const res = await moderatorModesApi.getConfig(topicId)
      setCurrentConfig(res.data)
      setSelectedModeId(res.data.mode_id)
      setNumRounds(res.data.num_rounds)
      setCustomPrompt(res.data.custom_prompt || '')
    } catch (err) {
      handleApiError(err, '加载主持人配置失败')
    } finally {
      setLoading(false)
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
      handleApiSuccess('主持人模式已更新')
    } catch (err: any) {
      handleApiError(err, '保存失败')
    }
  }

  const handleGenerateMode = async () => {
    if (!aiPrompt.trim()) { handleApiError({ message: '请输入主持人模式描述' }, '请输入主持人模式描述'); return }
    if (aiPrompt.trim().length < 10) { handleApiError({ message: '模式描述至少需要 10 个字符' }, '模式描述至少需要 10 个字符'); return }
    setGenerating(true)
    try {
      const res = await moderatorModesApi.generate(topicId, { prompt: aiPrompt })
      setCustomPrompt(res.data.custom_prompt)
      setAiPrompt('')
      handleApiSuccess('AI 生成成功！请检查并编辑主持人提示词')
    } catch (err: any) {
      handleApiError(err, 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const getCurrentMode = () => {
    if (currentConfig?.mode_id === 'custom') {
      return { id: 'custom', name: '自定义模式', description: '用户自定义的主持人提示词' }
    }
    return presetModes.find((m) => m.id === currentConfig?.mode_id) || presetModes[0]
  }

  if (loading) return <p className="text-gray-500 text-sm">加载中...</p>

  const currentMode = getCurrentMode()

  return (
    <div className="mb-6">
      <h3 className="font-semibold text-gray-900 mb-4">主持人模式</h3>

      {/* Current mode display */}
      <div className="p-4 border border-gray-200 mb-4 bg-gray-50">
        <div className="font-serif font-semibold text-black mb-1 text-sm">当前模式：{currentMode?.name}</div>
        <div className="text-sm font-serif text-gray-600 mb-1">{currentMode?.description}</div>
        <div className="text-xs font-serif text-gray-400">轮数：{currentConfig?.num_rounds} 轮</div>
      </div>

      {/* Mode selector cards */}
      <div className="mb-4">
        <label className={labelClass}>选择主持人模式</label>
        <div className="flex flex-col gap-2">
          {presetModes.map((mode) => (
            <label
              key={mode.id}
              className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                selectedModeId === mode.id
                  ? 'border-gray-900 bg-gray-50'
                  : 'border-gray-100 bg-gray-50 hover:border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="modeId"
                value={mode.id}
                checked={selectedModeId === mode.id}
                onChange={() => setSelectedModeId(mode.id)}
                className="mt-0.5 accent-gray-900"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">{mode.name}</div>
                <div className="text-xs text-gray-500">{mode.description}</div>
              </div>
            </label>
          ))}
          <label
            className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
              selectedModeId === 'custom'
                ? 'border-gray-900 bg-gray-50'
                : 'border-gray-100 bg-gray-50 hover:border-gray-200'
            }`}
          >
            <input
              type="radio"
              name="modeId"
              value="custom"
              checked={selectedModeId === 'custom'}
              onChange={() => setSelectedModeId('custom')}
              className="mt-0.5 accent-gray-900"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">自定义模式</div>
              <div className="text-xs text-gray-500">手动编写主持人提示词</div>
            </div>
          </label>
        </div>
      </div>

      {/* Num rounds */}
      <div className="mb-4">
        <label className={labelClass}>讨论轮数</label>
        <input
          type="number"
          className={inputClass}
          min="1"
          max="10"
          value={numRounds}
          onChange={(e) => setNumRounds(parseInt(e.target.value))}
        />
      </div>

      {/* Custom prompt button */}
      {selectedModeId === 'custom' && (
        <div className="mb-4">
          <button
            onClick={() => setShowCustomDialog(true)}
            className="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            编辑自定义主持人提示词
          </button>
        </div>
      )}

      {/* Convergence strategy for preset modes */}
      {selectedModeId !== 'custom' && (
        <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 mb-4">
          <span className="font-semibold">收敛策略：</span>
          {presetModes.find((m) => m.id === selectedModeId)?.convergence_strategy}
        </div>
      )}

      {onStartDiscussion ? (
        <>
          <div className="mb-4">
            <label className={labelClass}>可选技能（主持人将分配给角色）</label>
            <p className="text-xs text-gray-500 mb-2">点击 + 将技能加入话题，选中的技能会拷贝到工作区供主持人分配给各角色。</p>
            <SkillSelector value={selectedSkillIds} onChange={setSelectedSkillIds} maxHeight="320px" />
          </div>
          <div className="mb-4">
            <label className={labelClass}>推理模型</label>
            <select
              className={inputClass}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isStarting || isRunning}
            >
              {ROUNDTABLE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={async () => {
              await handleSaveMode()
              await onStartDiscussion(selectedModel, selectedSkillIds.length > 0 ? selectedSkillIds : undefined)
            }}
            disabled={isStarting || isRunning}
            className="bg-gray-900 hover:bg-black text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isStarting ? '启动中...' : isRunning ? '运行中...' : isCompleted ? '重新启动' : '启动讨论'}
          </button>
        </>
      ) : (
        <button onClick={handleSaveMode} className="bg-gray-900 hover:bg-black text-white px-4 py-2 text-sm font-medium transition-colors">
          保存模式配置
        </button>
      )}

      {/* Custom prompt dialog */}
      {showCustomDialog && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowCustomDialog(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl p-6 max-w-2xl w-[90%] max-h-[80vh] overflow-auto"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 mb-1">自定义主持人提示词</h3>
            <p className="text-sm text-gray-500 mb-4">
              编写主持人的完整提示词。可以使用以下占位符：
            </p>
            <code className="block bg-gray-900 text-gray-100 rounded-lg p-3 text-xs font-mono mb-4">
              {'{topic}'} - 话题标题{'\n'}
              {'{ws_abs}'} - 工作目录路径{'\n'}
              {'{expert_names_str}'} - 角色名称列表{'\n'}
              {'{num_experts}'} - 角色数量{'\n'}
              {'{num_rounds}'} - 轮数
            </code>

            {/* AI Generate Section */}
            <div className="mb-4 p-4 bg-gray-50 rounded-xl">
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
              className={`${inputClass} min-h-[350px] font-mono resize-vertical mb-4`}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="使用上方 AI 生成，或手动输入主持人提示词..."
            />

            <div className="flex gap-2">
              <button onClick={() => setShowCustomDialog(false)} className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">完成</button>
              <button onClick={() => setShowCustomDialog(false)} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
