/** Auth API client */

import { readApiError } from './httpError';

const API_BASE = import.meta.env.BASE_URL ? `${import.meta.env.BASE_URL}api` : '/api';

export interface User {
  id: number;
  phone: string;
  username: string | null;
  is_admin?: boolean;
  is_guest?: boolean;
  created_at: string;
}

export interface MeResponse {
  user: User;
  auth_type?: string;
}

export interface AuthResponse {
  message: string;
  user: User;
  token?: string;
  claim_status?: string;
  claim_detail?: string;
  redirect_path?: string;
}

export interface WatchaOAuthStartResponse {
  authorization_url: string;
  state: string;
}

export interface SendCodeResponse {
  message: string;
  dev_code?: string;
}

export interface RegisterConfigResponse {
  registration_requires_sms: boolean;
  skip_sms_until: string | null;
}

export interface DigitalTwinRecord {
  agent_name: string;
  display_name: string | null;
  expert_name: string | null;
  visibility: 'private' | 'public' | string;
  exposure: 'brief' | 'full' | string;
  session_id: string | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
  has_role_content?: boolean;
}

export interface DigitalTwinDetail extends DigitalTwinRecord {
  role_content: string | null;
}

export interface OpenClawKeyInfo {
  has_key: boolean;
  key?: string | null;
  masked_key?: string | null;
  created_at?: string | null;
  last_used_at?: string | null;
  skill_path?: string | null;
  bind_key?: string | null;
  bootstrap_path?: string | null;
  is_guest?: boolean;
  claim_token?: string | null;
  claim_register_path?: string | null;
  claim_login_path?: string | null;
}

export const authApi = {
  getRegisterConfig: async (): Promise<RegisterConfigResponse> => {
    const res = await fetch(`${API_BASE}/auth/register-config`);
    if (!res.ok) {
      throw new Error(await readApiError(res, '获取注册配置失败'));
    }
    return res.json();
  },

  sendCode: async (phone: string, type: 'register' | 'login' | 'reset_password' = 'register'): Promise<SendCodeResponse> => {
    const res = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, type }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '发送验证码失败'));
    }
    return res.json();
  },

  register: async (phone: string, code: string, password: string, username: string, claimToken?: string | null): Promise<AuthResponse> => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, password, username, claim_token: claimToken ?? null }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '注册失败'));
    }
    return res.json();
  },

  login: async (phone: string, password: string, claimToken?: string | null): Promise<AuthResponse> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password, claim_token: claimToken ?? null }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '登录失败'));
    }
    return res.json();
  },

  startWatchaLogin: async (redirectUri: string, nextPath: string, claimToken?: string | null): Promise<WatchaOAuthStartResponse> => {
    const res = await fetch(`${API_BASE}/auth/watcha/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uri: redirectUri, next_path: nextPath, claim_token: claimToken ?? null }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '观猹登录暂时不可用'));
    }
    return res.json();
  },

  completeWatchaLogin: async (code: string, state: string): Promise<AuthResponse> => {
    const res = await fetch(`${API_BASE}/auth/watcha/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '观猹登录失败'));
    }
    return res.json();
  },

  getMe: async (token: string): Promise<MeResponse> => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '获取用户信息失败'));
    }
    return res.json();
  },

  getDigitalTwins: async (token: string): Promise<{ digital_twins: DigitalTwinRecord[] }> => {
    const res = await fetch(`${API_BASE}/auth/digital-twins`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '获取分身记录失败'));
    }
    return res.json();
  },

  getDigitalTwinDetail: async (token: string, agentName: string): Promise<{ digital_twin: DigitalTwinDetail }> => {
    const res = await fetch(`${API_BASE}/auth/digital-twins/${encodeURIComponent(agentName)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '获取分身详情失败'));
    }
    return res.json();
  },

  getOpenClawKey: async (token: string): Promise<OpenClawKeyInfo> => {
    const res = await fetch(`${API_BASE}/auth/openclaw-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '获取 OpenClaw Key 失败'));
    }
    return res.json();
  },

  createOpenClawKey: async (token: string): Promise<OpenClawKeyInfo> => {
    const res = await fetch(`${API_BASE}/auth/openclaw-key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '生成 OpenClaw Key 失败'));
    }
    return res.json();
  },

  resetPassword: async (phone: string, code: string, newPassword: string): Promise<{ message: string }> => {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, new_password: newPassword }),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '密码重置失败'));
    }
    return res.json();
  },

  createGuestOpenClawKey: async (): Promise<OpenClawKeyInfo> => {
    const res = await fetch(`${API_BASE}/auth/openclaw-guest`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, '生成临时 OpenClaw 账号失败'));
    }
    return res.json();
  },
};

export const tokenManager = {
  get: (): string | null => localStorage.getItem('auth_token'),
  set: (token: string) => localStorage.setItem('auth_token', token),
  remove: () => localStorage.removeItem('auth_token'),
  getUser: (): User | null => {
    const user = localStorage.getItem('auth_user');
    return user ? JSON.parse(user) : null;
  },
  setUser: (user: User) => localStorage.setItem('auth_user', JSON.stringify(user)),
  clearUser: () => localStorage.removeItem('auth_user'),
};

export async function refreshCurrentUserProfile(): Promise<User | null> {
  const token = tokenManager.get()
  if (!token) {
    tokenManager.clearUser()
    return null
  }

  try {
    const me = await authApi.getMe(token)
    tokenManager.setUser(me.user)
    return me.user
  } catch {
    return tokenManager.getUser()
  }
}
