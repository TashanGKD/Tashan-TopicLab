import AuthPasswordInput from '../components/AuthPasswordInput';
import AuthPageFrame, { UnifiedAuthComplete } from '../components/AuthPageFrame';
import { authPath, isUnifiedAuth } from '../utils/sso';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { authApi, tokenManager } from '../api/auth';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const unified = isUnifiedAuth(location.pathname, searchParams);
  const [complete, setComplete] = useState(false);
  const from = searchParams.get('next') || (location.state as { from?: string } | null)?.from || '/';
  const claimToken = searchParams.get('openclaw_claim');
  const ssoClientId = searchParams.get('sso_client');
  const ssoRedirect = searchParams.get('sso_redirect');
  const ssoState = searchParams.get('sso_state');
  const ssoChallenge = searchParams.get('sso_code_challenge');
  const ssoActive = Boolean(ssoClientId && ssoRedirect);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [watchaLoading, setWatchaLoading] = useState(false);
  const [ssoHandingOff, setSsoHandingOff] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const ssoAutoAttempted = useRef(false);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const completeSsoHandoff = async (token: string): Promise<boolean> => {
    if (!ssoActive || !ssoClientId || !ssoRedirect) return false;
    setSsoHandingOff(true);
    try {
      const { code } = await authApi.ssoAuthorize(token, ssoClientId, ssoRedirect, ssoState, ssoChallenge);
      const target = new URL(ssoRedirect);
      target.searchParams.set('code', code);
      if (ssoState) target.searchParams.set('state', ssoState);
      window.location.replace(target.toString());
      return true;
    } catch (err: unknown) {
      setSsoHandingOff(false);
      showMessage('error', err instanceof Error ? err.message : '跨站登录授权失败');
      return false;
    }
  };

  // When arriving with sso_* parameters while already logged in, hand off immediately.
  useEffect(() => {
    if (!ssoActive || ssoAutoAttempted.current) return;
    const existingToken = tokenManager.get();
    if (!existingToken) return;
    ssoAutoAttempted.current = true;
    void completeSsoHandoff(existingToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (data.token && ssoActive) {
        await completeSsoHandoff(data.token);
        return;
      }
      if (data.token && unified) {
        setComplete(true);
        return;
      }
      showMessage('success', data.claim_status === 'claimed' ? '登录成功，已自动绑定你的智能体临时账号。' : '登录成功！');
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
    if (unified) return;
    setWatchaLoading(true);
    try {
      const data = await authApi.startWatchaLogin(buildWatchaCallbackUri(), ssoActive ? authPath('/login', searchParams, unified) : from, claimToken);
      window.location.assign(data.authorization_url);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '观猹登录暂时不可用');
      setWatchaLoading(false);
    }
  };

  const registerLinkTo = authPath('/register', searchParams, unified);

  if (complete) return <UnifiedAuthComplete />;

  if (ssoActive && ssoHandingOff) {
    return (
      <AuthPageFrame unified={unified} title="正在返回原网站">
          <div className="text-center">
            <h1 className="text-xl font-serif font-bold mb-2">正在返回原网站</h1>
            <p className="text-sm text-gray-500">登录成功，正在为你跳转，请稍候...</p>
          </div>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame unified={unified} title="登录">
          <h1 className="text-xl font-serif font-bold text-center mb-2">{unified ? '欢迎回来' : '登录'}</h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            {claimToken ? '登录后会自动认领你的智能体临时账号' : unified ? '使用他山账号继续' : '登录您的账号'}
          </p>

          {ssoActive && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-blue-50 text-blue-700">
              你正在使用他山账号登录其他网站。登录或注册成功后，会自动返回该网站。
            </div>
          )}

          {message && (
            <div role="alert" className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-phone" className="block text-sm font-serif mb-2" style={{ color: 'var(--text-primary)' }}>手机号</label>
              <input
                type="tel"
                id="login-phone"
                aria-label="手机号"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                maxLength={11}
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-[var(--color-dark)] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-serif" style={{ color: 'var(--text-primary)' }}>密码</label>
              <AuthPasswordInput
                unified={unified}
                type="password"
                id="login-password"
                aria-label="密码"
                autoComplete="current-password"
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

          {!unified && <>
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
          </>}

          <div className="auth-form-links mt-4 flex justify-between text-sm text-gray-500 font-serif">
            <Link to={authPath('/forgot-password', searchParams, unified)} className="hover:underline" style={{ color: 'var(--text-primary)' }}>忘记密码？</Link>
            <span>
              还没有账号？{' '}
              <Link to={registerLinkTo} state={{ from }} className="hover:underline" style={{ color: 'var(--text-primary)' }}>立即注册</Link>
            </span>
          </div>
    </AuthPageFrame>
  );
}
