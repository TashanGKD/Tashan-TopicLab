import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { authApi, tokenManager } from '../api/auth';

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMessage = (type: 'success' | 'error', text: string, durationMs = 3000) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), durationMs);
  };

  const handleSendCode = async () => {
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      showMessage('error', '请输入正确的手机号');
      return;
    }

    setSendingCode(true);
    try {
      const data = await authApi.sendCode(phone, 'register');
      if (data.dev_code) {
        showMessage('success', `验证码已生成（开发模式，无真实短信）：${data.dev_code}`, 15000);
      } else {
        showMessage('success', data.message);
      }
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '发送失败');
    } finally {
      setSendingCode(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !phone || !code || !password || !confirmPassword) {
      showMessage('error', '请填写所有必填项');
      return;
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      showMessage('error', '手机号格式不正确');
      return;
    }

    if (password.length < 6) {
      showMessage('error', '密码长度至少6位');
      return;
    }

    if (password !== confirmPassword) {
      showMessage('error', '两次输入的密码不一致');
      return;
    }

    if (username.trim().length > 50) {
      showMessage('error', '用户名最多50个字符');
      return;
    }

    setLoading(true);
    try {
      const data = await authApi.register(phone, code, password, username.trim());
      if (data.token) {
        tokenManager.set(data.token);
        tokenManager.setUser(data.user);
        window.dispatchEvent(new CustomEvent('auth-change'));
      }
      showMessage('success', '注册成功！');
      setTimeout(() => navigate(from), 1500);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-md">
        <div className="border border-gray-200 rounded-lg p-6">
          <h1 className="text-xl font-serif font-bold text-center mb-2">创建账号</h1>
          <p className="text-sm text-gray-500 text-center mb-6">填写信息完成注册</p>

          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-serif text-black mb-2">用户名 *</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                maxLength={50}
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-serif text-black mb-2">手机号 *</label>
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
              <label className="block text-sm font-serif text-black mb-2">验证码 *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="请输入验证码"
                  maxLength={6}
                  disabled={loading}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode || countdown > 0 || !phone}
                  className="min-w-[120px] border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif hover:border-black disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingCode ? '发送中...' : countdown > 0 ? `${countdown}秒后重试` : '获取验证码'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-serif text-black mb-2">密码 *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码（至少6位）"
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-serif text-black mb-2">确认密码 *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white py-2 rounded-lg text-sm font-serif font-medium hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '注册中...' : '注册'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-500 font-serif">
            已有账号？{' '}
            <Link to="/login" state={{ from }} className="text-black hover:underline">立即登录</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
