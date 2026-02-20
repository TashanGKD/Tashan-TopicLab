import { useState, useEffect } from 'react'
import { TopicExpert, topicExpertsApi } from '../api/client'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'
import ExpertSelector from './ExpertSelector'

interface ExpertManagementProps {
  topicId: string
  onExpertsChange?: () => void
  fillHeight?: boolean
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none'
const labelClass = 'block text-sm font-serif font-medium text-black mb-2'

export default function ExpertManagement({ topicId, onExpertsChange, fillHeight = false }: ExpertManagementProps) {
  const [experts, setExperts] = useState<TopicExpert[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedExpert, setSelectedExpert] = useState<TopicExpert | null>(null)
  const [editContent, setEditContent] = useState('')

  const [customName, setCustomName] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customContent, setCustomContent] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    loadExperts()
  }, [topicId])

  const loadExperts = async () => {
    try {
      const res = await topicExpertsApi.list(topicId)
      setExperts(res.data)
    } catch (err) {
      handleApiError(err, '加载角色列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAddPreset = async (name: string) => {
    await topicExpertsApi.add(topicId, { source: 'preset', preset_name: name })
    await loadExperts()
    onExpertsChange?.()
    handleApiSuccess('角色添加成功')
  }

  const handleRemove = async (name: string) => {
    await topicExpertsApi.delete(topicId, name)
    await loadExperts()
    onExpertsChange?.()
    handleApiSuccess('角色删除成功')
  }

  const handleEdit = async (expert: TopicExpert) => {
    setSelectedExpert(expert)
    setEditContent('')
    setShowEditDialog(true)
    try {
      const res = await topicExpertsApi.getContent(topicId, expert.name)
      setEditContent(res.data.role_content)
    } catch (err) {
      handleApiError(err, '加载角色内容失败')
    }
  }

  const handleSaveEdit = async () => {
    if (!selectedExpert || !editContent) return
    try {
      await topicExpertsApi.update(topicId, selectedExpert.name, { role_content: editContent })
      setShowEditDialog(false)
      setSelectedExpert(null)
      setEditContent('')
      await loadExperts()
      onExpertsChange?.()
      handleApiSuccess('角色更新成功')
    } catch (err: any) {
      handleApiError(err, '更新失败')
    }
  }

  const handleShare = async (expert: TopicExpert) => {
    if (!confirm(`将「${expert.label}」分享到平台预设库？所有用户均可添加此角色。`)) return
    try {
      await topicExpertsApi.share(topicId, expert.name)
      await loadExperts()
      handleApiSuccess(`「${expert.label}」已共享到平台`)
    } catch (err: any) {
      handleApiError(err, '分享失败')
    }
  }

  const handleAddCustom = async () => {
    if (!customName || !customLabel || !customDescription || !customContent) {
      alert('请先生成角色信息或填写所有字段')
      return
    }
    try {
      await topicExpertsApi.add(topicId, {
        source: 'custom',
        name: customName,
        label: customLabel,
        description: customDescription,
        role_content: customContent,
      })
      setShowAddDialog(false)
      setCustomName(''); setCustomLabel(''); setCustomDescription(''); setCustomContent('')
      await loadExperts()
      onExpertsChange?.()
      handleApiSuccess('自定义角色创建成功')
    } catch (err: any) {
      handleApiError(err, '创建角色失败')
    }
  }

  const handleGenerateExpert = async () => {
    if (!customLabel.trim()) { handleApiError({ message: '请输入角色标签' }, '请输入角色标签'); return }
    if (!customDescription.trim()) { handleApiError({ message: '请输入角色简介' }, '请输入角色简介'); return }
    if (customDescription.trim().length < 10) { handleApiError({ message: '角色简介至少需要 10 个字符' }, '角色简介至少需要 10 个字符'); return }

    setGenerating(true)
    try {
      const res = await topicExpertsApi.generate(topicId, {
        expert_name: customName.trim() || undefined,
        expert_label: customLabel.trim(),
        description: customDescription.trim(),
      })
      if (res.data.expert_name && !customName) setCustomName(res.data.expert_name)
      setCustomContent(res.data.role_content)
      handleApiSuccess('AI 生成成功！请检查并编辑信息')
    } catch (err: any) {
      handleApiError(err, 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <p className="text-gray-500 text-sm">加载中...</p>

  return (
    <div className={fillHeight ? 'h-full flex flex-col min-h-0 overflow-hidden' : 'space-y-4'}>
      <p className="text-xs text-gray-500 mb-2 flex-shrink-0">
        点击 + 将角色加入话题，选中的角色会参与讨论。也可创建新角色。
      </p>
      <div className="flex gap-2 flex-shrink-0 mb-2">
        <button
          onClick={() => setShowAddDialog(true)}
          className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          创建新角色
        </button>
      </div>
      <div className={fillHeight ? 'flex-1 min-h-0 overflow-hidden' : ''}>
        <ExpertSelector
          value={experts.map((e) => e.name)}
          selectedExperts={experts.map((e) => ({ name: e.name, label: e.label }))}
          onChange={() => {}}
          onAdd={handleAddPreset}
          onRemove={handleRemove}
          onEdit={(name) => {
            const e = experts.find((x) => x.name === name)
            if (e) handleEdit(e)
          }}
          onShare={(name) => {
            const e = experts.find((x) => x.name === name)
            if (e) handleShare(e)
          }}
          fillHeight={fillHeight}
        />
      </div>

      {showAddDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAddDialog(false)}
        >
          <div
            className="bg-white p-6 max-w-lg w-[90%] max-h-[80vh] overflow-auto border border-gray-200 rounded-lg"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-serif font-semibold text-black mb-6">创建新角色</h3>

            <div className="mb-4">
              <label className={labelClass}>角色标签（中文）*</label>
              <input className={inputClass} placeholder="例如：经济学家" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
            </div>
            <div className="mb-4">
              <label className={labelClass}>角色简介*</label>
              <input className={inputClass} placeholder="例如：专注于 AI 对经济的影响" value={customDescription} onChange={e => setCustomDescription(e.target.value)} />
            </div>

            <div className="mb-4">
              <button
                onClick={handleGenerateExpert}
                className="w-full bg-black text-white px-4 py-2 text-sm font-serif hover:bg-gray-900 transition-colors disabled:opacity-50"
                disabled={generating || !customLabel || !customDescription}
              >
                {generating ? 'AI 生成中...' : 'AI 自动生成完整信息'}
              </button>
            </div>

            <div className="mb-4">
              <label className={labelClass}>角色名称（英文）</label>
              <input className={inputClass} placeholder="AI 自动生成，也可手动输入" value={customName} onChange={e => setCustomName(e.target.value)} />
            </div>
            <div className="mb-4">
              <label className={labelClass}>角色定义（Markdown）</label>
              <textarea
                className={`${inputClass} min-h-[200px] font-mono resize-y`}
                placeholder="AI 自动生成，也可手动输入..."
                value={customContent}
                onChange={e => setCustomContent(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddCustom}
                className="bg-black text-white px-4 py-2 text-sm font-serif hover:bg-gray-900 transition-colors disabled:opacity-50"
                disabled={!customName || !customLabel || !customDescription || !customContent}
              >
                创建角色
              </button>
              <button onClick={() => setShowAddDialog(false)} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-serif text-black hover:border-black transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}

      {showEditDialog && selectedExpert && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowEditDialog(false)}
        >
          <div
            className="bg-white p-6 max-w-xl w-[90%] max-h-[80vh] overflow-auto border border-gray-200 rounded-lg"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-serif font-semibold text-black mb-4">编辑角色：{selectedExpert.label}</h3>

            <label className={labelClass}>角色定义（Markdown）</label>
            <textarea
              className={`${inputClass} min-h-[300px] font-mono resize-y mb-4`}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              placeholder="在此输入新的角色定义..."
            />

            <div className="flex gap-2">
              <button onClick={handleSaveEdit} className="bg-black text-white px-4 py-2 text-sm font-serif hover:bg-gray-900 transition-colors">保存</button>
              <button onClick={() => setShowEditDialog(false)} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-serif text-black hover:border-black transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
