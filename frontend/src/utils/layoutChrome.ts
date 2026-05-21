/** 全站顶栏、底栏 Tab 等「外壳」隐藏（登录注册、沉浸式子页） */
export function shouldHideGlobalChrome(pathname: string): boolean {
  if (pathname === '/login' || pathname === '/register') {
    return true
  }
  if (pathname.startsWith('/apps/skills')) {
    return true
  }
  if (pathname.startsWith('/library')) {
    return true
  }
  if (pathname === '/wechat-group-qr' || pathname.startsWith('/qr/')) {
    return true
  }
  return false
}
