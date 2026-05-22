import DefaultAvatar from '../components/DefaultAvatar'

const MAP_CLUSTER_LAYOUT = [
  { color: '#f2a13b' },
  { color: '#40aeb0' },
  { color: '#8b7bd8' },
  { color: '#54b07a' },
  { color: '#5a9de2' },
] as const

type TopicPlazaSidebarColumn = {
  category: {
    id: string
    name: string
  }
  topicCount: number
  audienceCount?: number
}

type TopicPlazaViewMode = 'map' | 'list'

export function TopicPlazaSidebar({
  topicColumns,
  activeCategory,
  viewMode,
  onCategoryJump,
  onViewModeChange,
  onPeopleOpen,
  variant = 'page',
}: {
  topicColumns: TopicPlazaSidebarColumn[]
  activeCategory: string
  viewMode: TopicPlazaViewMode
  onCategoryJump: (categoryId: string) => void
  onViewModeChange: (viewMode: TopicPlazaViewMode) => void
  onPeopleOpen?: () => void
  variant?: 'page' | 'overlay'
}) {
  const populatedColumns = topicColumns.filter(({ topicCount }) => topicCount > 0)
  const viewOptions = [
    { id: 'map', label: '广场视图', hint: '连接地图' },
    { id: 'list', label: '列表视图', hint: '快速选择' },
  ] as const
  const sidebarClassName = variant === 'overlay'
    ? 'hidden max-h-[calc(100%-2rem)] overflow-y-auto rounded-[1.25rem] border border-white/78 bg-[#fffaf2]/88 px-4 py-4 shadow-[0_20px_52px_rgba(38,48,43,0.18)] backdrop-blur-xl lg:flex lg:flex-col'
    : 'hidden border-r border-[#dfe5df] bg-white/74 px-5 py-6 lg:flex lg:flex-col'

  return (
    <aside className={sidebarClassName}>
      <div className={variant === 'overlay' ? 'mb-5' : 'mb-7'}>
        <p className="text-xs text-[#8c9892]">TopicLab</p>
        <h2 className="mt-1 font-serif text-lg font-semibold text-[#17211f]">话题连接</h2>
      </div>

      <div className={`${variant === 'overlay' ? 'border-t border-white/72 pt-4' : 'border-t border-[#e5ebe5] pt-5'}`}>
        <p className="mb-2 text-xs text-[#8c9892]">视图</p>
        <div className="space-y-1 text-sm">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onViewModeChange(option.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                viewMode === option.id ? 'bg-[#fffdf8]/92 font-semibold text-[#174f51] shadow-sm' : 'text-[#66716d] hover:bg-[#f4f6f3]'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${viewMode === option.id ? 'bg-[#40aeb0]' : 'bg-[#c8d0ca]'}`} />
              <span className="min-w-0">
                <span className="block">{option.label}</span>
                <span className="block text-[11px] font-normal text-[#9aa49e]">{option.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${variant === 'overlay' ? 'mt-4 border-t border-white/72 pt-4' : 'mt-7 border-t border-[#e5ebe5] pt-5'}`}>
        <p className="mb-3 text-xs text-[#8c9892]">入口</p>
        <div className="space-y-1.5">
          {populatedColumns.map(({ category }, index) => (
            <button
              key={category.id}
              type="button"
              onClick={() => onCategoryJump(category.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                activeCategory === category.id ? 'bg-[#fffdf8]/92 font-medium text-[#18211f] shadow-sm' : 'text-[#586761] hover:bg-[#f5f7f4]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.55)]" style={{ backgroundColor: MAP_CLUSTER_LAYOUT[index % MAP_CLUSTER_LAYOUT.length].color }} />
                <span className="truncate">{category.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${variant === 'overlay' ? 'mt-4 border-t border-white/72 pt-4' : 'mt-auto border-t border-[#e5ebe5] pt-5'}`}>
        <p className="mb-3 text-xs text-[#8c9892]">相关的人</p>
        <button
          type="button"
          onClick={onPeopleOpen ?? (() => onViewModeChange('list'))}
          className="mb-5 flex -space-x-2 rounded-full text-left transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#8fcac5]"
          aria-label="查看这桌附近的人"
        >
          {['发起人', '我这边', '补资料的人', '提问题的人', '一起看的人'].map((name) => (
            <div key={name} className="h-[38px] w-[38px] overflow-hidden rounded-full bg-[#edf3ef] ring-2 ring-white shadow-[0_8px_14px_rgba(38,48,43,0.10)]">
              <DefaultAvatar name={name} className="h-full w-full" />
            </div>
          ))}
          <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-[#eef1ee] text-xs text-[#67736e] ring-2 ring-white shadow-[0_8px_14px_rgba(38,48,43,0.10)]">+12</span>
        </button>
        <button type="button" onClick={() => onViewModeChange('list')} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#cbded4] bg-[#fffdf8] text-sm font-medium text-[#2f8586] shadow-sm transition hover:border-[#8fcac5] hover:bg-white">
          <span className="text-lg leading-none">+</span>
          展开话题列表
        </button>
      </div>
    </aside>
  )
}
