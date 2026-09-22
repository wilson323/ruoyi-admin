import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMemoryHistory, createRouter } from 'vue-router';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enterPlatform } from '../../../router/ipd-guard';
import { useIpdAuthStore } from '../../../store/ipd-auth';

/**
 * P3 拍板（owner 2026-09-21「恢复 AI 平台入口」）验收：换票端点、落地路径（跳过置顶 IPD 分组）、
 * 失败诚实降级（抛错且不静默跳转）。静态面锁定顶栏菜单挂载点（layouts/basic.vue），
 * 与 ipd-a11y.test.ts 对 ipd.vue 的负向锁互证。
 */
vi.mock('../../../router/access', () => ({
  generatePlatformAccess: async () => ({
    accessibleMenus: [
      {
        children: [{ name: '我的工作台', path: '/ipd/workbench' }],
        name: 'IPD 工作台',
        path: '/ipd',
      },
      {
        children: [{ name: 'Provider', path: '/chat/provider' }],
        name: '对话管理',
        path: '/chat',
      },
    ],
  }),
}));

const identity = {
  mustChangePwd: false,
  person: {
    accountStatus: 'ACTIVE',
    groupId: null,
    id: '900103',
    name: '测试人员',
    personType: 'MARKET_PM',
    username: 'fixture',
  },
  scope: 'FULL',
};

const pair = {
  ...identity,
  expiresIn: 900,
  token: 'access-one',
  tokenType: 'Bearer',
};
const ok = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({
      code,
      data,
      message: code ? '请求被拒绝' : 'ok',
      timestamp: '2026-09-21',
      traceId: null,
    }),
    { headers: { 'Content-Type': 'application/json' }, status },
  );

const tokenOk = () =>
  ok({
    expiresIn: 900,
    platformUser: 'ipd-admin',
    token: 'platform-one',
    tokenType: 'Bearer',
  });

function stubFetch(platform: (options?: RequestInit) => Response) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/login')) return ok(pair);
    if (url.endsWith('/me')) return ok(identity);
    if (url.endsWith('/platform-token')) return platform(options);
    return ok(null, 401, 20_001);
  });
}

function newRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ component: { template: '<div />' }, path: '/:pathMatch(.*)*' }],
  });
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('p3 — AI 平台入口恢复', () => {
  it('换票走 POST /api/v1/auth/platform-token，落地取平台分组首叶（跳过置顶 IPD 分组）', async () => {
    const fetcher = stubFetch(tokenOk);
    vi.stubGlobal('fetch', fetcher);
    await useIpdAuthStore().login('fixture', 'fixture-password');
    const router = newRouter();
    await router.push('/ipd/workbench');
    await router.isReady();
    expect(await enterPlatform(router)).toBe('/chat/provider');
    const calls = fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith('/platform-token'),
    );
    expect(calls[0]?.[0]).toBe('/api/v1/auth/platform-token');
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(
      new Headers(calls[calls.length - 1]?.[1]?.headers).get('Authorization'),
    ).toBe('Bearer access-one');
  });

  it('端点不可用（404）时抛错且停留在原页——诚实降级不静默跳转', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(() => ok(null, 404, 50_001)),
    );
    await useIpdAuthStore().login('fixture', 'fixture-password');
    const router = newRouter();
    await router.push('/ipd/workbench');
    await router.isReady();
    await expect(enterPlatform(router)).rejects.toThrow();
    expect(router.currentRoute.value.path).toBe('/ipd/workbench');
  });

  it('入口挂在顶栏用户菜单（basic.vue），IPD 壳（ipd.vue）不得再出现该入口', () => {
    const basic = readFileSync(
      resolve(__dirname, '../../../layouts/basic.vue'),
      'utf8',
    );
    expect(basic).toMatch(/text: '进入 AI 平台'/);
    expect(basic).toMatch(
      /import \{ enterPlatform \} from '#\/router\/ipd-guard';/,
    );
    expect(basic).toMatch(/await enterPlatform\(router\)/);
    expect(
      readFileSync(resolve(__dirname, '../../../layouts/ipd.vue'), 'utf8'),
    ).not.toMatch(/进入 AI 平台/);
  });
});
