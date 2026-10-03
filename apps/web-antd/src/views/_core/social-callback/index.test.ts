import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SocialCallback from './index.vue';

const state = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  push: vi.fn(),
  replace: vi.fn(),
  access: { accessToken: 'existing-token' },
  authCallback: vi.fn(),
  authLogin: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ push: state.push, replace: state.replace }),
}));
vi.mock('@vben/constants', () => ({
  DEFAULT_TENANT_ID: '000000',
  LOGIN_PATH: '/auth/login',
}));
vi.mock('@vben/stores', () => ({ useAccessStore: () => state.access }));
vi.mock('@vben/utils', () => ({ cn: (...items: string[]) => items.join(' ') }));
vi.mock('ant-design-vue', () => ({
  message: { error: state.error, success: state.success },
  Spin: 'div',
}));
vi.mock('#/api', () => ({ authCallback: state.authCallback }));
vi.mock('#/store', () => ({
  useAuthStore: () => ({ authLogin: state.authLogin }),
}));
vi.mock('../oauth-common', () => ({ accountBindList: [{ source: 'github' }] }));

describe('第三方回调延迟跳转生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.clearAllMocks();
    state.authCallback.mockReset().mockResolvedValue(undefined);
    state.authLogin.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.access.accessToken = 'existing-token';
    state.route.query = {
      code: 'code',
      source: 'github',
      state: btoa(JSON.stringify({ tenantId: '000000' })),
    };
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('仍挂载时失败保留原一千五百毫秒登录跳转', async () => {
    state.authCallback.mockRejectedValue(new Error('failure'));
    const wrapper = mount(SocialCallback);
    await flushPromises();
    vi.advanceTimersByTime(1499);
    expect(state.push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/auth/login');
    wrapper.unmount();
  });

  it('已安排的跳转在卸载时取消', async () => {
    state.authCallback.mockRejectedValue(new Error('failure'));
    const wrapper = mount(SocialCallback);
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('卸载后异步失败不再创建跳转timer', async () => {
    let reject!: (error: Error) => void;
    state.authCallback.mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const wrapper = mount(SocialCallback);
    wrapper.unmount();
    reject(new Error('late failure'));
    await flushPromises();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('无token仍走原登录分支，失败时沿原登录路径跳转', async () => {
    state.access.accessToken = '';
    state.authLogin.mockRejectedValue(new Error('login failure'));
    const wrapper = mount(SocialCallback);
    await flushPromises();
    expect(state.authLogin).toHaveBeenCalledTimes(1);
    expect(state.authCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/auth/login');
    wrapper.unmount();
  });

  it('无回调参数仍走原replace且不调用认证', async () => {
    state.route.query = {};
    const wrapper = mount(SocialCallback);
    await flushPromises();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith('/auth/login');
    expect(state.authCallback).not.toHaveBeenCalled();
    expect(state.authLogin).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
