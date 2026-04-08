import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../api/auth';

type Step = 'phone' | 'reset';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      showMessage('error', '手机号格式不正确');
      return;
    }
    setLoading(true);
    try {
      await authApi.sendCode(phone, 'reset_password');
      setCodeSent(true);
      setStep('reset');
      startCountdown();
      showMessage('success', '验证码已发送，请查收短信');
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    setLoading(true);
    try {
      await authApi.sendCode(phone, 'reset_password');
      startCountdown();
      showMessage('success', '验证码已重新发送');
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || code.length !== 6) {
      showMessage('error', '请输入6位验证码');
      return;
    }
    if (newPassword.length < 8) {
      showMessage('error', '新密码至少8位');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage('error', '两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword(phone, code, newPassword);
      showMessage('success', '密码重置成功，即将跳转登录');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err: unknown) {
      showMessage('error', err instanceof Error ? err.message : '重置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="border border-gray-200 rounded-lg p-6">
          <h1 className="text-xl font-serif font-bold text-center mb-2">重置密码</h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            {step === 'phone' ? '输入手机号获取验证码' : `验证码已发送至 ${phone}`}
          </p>

          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          {step === 'phone' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-serif mb-2" style={{ color: 'var(--text-primary)' }}>手机号</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入注册时使用的手机号"
                  maxLength={11}
                  disabled={loading}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={loading || !phone}
                className="w-full py-2 rounded-lg text-sm font-serif font-medium bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:bg-gray-900"
              >
                {loading ? '发送中...' : '获取验证码'}
              </button>
            </div>
          )}

          {step === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-serif" style={{ color: 'var(--text-primary)' }}>验证码</label>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={countdown > 0 || loading}
                    className="text-xs text-gray-500 hover:text-black disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {countdown > 0 ? `重新发送 (${countdown}s)` : '重新发送'}
                  </button>
                </div>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6位短信验证码"
                  disabled={loading}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-serif mb-2" style={{ color: 'var(--text-primary)' }}>新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少8位"
                  disabled={loading}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-serif mb-2" style={{ color: 'var(--text-primary)' }}>确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  disabled={loading}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif focus:border-black focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 rounded-lg text-sm font-serif font-medium bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:bg-gray-900"
              >
                {loading ? '重置中...' : '重置密码'}
              </button>
            </form>
          )}

          <div className="mt-4 text-center text-sm text-gray-500 font-serif">
            想起来了？{' '}
            <Link to="/login" className="hover:underline" style={{ color: 'var(--text-primary)' }}>返回登录</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
