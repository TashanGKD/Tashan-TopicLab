import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getScaleById } from '../data/scales'
import { calculateAMS_RAI, calculateRCSS, calculateScores } from '../utils/scoring'
import { submitScale } from '../profileHelperApi'

const SESSION_KEYS = ['tashan_session_id', 'tashan_profile_session_id'] as const

function getStoredSessionId(): string | null {
  for (const key of SESSION_KEYS) {
    const value = localStorage.getItem(key)
    if (value) return value
  }
  return null
}

/** 渲染 Mini-IPIP 测试结果 */
function IPIPResult({ scores }: { scores: Record<string, number> }) {
  const dims = [
    { id: 'E', label: '外向性' },
    { id: 'A', label: '宜人性' },
    { id: 'C', label: '尽责性' },
    { id: 'N', label: '神经质' },
    { id: 'I', label: '开放性/智力' },
  ]
  const levelLabel = (v: number) => {
    if (v >= 4.2) return '高'
    if (v >= 2.8) return '中'
    return '低'
  }
  return (
    <div className="score-table">
      {dims.map((d) => (
        <div key={d.id} className="score-row">
          <span className="score-dim">{d.label}</span>
          <span className="score-val">
            {(scores[d.id] || 0).toFixed(2)}
            <span style={{ color: '#9ca3af', marginLeft: 4, fontSize: '0.8em' }}>
              （{levelLabel(scores[d.id] || 0)}）
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** 渲染 AMS 完整 7 维结果 */
function AMSResult({ scores }: { scores: Record<string, number> }) {
  const { intrinsicTotal, extrinsicTotal, RAI } = calculateAMS_RAI(scores)
  const dims = [
    { id: 'know',           label: '求知内在动机',     group: 'intrinsic' },
    { id: 'accomplishment', label: '成就内在动机',     group: 'intrinsic' },
    { id: 'stimulation',    label: '体验刺激内在动机', group: 'intrinsic' },
    { id: 'identified',     label: '认同调节',         group: 'autonomous' },
    { id: 'introjected',    label: '内摄调节',         group: 'controlled' },
    { id: 'external',       label: '外部调节',         group: 'controlled' },
    { id: 'amotivation',    label: '无动机',           group: 'amotivation' },
  ]
  return (
    <>
      <div className="score-table">
        {dims.map((d) => (
          <div key={d.id} className="score-row">
            <span className="score-dim">{d.label}</span>
            <span className="score-val">{(scores[d.id] || 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="score-summary">
        <p>内在动机总分：{intrinsicTotal}</p>
        <p>外在动机总分：{extrinsicTotal}</p>
        <p>
          自主动机指数 (RAI)：<strong>{RAI}</strong>
        </p>
        <p style={{ fontSize: '0.8em', color: '#9ca3af' }}>
          RAI = 3×求知 + 3×成就 + 3×体验刺激 + 2×认同 − 内摄 − 2×外部 − 3×无动机
        </p>
      </div>
    </>
  )
}

export function ScaleTestPage() {
  const { scaleId } = useParams<{ scaleId: string }>()
  const navigate = useNavigate()
  const scale = scaleId ? getScaleById(scaleId) : undefined

  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [completed, setCompleted] = useState(false)
  const [saving, setSaving] = useState(false)

  const question = scale?.questions[currentIdx]
  const values = useMemo(() => {
    if (!scale) return []
    return Array.from({ length: scale.max_val - scale.min_val + 1 }, (_, i) => scale.min_val + i)
  }, [scale])

  if (!scale) {
    return (
      <div className="page-empty">
        <h2>量表不存在</h2>
        <button type="button" className="btn-primary" onClick={() => navigate('/profile-helper/scales')}>
          返回量表列表
        </button>
      </div>
    )
  }

  const handleAnswer = (questionId: string, value: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    if (currentIdx < scale.questions.length - 1) {
      setTimeout(() => {
        setCurrentIdx((idx) => Math.min(idx + 1, scale.questions.length - 1))
      }, 180)
      return
    }
    setTimeout(() => setCompleted(true), 180)
  }

  const goNext = () => {
    if (currentIdx < scale.questions.length - 1) {
      setCurrentIdx((i) => i + 1)
      return
    }
    setCompleted(true)
  }

  const handleSave = async () => {
    const sessionId = getStoredSessionId()
    if (!sessionId) {
      alert('请先在「对话采集」页面建立会话')
      return
    }

    const scores = calculateScores(scale, answers)
    const localKey = `profile_helper_scale_${scale.id}`
    const payload = {
      scaleId: scale.id,
      scaleName: scale.name,
      answers,
      scores,
      savedAt: new Date().toISOString(),
    }

    setSaving(true)
    try {
      await submitScale(sessionId, scale.id, answers, scores, payload)
      localStorage.setItem(localKey, JSON.stringify(payload))
      alert('量表结果已保存')
    } catch {
      localStorage.setItem(localKey, JSON.stringify(payload))
      alert('当前后端未开启量表提交接口，结果已本地保存')
    } finally {
      setSaving(false)
    }
  }

  if (completed) {
    const scores = calculateScores(scale, answers)
    const rcss = scale.id === 'rcss' ? calculateRCSS(scores) : null
    const amsRai = scale.id === 'ams' ? calculateAMS_RAI(scores) : null

    return (
      <div className="scale-test-page">
        <div className="scale-result">
          <h2>{scale.name} — 测试完成</h2>

          {scale.id === 'rcss' && (
            <>
              <div className="score-table">
                {scale.dimensions.map((dim) => (
                  <div key={dim.id} className="score-row">
                    <span className="score-dim">{dim.name}</span>
                    <span className="score-val">{(scores[dim.id] || 0).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              {rcss && (
                <div className="score-summary">
                  <p>横向整合分 (I)：{rcss.I}</p>
                  <p>垂直深度分 (D)：{rcss.D}</p>
                  <p>
                    认知风格指数 (CSI)：<strong>{rcss.CSI}</strong>
                  </p>
                  <p>
                    类型：<strong>{rcss.type}</strong>
                  </p>
                </div>
              )}
            </>
          )}

          {scale.id === 'mini-ipip' && <IPIPResult scores={scores} />}

          {scale.id === 'ams' && amsRai && <AMSResult scores={scores} />}

          <div className="scale-result-actions">
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存结果'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/profile-helper/scales')}
            >
              返回量表列表
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setCurrentIdx(0)
                setAnswers({})
                setCompleted(false)
              }}
            >
              重新测试
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!question) return null

  const progress = (currentIdx / scale.questions.length) * 100

  return (
    <div className="scale-test-page">
      <div className="scale-test-container">
        <header className="scale-test-header">
          <h2>{scale.name}</h2>
          <p className="scale-instructions">{scale.instructions}</p>
        </header>

        <div className="scale-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-text">
            {currentIdx + 1} / {scale.questions.length}
          </span>
        </div>

        <div className="scale-question-card">
          <p className="scale-question-text">{question.text}</p>
          <div className="scale-rating-row">
            <span className="rating-end-label">{scale.min_label}</span>
            <div className="scale-rating-buttons">
              {values.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`scale-rating-btn ${answers[question.id] === v ? 'selected' : ''}`}
                  onClick={() => handleAnswer(question.id, v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="rating-end-label">{scale.max_label}</span>
          </div>
        </div>

        <div className="scale-nav">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
          >
            ← 上一题
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={goNext}
            disabled={answers[question.id] == null}
          >
            {currentIdx === scale.questions.length - 1 ? '完成' : '下一题 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
