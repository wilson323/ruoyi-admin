import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import Account from './account.vue';
import Login from './login.vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginIpd } from '../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../store/ipd-auth';

const identity = { mustChangePwd: false, scope: 'FULL', person: { id: '900103', groupId: null, name: '测试人员', username: 'fixture', personType: 'MARKET_PM', accountStatus: 'ACTIVE' } };
const pair = (suffix = 'one') => ({ ...identity, token: `access-${suffix}`, tokenType: 'Bearer', expiresIn: 900 });
const response = (data: unknown, status = 200, code = 0, message?: string) => new Response(JSON.stringify({ code, message: message ?? (code ? '请求被拒绝' : 'ok'), data, timestamp: '2026-09-05', traceId: null }), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('rotating IPD session', () => {
  it('keeps the server-issued token and expiration interval from login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(pair())));
    expect(await loginIpd('fixture', 'fixture-password')).toEqual(pair());
  });
  it('maps a credential rejection (400/10001) on the login path to the dedicated message', async () => {
    // 2026-09-06 第六批回归：凭据语义按后端固定枚举消息判定（评审 Important-1），不得被通用表吞成「输入信息不符合要求」
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 400, 10001, '用户名或密码错误')));
    const auth = useIpdAuthStore();
    await expect(auth.login('fixture', 'wrong-password')).rejects.toThrow();
    expect(auth.error).toBe('用户名或密码错误，请重新输入');
  });
  it('does not mask non-credential 10001 rejections (rate limit / disabled) as wrong password', async () => {
    // 评审 Important-1：离职/禁用/限流同落 400+10001，按 code 无差别覆写会遮蔽防爆破提示、误导撞库
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 400, 10001, '登录尝试过于频繁，请稍后再试')));
    const auth = useIpdAuthStore();
    await expect(auth.login('fixture', 'any')).rejects.toThrow();
    expect(auth.error).toBe('输入信息不符合要求，请检查后重试');
  });
  it('keeps the defensive 401 login specialization for credential codes (gateway rewrite path)', async () => {
    // 评审 Suggestion-2：后端登录匿名放行且 10001 实走 HTTP 400，401+10001 仅网关异常改写时出现——纯防御分支须有用例固定
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 401, 10001, '用户名或密码错误')));
    await expect(loginIpd('fixture', 'wrong')).rejects.toThrow('用户名或密码错误，请重新输入');
  });
  it('never reports wrong-password for 401 login rejections carrying non-credential codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 401, 20002, '账号待移交冻结中')));
    await expect(loginIpd('fixture', 'wrong')).rejects.toThrow('账号待移交冻结中，仅保留移交相关权限');
  });
  it('rotates once for concurrent expired requests and atomically stores the new pair', async () => {
    let expired = false; let refreshCalls = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/refresh')) {
        refreshCalls++;
        expect(options?.body).toBeUndefined();
        expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer access-one');
        await gate; return response(pair('two'));
      }
      return expired && new Headers(options?.headers).get('Authorization') === 'Bearer access-one'
        ? response(null, 401, 20001) : response(identity);
    });
    vi.stubGlobal('fetch', fetcher);
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password'); expired = true;
    const results = Promise.allSettled([auth.refreshIdentity(), auth.refreshIdentity()]);
    try { await vi.waitFor(() => expect(refreshCalls).toBe(1)); } finally { release(); }
    expect((await results).map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(auth.token).toBe('access-two');
    const stored = JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}');
    expect(stored.accessToken).toBe('access-two');
    expect(stored.refreshToken).toBeUndefined();
    expect(stored.person).toBeUndefined(); expect(sessionStorage.getItem('ruoyi-ipd.session-token')).toBeNull();
  });

  it('never resurrects a previous session when refresh finishes after a new login', async () => {
    let logins = 0; let expire = false; let refreshCalls = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/login')) return response(pair(++logins === 1 ? 'one' : 'new-login'));
      if (url.endsWith('/refresh')) { refreshCalls++; await gate; return response(pair('old-family')); }
      return expire && new Headers(options?.headers).get('Authorization') === 'Bearer access-one'
        ? response(null, 401, 20001) : response(identity);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password'); expire = true;
    const previous = Promise.allSettled([auth.refreshIdentity()]);
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    await auth.login('fixture', 'new-login-password'); release();
    expect((await previous)[0]?.status).toBe('rejected');
    expect(auth.token).toBe('access-new-login');
    expect(auth.identity?.person.id).toBe('900103');
    expect(JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}').accessToken).toBe('access-new-login');
  });

  it('shows a login error when issued credentials are rejected during identity confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/login') ? response(pair()) : response(null, 401, 20001)));
    const auth = useIpdAuthStore();
    await expect(auth.login('fixture', 'fixture-password')).rejects.toThrow();
    expect(auth.error).toContain('登录已失效'); expect(auth.token).toBe('');
    expect(sessionStorage.getItem('ruoyi-ipd.session')).toBeNull();
  });

  it('offers a usable login recovery after an uncertain refresh during logout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/me')) return response(identity);
      if (url.endsWith('/refresh')) throw new TypeError('Connection lost');
      return response(null, 401, 20001);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password');
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/ipd/account', component: Account }, { path: '/auth/login', component: Login }] });
    await router.push('/ipd/account'); await router.isReady();
    const wrapper = mount(Account, { global: { plugins: [router] } });
    try {
      await wrapper.find('button').trigger('click');
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/auth/login'));
      expect(auth.error).toContain('无法确认');
      expect(JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}').refreshState).toBe('uncertain');
    } finally { wrapper.unmount(); }
  });

  it.each(['400', '403', '500', 'network', 'html401'])('does not refresh or replay a write after %s', async failure => {
    let writes = 0; let rotations = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/me')) return response(identity);
      // 平台票桥（2026-09-06）：login 后的换票调用显式分流为 404 降级，不参与写/轮换计数
      if (url.endsWith('/platform-token')) return response(null, 404, 50001);
      if (url.endsWith('/refresh')) { rotations++; return response(pair('two')); }
      writes++;
      if (failure === 'network') throw new TypeError('Connection lost');
      if (failure === 'html401') return new Response('<html>gateway</html>', { status: 401 });
      return response(null, Number(failure), failure === '400' ? 10001 : failure === '403' ? 30001 : 90001);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password');
    await expect(auth.changePassword('old-fixture', 'New-fixture-8')).rejects.toThrow();
    expect(writes).toBe(1); expect(rotations).toBe(0); expect(auth.token).toBe('access-one');
  });

  it.each(['401', 'network', '500', '400', 'invalid-success'])('never reuses the previous token after refresh %s', async failure => {
    let fail = false; let rotations = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/refresh')) {
        rotations++;
        if (failure === 'network') throw new TypeError('Connection lost');
        if (failure === 'invalid-success') return response({ ...pair('two'), token: 'access-one' });
        return response(null, Number(failure), failure === '401' ? 20001 : failure === '400' ? 10001 : 90001);
      }
      return fail ? response(null, 401, 20001) : response(identity);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password'); fail = true;
    await expect(auth.refreshIdentity()).rejects.toThrow();
    if (failure === '401') {
      expect(auth.token).toBe(''); expect(sessionStorage.getItem('ruoyi-ipd.session')).toBeNull();
    } else {
      expect(auth.token).toBe('access-one'); expect(auth.identity).toBeNull();
      expect(auth.requiresReauthentication).toBe(true);
      setActivePinia(createPinia());
      await expect(useIpdAuthStore().refreshIdentity()).rejects.toThrow('无法确认会话刷新结果');
    }
    expect(rotations).toBe(1);
  });

  it('retries a definite unauthorized write once and then stops on another401', async () => {
    let writes = 0; let rotations = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/me')) return response(identity);
      // 平台票桥（2026-09-06）：login 后的换票调用显式分流为 404 降级，不参与写/轮换计数
      if (url.endsWith('/platform-token')) return response(null, 404, 50001);
      if (url.endsWith('/refresh')) { rotations++; return response(pair('two')); }
      writes++; return response(null, 401, 20001);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password');
    await expect(auth.changePassword('old-fixture', 'New-fixture-8')).rejects.toThrow();
    expect(writes).toBe(2); expect(rotations).toBe(1); expect(auth.token).toBe('');
  });

  it('retains the token after an ordinary logout network failure and lets the visible retry succeed', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/me')) return response(identity);
      if (url.endsWith('/logout') && ++attempts === 1) throw new TypeError('Connection lost');
      return response(null);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password');
    await expect(auth.logout()).rejects.toThrow();
    expect(auth.requiresReauthentication).toBe(false); expect(auth.identity?.person.id).toBe('900103');
    expect(JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}').accessToken).toBe('access-one');
    await auth.logout(); expect(attempts).toBe(2); expect(sessionStorage.getItem('ruoyi-ipd.session')).toBeNull();
  });

  it.each(['HANDOVER_ONLY', 'PASSWORD_CHANGE_REQUIRED'])('applies %s from the rotation without elevation', async scope => {
    let expired = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/refresh')) return response({ ...pair('two'), scope, mustChangePwd: scope === 'PASSWORD_CHANGE_REQUIRED' });
      if (expired && new Headers(options?.headers).get('Authorization') === 'Bearer access-one') return response(null, 401, 20001);
      return response({ ...identity, scope: expired ? scope : 'FULL', mustChangePwd: expired && scope === 'PASSWORD_CHANGE_REQUIRED' });
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password');
    expired = true;
    await auth.refreshIdentity();
    expect(JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}').accessToken).toBe('access-two');
    expect(auth.identity?.scope).toBe(scope);
    expect(auth.mustChangePassword).toBe(scope === 'PASSWORD_CHANGE_REQUIRED');
  });

  it('reuses the completed rotation for a late401 from the old access token', async () => {
    let expired = false; let rejected = 0; let rotations = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/refresh')) { rotations++; return response(pair('two')); }
      if (expired && new Headers(options?.headers).get('Authorization') === 'Bearer access-one') {
        if (++rejected === 1) await gate;
        return response(null, 401, 20001);
      }
      return response(identity);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password'); expired = true;
    const delayed = auth.refreshIdentity(); await auth.refreshIdentity(); release(); await delayed;
    expect(rotations).toBe(1); expect(auth.token).toBe('access-two');
  });

  it('preserves unknown rotation state even when access fails immediately after login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/refresh')) throw new TypeError('Connection lost');
      return response(null, 401, 20001);
    }));
    const auth = useIpdAuthStore(); await expect(auth.login('fixture', 'fixture-password')).rejects.toThrow('无法确认');
    expect(auth.requiresReauthentication).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}').refreshState).toBe('uncertain');
  });

  it('refreshes an expired access before logout and clears the whole pair only after server success', async () => {
    let logoutCalls = 0; let rotations = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/me')) return response(identity);
      // 平台票桥（2026-09-06）：login 后的换票调用显式分流为 404 降级，不参与登出计数
      if (url.endsWith('/platform-token')) return response(null, 404, 50001);
      if (url.endsWith('/refresh')) { rotations++; return response(pair('two')); }
      logoutCalls++;
      return new Headers(options?.headers).get('Authorization') === 'Bearer access-one'
        ? response(null, 401, 20001) : response(null);
    }));
    const auth = useIpdAuthStore(); await auth.login('fixture', 'fixture-password'); await auth.logout();
    expect(logoutCalls).toBe(2); expect(rotations).toBe(1);
    expect(auth.token).toBe(''); expect(auth.identity).toBeNull(); expect(sessionStorage.getItem('ruoyi-ipd.session')).toBeNull();
  });

  it.each([{ token: '' }, { expiresIn: 0 }, { expiresIn: -1 }, { tokenType: 'Basic' }])('rejects incomplete or invalid login credentials %j', async invalid => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...pair(), ...invalid })));
    await expect(loginIpd('fixture', 'fixture-password')).rejects.toThrow('登录响应格式异常');
  });

  it('seals the session before sending so reload during a pending rotation cannot reuse it', async () => {
    let expired = false; let rotations = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/login')) return response(pair());
      if (url.endsWith('/refresh')) { rotations++; await gate; return response(pair('two')); }
      return expired && new Headers(options?.headers).get('Authorization') === 'Bearer access-one'
        ? response(null, 401, 20001) : response(identity);
    }));
    const original = useIpdAuthStore(); await original.login('fixture', 'fixture-password'); expired = true;
    const pending = Promise.allSettled([original.refreshIdentity()]);
    try {
      await vi.waitFor(() => expect(rotations).toBe(1));
      expect(JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}').refreshState).toBe('uncertain');
      setActivePinia(createPinia());
      const reloaded = useIpdAuthStore();
      await expect(reloaded.refreshIdentity()).rejects.toThrow('无法确认会话刷新结果');
      expect(rotations).toBe(1);
    } finally { release(); await pending; }
  });

});
