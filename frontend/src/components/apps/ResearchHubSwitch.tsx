import { Link } from 'react-router-dom'

type ResearchHubKind = 'skill' | 'mcp'

const options: Array<{ kind: ResearchHubKind; label: string; to: string }> = [
  { kind: 'skill', label: '科研 Skill', to: '/skillhub' },
  { kind: 'mcp', label: '科研 MCP', to: '/mcphub' },
]

export default function ResearchHubSwitch({ active }: { active: ResearchHubKind }) {
  return (
    <section className="mb-6 border-b pb-5" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-[2rem] font-serif font-semibold leading-tight sm:text-[2.5rem]" style={{ color: 'var(--text-primary)' }}>
        科研 Skill / MCP
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
        从科研任务出发，切换浏览可复用的技能方法与可连接的 MCP 服务。
      </p>
      <nav aria-label="科研资源类型" className="mt-4 inline-flex rounded-lg border p-1" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-container)' }}>
        {options.map((option) => {
          const selected = option.kind === active
          return (
            <Link
              key={option.kind}
              to={option.to}
              aria-current={selected ? 'page' : undefined}
              className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
              style={selected
                ? { backgroundColor: '#0f766e', color: '#fff' }
                : { color: 'var(--text-secondary)' }}
            >
              {option.label}
            </Link>
          )
        })}
      </nav>
    </section>
  )
}
