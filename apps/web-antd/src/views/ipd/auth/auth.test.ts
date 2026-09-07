import type { IpdIdentity } from '../../../api/ipd/auth';

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { loginIpd, parseIdentity, requestIpd } from '../../../api/ipd/auth';
import { identityDestination, IPD_ACCOUNT, IPD_HOME, IPD_LOGIN, IPD_PASSWORD } from '../../../router/ipd-guard';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import Login from './login.vue';
import Account from './account.vue';
import ChangePassword from './change-password.vue';
import { passwordStrength, validateNewPassword } from './password-rules';

const identity: IpdIdentity = {
  mustChangePwd: true, scope: 'PASSWORD_CHANGE_REQUIRED',
  person: { id: '9007199254740993', groupId: null, name: '测试人员', username: 'fixture-user', personType: 'MARKET_PM', accountStatus: 'ACTIVE' },
};
const response = (data: unknown, status = 200, code = 0) => new Response(JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('IPD API and session contract', () => {
  it('retains a recoverable session after logout transport failure and lets retry revoke it', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network unavailable')).mockResolvedValueOnce(response(null));
    vi.stubGlobal('fetch', fetcher);
    await expect(auth.logout()).rejects.toThrow();
    expect(auth.token).toBe('test-session');
    expect(auth.identity).toEqual(identity);
    await auth.logout();
    expect(auth.token).toBe(''); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves string IDs and refuses numeric identity IDs or unknown roles', () => {
    expect(parseIdentity(identity).person.id).toBe('9007199254740993');
    expect(parseIdentity({ ...identity, person: { ...identity.person, extraPrivateField: 'fixture' } }).person).not.toHaveProperty('extraPrivateField');
    expect(() => parseIdentity({ ...identity, person: { ...identity.person, id: 123 } })).toThrow();
    expect(() => parseIdentity({ ...identity, person: { ...identity.person, personType: 'admin' } })).toThrow();
  });
  it('uses only the local IPD prefix and sends only login fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ...identity, token: 'test-session', tokenType: 'Bearer', expiresIn: 900 }));
    vi.stubGlobal('fetch', fetcher);
    const result = await loginIpd('fixture-user', 'fixture-value');
    expect(result.scope).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/auth/login');
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ username: 'fixture-user', password: 'fixture-value' });
    expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBeUndefined();
  });
  it('rejects RuoYi code200 and HTML responses rather than reporting success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(identity, 200, 200)).mockResolvedValueOnce(new Response('<html>unavailable</html>')));
    await expect(requestIpd('/auth/me')).rejects.toThrow();
    await expect(requestIpd('/auth/me')).rejects.toThrow('服务暂时不可用');
  });
  it('does not display arbitrary server exception details in validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 10001, message: 'SQL secret-field debug details', data: null }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    await expect(requestIpd('/auth/change-password')).rejects.toThrow('输入信息不符合要求');
  });
  it('clears the session when a live me request returns401', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    sessionStorage.setItem('ruoyi-ipd.session-token', auth.token);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 401, 20001)));
    await expect(auth.refreshIdentity()).rejects.toThrow('登录已失效');
    expect(auth.token).toBe(''); expect(auth.identity).toBeNull();
    expect(sessionStorage.getItem('ruoyi-ipd.session-token')).toBeNull();
  });
  it('revokes local state after a successful password change and never sends confirmation', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    const fetcher = vi.fn().mockResolvedValue(response(null)); vi.stubGlobal('fetch', fetcher);
    await auth.changePassword('old-fixture', 'New-fixture-8');
    expect(auth.token).toBe(''); expect(auth.identity).toBeNull();
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ currentPassword: 'old-fixture', newPassword: 'New-fixture-8' });
  });
  it('keeps entered identity restricted after a rejected password change', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 400, 10001)));
    await expect(auth.changePassword('wrong-fixture', 'New-fixture-8')).rejects.toThrow();
    expect(auth.mustChangePassword).toBe(true); expect(auth.token).toBe('test-session');
  });
});

describe('IPD navigation and password rules', () => {
  it('blocks anonymous access and every first-login deep link except password setup', () => {
    expect(identityDestination('/dashboard', null)).toBe(IPD_LOGIN);
    for (const path of [IPD_LOGIN, IPD_ACCOUNT, '/dashboard', '/system/user', '/auth/qrcode-login']) expect(identityDestination(path, identity)).toBe(IPD_PASSWORD);
    expect(identityDestination(IPD_PASSWORD, identity)).toBe(true);
  });
  it('does not use a full or frozen IPD identity to unlock legacy framework routes', () => {
    expect(identityDestination('/system/user', { ...identity, scope: 'FULL', mustChangePwd: false })).toBe(IPD_HOME);
    expect(identityDestination('/ipd/projects', { ...identity, scope: 'FULL', mustChangePwd: false })).toBe(true);
    expect(identityDestination('/portal/submit', { ...identity, scope: 'FULL', mustChangePwd: false })).toBe(true);
    expect(identityDestination('/system/user', { ...identity, scope: 'HANDOVER_ONLY', mustChangePwd: false })).toBe(IPD_ACCOUNT);
    expect(identityDestination('/ipd/handover', { ...identity, scope: 'HANDOVER_ONLY', mustChangePwd: false })).toBe(true);
  });
  it('checks confirmation, current password, character minimum and UTF8 byte maximum', () => {
    expect(validateNewPassword('', 'Abcdef12', 'Abcdef12')).toContain('当前密码');
    expect(validateNewPassword('old-value', 'abc', 'abc')).toContain('8');
    expect(validateNewPassword('Abcdef12', 'Abcdef12', 'Abcdef12')).toContain('不能与当前');
    expect(validateNewPassword('old-value', 'Abcdef12', 'different')).toContain('不一致');
    expect(validateNewPassword('old-value', '汉'.repeat(25), '汉'.repeat(25))).toContain('72字节');
    expect(validateNewPassword('old-value', 'Abcdef12', 'Abcdef12')).toBe('');
    expect(passwordStrength('Abcdef123!45').label).toBe('强');
  });
});

async function mountPage(component: typeof Login | typeof ChangePassword | typeof Account) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component }, { path: IPD_LOGIN, component: Login }, { path: IPD_PASSWORD, component: ChangePassword }, { path: IPD_ACCOUNT, component: Login }] });
  await router.push('/'); await router.isReady();
  const wrapper = mount(component, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe('IPD authentication components', () => {
  it('shows a short-lived success notice only after an actual successful store operation', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null)));
    await auth.changePassword('old-fixture', 'New-fixture-8');
    const { wrapper } = await mountPage(Login);
    expect(wrapper.text()).toContain('密码已修改');
    wrapper.unmount();
    const second = await mountPage(Login);
    expect(second.wrapper.text()).not.toContain('密码已修改'); second.wrapper.unmount();
  });
  it('keeps a failed logout on the account page and retries through the same button', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = { ...identity, mustChangePwd: false, scope: 'FULL' };
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network unavailable')).mockResolvedValueOnce(response(null)); vi.stubGlobal('fetch', fetcher);
    const { wrapper, router } = await mountPage(Account);
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('未能确认服务端退出'));
    expect(router.currentRoute.value.path).toBe('/'); expect(auth.token).toBe('test-session');
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(IPD_LOGIN));
    expect(fetcher).toHaveBeenCalledTimes(2); wrapper.unmount();
  });

  it('cannot claim a password change from a forged URL query', async () => {
    const { wrapper, router } = await mountPage(Login);
    await router.replace({ path: '/', query: { passwordChanged: '1' } });
    expect(wrapper.text()).not.toContain('密码已修改');
    wrapper.unmount();
  });

  it('submits the real login form then follows the first-login route', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...identity, token: 'test-session', tokenType: 'Bearer', expiresIn: 900 })).mockResolvedValueOnce(response(identity));
    vi.stubGlobal('fetch', fetcher);
    const { wrapper, router } = await mountPage(Login);
    await wrapper.findAll('input')[0]?.setValue('fixture-user');
    await wrapper.findAll('input')[1]?.setValue('fixture-value');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(IPD_PASSWORD));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('input')[1]?.element.value).toBe('');
    wrapper.unmount();
  });
  it('submits the real password form, clears secrets and requires a new login', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    const fetcher = vi.fn().mockResolvedValue(response(null)); vi.stubGlobal('fetch', fetcher);
    const { wrapper, router } = await mountPage(ChangePassword);
    const inputs = wrapper.findAll('input');
    await inputs[0]?.setValue('old-fixture'); await inputs[1]?.setValue('New-fixture-8'); await inputs[2]?.setValue('New-fixture-8');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(IPD_LOGIN));
    expect(auth.consumePasswordChangedNotice()).toBe(true);
    expect(auth.consumePasswordChangedNotice()).toBe(false);
    expect(auth.token).toBe(''); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('input').map((input) => input.element.value)).toEqual(['', '', '']);
    wrapper.unmount();
  });
  it('displays mismatching confirmation without calling the API', async () => {
    const auth = useIpdAuthStore(); auth.token = 'test-session'; auth.identity = identity;
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { wrapper } = await mountPage(ChangePassword);
    const inputs = wrapper.findAll('input');
    await inputs[0]?.setValue('old-fixture'); await inputs[1]?.setValue('New-fixture-8'); await inputs[2]?.setValue('different-fixture');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('两次输入的新密码不一致'));
    expect(fetcher).not.toHaveBeenCalled(); wrapper.unmount();
  });

  it('shows empty login fields without demo or third party shortcuts', async () => {
    const { wrapper } = await mountPage(Login);
    expect(wrapper.findAll('input').map((input) => input.element.value)).toEqual(['', '']);
    // 原型对齐：企微入口以双 tab 形式存在（默认姓名账号），无手机号/第三方快捷登录
    expect(wrapper.text()).toContain('企业微信扫码');
    expect(wrapper.text()).not.toContain('手机号登录');
    const wecomTab = wrapper.findAll('button').find((button) => button.text().includes('企业微信扫码'));
    expect(wecomTab).toBeDefined();
    await wecomTab?.trigger('click');
    expect(wrapper.text()).toContain('企业微信登录暂未开放');
    wrapper.unmount();
  });
  it('shows the verified identity with the prototype first-login layout and three blank password inputs', async () => {
    const auth = useIpdAuthStore(); auth.identity = identity;
    const { wrapper } = await mountPage(ChangePassword);
    // 原型 FirstLoginPage 对齐：eyebrow/标题/角色名·用户名/managed-profile-card/按钮文案；
    // 原型无密码强度条，已随一比一复刻移除
    expect(wrapper.text()).toContain('首次登录安全设置');
    expect(wrapper.text()).toContain('设置个人密码，开始安全工作。');
    expect(wrapper.text()).toContain('完成首次登录设置');
    expect(wrapper.text()).toContain('市场PM · 用户名：fixture-user');
    expect(wrapper.text()).toContain('测试人员 · 本地治理账号');
    expect(wrapper.text()).toContain('设置密码并进入工作台');
    expect(wrapper.text()).toContain('退出并返回登录');
    expect(wrapper.findAll('input').map((input) => input.element.value)).toEqual(['', '', '']);
    wrapper.unmount();
  });
});
