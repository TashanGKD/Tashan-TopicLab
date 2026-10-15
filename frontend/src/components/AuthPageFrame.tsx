import { useEffect, type ReactNode } from 'react';

export default function AuthPageFrame({ unified, title, children }: {
  unified: boolean;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!unified) return;
    const previous = document.title;
    document.title = `${title} · 他山统一认证`;
    return () => { document.title = previous; };
  }, [unified, title]);

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 py-10 ${unified ? 'bg-slate-50 text-slate-900' : ''}`}>
      <div className="w-full max-w-md">
        {unified && (
          <header className="mb-8 text-center">
            <div aria-hidden="true" className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-xl font-bold text-white">山</div>
            <p className="text-2xl font-semibold tracking-wide">他山统一认证</p>
          </header>
        )}
        <div className={unified ? 'rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm' : 'border border-gray-200 rounded-lg p-6'}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function UnifiedAuthComplete() {
  return (
    <AuthPageFrame unified title="登录成功">
      <div role="status" className="text-center">
        <h1 className="mb-3 text-xl font-semibold">已登录他山账号</h1>
        <p className="text-sm leading-6 text-slate-500">请返回需要登录的网站，点击登录即可继续。</p>
      </div>
    </AuthPageFrame>
  );
}
