import { adminRequest } from './admin';
export interface SsoClient { client_id: string; name: string; origin: string; enabled: number; version: number; redirect_uri: string; }
export interface SsoConfig extends SsoClient { client_secret: string; session_secret: string; }
export interface SsoUser { id: number; username: string; enabled: number; }
const body = (method: string, value?: unknown) => ({method, ...(value ? {body: JSON.stringify(value)} : {})});
export const ssoAdmin = {
  list: () => adminRequest<{clients: SsoClient[]}>('/sso/clients'),
  create: (name: string, origin: string) => adminRequest<SsoConfig>('/sso/clients', body('POST', {name,origin})),
  toggle: (id: string, enabled: boolean) => adminRequest<SsoClient>(`/sso/clients/${id}`, body('PATCH', {enabled})),
  rotate: (id: string) => adminRequest<SsoConfig>(`/sso/clients/${id}/rotate`, body('POST')),
  users: (q: string) => adminRequest<{users:SsoUser[]}>(`/sso/users?q=${encodeURIComponent(q)}`),
  user: (id: number, enabled?: boolean) => adminRequest(`/sso/users/${id}${enabled === undefined ? '/revoke' : ''}`, body(enabled === undefined ? 'POST' : 'PATCH', enabled === undefined ? undefined : {enabled})),
};
export function siteConfiguration(item: SsoConfig) {
  const base = new URL(window.location.hostname === 'world.tashan.chat'
    ? 'https://login.tashan.ac.cn/'
    : new URL(import.meta.env.BASE_URL || '/', window.location.origin).href);
  return {name:item.name, origin:item.origin, clientId:item.client_id, clientSecret:item.client_secret, sessionSecret:item.session_secret,
    loginUrl:new URL('login', base).href, apiBase:new URL('api', base).href};
}
