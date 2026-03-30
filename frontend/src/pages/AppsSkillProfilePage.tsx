import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { tokenManager } from '../api/auth'
import { skillHubApi, type SkillHubProfile } from '../api/client'
import ImmersiveAppShell from '../components/ImmersiveAppShell'
import { handleApiError } from '../utils/errorHandler'
import { toast } from '../utils/toast'
import { copyText, SkillCard } from './skillHubShared'

export default function AppsSkillProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [profile, setProfile] = useState<SkillHubProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const isLoggedIn = Boolean(tokenManager.get())

  const load = async () => {
    try {
      setLoading(true)
      const res = await skillHubApi.getProfile()
      setProfile(res.data)
    } catch (err) {
      handleApiError(err, '加载绑定中心失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false)
      return
    }
    void load()
  }, [isLoggedIn])

  const rotateKey = async () => {
    try {
      const res = await skillHubApi.rotateOpenClawKey()
      const data = res.data as { key?: string; masked_key?: string }
      if (data.key) {
        await copyText(data.key)
        toast.success('已生成并复制新的 OpenClaw Key')
      } else {
        toast.success('已生成新的 OpenClaw Key')
      }
      await load()
    } catch (err) {
      handleApiError(err, '生成 OpenClaw Key 失败')
    }
  }

  return (
    <ImmersiveAppShell title="OpenClaw 绑定中心" subtitle="查看绑定的 agent、Key、积分和你在 SkillHub 的发布与互动记录。">
      {!isLoggedIn ? (
        <AuthPrompt
          title="登录后再进入绑定中心"
          description="这里会聚合你的 OpenClaw Agent、Key、积分余额，以及你在 SkillHub 的发布、评测、下载和收藏记录。"
          from={`${location.pathname}${location.search}`}
          onLogin={() => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })}
        />
      ) : loading || !profile ? (
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>正在加载绑定信息…</div>
      ) : !profile.has_agent ? (
        <section className="rounded-[28px] border p-6" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Agent</div>
          <h2 className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
            还没有 OpenClaw Agent
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            你已经登录 TopicLab，但还没有在 SkillHub 里产生发布、评测或下载记录。先生成 Key，或直接去发布第一个科研 Skill。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={rotateKey} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              生成 OpenClaw Key
            </button>
            <Link to="/apps/skills/publish" className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
              发布第一个 Skill
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
            <div className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
              <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Agent</div>
              <h2 className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                {profile.openclaw_agent?.display_name ?? '未绑定 OpenClaw Agent'}
              </h2>
              <div className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                handle: {profile.openclaw_agent?.handle ?? '—'}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric label="余额" value={profile.wallet ? `${profile.wallet.balance} pts` : '—'} />
                <Metric label="累计获得" value={profile.wallet ? `${profile.wallet.lifetime_earned}` : '—'} />
                <Metric label="累计花费" value={profile.wallet ? `${profile.wallet.lifetime_spent}` : '—'} />
              </div>
            </div>

            <div className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
              <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Key</div>
              <h2 className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>
                API Key / CLI 接入
              </h2>
              <div className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                当前 Key：{profile.key?.masked_key ?? '尚未生成'}
              </div>
              <button type="button" onClick={rotateKey} className="mt-4 rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                生成 / 轮换 Key
              </button>
            </div>
          </section>

          <section className="mt-8">
            <div className="flex items-end justify-between gap-3">
              <h3 className="text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>我的 Skill</h3>
              <Link to="/apps/skills/publish" className="text-sm underline underline-offset-4" style={{ color: 'var(--text-secondary)' }}>
                发布新 Skill
              </Link>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {profile.my_skills.map((skill) => <SkillCard key={skill.id} skill={skill} />)}
            </div>
          </section>

          <section className="mt-8 grid gap-4 xl:grid-cols-3">
            <SimpleList title="我的评测" items={profile.my_reviews.map((item) => `${item.skill_name} · ${item.rating} 分`)} />
            <SimpleList title="我的下载" items={profile.my_downloads.map((item) => `${item.skill_name} · ${item.version || 'latest'} · ${item.points_spent} pts`)} />
            <SimpleList title="我的收藏" items={profile.my_favorites.map((item) => item.name)} />
          </section>
        </>
      )}
    </ImmersiveAppShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)' }}>
      <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="mt-2 text-lg font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function SimpleList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
      <h3 className="text-xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>暂无记录</div>
        ) : items.map((item) => (
          <div key={item} className="rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
            {item}
          </div>
        ))}
      </div>
    </section>
  )
}

function AuthPrompt({
  title,
  description,
  from,
  onLogin,
}: {
  title: string
  description: string
  from: string
  onLogin: () => void
}) {
  return (
    <section className="rounded-[28px] border p-6" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Account</div>
      <h2 className="mt-2 text-2xl font-serif font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onLogin} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          去登录
        </button>
        <Link to="/register" state={{ from }} className="rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)', color: 'var(--text-secondary)' }}>
          去注册
        </Link>
      </div>
    </section>
  )
}
