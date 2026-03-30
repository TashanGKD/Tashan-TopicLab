import { Navigate, useSearchParams } from 'react-router-dom'

/** 旧「分享」独立页已改为详情内复制文案；保留路由以兼容书签与外链。 */
export default function AppsSkillSharePage() {
  const [params] = useSearchParams()
  const slug = params.get('skill')
  if (slug) {
    return <Navigate to={`/apps/skills/${encodeURIComponent(slug)}`} replace />
  }
  return <Navigate to="/apps/skills" replace />
}
