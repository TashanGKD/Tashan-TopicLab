import { useEffect, useId, useRef, useState } from 'react';
import { AuthApiError, authApi, type CaptchaConfig } from '../api/auth';

type Instance = { destroyCaptcha: () => void; hide?: () => void };
type Options = {
  SceneId: string; mode: 'popup'; element: string; button: string;
  captchaVerifyCallback: (token: string) => Promise<{ captchaResult: boolean; bizResult: boolean }>;
  onBizResultCallback: () => void; getInstance: (instance: Instance) => void;
  onError: () => void; slideStyle: { width: number; height: number }; language: 'cn'; rem: number;
};
declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string };
    initAliyunCaptcha?: (options: Options) => void;
  }
}
let scriptPromise: Promise<void> | undefined;
function loadSdk(config: CaptchaConfig): Promise<void> {
  window.AliyunCaptchaConfig = { region: config.region!, prefix: config.prefix! };
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
      script.async = true;
      const timer = setTimeout(() => failed(), 15000);
      const failed = () => {
        clearTimeout(timer); script.remove(); scriptPromise = undefined;
        reject(new Error('安全验证加载失败，请刷新重试'));
      };
      script.onload = () => { clearTimeout(timer); window.initAliyunCaptcha ? resolve() : failed(); };
      script.onerror = failed;
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

type Pending = { action: (token?: string) => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; running: boolean };

/** One SDK instance per account page. Business endpoints enforce validation themselves. */
export function useCaptcha(purpose: 'sms' | 'login') {
  const id = 'auth-captcha-' + useId().replace(/:/g, '');
  const configRef = useRef<CaptchaConfig>();
  const pending = useRef<Pending>();
  const instance = useRef<Instance>();
  const readyAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    const request = pending.current;
    if (!request || request.running) return;
    pending.current = undefined; clearTimeout(request.timer);
    instance.current?.hide?.(); setBusy(false);
    request.reject(new Error('验证已取消，请重新操作'));
  };

  useEffect(() => {
    let disposed = false;
    let readyTimer: ReturnType<typeof setTimeout>;
    const setup = async () => {
      try {
        const config = await authApi.getCaptchaConfig();
        if (disposed) return;
        configRef.current = config;
        if (!config.enabled) { setReady(true); return; }
        if (!config.prefix || !config.region || !config.scenes?.[purpose]) throw new Error('安全验证暂不可用，请稍后重试');
        await loadSdk(config);
        if (disposed) return;
        window.initAliyunCaptcha!({
          SceneId: config.scenes[purpose], mode: 'popup',
          element: `#${id}`, button: `#${id}-trigger`, language: 'cn',
          slideStyle: { width: 320, height: 40 }, rem: Math.min(1, (window.innerWidth - 24) / 360),
          onBizResultCallback: () => {},
          getInstance: (value) => {
            if (disposed) { value.destroyCaptcha(); return; }
            instance.current = value;
            readyAt.current = Date.now() + 2100;
            readyTimer = setTimeout(() => { if (!disposed) setReady(true); }, 2100);
          },
          onError: () => {
            if (disposed) return;
            setError('安全验证加载失败，请刷新重试'); setReady(false);
            const request = pending.current;
            if (request && !request.running) {
              clearTimeout(request.timer); pending.current = undefined; setBusy(false);
              request.reject(new Error('安全验证暂不可用，请刷新重试'));
            }
          },
          captchaVerifyCallback: async (token) => {
            const request = pending.current;
            if (!request || request.running || disposed) return { captchaResult: false, bizResult: false };
            request.running = true;
            try {
              const value = await request.action(token);
              clearTimeout(request.timer); pending.current = undefined; setBusy(false); setError('');
              request.resolve(value);
              return { captchaResult: true, bizResult: true };
            } catch (cause) {
              request.running = false;
              if (cause instanceof AuthApiError && cause.status === 428) {
                setError('请完成安全验证后继续');
                return { captchaResult: false, bizResult: false };
              }
              clearTimeout(request.timer); pending.current = undefined; setBusy(false);
              request.reject(cause instanceof Error ? cause : new Error('请求失败，请重试'));
              return { captchaResult: cause instanceof AuthApiError && cause.status < 500, bizResult: false };
            }
          },
        });
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '安全验证加载失败，请刷新重试');
      }
    };
    void setup();
    return () => {
      disposed = true; clearTimeout(readyTimer);
      instance.current?.destroyCaptcha(); instance.current = undefined;
      if (pending.current) {
        clearTimeout(pending.current.timer);
        pending.current.reject(new Error('验证已结束，请重新操作')); pending.current = undefined;
      }
    };
  }, [id, purpose]);

  const run = async <T,>(action: (token?: string) => Promise<T>): Promise<T> => {
    if (!ready || !configRef.current) throw new Error(error || '安全验证正在准备，请稍后重试');
    if (!configRef.current.enabled) return action();
    if (pending.current) throw new Error('请先完成当前安全验证');
    if (Date.now() < readyAt.current) throw new Error('安全验证正在准备，请稍后重试');
    setError(''); setBusy(true);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = pending.current;
        if (request?.running) return; // Never invite retry while a business request is in flight.
        pending.current = undefined; instance.current?.hide?.(); setBusy(false);
        reject(new Error('验证已超时，请重新操作'));
      }, 120000);
      pending.current = { action, resolve: value => resolve(value as T), reject, timer, running: false };
      document.getElementById(`${id}-trigger`)?.click();
    });
  };

  const element = <>
    <div id={id} />
    <button id={`${id}-trigger`} type="button" hidden tabIndex={-1} aria-hidden="true" />
    {error && <p role="alert" className="text-sm text-red-600 my-2">{error}</p>}
    {busy && <p className="text-sm text-gray-500 my-2">正在进行安全验证… <button type="button" className="underline" onClick={cancel}>取消</button></p>}
  </>;
  return { run, element, ready };
}
