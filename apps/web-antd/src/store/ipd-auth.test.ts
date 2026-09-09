import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loginIpdMock } = vi.hoisted(() => ({ loginIpdMock: vi.fn() }));

vi.mock('../api/ipd/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/ipd/auth')>();
  return { ...actual, loginIpd: loginIpdMock };
});
vi.mock('../api/core/user', () => ({ getUserInfoApi: vi.fn() }));
vi.mock('@vben/stores', () => ({
  useAccessStore: () => ({ setAccessToken: vi.fn(), setAccessCodes: vi.fn() }),
  useUserStore: () => ({ userInfo: null, setUserInfo: vi.fn() }),
}));

import { IPD_LOGIN_CREDENTIAL_TEXT, IpdRequestError } from '../api/ipd/auth';
import { useIpdAuthStore } from './ipd-auth';

/** 系统性梳理-20260909 P1：登录限流文案特判 + 冷却（store/ipd-auth.ts login()）。 */
describe('ipd-auth store 登录限流特判', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  it('限流（400+10001+固定文案）：错误原文透出并启动 60s 冷却', async () => {
    const store = useIpdAuthStore();
    loginIpdMock.mockRejectedValueOnce(new IpdRequestError(
      '登录尝试过于频繁，请稍后再试', 400, 10001, 'http', '登录尝试过于频繁，请稍后再试',
    ));

    await expect(store.login('ipd-admin', 'x')).rejects.toBeInstanceOf(IpdRequestError);

    expect(store.error).toBe('登录尝试过于频繁，请稍后再试');
    expect(store.loginCooldownRemaining).toBe(60);
  });

  it('冷却逐秒递减，60s 后归零', async () => {
    const store = useIpdAuthStore();
    loginIpdMock.mockRejectedValueOnce(new IpdRequestError(
      '登录尝试过于频繁，请稍后再试', 400, 10001, 'http', '登录尝试过于频繁，请稍后再试',
    ));
    await expect(store.login('ipd-admin', 'x')).rejects.toThrow();
    expect(store.loginCooldownRemaining).toBe(60);

    vi.advanceTimersByTime(1000);
    expect(store.loginCooldownRemaining).toBe(59);
    vi.advanceTimersByTime(59_000);
    expect(store.loginCooldownRemaining).toBe(0);
  });

  it('冷却期内直接调 login()：store 层拦截（纵深守卫，不依赖视图层）', async () => {
    const store = useIpdAuthStore();
    loginIpdMock.mockRejectedValueOnce(new IpdRequestError(
      '登录尝试过于频繁，请稍后再试', 400, 10001, 'http', '登录尝试过于频繁，请稍后再试',
    ));
    await expect(store.login('ipd-admin', 'x')).rejects.toThrow();
    expect(store.loginCooldownRemaining).toBe(60);

    // 蜂群复审 P2：冷却期内再次登录，不发请求、直接被 store 拒绝
    loginIpdMock.mockClear();
    await expect(store.login('ipd-admin', 'x')).rejects.toThrow(/\d+ 秒后再试/);
    expect(loginIpdMock).not.toHaveBeenCalled();
  });

  it('凭据错误（envelope.message 固定枚举）：仍走凭据文案，不触发冷却', async () => {
    const store = useIpdAuthStore();
    loginIpdMock.mockRejectedValueOnce(new IpdRequestError(
      '用户名或密码错误', 400, 10001, 'http', '用户名或密码错误',
    ));

    await expect(store.login('ipd-admin', 'x')).rejects.toBeInstanceOf(IpdRequestError);

    expect(store.error).toBe(IPD_LOGIN_CREDENTIAL_TEXT);
    expect(store.loginCooldownRemaining).toBe(0);
  });

  it('其他失败：通用兜底文案，不触发冷却', async () => {
    const store = useIpdAuthStore();
    loginIpdMock.mockRejectedValueOnce(new Error('boom'));

    await expect(store.login('ipd-admin', 'x')).rejects.toBeInstanceOf(Error);

    expect(store.error).toBe('登录失败，请重试');
    expect(store.loginCooldownRemaining).toBe(0);
  });
});
