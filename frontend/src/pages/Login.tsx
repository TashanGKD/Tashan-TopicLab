import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { authApi, tokenManager } from '../api/auth';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
      const data = await authApi.login(phone, password);
      if (data.token) {
        tokenManager.set(data.token);
        tokenManager.setUser(data.user);
        window.dispatchEvent(new CustomEvent('auth-change'));
      }
      showMessage('success', '登录成功！');
      setTimeout(() => navigate(from), 1000);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-md">
        <div className="border border-gray-200 rounded-lg p-6">
          <h1 className="text-xl font-serif font-bold text-center mb-2">登录</h1>
          <p className="text-sm text-gray-500 text-center mb-6">登录您的账号</p>

          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-serif text-black mb-2">手机号</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                maxLength={11}
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-serif text-black mb-2">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white py-2 rounded-lg text-sm font-serif font-medium hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-500 font-serif">
            还没有账号？{' '}
            <Link to="/register" state={{ from }} className="text-black hover:underline">立即注册</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
