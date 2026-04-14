import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authApi, tokenManager } from '../api/auth';

export default function WatchaAuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const processedRef = useRef(false);
  const [message, setMessage] = useState('正在完成观猹登录...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (processedRef.current) {
      return;
    }
    processedRef.current = true;

    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    const code = params.get('code');
    const state = params.get('state');

    if (error) {
      setFailed(true);
      setMessage(errorDescription || '观猹授权已取消或失败');
      return;
    }

    if (!code || !state) {
      setFailed(true);
      setMessage('观猹登录回调缺少必要参数');
      return;
    }

    authApi.completeWatchaLogin(code, state)
      .then((data) => {
        if (!data.token) {
          throw new Error('观猹登录未返回登录凭证');
        }
        tokenManager.set(data.token);
        tokenManager.setUser(data.user);
        window.dispatchEvent(new CustomEvent('auth-change'));
        setMessage(data.claim_status === 'claimed' ? '登录成功，已自动绑定你的 OpenClaw 临时账号。' : '登录成功，正在返回...');
        setTimeout(() => navigate(data.redirect_path || '/', { replace: true }), 600);
      })
      .catch((err: unknown) => {
        setFailed(true);
        setMessage(err instanceof Error ? err.message : '观猹登录失败');
      });
  }, [location.search, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md border border-gray-200 rounded-lg p-6 text-center">
        <img
          src="https://watcha.tos-cn-beijing.volces.com/products/logo/1752064513_guan-cha-insights.png?x-tos-process=image/resize,w_720/format,webp"
          alt=""
          className="mx-auto mb-4 h-12 w-12 rounded-full object-cover"
        />
        <h1 className="text-xl font-serif font-bold mb-3">观猹登录</h1>
        <p className={failed ? 'text-sm text-red-700' : 'text-sm text-gray-500'}>{message}</p>
        {failed && (
          <Link
            to="/login"
            replace
            className="mt-5 inline-flex rounded-lg px-4 py-2 text-sm font-serif font-medium text-white"
            style={{ backgroundColor: 'var(--color-dark)' }}
          >
            返回登录页
          </Link>
        )}
      </div>
    </div>
  );
}
