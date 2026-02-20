import { useState, useEffect } from 'react'
import { TopicExpert, topicExpertsApi, expertsApi, ExpertInfo } from '../api/client'
import { handleApiError, handleApiSuccess } from '../utils/errorHandler'

interface ExpertManagementProps {
  topicId: string
  onExpertsChange?: () => void
}

const inputClass = 'w-full border border-gray-200 px-3 py-2 text-sm font-serif focus:border-black focus:outline-none'
const labelClass = 'block text-sm font-serif font-medium text-black mb-2'

export default function ExpertManagement({ topicId, onExpertsChange }: ExpertManagementProps) {
  const [experts, setExperts] = useState<TopicExpert[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [addMode, setAddMode] = useState<'preset' | 'custom'>('preset')
  const [selectedExpert, setSelectedExpert] = useState<TopicExpert | null>(null)
  const [editContent, setEditContent] = useState('')

  const [presetExperts, setPresetExperts] = useState<ExpertInfo[]>([])
  const [selectedPreset, setSelectedPreset] = useState('')

  const [customName, setCustomName] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customContent, setCustomContent] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    loadExperts()
    loadPresetExperts()
  }, [topicId])

  const loadExperts = async () => {
    try {
      const res = await topicExpertsApi.list(topicId)
      setExperts(res.data)
    } catch (err) {
      handleApiError(err, '加载专家列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadPresetExperts = async () => {
    try {
      const res = await expertsApi.list()
      setPresetExperts(res.data)
    } catch (err) {
      handleApiError(err, '加载预设专家失败')
    }
  }

  const handleAddPreset = async () => {
    if (!selectedPreset) return
    try {
      await topicExpertsApi.add(topicId, { source: 'preset', preset_name: selectedPreset })
      setShowAddDialog(false)
      setSelectedPreset('')
      await loadExperts()
      onExpertsChange?.()
      handleApiSuccess('专家添加成功')
    } catch (err: any) {
      handleApiError(err, '添加专家失败')
    }
  }

  const handleAddCustom = async () => {
    if (!customName || !customLabel || !customDescription || !customContent) {
      alert('请先生成专家信息或填写所有字段')
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
      handleApiSuccess('自定义专家创建成功')
    } catch (err: any) {
      handleApiError(err, '创建专家失败')
    }
  }

  const handleGenerateExpert = async () => {
    if (!customLabel.trim()) { handleApiError({ message: '请输入专家标签' }, '请输入专家标签'); return }
    if (!customDescription.trim()) { handleApiError({ message: '请输入专家简介' }, '请输入专家简介'); return }
    if (customDescription.trim().length < 10) { handleApiError({ message: '专家简介至少需要 10 个字符' }, '专家简介至少需要 10 个字符'); return }

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

  const handleEdit = async (expert: TopicExpert) => {
    setSelectedExpert(expert)
    setEditContent('')
    setShowEditDialog(true)
    try {
      const res = await topicExpertsApi.getContent(topicId, expert.name)
      setEditContent(res.data.role_content)
    } catch (err) {
      handleApiError(err, '加载专家内容失败')
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
      handleApiSuccess('专家更新成功')
    } catch (err: any) {
      handleApiError(err, '更新失败')
    }
  }

  const handleShare = async (expert: TopicExpert) => {
    if (!confirm(`将「${expert.label}」分享到平台预设库？所有用户均可添加此专家。`)) return
    try {
      await topicExpertsApi.share(topicId, expert.name)
      await loadPresetExperts()
      handleApiSuccess(`「${expert.label}」已共享到平台`)
    } catch (err: any) {
      handleApiError(err, '分享失败')
    }
  }

  const handleDelete = async (expertName: string) => {
    if (!confirm(`确定删除专家 "${expertName}" 吗？`)) return
    try {
      await topicExpertsApi.delete(topicId, expertName)
      await loadExperts()
      onExpertsChange?.()
      handleApiSuccess('专家删除成功')
    } catch (err: any) {
      handleApiError(err, '删除失败')
    }
  }

  if (loading) return <p className="text-gray-500 text-sm font-serif">加载中...</p>

  return (
    <div className="mb-6">
      <h3 className="font-serif font-semibold text-black mb-4">专家库</h3>

      <div className="mb-4 flex flex-wrap gap-2">
        {experts.length === 0 && (
          <p className="text-sm font-serif text-gray-400">暂无专家，请添加</p>
        )}
        {experts.map((expert) => (
          <div
            key={expert.name}
            className="flex items-center gap-2 border border-gray-200 px-3 py-1"
          >
            <span className="text-sm font-serif text-black">{expert.label}</span>
            <button
              onClick={() => handleEdit(expert)}
              className="text-gray-400 hover:text-black text-xs transition-colors"
            >
              编辑
            </button>
            <button
              onClick={() => handleShare(expert)}
              className="text-gray-400 hover:text-blue-600 text-xs transition-colors"
              title="分享到平台预设库"
            >
              共享
            </button>
            <button
              onClick={() => handleDelete(expert.name)}
              className="text-gray-400 hover:text-black text-xs transition-colors"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { setAddMode('preset'); setShowAddDialog(true) }}
          className="border border-gray-200 px-4 py-2 text-sm font-serif text-black hover:border-black transition-colors"
        >
          从预设添加
        </button>
        <button
          onClick={() => { setAddMode('custom'); setShowAddDialog(true) }}
          className="bg-black px-4 py-2 text-sm font-serif text-white hover:bg-gray-900 transition-colors"
        >
          创建新专家
        </button>
      </div>

      {showAddDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAddDialog(false)}
        >
          <div
            className="bg-white p-6 max-w-lg w-[90%] max-h-[80vh] overflow-auto border border-gray-200"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-serif font-semibold text-black mb-6">
              {addMode === 'preset' ? '从预设添加专家' : '创建新专家'}
            </h3>

            {addMode === 'preset' ? (
              <>
                <label className={labelClass}>选择预设专家</label>
                <select
                  className={`${inputClass} mb-4`}
                  value={selectedPreset}
                  onChange={(e) => setSelectedPreset(e.target.value)}
                >
                  <option value="">请选择...</option>
                  {presetExperts.map((expert) => (
                    <option key={expert.name} value={expert.name}>
                      {expert.label} - {expert.description}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={handleAddPreset} className="bg-black text-white px-4 py-2 text-sm font-serif hover:bg-gray-900 transition-colors">添加</button>
                  <button onClick={() => setShowAddDialog(false)} className="border border-gray-200 px-4 py-2 text-sm font-serif text-black hover:border-black transition-colors">取消</button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4">
                  <label className={labelClass}>专家标签（中文）*</label>
                  <input className={inputClass} placeholder="例如：经济学家" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
                </div>
                <div className="mb-4">
                  <label className={labelClass}>专家简介*</label>
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
                  <label className={labelClass}>专家名称（英文）</label>
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
                    创建专家
                  </button>
                  <button onClick={() => setShowAddDialog(false)} className="border border-gray-200 px-4 py-2 text-sm font-serif text-black hover:border-black transition-colors">取消</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showEditDialog && selectedExpert && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowEditDialog(false)}
        >
          <div
            className="bg-white p-6 max-w-xl w-[90%] max-h-[80vh] overflow-auto border border-gray-200"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-serif font-semibold text-black mb-4">编辑专家：{selectedExpert.label}</h3>

            <label className={labelClass}>角色定义（Markdown）</label>
            <textarea
              className={`${inputClass} min-h-[300px] font-mono resize-y mb-4`}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              placeholder="在此输入新的角色定义..."
            />

            <div className="flex gap-2">
              <button onClick={handleSaveEdit} className="bg-black text-white px-4 py-2 text-sm font-serif hover:bg-gray-900 transition-colors">保存</button>
              <button onClick={() => setShowEditDialog(false)} className="border border-gray-200 px-4 py-2 text-sm font-serif text-black hover:border-black transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
