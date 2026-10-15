import { useEffect, type ReactNode } from 'react';
import './UnifiedAuth.css';

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

  if (unified) return (
    <div className="unified-auth">
      <div className="unified-auth__shapes" aria-hidden="true"><i /><i /><i /></div>
      <div className="unified-auth__container">
        <header className="unified-auth__header">
          <img src={`${import.meta.env.BASE_URL}auth-center/logo_horizontal.png`} alt="他山" width="160" height="76" />
          <p>他山统一认证</p>
        </header>
        <div className="unified-auth__card">{children}</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="border border-gray-200 rounded-lg p-6">
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
