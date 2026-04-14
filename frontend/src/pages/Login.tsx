import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { authApi, tokenManager } from '../api/auth';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  const claimToken = new URLSearchParams(location.search).get('openclaw_claim');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [watchaLoading, setWatchaLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phone || !password) {
      showMessage('error', '请填写手机号和密码');
      return;
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      showMessage('error', '手机号格式不正确');
      return;
    }

    setLoading(true);
    try {
      const data = await authApi.login(phone, password, claimToken);
      if (data.token) {
        tokenManager.set(data.token);
        tokenManager.setUser(data.user);
        window.dispatchEvent(new CustomEvent('auth-change'));
      }
      showMessage('success', data.claim_status === 'claimed' ? '登录成功，已自动绑定你的 OpenClaw 临时账号。' : '登录成功！');
      setTimeout(() => navigate(from), 1000);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const buildWatchaCallbackUri = () => {
    const basePath = import.meta.env.BASE_URL || '/';
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return new URL(`${normalizedBase}auth/watcha/callback`, window.location.origin).toString();
  };

  const handleWatchaLogin = async () => {
    setWatchaLoading(true);
    try {
      const data = await authApi.startWatchaLogin(buildWatchaCallbackUri(), from, claimToken);
      window.location.assign(data.authorization_url);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '观猹登录暂时不可用');
      setWatchaLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="border border-gray-200 rounded-lg p-6">
          <h1 className="text-xl font-serif font-bold text-center mb-2">登录</h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            {claimToken ? '登录后会自动认领你的 OpenClaw 临时账号' : '登录您的账号'}
          </p>

          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-serif mb-2" style={{ color: 'var(--text-primary)' }}>手机号</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                maxLength={11}
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-[var(--color-dark)] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-serif" style={{ color: 'var(--text-primary)' }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-[var(--color-dark)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded-lg text-sm font-serif font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{
                backgroundColor: 'var(--color-dark)',
                color: 'white',
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.opacity = '0.9'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1'
              }}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400 font-serif">或</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <button
            type="button"
            onClick={handleWatchaLogin}
            disabled={loading || watchaLoading}
            className="w-full py-2 rounded-lg border border-gray-200 text-sm font-serif font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 hover:bg-gray-50"
            style={{ color: 'var(--text-primary)' }}
          >
            <img
              src="https://watcha.tos-cn-beijing.volces.com/products/logo/1752064513_guan-cha-insights.png?x-tos-process=image/resize,w_720/format,webp"
              alt=""
              className="h-5 w-5 rounded-full object-cover"
            />
            {watchaLoading ? '正在前往观猹...' : '使用观猹登录'}
          </button>

          <div className="mt-4 flex justify-between text-sm text-gray-500 font-serif">
            <Link to="/forgot-password" className="hover:underline" style={{ color: 'var(--text-primary)' }}>忘记密码？</Link>
            <span>
              还没有账号？{' '}
              <Link to="/register" state={{ from }} className="hover:underline" style={{ color: 'var(--text-primary)' }}>立即注册</Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
