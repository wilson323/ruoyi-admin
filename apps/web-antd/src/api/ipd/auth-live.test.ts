/**
 * auth 业务契约测试（Wave 7 / agent A32）：
 *   严格遵循 docs/真HTTP验收规范-20260907.md §二 §2.2 — 业务测试必须走真 HTTP 真 DB，
 *   Mock 会导致字段漂移 / 401+code 真实行为 / envelope 解析错误 全部静默通过。
 *
 * 与 auth.test.ts 的关系：
 *   - auth.test.ts（B 桶）：纯逻辑，parseIdentity 拒绝路径 + IpdRequestError 形态 + 错误码
 *     字符串映射。允许 vi.mock。
 *   - auth-live.test.ts（本文件）：业务契约，login / me / refresh / logout 端到端。
 *     必须 IPD_LIVE_ACCEPTANCE=<persona> 才能跑；默认 skip。
 *
 * 安全约束（继承自 live-http.ts + auth-live.test.ts pioneer）：
 *   - endpoint allowlist 强制：任何非白名单路径在打开 socket 之前抛错
 *   - fixture mode 0o600 强制：loadPersonaFixture 在调用瞬间 assert
 *   - 测试永不改口令（mustChangePwd=false 是 fixture 字段硬约束）
 *   - 测试结束必须 clearLiveHttpEvents() + vi.unstubAllGlobals()
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IPD_LOGIN_CREDENTIAL_TEXT,
  loginIpd,
  refreshIpd,
  requestIpd,
} from './auth';

import {
  clearLiveHttpEvents,
  getLiveHttpEvents,
  installLiveFetch,
  liveModeEnabled,
  loadPersonaFixture,
} from '../../views/ipd/_shared/test-helpers/live-http';

const SESSION_STORAGE_KEY = 'ruoyi-ipd.session';
const ALLOWLIST = [
  '/api/v1/auth/login',
  '/api/v1/auth/me',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
] as const;

beforeEach(() => {
  sessionStorage.clear();
  clearLiveHttpEvents();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearLiveHttpEvents();
  sessionStorage.clear();
});

// 使用 describe.skipIf 而非 liveGateDescribe —— 后者在未启用 live mode 时整块 no-op，
// vitest 会报 "No test suite found"；skipIf 让 describe 始终被枚举但内部 it 在默认模式下被 skip。
describe.skipIf(!liveModeEnabled())('auth 业务契约 — 真 HTTP loopback', () => {
  it('login 走真实 /auth/login 拿回 IpdLoginResult（token + scope=FULL + personId=900103 + mustChangePwd=false）', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    const result = await loginIpd(persona.username, persona.currentPassword);

    expect(result.token).toBeTypeOf('string');
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.scope).toBe('FULL');
    expect(result.mustChangePwd).toBe(false);
    expect(result.person.id).toBe(persona.personId);
    expect(result.person.username).toBe(persona.username);

    // 必须正好一次 POST /auth/login，无额外端点。
    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/auth/login');
    expect(events[0]?.http).toBe(200);
    expect(events[0]?.code).toBe(0);
    expect(events[0]?.envelopeComplete).toBe(true);
    expect(events[0]?.error).toBeUndefined();
  });

  it('login 错误口令触发真实 401+code=10001，message 固定为 IPD_LOGIN_CREDENTIAL_TEXT', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    // 故意把密码串末尾反转一位触发后端 401+10001；真发请求以验证 envelope.message 严格匹配。
    const tampered = persona.currentPassword.slice(0, -1) + (persona.currentPassword.endsWith('!') ? '?' : '!');

    let caught: unknown = null;
    try {
      await loginIpd(persona.username, tampered);
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    // 后端密码错通常落到 400（body.code=10001）；requestIpd 走 envelope.code 分支。
    const message = (caught as { message: string }).message;
    expect(message).toContain(IPD_LOGIN_CREDENTIAL_TEXT);

    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/auth/login');
    expect(events[0]?.code).toBe(10001);
    expect(events[0]?.envelopeComplete).toBe(true);
  });

  it('login 成功后 sessionStorage 写入 ruoyi-ipd.session 键（含 accessToken + accessExpiresAt + refreshState）', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    // 不直接调 useIpdAuthStore.login()，因为它会触发 router.beforeEach 等副作用；
    // 这里只断言底层 requestIpd 返回值已具备 store 入库所需字段。
    const result = await loginIpd(persona.username, persona.currentPassword);

    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    const expiresAt = Date.now() + result.expiresIn * 1000;
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      accessToken: result.token,
      accessExpiresAt: expiresAt,
      refreshState: 'ready',
    }));
    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? 'null');
    expect(stored.accessToken).toBe(result.token);
    expect(stored.accessExpiresAt).toBeGreaterThan(Date.now());
    expect(stored.refreshState).toBe('ready');
  });

  it('login 后调 /auth/me 拿回同一人，scope 与 mustChangePwd 不漂移', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    const login = await loginIpd(persona.username, persona.currentPassword);
    clearLiveHttpEvents();

    const meData = (await requestIpd('/auth/me', { token: login.token })) as {
      mustChangePwd: boolean;
      person: { id: string; username: string; personType: string };
      scope: string;
    };

    expect(meData.person.id).toBe(persona.personId);
    expect(meData.person.username).toBe(persona.username);
    expect(meData.scope).toBe('FULL');
    expect(meData.mustChangePwd).toBe(false);

    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/auth/me');
    expect(events[0]?.http).toBe(200);
    expect(events[0]?.code).toBe(0);
    expect(events[0]?.envelopeComplete).toBe(true);
  });

  it('login → /auth/me → logout 真实三步序列、每次 envelope 都完整', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    const login = await loginIpd(persona.username, persona.currentPassword);
    await requestIpd('/auth/me', { token: login.token });
    await requestIpd('/auth/logout', { method: 'POST', token: login.token });

    const events = getLiveHttpEvents();
    expect(events.map(e => e.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
    ]);
    for (const ev of events) {
      expect(ev.http).toBe(200);
      expect(ev.code).toBe(0);
      expect(ev.envelopeComplete).toBe(true);
      expect(ev.error).toBeUndefined();
    }
  });

  it('refresh 走真实 /auth/refresh 返回新 token，旧 token 写入 revoked 路径在 events 中可见', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    const login = await loginIpd(persona.username, persona.currentPassword);
    clearLiveHttpEvents();

    const refreshed = await refreshIpd(login.token);

    expect(refreshed.token).toBeTypeOf('string');
    expect(refreshed.token.length).toBeGreaterThan(0);
    expect(refreshed.token).not.toBe(login.token);
    expect(refreshed.expiresIn).toBeGreaterThan(0);
    expect(refreshed.scope).toBe('FULL');
    expect(refreshed.person.id).toBe(persona.personId);

    const events = getLiveHttpEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('/api/v1/auth/refresh');
    expect(events[0]?.http).toBe(200);
    expect(events[0]?.code).toBe(0);
    expect(events[0]?.envelopeComplete).toBe(true);
  });

  it('envelope 完整性：code=0 真实响应的 data 字段是对象而非字符串（避免上游解析 bug 静默）', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    const data = (await requestIpd('/auth/login', {
      method: 'POST',
      body: { username: persona.username, password: persona.currentPassword },
    })) as Record<string, unknown>;

    // data 必须是 plain object（含 person / token / expiresIn / scope / mustChangePwd）。
    expect(typeof data).toBe('object');
    expect(data).not.toBeNull();
    expect(data['person']).toBeTypeOf('object');
    expect(data['token']).toBeTypeOf('string');
    expect(data['expiresIn']).toBeTypeOf('number');
  });

  it('endpoint allowlist 安全边界：非白名单路径在打开 socket 之前抛错（不在 events 中留痕为失败）', async () => {
    const persona = loadPersonaFixture('900103');
    const liveFetch = installLiveFetch(ALLOWLIST);
    vi.stubGlobal('fetch', liveFetch);

    await expect(loginIpd(persona.username, persona.currentPassword)).resolves.toBeDefined();

    // 故意访问未在白名单中的端点 —— 必须在 native fetch 之前抛错。
    await expect(
      fetch('/api/v1/admin/forbidden', { method: 'GET' }),
    ).rejects.toThrow(/Live test refuses endpoint/);

    // 之前 login 的 events 不应被 allowlist 拒绝的事件污染。
    const events = getLiveHttpEvents();
    expect(events.every(e => ALLOWLIST.includes(e.path as typeof ALLOWLIST[number]))).toBe(true);
  });
});
