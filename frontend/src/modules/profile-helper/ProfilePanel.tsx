import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { getDownloadUrl, getForumDownloadUrl } from './profileHelperApi'
import { ScientistMatchSection } from './components/ScientistMatchSection'

interface ProfilePanelProps {
  sessionId: string | null
  profile: string
  forumProfile: string
  onImportToTopicLab?: () => void
  importLoading?: boolean
  importResult?: string | null
}

export function ProfilePanel({
  sessionId,
  profile,
  forumProfile,
  onImportToTopicLab,
  importLoading,
  importResult,
}: ProfilePanelProps) {
  if (!sessionId) return null

  const mergedContent = [
    profile ? `## 科研数字分身\n\n${profile}` : '',
    forumProfile ? `## 他山论坛分身\n\n${forumProfile}` : '',
  ]
    .filter(Boolean)
    .join('\n\n---\n\n')

  const hasProfile = !!profile && !profile.includes('[姓名/标识]')

  return (
    <div className="profile-panel">
      <section className="profile-safety-notice">
        <p>您在本系统中提供的所有信息仅用于构建和更新您的数字分身。平台不会向任何第三方泄露您的数据，也不会将您的数据用于模型训练或其他用途。</p>
        <p>您的数字分身仅在平台内部运行，用于与系统中的其他智能体进行信息交流与协作，不会在平台之外使用。</p>
        <p>您可以自行决定该数字分身是否公开。当选择公开时，其他用户在发起讨论或协作任务时可以选择您的数字分身参与；当选择不公开时，该数字分身仅对您本人可见和使用。</p>
      </section>

      <section className="profile-section">
        <h3>查看分身</h3>
        <div className="profile-content">
          {mergedContent ? (
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {mergedContent}
            </ReactMarkdown>
          ) : (
            <p className="profile-empty">尚未建立分身，可以说「建立我的分身」开始。</p>
          )}
        </div>
        <div className="profile-forum-actions">
          <a
            href={getDownloadUrl(sessionId)}
            download="profile.md"
            className={`profile-download-btn ${profile ? '' : 'profile-download-btn-disabled'}`}
          >
            下载科研数字分身
          </a>
          <a
            href={getForumDownloadUrl(sessionId)}
            download="forum-profile.md"
            className={`profile-download-btn ${forumProfile ? '' : 'profile-download-btn-disabled'}`}
          >
            下载他山论坛分身
          </a>
          {onImportToTopicLab && (
            <button
              type="button"
              className="profile-import-btn"
              onClick={onImportToTopicLab}
              disabled={!forumProfile || importLoading}
            >
              {importLoading ? '导入中...' : '一键导入 Topic-Lab 角色库'}
            </button>
          )}
        </div>
        {importResult && (
          <p className="profile-import-result">{importResult}</p>
        )}
      </section>

      {/* 科研灵魂伴侣：有完整画像时展示 */}
      {hasProfile && (
        <ScientistMatchSection sessionId={sessionId} />
      )}
    </div>
  )
}
