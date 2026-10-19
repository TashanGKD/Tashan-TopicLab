import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, authApi } from '../api/auth';
import { useCaptcha } from './useCaptcha';
let options: Parameters<NonNullable<typeof window.initAliyunCaptcha>>[0];
const destroy = vi.fn();
const action = vi.fn();
function Page() {
  const captcha = useCaptcha('sms');
  return <>{captcha.element}<button disabled={!captcha.ready} onClick={() => void captcha.run(action).catch(() => {})}>send</button></>;
}
beforeEach(() => {
  vi.useFakeTimers(); destroy.mockClear(); action.mockReset();
  vi.spyOn(authApi, 'getCaptchaConfig').mockResolvedValue({enabled:true,prefix:'unit-prefix',region:'cn',scenes:{sms:'unit-sms',login:'unit-login'}});
  window.initAliyunCaptcha = vi.fn(config => { options = config; config.getInstance({destroyCaptcha:destroy}); });
});
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); delete window.initAliyunCaptcha;});
async function setup() {
  render(<Page/>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => {vi.advanceTimersByTime(2200);});
  fireEvent.click(screen.getByText('send'));
}
describe('CAPTCHA business gating', () => {
  it('does not execute business work before the SDK proof and uses the trusted scene', async () => {
    await setup();
    expect(options.SceneId).toBe('unit-sms'); expect(action).not.toHaveBeenCalled();
    action.mockResolvedValue({message:'ok'});
    let result;
    await act(async () => {result = await options.captchaVerifyCallback('opaque-proof');});
    expect(action).toHaveBeenCalledWith('opaque-proof');
    expect(result).toEqual({captchaResult:true,bizResult:true});
  });
  it('keeps a rejected risk check open for the provider secondary challenge', async () => {
    await setup();
    action.mockRejectedValueOnce(new AuthApiError('risk',428)).mockResolvedValueOnce({});
    let result;
    await act(async () => {result = await options.captchaVerifyCallback('first');});
    expect(result).toEqual({captchaResult:false,bizResult:false});
    await act(async () => {result = await options.captchaVerifyCallback('second');});
    expect(result).toEqual({captchaResult:true,bizResult:true});
  });
  it('cancels without performing business work and destroys SDK on unmount', async () => {
    await setup(); fireEvent.click(screen.getByText('取消'));
    await act(async () => { await options.captchaVerifyCallback('late'); });
    expect(action).not.toHaveBeenCalled(); cleanup(); expect(destroy).toHaveBeenCalledOnce();
  });
  it('provider outage is never considered a passed CAPTCHA', async () => {
    await setup(); action.mockRejectedValue(new AuthApiError('outage',503));
    let result;
    await act(async () => {result = await options.captchaVerifyCallback('proof');});
    expect(result).toEqual({captchaResult:false,bizResult:false});
  });
});
