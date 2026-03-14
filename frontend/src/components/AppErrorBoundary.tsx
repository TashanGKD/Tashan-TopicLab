import React from 'react'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
}

export default class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // Keep diagnostics in console while showing a recoverable UI.
    console.error('AppErrorBoundary caught render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-serif font-bold text-black">页面加载出现异常</h1>
            <p className="mt-3 text-sm text-gray-600">
              已拦截运行时错误，避免整页白屏。你可以刷新页面重试。
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full border border-black px-4 py-2 text-sm font-medium text-black hover:bg-black hover:text-white transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
