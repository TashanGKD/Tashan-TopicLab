import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';
import ForgotPassword from './ForgotPassword';
import Register from './Register';
import { shouldHideGlobalChrome } from '../utils/layoutChrome';
import { authApi } from '../api/auth';
import { authPath } from '../utils/sso';
import { siteConfiguration } from '../api/ssoAdmin';

const params = new URLSearchParams({sso_client:'site-test',sso_redirect:'https://site.example/auth/callback',sso_state:'s'.repeat(43),sso_code_challenge:'c'.repeat(43),sso_code_challenge_method:'S256'});
beforeEach(()=>{localStorage.clear();vi.spyOn(authApi,"getCaptchaConfig").mockResolvedValue({enabled:false});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('SSO navigation',()=>{
  it('preserves PKCE/state through registration and password recovery',()=>{
    render(<MemoryRouter initialEntries={[`/login?${params}`]}><Login/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'立即注册'}).getAttribute('href')).toBe(`/sso/register?${params}`);
    expect(screen.getByRole('link',{name:'忘记密码？'}).getAttribute('href')).toBe(`/sso/forgot-password?${params}`);
    cleanup();
    render(<MemoryRouter initialEntries={[`/forgot-password?${params}`]}><ForgotPassword/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'返回登录'}).getAttribute('href')).toBe(`/sso/login?${params}`);
  });
  it.each(['/sso/login', `/sso/login?${params}`, `/login?${params}`])('unified entry %s has its own branding and no Watcha', (entry) => {
    render(<MemoryRouter initialEntries={[entry]}><Login/></MemoryRouter>);
    expect(screen.getByText('他山统一认证')).toBeTruthy();
    expect(document.title).toBe('登录 · 他山统一认证');
    expect(screen.queryByRole('button', {name:/观猹/})).toBeNull();
    expect(screen.getByRole('link', {name:'立即注册'}).getAttribute('href')).toMatch(/^\/sso\/register/);
  });
  it('ordinary World login keeps Watcha and ordinary registration',async()=>{
    const start=vi.spyOn(authApi,'startWatchaLogin').mockRejectedValue(new Error('local test'));
    render(<MemoryRouter initialEntries={['/login?next=%2Fme']}><Login/></MemoryRouter>);
    expect(screen.queryByText('他山统一认证')).toBeNull();
    expect(screen.getByRole('link',{name:'立即注册'}).getAttribute('href')).toBe('/register?next=%2Fme');
    fireEvent.click(screen.getByRole('button',{name:/观猹/}));
    await waitFor(()=>expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0][1]).toBe('/me');
  });
  it('registration and recovery retain the shell without a requesting site', async()=>{
    vi.spyOn(authApi, 'getRegisterConfig').mockResolvedValue({registration_requires_sms:false,skip_sms_until:null});
    render(<MemoryRouter initialEntries={['/sso/register']}><Register/></MemoryRouter>);
    expect(screen.getByText('他山统一认证')).toBeTruthy();
    expect(screen.getByRole('link',{name:'立即登录'}).getAttribute('href')).toBe('/sso/login');
    await waitFor(()=>expect(screen.queryByPlaceholderText('请输入验证码')).toBeNull());
    cleanup();
    render(<MemoryRouter initialEntries={['/sso/forgot-password']}><ForgotPassword/></MemoryRouter>);
    expect(screen.getByText('他山统一认证')).toBeTruthy();
    expect(screen.getByRole('link',{name:'返回登录'}).getAttribute('href')).toBe('/sso/login');
  });
  it('direct unified login finishes inside the authentication shell', async()=>{
    vi.spyOn(authApi,'login').mockResolvedValue({token:'test-token',user:{id:1,phone:'13800000000',username:'Test'}} as never);
    const handoff=vi.spyOn(authApi,'ssoAuthorize');
    render(<MemoryRouter initialEntries={['/sso/login']}><Login/></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/手机号/),{target:{value:'13800000000'}});
    fireEvent.change(screen.getByPlaceholderText(/密码/),{target:{value:'test-password'}});
    await waitFor(()=>expect((screen.getByRole('button',{name:'登录'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'登录'}));
    expect(await screen.findByText('已登录他山账号')).toBeTruthy();
    expect(screen.getByText('他山统一认证')).toBeTruthy();
    expect(handoff).not.toHaveBeenCalled();
  });
  it('hides World navigation throughout unified authentication',()=>{
    for (const path of ['/sso/login','/sso/register','/sso/forgot-password','/forgot-password']) {
      expect(shouldHideGlobalChrome(path)).toBe(true);
    }
    expect(shouldHideGlobalChrome('/')).toBe(false);
  });
  it('failed handoff stays on login instead of leaving the requesting site behind',async()=>{
    vi.spyOn(authApi,'login').mockResolvedValue({token:'test-token',user:{id:1,phone:'13800000000',username:'Test'}} as never);
    const handoff=vi.spyOn(authApi,'ssoAuthorize').mockRejectedValue(new Error('网站已停用'));
    render(<MemoryRouter initialEntries={[`/login?${params}`]}><Login/></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/手机号/),{target:{value:'13800000000'}});
    fireEvent.change(screen.getByPlaceholderText(/密码/),{target:{value:'test-password'}});
    await waitFor(()=>expect((screen.getByRole('button',{name:'登录'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'登录'}));
    await waitFor(()=>expect(handoff).toHaveBeenCalledWith('test-token','site-test',params.get('sso_redirect'),params.get('sso_state'),params.get('sso_code_challenge')));
    expect(await screen.findByText('网站已停用')).toBeTruthy();
  });
  it('does not carry unrelated parameters',()=>{
    expect(authPath('/login',new URLSearchParams('unrelated=secret'))).toBe('/login');
  });
  it('download config is usable by the SDK without translating fields',()=>{
    const value=siteConfiguration({client_id:'site-test',name:'Test',origin:'https://site.example',enabled:1,version:1,redirect_uri:'https://site.example/auth/callback',client_secret:'c'.repeat(43),session_secret:'s'.repeat(43)});
    expect(value.clientId).toBe('site-test');expect(value.clientSecret).toHaveLength(43);
    expect(value.loginUrl).toBe(new URL('/login',window.location.origin).href);
    expect(value.apiBase).toBe(new URL('/api',window.location.origin).href);
  });
});
