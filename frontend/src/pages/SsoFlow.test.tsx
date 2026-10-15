import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';
import ForgotPassword from './ForgotPassword';
import { authApi } from '../api/auth';
import { authPath } from '../utils/sso';
import { siteConfiguration } from '../api/ssoAdmin';

const params = new URLSearchParams({sso_client:'site-test',sso_redirect:'https://site.example/auth/callback',sso_state:'s'.repeat(43),sso_code_challenge:'c'.repeat(43),sso_code_challenge_method:'S256'});
beforeEach(()=>{localStorage.clear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('SSO navigation',()=>{
  it('preserves PKCE/state through registration and password recovery',()=>{
    render(<MemoryRouter initialEntries={[`/login?${params}`]}><Login/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'立即注册'}).getAttribute('href')).toBe(`/register?${params}`);
    expect(screen.getByRole('link',{name:'忘记密码？'}).getAttribute('href')).toBe(`/forgot-password?${params}`);
    cleanup();
    render(<MemoryRouter initialEntries={[`/forgot-password?${params}`]}><ForgotPassword/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'返回登录'}).getAttribute('href')).toBe(`/login?${params}`);
  });
  it('Watcha returns to login with the entire SSO flow',async()=>{
    const start=vi.spyOn(authApi,'startWatchaLogin').mockRejectedValue(new Error('local test'));
    render(<MemoryRouter initialEntries={[`/login?${params}`]}><Login/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:/观猹/}));
    await waitFor(()=>expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0][1]).toBe(`/login?${params}`);
  });
  it('failed handoff stays on login instead of leaving the requesting site behind',async()=>{
    vi.spyOn(authApi,'login').mockResolvedValue({token:'test-token',user:{id:1,phone:'13800000000',username:'Test'}} as never);
    const handoff=vi.spyOn(authApi,'ssoAuthorize').mockRejectedValue(new Error('网站已停用'));
    render(<MemoryRouter initialEntries={[`/login?${params}`]}><Login/></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/手机号/),{target:{value:'13800000000'}});
    fireEvent.change(screen.getByPlaceholderText(/密码/),{target:{value:'test-password'}});
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
