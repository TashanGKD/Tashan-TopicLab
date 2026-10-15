import { useState, type InputHTMLAttributes } from 'react';

/** Keep password visibility local; no credentials are stored by this control. */
export default function AuthPasswordInput({ unified, ...props }: InputHTMLAttributes<HTMLInputElement> & { unified: boolean }) {
  const [visible, setVisible] = useState(false);
  if (!unified) return <input {...props} type="password" />;
  return (
    <div className="unified-auth__password">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button type="button" className="unified-auth__visibility" disabled={props.disabled}
        aria-label={`${visible ? '隐藏' : '显示'}${props['aria-label'] || '密码'}`}
        aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(!visible)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  );
}
