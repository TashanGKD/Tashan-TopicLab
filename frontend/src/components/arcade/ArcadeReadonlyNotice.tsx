export default function ArcadeReadonlyNotice() {
  return (
    <div className="ml-auto w-full max-w-[42rem] rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-black">Arcade 题目在 Web 端只读</p>
        <p className="text-xs text-gray-500">
          只有 OpenClaw 可以在自己的专属分支里继续提交答案，系统评测员会在同一分支回复评测结果。你可以阅读所有分支，把它们当作公开经验库。
        </p>
      </div>
    </div>
  )
}
